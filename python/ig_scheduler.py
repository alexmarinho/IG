#!/usr/bin/env python3
"""Iterated Greedy for scheduling with rejection (OAS / MaScLib).

The 2015 algorithm, rewritten as the 2017 Python version should have been:
no deepcopy, incremental evaluation (recompute only downstream of an edit and
stop at the first absorbing idle gap), plain data structures, zero runtime
dependencies. Semantics are identical to the validated Rust engine in
``engine/``: cost = setup cost + mode cost + weighted tardiness (ASAP timing)
for performed jobs, plus rejection costs; money is kept in integer deci-units
(x10) because the data has fractional tardiness weights.

Command line (installed by the package as ``ig-solve``):

    ig-solve masclib/NCOS_31.csv --seconds 5

From a checkout (adds the benchmark validation harness):

    python python/ig_scheduler.py solve masclib/NCOS_31.csv --seconds 5
    python python/ig_scheduler.py validate masclib benchmark.json --seconds 2

As a library:

    from ig_scheduler import Instance, solve

    inst = Instance.parse("masclib/NCOS_31.csv")
    result = solve(inst, seconds=5.0)
    print(result.best_cost, result.order)
"""
from __future__ import annotations

import random
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

__version__ = "1.0.0"

__all__ = ["Instance", "Job", "Result", "State", "main", "solve"]

#: A custom destroy operator: ``(state, d, rng) -> scheduled job ids to remove``.
DestroyFn = Callable[["State", int, random.Random], Iterable[int]]


# ---------------------------------------------------------------- instance


@dataclass(frozen=True, slots=True)
class Job:
    """One activity of an instance. Money fields are deci-units (x10)."""

    id: int
    fam: int      # setup-state family
    p: int        # processing time
    rel: int      # release date (START_MIN)
    due: int
    w: int        # tardiness weight, deci-units
    mode: int     # mode cost, deci-units
    rej: int      # rejection (unperformed) cost, deci-units
    end_max: int  # hard completion deadline


class _Row:
    """One data line of a MASC CSV section, with header-aware typed accessors."""

    __slots__ = ("_cells", "_cols")

    def __init__(self, cols: dict[str, int], cells: list[str]) -> None:
        self._cols = cols
        self._cells = cells

    def get(self, name: str) -> str | None:
        idx = self._cols.get(name)
        return self._cells[idx] if idx is not None else None

    def geti(self, name: str, default: int = 0) -> int:
        v = self.get(name)
        return int(float(v)) if v not in (None, "") else default

    def deci(self, name: str, default: int = 0) -> int:
        """Money field in deci-units (the data has 0.1-granular weights)."""
        v = self.get(name)
        return round(float(v) * 10) if v not in (None, "") else default


