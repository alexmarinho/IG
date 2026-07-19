#!/usr/bin/env python3
"""Evolve an IG destroy operator — the LLM heuristic factory.

Two mutation backends behind one evolution loop:

  --backend local   built-in mutation over a feature basis (no API key, runs in
                    CI, fully reproducible). Proves the loop and produces a real
                    evolved operator offline.
  --backend llm     an LLM writes/mutates free-form Python for `destroy_score`,
                    given the task and the current elite heuristics + their
                    scores (FunSearch / EoH / ReEvo style). Needs an
                    OpenAI-compatible endpoint — set the vars in .env (see
                    .env.example); DeepSeek is the default target. This script
                    never sees your key beyond passing os.environ through.

    python factory/evolve.py --backend local  --gens 8 --pop 12
    python factory/evolve.py --backend llm --gens 6 --pop 8

The winner's mean gap vs. the random-destruction baseline is printed on train
and on a held-out test split.
"""
from __future__ import annotations

import argparse
import os
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import FEATURES, TEST, TRAIN, baseline_gap, score_candidate  # noqa: E402

# ------------------------------------------------------------------ local backend

BASIS = list(FEATURES) + ["late*weight", "slack*proc", "setup_credits*position"]


def local_score_fn(genome: dict):
    def fn(f):
        s = 0.0
        for k, w in genome.items():
            if w == 0.0:
                continue
            if k == "late*weight":
                s += w * f["late"] * f["weight"]
            elif k == "slack*proc":
                s += w * f["slack"] * f["proc"]
            elif k == "setup_credits*position":
                s += w * f["setup_credits"] * f["position"]
            else:
                s += w * f[k]
        return s
    return fn


def local_seed(rng): return {k: rng.uniform(-1, 1) for k in BASIS}


def local_mutate(g, rng):
    child = dict(g)
    for k in BASIS:
        if rng.random() < 0.4:
            child[k] += rng.gauss(0, 0.6)
    return child


def local_cross(a, b, rng):
    return {k: (a[k] if rng.random() < 0.5 else b[k]) for k in BASIS}


def local_repr(g):
    terms = [f"{w:+.2f}·{k}" for k, w in g.items() if abs(w) > 0.05]
    return " ".join(terms) or "0"


# ------------------------------------------------------------------ llm backend

LLM_PROMPT = """You are evolving the destroy operator of an Iterated Greedy metaheuristic for
single-machine scheduling with rejection and tardiness. Each iteration removes d
scheduled jobs so the greedy repair can rebuild a cheaper schedule. Write the body
of a Python function that scores one scheduled job — higher score = more likely to
be removed. Choosing which jobs to disturb well is the whole game: remove the ones
whose replacement most helps.

The argument `f` is a dict with these keys (all floats):
  late            : how many seconds this job finishes past its due date (0 if on time)
  slack           : due - finish (negative when late; large positive = very early)
  proc            : processing time
  setup_credits   : setup cost paid to run this job after the previous one
  reject_credits  : what would be paid to reject this job instead
  position        : index in the schedule, 0..1
  weight          : tardiness penalty per second late

Return ONLY a Python expression or a short function body ending in `return <score>`.
No imports, no explanation. Current best heuristics and their mean gap %% (lower is
better; random destruction scores {baseline:.3f}%%):
{elites}

Write one new, different heuristic likely to score lower:"""


