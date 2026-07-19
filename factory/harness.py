#!/usr/bin/env python3
"""Scoring harness for the LLM heuristic factory.

The evolvable slot is the Iterated Greedy **destroy operator**: given the current
schedule, decide which d jobs to rip out. The thesis (and IG-DOE 2026 on flow
shop) show this is where evolved operators pay off. A candidate is a function

    destroy_score(feat) -> float      # higher = more likely to be destroyed

evaluated per scheduled job over a feature dict; the harness removes the top-d.
A candidate is scored by running the IG with that operator on a train split of
MaScLib instances (fixed iteration budget, so scores are deterministic and
comparable) and returning the mean relative gap to the best-known values.
Lower is better; random destruction is the baseline every candidate must beat.
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))
from ig_scheduler import Instance, solve  # noqa: E402

BEST = json.loads((ROOT / "benchmark.json").read_text())

# Train / test split — instances where destruction choice actually matters
# (nonzero gaps for basic IG, meaningful iteration). Test is held out for honest
# reporting of generalization.
TRAIN = ["NCOS_13", "NCOS_14", "NCOS_31a", "STC_NCOS_32a"]
TEST = ["NCOS_12a", "NCOS_41a", "STC_NCOS_41a"]

FEATURES = ("late", "slack", "proc", "setup_credits", "reject_credits", "position", "weight")


def _instance(name: str) -> Instance:
    return Instance.parse(ROOT / "masclib" / f"{name}.csv")


def _features(state) -> list[tuple[int, dict]]:
    """Per-scheduled-job features for the current schedule."""
    inst, order, fin = state.inst, state.order, state.fin
    n = max(1, len(order))
    out = []
    prev_fam = inst.init_state
    for i, jid in enumerate(order):
        j = inst.jobs[jid]
        setup_c = inst.setup_c[prev_fam][j.fam] / 10.0
        out.append((jid, {
            "late": max(0, fin[i] - j.due),
            "slack": j.due - fin[i],
            "proc": j.p,
            "setup_credits": setup_c,
            "reject_credits": j.rej / 10.0,
            "position": i / n,
            "weight": j.w / 10.0,
        }))
        prev_fam = j.fam
    return out


def make_destroy(score_fn, temp: float = 1.0):
    """Wrap a per-job score function into an IG destroy operator that *samples* d
    jobs biased by the score (standardized softmax), rather than taking a fixed
    top-d. Deterministic top-d kills the diversification that makes IG work — a
    biased sampler keeps the learned preference while preserving exploration, and
    degrades to exactly random destruction when all scores are equal."""
    import math

    def destroy(state, d, rng: random.Random):
        feats = _features(state)
        if not feats:
            return []
        raw = []
        for jid, f in feats:
            try:
                s = float(score_fn(f))
            except Exception:
                s = 0.0
            if s != s:  # NaN guard
                s = 0.0
            raw.append(s)
        m = sum(raw) / len(raw)
        var = sum((s - m) ** 2 for s in raw) / len(raw)
        sd = math.sqrt(var) or 1.0
        weights = [math.exp((s - m) / (sd * temp)) for s in raw]
        # weighted sampling without replacement (roulette)
        pool = list(zip(weights, (jid for jid, _ in feats)))
        chosen = []
        for _ in range(min(d, len(pool))):
            tot = sum(w for w, _ in pool)
            r = rng.random() * tot
            acc = 0.0
            for i, (w, jid) in enumerate(pool):
                acc += w
                if acc >= r:
                    chosen.append(jid)
                    pool.pop(i)
                    break
        return chosen
    return destroy


def score_candidate(score_fn, split=None, iters=90, seed=1, seeds=None) -> float:
    """Mean relative gap (%) to best-known over `split`, running the IG with the
    candidate destroy operator for `iters` iterations. Lower is better.
    Pass `seeds` (an iterable) to average over several IG seeds — single-seed
    scores let evolution exploit one lucky trajectory (the overfitting failure
    mode documented in RESULTS.md); multi-seed scoring removes that exploit."""
    split = split or TRAIN
    destroy = make_destroy(score_fn)
    gaps = []
    for name in split:
        inst = _instance(name)
        best_known = BEST[name][1]
        for sd in (seeds if seeds is not None else (seed,)):
            r = solve(inst, d=2, accept="current", permute=True,
                      max_iters=iters, seed=sd, destroy_fn=destroy)
            gaps.append(100.0 * (r.best_cost - best_known) / best_known)
    return sum(gaps) / len(gaps)


def baseline_gap(split=None, iters=90, seed=1, seeds=None) -> float:
    """Random destruction — the score every candidate must beat."""
    split = split or TRAIN
    gaps = []
    for name in split:
        inst = _instance(name)
        best_known = BEST[name][1]
        for sd in (seeds if seeds is not None else (seed,)):
            r = solve(inst, d=2, accept="current", permute=True, max_iters=iters, seed=sd)
            gaps.append(100.0 * (r.best_cost - best_known) / best_known)
    return sum(gaps) / len(gaps)


if __name__ == "__main__":
    print(f"train {TRAIN}")
    print(f"baseline (random destroy) mean gap: {baseline_gap():.3f}%")
    # a hand-written heuristic for reference: destroy the latest, loosest, priciest-to-keep
    ref = lambda f: f["late"] * f["weight"] - f["slack"] + f["setup_credits"]
    print(f"reference heuristic mean gap:        {score_candidate(ref):.3f}%")