@dataclass(slots=True)
class Instance:
    """A parsed single-machine MASC instance (see ``masclib/README.md``)."""

    name: str
    jobs: list[Job]
    n_states: int
    init_state: int
    setup_t: list[list[int]]  # [from][to] time
    setup_c: list[list[int]]  # [from][to] cost, deci-units

    @property
    def n(self) -> int:
        """Number of jobs."""
        return len(self.jobs)

    @classmethod
    def parse(cls, path: str | Path) -> Instance:
        """Parse a MASC CSV file; the instance name falls back to the file stem."""
        path = Path(path)
        return cls.parse_text(path.read_text(), path.stem)

    @classmethod
    def parse_text(cls, text: str, fallback_name: str = "?") -> Instance:
        """Parse MASC CSV text.

        Sections are self-describing: a ``SECTION|NAMES,COL,...`` header line
        declares the columns, then ``SECTION,...`` data lines follow. Missing
        columns fall back to defaults. Multi-machine files (several RESOURCE
        rows, or several MODE rows for one activity) are rejected loudly.
        """
        columns: dict[str, dict[str, int]] = {}  # section -> column -> cell index
        name = fallback_name
        init_state = 0
        n_resources = 0
        fams: dict[int, int] = {}
        dues: dict[int, tuple[int, int]] = {}
        modes: dict[int, tuple[int, int, int, int, int]] = {}
        setups: list[tuple[int, int, int, int]] = []

        for raw in text.splitlines():
            line = raw.strip()
            if not line:
                continue
            cells = line.split(",")
            tag = cells[0]
            if "|" in tag:
                sec, kind = tag.split("|", 1)
                if kind == "NAMES":
                    cols: dict[str, int] = {}
                    for i, cname in enumerate(cells[1:], start=1):
                        cols.setdefault(cname, i)  # first occurrence wins
                    columns[sec] = cols
                continue

            row = _Row(columns.get(tag, {}), cells)
            if tag == "MODEL":
                name = row.get("NAME") or name
            elif tag == "RESOURCE":
                n_resources += 1
                if n_resources > 1:
                    raise ValueError(
                        "multi-resource (multi-machine) instances are not supported yet; "
                        "this parser would silently collapse them to a wrong single-machine instance")
                init_state = row.geti("INITIAL_SETUP_STATE")
            elif tag == "ACTIVITY":
                fams[row.geti("ACTIVITY_ID")] = row.geti("SETUP_STATE")
            elif tag == "SETUP_MATRIX":
                setups.append((row.geti("FROM_STATE"), row.geti("TO_STATE"),
                               row.geti("SETUP_TIME"), row.deci("SETUP_COST")))
            elif tag == "DUE_DATE":
                dues[row.geti("ACTIVITY_ID")] = (row.geti("DUE_TIME"),
                                                 row.deci("TARDINESS_VARIABLE_COST"))
            elif tag == "MODE":
                if row.geti("ACTIVITY_ID") in modes:
                    raise ValueError(
                        "multiple MODE rows for one activity (machine-choice instances) are not "
                        "supported yet; the last row would silently win")
                modes[row.geti("ACTIVITY_ID")] = (
                    row.deci("MODE_COST"), row.geti("PROCESSING_TIME"), row.geti("START_MIN"),
                    row.geti("END_MAX", 2**60), row.deci("UNPERFORMED_COST"))

        n_states = max([f + 1 for f, _, _, _ in setups]
                       + [t + 1 for _, t, _, _ in setups]
                       + [init_state + 1, 1])
        setup_t = [[0] * n_states for _ in range(n_states)]
        setup_c = [[0] * n_states for _ in range(n_states)]
        for f, t, stime, scost in setups:
            setup_t[f][t] = stime
            setup_c[f][t] = scost

        jobs = []
        for jid in sorted(modes):
            mode, p, rel, end_max, rej = modes[jid]
            due, w = dues.get(jid, (end_max, 0))
            jobs.append(Job(jid, fams.get(jid, 0), p, rel, due, w, mode, rej, end_max))
        return cls(name, jobs, n_states, init_state, setup_t, setup_c)


# ---------------------------------------------------------------- evaluator