def llm_call(prompt: str) -> str:
    import json
    import urllib.request
    base = os.environ.get("OPENAI_BASE_URL", "https://api.deepseek.com")
    key = os.environ.get("OPENAI_API_KEY")
    model = os.environ.get("OPENAI_MODEL", "deepseek-chat")
    if not key:
        raise SystemExit("set OPENAI_API_KEY (and optionally OPENAI_BASE_URL/OPENAI_MODEL) — see .env.example")
    req = urllib.request.Request(
        base.rstrip("/") + "/v1/chat/completions",
        data=json.dumps({"model": model, "temperature": 1.0,
                         "messages": [{"role": "user", "content": prompt}]}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"]


def llm_compile(text: str):
    """Turn an LLM reply into a scoring function; None if it won't compile/run."""
    body = text.strip().strip("`")
    if body.startswith("python"):
        body = body[6:]
    body = body.strip()
    if "return" not in body:
        body = "return " + body.splitlines()[-1]
    src = "def _h(f):\n" + "\n".join("    " + ln for ln in body.splitlines())
    ns: dict = {}
    try:
        exec(src, {"__builtins__": {"min": min, "max": max, "abs": abs}}, ns)
        fn = ns["_h"]
        fn({k: 1.0 for k in FEATURES})  # smoke test
        return fn, body
    except Exception:
        return None, None


# ------------------------------------------------------------------ evolution loop


def evolve(backend: str, gens: int, pop: int, iters: int, seed: int, eval_seeds: int = 3):
    rng = random.Random(seed)
    ES = tuple(range(1, eval_seeds + 1))
    score = lambda fn: score_candidate(fn, iters=iters, seeds=ES)
    base = baseline_gap(iters=iters, seeds=ES)
    print(f"baseline (random destroy): {base:.3f}%  ·  backend={backend}  eval_seeds={eval_seeds}  train={TRAIN}")

    # (score, genome, repr, score_fn)
    population = []
    if backend == "local":
        for _ in range(pop):
            g = local_seed(rng)
            population.append([score(local_score_fn(g)), g, local_repr(g), local_score_fn(g)])
    else:
        seeds = ["f['late'] * f['weight']", "f['reject_credits'] - f['slack']", "f['setup_credits']"]
        for txt in seeds[:pop]:
            fn, body = llm_compile(txt)
            if fn:
                population.append([score(fn), body, body, fn])
    population.sort(key=lambda r: r[0])
    print(f"gen 0 best: {population[0][0]:.3f}%  [{population[0][2][:70]}]")

    for gen in range(1, gens + 1):
        elites = population[: max(2, pop // 3)]
        children = []
        while len(children) < pop:
            if backend == "local":
                # 20% fresh random immigrants keep the population from collapsing
                if rng.random() < 0.2:
                    g = local_seed(rng)
                else:
                    a, b = rng.choice(elites), rng.choice(elites)
                    g = local_mutate(local_cross(a[1], b[1], rng), rng)
                fn = local_score_fn(g)
                children.append([score(fn), g, local_repr(g), fn])
            else:
                elite_txt = "\n".join(f"  {e[0]:.3f}%: {e[2][:80]}" for e in elites)
                prompt = LLM_PROMPT.format(baseline=base, elites=elite_txt)
                fn, body = llm_compile(llm_call(prompt))
                if fn:
                    children.append([score(fn), body, body, fn])
        population = sorted(elites + children, key=lambda r: r[0])[:pop]
        print(f"gen {gen} best: {population[0][0]:.3f}%  [{population[0][2][:70]}]")

    best = population[0]
    HOLD = (11, 12, 13, 14, 15)  # fresh seeds, disjoint from the evolution seeds
    tr = score_candidate(best[3], iters=iters, seeds=HOLD)
    te = score_candidate(best[3], split=TEST, iters=iters, seeds=HOLD)
    btr = baseline_gap(iters=iters, seeds=HOLD)
    bte = baseline_gap(split=TEST, iters=iters, seeds=HOLD)
    print("\n=== winner (held-out seeds 11-15) ===")
    print(f"heuristic: {best[2]}")
    print(f"train gap: {tr:.3f}%  (random {btr:.3f}%  →  {btr - tr:+.3f}pp)")
    print(f"test  gap: {te:.3f}%  (random {bte:.3f}%  →  {bte - te:+.3f}pp)")
    return best


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--backend", choices=["local", "llm"], default="local")
    ap.add_argument("--gens", type=int, default=8)
    ap.add_argument("--pop", type=int, default=12)
    ap.add_argument("--iters", type=int, default=90)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--eval-seeds", type=int, default=3,
                    help="IG seeds averaged per candidate score (1 = the old exploitable mode)")
    a = ap.parse_args()
    evolve(a.backend, a.gens, a.pop, a.iters, a.seed, a.eval_seeds)


if __name__ == "__main__":
    main()