class State:
    """One solution: sequence Pi + rejected set Omega, with cached finish times
    and cumulative costs so a candidate edit is evaluated in O(k) — k = jobs
    until the shift is absorbed by an idle gap. All costs are deci-units."""

    __slots__ = ("cum", "fin", "in_seq", "inst", "order", "perf_cost", "rej_cost")

    def __init__(self, inst: Instance) -> None:
        self.inst = inst
        self.order: list[int] = []              # scheduled job ids, in sequence
        self.in_seq: list[bool] = [False] * inst.n
        self.fin: list[int] = []                # finish time per position
        self.cum: list[int] = []                # cumulative performed cost per position
        self.perf_cost = 0
        self.rej_cost = sum(j.rej for j in inst.jobs)

    def total(self) -> int:
        """Total cost (performed + rejected), deci-units."""
        return self.perf_cost + self.rej_cost

    def rejected(self) -> list[int]:
        """Job ids currently not in the sequence."""
        in_seq = self.in_seq
        return [j for j in range(self.inst.n) if not in_seq[j]]

    def clone_from(self, other: State) -> None:
        """Become a copy of `other` (shares only the immutable instance)."""
        self.order = other.order[:]
        self.in_seq = other.in_seq[:]
        self.fin = other.fin[:]
        self.cum = other.cum[:]
        self.perf_cost = other.perf_cost
        self.rej_cost = other.rej_cost

    def rebuild(self) -> None:
        """Recompute finish times and cumulative costs from scratch."""
        inst = self.inst
        jobs, setup_t, setup_c = inst.jobs, inst.setup_t, inst.setup_c
        fin: list[int] = []
        cum: list[int] = []
        t, state, total = 0, inst.init_state, 0
        for jid in self.order:
            j = jobs[jid]
            stime = setup_t[state][j.fam]
            rel_s = j.rel - stime
            f = (t if t > rel_s else rel_s) + stime + j.p
            td = f - j.due
            total += setup_c[state][j.fam] + j.mode + (td * j.w if td > 0 else 0)
            fin.append(f)
            cum.append(total)
            t, state = f, j.fam
        self.fin, self.cum, self.perf_cost = fin, cum, total

    def _before(self, pos: int) -> tuple[int, int]:
        """(finish time, setup state) of the machine just before `pos`."""
        if pos == 0:
            return 0, self.inst.init_state
        return self.fin[pos - 1], self.inst.jobs[self.order[pos - 1]].fam

    def try_insert(self, jid: int, pos: int, cutoff: int | None = None) -> int | None:
        """Total cost after inserting `jid` at `pos`, or None if infeasible.

        `cutoff` enables exact lower-bound pruning. Every cost that enters the
        objective is non-negative, so the partial cost accumulated over the jobs
        walked so far (``prefix + rejection deltas + new``) can only grow as the
        walk continues and is therefore a valid lower bound on the final
        candidate cost. Once that running bound reaches `cutoff` the candidate can
        never be selected (selection is strict ``<``), so we stop the walk and
        return the bound. Pass `cutoff` only on non-negative-cost instances;
        without it the result is byte-for-byte the old behaviour. A candidate that
        *can* win never trips the bound, so its returned cost is always exact.
        """
        inst = self.inst
        jobs, setup_t, setup_c = inst.jobs, inst.setup_t, inst.setup_c
        order, fin, cum = self.order, self.fin, self.cum
        j = jobs[jid]
        t, state = self._before(pos)
        stime = setup_t[state][j.fam]
        rel_s = j.rel - stime
        f = (t if t > rel_s else rel_s) + stime + j.p
        if f > j.end_max:
            return None
        td = f - j.due
        new = setup_c[state][j.fam] + j.mode + (td * j.w if td > 0 else 0)
        t, state = f, j.fam
        prefix = cum[pos - 1] if pos else 0
        tail = prefix + self.rej_cost - j.rej
        budget = None if cutoff is None else cutoff - tail  # bail once new >= budget
        for i in range(pos, len(order)):
            k = jobs[order[i]]
            stime = setup_t[state][k.fam]
            rel_s = k.rel - stime
            f = (t if t > rel_s else rel_s) + stime + k.p
            if f > k.end_max:
                return None
            td = f - k.due
            new += setup_c[state][k.fam] + k.mode + (td * k.w if td > 0 else 0)
            if budget is not None and new >= budget:  # tail+new >= cutoff: can't win
                return tail + new
            t, state = f, k.fam
            if i > pos and f == fin[i]:  # absorbed by an idle gap
                return tail + new + (self.perf_cost - cum[i])
        return tail + new

    def try_replace(self, jid: int, pos: int, cutoff: int | None = None) -> int | None:
        """Total cost after swapping rejected `jid` with the job at `pos`.

        `cutoff` enables the same exact lower-bound pruning as `try_insert`
        (see its docstring); pass it only on non-negative-cost instances.
        """
        inst = self.inst
        jobs, setup_t, setup_c = inst.jobs, inst.setup_t, inst.setup_c
        order, fin, cum = self.order, self.fin, self.cum
        out, j = jobs[order[pos]], jobs[jid]
        t, state = self._before(pos)
        stime = setup_t[state][j.fam]
        rel_s = j.rel - stime
        f = (t if t > rel_s else rel_s) + stime + j.p
        if f > j.end_max:
            return None
        td = f - j.due
        new = setup_c[state][j.fam] + j.mode + (td * j.w if td > 0 else 0)
        t, state = f, j.fam
        prefix = cum[pos - 1] if pos else 0
        tail = prefix + self.rej_cost - j.rej + out.rej
        budget = None if cutoff is None else cutoff - tail  # bail once new >= budget
        for i in range(pos + 1, len(order)):
            k = jobs[order[i]]
            stime = setup_t[state][k.fam]
            rel_s = k.rel - stime
            f = (t if t > rel_s else rel_s) + stime + k.p
            if f > k.end_max:
                return None
            td = f - k.due
            new += setup_c[state][k.fam] + k.mode + (td * k.w if td > 0 else 0)
            if budget is not None and new >= budget:  # tail+new >= cutoff: can't win
                return tail + new
            t, state = f, k.fam
            if i > pos + 1 and f == fin[i]:  # absorbed by an idle gap
                return tail + new + (self.perf_cost - cum[i])
        return tail + new

    def insert(self, jid: int, pos: int) -> None:
        """Insert rejected job `jid` at `pos` and rebuild the caches."""
        self.order.insert(pos, jid)
        self.in_seq[jid] = True
        self.rej_cost -= self.inst.jobs[jid].rej
        self.rebuild()

    def replace(self, jid: int, pos: int) -> None:
        """Swap rejected job `jid` with the scheduled job at `pos` and rebuild."""
        out = self.order[pos]
        self.in_seq[out] = False
        self.rej_cost += self.inst.jobs[out].rej
        self.order[pos] = jid
        self.in_seq[jid] = True
        self.rej_cost -= self.inst.jobs[jid].rej
        self.rebuild()

    def remove_random(self, d: int, rng: random.Random) -> None:
        """Remove up to `d` random scheduled jobs (the classic IG destruction)."""
        for _ in range(min(d, len(self.order))):
            jid = self.order.pop(rng.randrange(len(self.order)))
            self.in_seq[jid] = False
            self.rej_cost += self.inst.jobs[jid].rej
        self.rebuild()

    def remove_jobs(self, jobs: Iterable[int]) -> None:
        """Remove a specific set of scheduled jobs (used by custom destroy operators)."""
        drop = set(jobs)
        self.order = [j for j in self.order if j not in drop]
        for jid in drop:
            if self.in_seq[jid]:
                self.in_seq[jid] = False
                self.rej_cost += self.inst.jobs[jid].rej
        self.rebuild()


# ---------------------------------------------------------------- IG


@dataclass(slots=True)
class Result:
    """Outcome of one `solve` run. Costs are in data units (deci / 10)."""

    best_cost: float
    order: list[int]
    rejected: list[int]
    iterations: int
    evaluations: int
    elapsed: float
    log: list[tuple[int, float]] = field(default_factory=list)  # (iteration, cost)


def _construct(s: State, rng: random.Random, prune: bool = False) -> int:
    """Greedy rebuild: insert each pending job at its cheapest feasible position,
    only when that beats staying rejected. Returns candidate evaluations done.

    When `prune` is set (a non-negative-cost instance) two exact prunings fire:
    the inner lower-bound bail inside `try_insert`, and an outer position break —
    once the fixed prefix cost ``cum[pos-1]`` reaches the best candidate found so
    far, no later position can win (``cum`` is non-decreasing). Skipped positions
    are credited to `evals` so the reported count is identical to the full scan.
    """
    evals = 0
    pend = s.rejected()
    rng.shuffle(pend)
    for jid in pend:
        best_pos, best_cost = -1, s.total()
        cutoff = best_cost if prune else None
        npos = len(s.order) + 1
        cum = s.cum
        for pos in range(npos):
            if cutoff is not None and pos and cum[pos - 1] >= best_cost:
                evals += npos - pos  # no later position can beat best_cost
                break
            evals += 1
            c = s.try_insert(jid, pos, cutoff)
            if c is not None and c < best_cost:
                best_pos, best_cost = pos, c
                cutoff = best_cost
        if best_pos >= 0:
            s.insert(jid, best_pos)
    return evals


def _permute(s: State, rng: random.Random, prune: bool = False) -> int:
    """Swap pass: try exchanging each rejected job with each scheduled one,
    keeping the cheapest improving swap. Returns candidate evaluations done.
    With `prune`, `try_replace` bails early via the same exact lower bound."""
    evals = 0
    pend = s.rejected()
    rng.shuffle(pend)
    for jid in pend:
        best_pos, best_cost = -1, s.total()
        cutoff = best_cost if prune else None
        for pos in range(len(s.order)):
            evals += 1
            c = s.try_replace(jid, pos, cutoff)
            if c is not None and c < best_cost:
                best_pos, best_cost = pos, c
                cutoff = best_cost
        if best_pos >= 0:
            s.replace(jid, best_pos)
    return evals


def solve(inst: Instance, *, seconds: float = 5.0, d: int = 2,
          accept: str = "current", permute: bool = True,
          target: float | None = None, seed: int = 1,
          max_iters: int | None = None,
          destroy_fn: DestroyFn | None = None) -> Result:
    """Run the Iterated Greedy for `seconds` (or `max_iters`, or until `target`).

    Args:
        inst: the parsed instance.
        seconds: wall-clock budget (ignored when `max_iters` is given).
        d: jobs removed per destruction step.
        accept: ``"current"`` (accept the new schedule, classic IG walk) or
            ``"best"`` (restart each iteration from the incumbent).
        permute: run the scheduled/rejected swap pass after each rebuild.
        target: stop early once the best cost (data units) reaches this value.
        seed: RNG seed; runs with `max_iters` are fully deterministic.
        max_iters: iteration budget replacing the time budget.
        destroy_fn: ``(state, d, rng) -> list[int]`` optionally replaces random
            destruction with a custom operator returning the scheduled job ids
            to remove — the hook the LLM heuristic factory (``factory/``) evolves.
    """
    rng = random.Random(seed)
    t0 = time.perf_counter()
    target_deci = None if target is None else round(target * 10)

    # Exact cutoff pruning is valid only when every cost that enters the
    # objective is non-negative (setup, mode, tardiness weight, rejection): then
    # the partial candidate cost accumulated so far can only grow, so it is a
    # valid lower bound and a candidate that already reaches the incumbent can be
    # abandoned. All shipped MaScLib instances qualify; anything else falls back
    # to the byte-identical unpruned search (kill-max still applies).
    prune = (all(c >= 0 for row in inst.setup_c for c in row)
             and all(j.mode >= 0 and j.w >= 0 and j.rej >= 0 for j in inst.jobs))

    cur = State(inst)
    cur.rebuild()
    evals = _construct(cur, rng, prune)
    if permute:
        evals += _permute(cur, rng, prune)
    best = State(inst)
    best.clone_from(cur)
    iters = 0
    log = [(0, best.total() / 10)]

    while (max_iters is None and time.perf_counter() - t0 < seconds) or \
          (max_iters is not None and iters < max_iters):
        if target_deci is not None and best.total() <= target_deci:
            break
        iters += 1
        if accept == "best":
            cur.clone_from(best)
        if destroy_fn is None:
            cur.remove_random(d, rng)
        else:
            cur.remove_jobs(destroy_fn(cur, d, rng))
        evals += _construct(cur, rng, prune)
        if permute:
            evals += _permute(cur, rng, prune)
        if cur.total() < best.total():
            best.clone_from(cur)
            log.append((iters, best.total() / 10))

    return Result(best.total() / 10, best.order[:], best.rejected(),
                  iters, evals, time.perf_counter() - t0, log)


# ---------------------------------------------------------------- CLI


def _print_solution(inst: Instance, r: Result) -> None:
    """Two-line solve report, mirroring the Rust CLI's output style."""
    rate = r.evaluations / max(r.elapsed, 1e-9) / 1e3
    print(f"{inst.name}: n={inst.n} best={r.best_cost:g} iters={r.iterations} "
          f"evals={r.evaluations} ({rate:.0f}k evals/s) t={r.elapsed:.2f}s")
    print(f"  performed {len(r.order)} / rejected {len(r.rejected)}")


def main(argv: list[str] | None = None) -> None:
    """Console entry point (``ig-solve``): solve one MASC CSV instance."""
    import argparse

    ap = argparse.ArgumentParser(
        prog="ig-solve",
        description="Iterated Greedy for scheduling with rejection (OAS / MaScLib).")
    ap.add_argument("instance", help="path to a MASC CSV instance (e.g. masclib/NCOS_01.csv)")
    ap.add_argument("--seconds", type=float, default=5.0, help="time budget (default: 5)")
    ap.add_argument("--d", type=int, default=2, help="jobs removed per destroy step (default: 2)")
    ap.add_argument("--seed", type=int, default=1, help="RNG seed (default: 1)")
    ap.add_argument("--target", type=float, default=None,
                    help="stop early at this cost, in data units (e.g. the best known)")
    ap.add_argument("--no-permute", action="store_true",
                    help="skip the scheduled/rejected swap pass")
    ap.add_argument("--quiet", action="store_true", help="print only the best cost")
    ap.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    args = ap.parse_args(argv)

    try:
        inst = Instance.parse(args.instance)
    except (OSError, ValueError) as exc:
        raise SystemExit(f"ig-solve: {exc}") from exc
    r = solve(inst, seconds=args.seconds, d=args.d, seed=args.seed,
              target=args.target, permute=not args.no_permute)
    if args.quiet:
        print(f"{r.best_cost:g}")
    else:
        _print_solution(inst, r)


def _cli() -> None:
    """Checkout CLI (``python ig_scheduler.py``): solve + benchmark validation."""
    import argparse
    import json

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("solve", help="solve one instance")
    sp.add_argument("instance")
    va = sub.add_parser("validate", help="run all instances vs benchmark.json")
    va.add_argument("masclib_dir")
    va.add_argument("benchmark")
    for p in (sp, va):
        p.add_argument("--seconds", type=float, default=2.0)
        p.add_argument("--d", type=int, default=2)
        p.add_argument("--accept", choices=["current", "best"], default="current")
        p.add_argument("--seed", type=int, default=1)

    args = ap.parse_args()
    if args.cmd == "solve":
        inst = Instance.parse(args.instance)
        r = solve(inst, seconds=args.seconds, d=args.d, accept=args.accept, seed=args.seed)
        _print_solution(inst, r)
    else:
        bench = json.loads(Path(args.benchmark).read_text())
        hits = 0
        for name in sorted(bench):
            inst = Instance.parse(Path(args.masclib_dir) / f"{name}.csv")
            best_known = bench[name][1]
            dd = 50 if inst.n >= 500 else args.d
            r = solve(inst, seconds=args.seconds, d=dd, accept=args.accept,
                      permute=inst.n < 500, target=best_known, seed=args.seed)
            gap = 100 * (r.best_cost - best_known) / best_known
            mark = " ✓" if r.best_cost <= best_known else ""
            hits += r.best_cost <= best_known
            print(f"{name:<14} n={inst.n:>3} found={r.best_cost:>10g} "
                  f"best2015={best_known:>9} gap={gap:>7.2f}%{mark}")
        print(f"\nmatched-or-beat: {hits}/{len(bench)}")


if __name__ == "__main__":
    _cli()
