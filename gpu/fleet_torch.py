#!/usr/bin/env python3
"""GPU replica fleet — thousands of Iterated Greedy searches in parallel.

One CUDA (or CPU) tensor program advances R independent IG replicas in
lockstep on the same instance: batched destroy (binomial, with a per-replica
adaptive ramp), batched greedy repair (every insertion position of the current
pending job is priced for all replicas in a single n-step scan — the
"virtual replica" trick), and per-replica incumbents. The point is not a
smarter search but a *wider* one: massive-restart diversity, parameter
sweeps, record hunting, and a scoring engine for evolved heuristics.

Semantics match the validated engines (setup time+cost, mode cost, weighted
tardiness, ASAP timing, rejection, END_MAX windows; deci-unit money). Verify:

    python gpu/fleet_torch.py verify masclib/NCOS_01.csv
    python gpu/fleet_torch.py verify masclib/STC_NCOS_31.csv

Run a fleet:

    python gpu/fleet_torch.py solve masclib/NCOS_31.csv --replicas 4096 --seconds 60
    python gpu/fleet_torch.py solve masclib/STC_NCOS_51a.csv --replicas 2048 \
        --seconds 120 --d 2 --dmax 150

No GPU? It runs on CPU (slowly) with --device cpu — same numbers.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))
from ig_scheduler import Instance  # noqa: E402

INF = torch.iinfo(torch.int64).max // 4


class Fleet:
    def __init__(self, inst: Instance, replicas: int, d: int, dmax: int,
                 device: str, seed: int):
        self.inst = inst
        self.R = replicas
        self.n = inst.n
        self.d = d
        self.dmax = max(dmax, d)
        self.dev = torch.device(device)
        g = torch.Generator(device="cpu").manual_seed(seed)
        self.g = g

        j = inst.jobs
        t64 = lambda xs: torch.tensor(xs, dtype=torch.int64, device=self.dev)
        self.p = t64([x.p for x in j])
        self.rel = t64([x.rel for x in j])
        self.due = t64([x.due for x in j])
        self.w = t64([x.w for x in j])
        self.mode = t64([x.mode for x in j])
        self.rej = t64([x.rej for x in j])
        self.end_max = t64([x.end_max for x in j])
        self.fam = t64([x.fam for x in j])
        self.setup_t = t64(inst.setup_t)
        self.setup_c = t64(inst.setup_c)
        self.init_state = inst.init_state
        self.rej_total = int(self.rej.sum())

        R, n = self.R, self.n
        # order[r]: positions [0, len) = schedule; [len, n) = pool (incl. processed)
        self.order = torch.argsort(torch.rand(R, n, generator=g), dim=1).to(self.dev)
        self.len = torch.zeros(R, dtype=torch.int64, device=self.dev)
        self.cur_cost = torch.full((R,), self.rej_total, dtype=torch.int64, device=self.dev)
        self.best_cost = self.cur_cost.clone()
        self.best_order = self.order.clone()
        self.best_len = self.len.clone()
        self.stall = torch.zeros(R, dtype=torch.int64, device=self.dev)
        self.iterations = 0
        self.arange_n = torch.arange(n, device=self.dev)

    # ---------------------------------------------------------------- repair

    def _repair(self) -> None:
        """Greedy best-insertion of every pool job (shuffled), all replicas in
        lockstep. For the pending job at pool-front, all insertion positions
        are priced in ONE n-step scan over (replica, position) pairs."""
        R, n = self.R, self.n
        ar = self.arange_n

        # shuffle each replica's pool zone [len, n)
        keys = torch.rand(R, n, generator=self.g).to(self.dev)
        keys = torch.where(ar.unsqueeze(0) >= self.len.unsqueeze(1), keys, -1.0 - ar.flip(0).unsqueeze(0).to(keys))
        pool_perm = torch.argsort(keys, dim=1, stable=True)
        self.order = torch.gather(self.order, 1, pool_perm)

        start_len = self.len.clone()
        for step in range(n):
            ptr = start_len + step                       # pool-front per replica
            active = ptr < n
            if not bool(active.any()):
                break
            ptr_c = ptr.clamp(max=n - 1)
            jid = torch.gather(self.order, 1, ptr_c.unsqueeze(1)).squeeze(1)  # [R]

            # price inserting jid at every position p in [0, len] — virtual rows
            P = n + 1
            pos_idx = ar.unsqueeze(0).expand(R, n)                      # slot index k
            p_cand = torch.arange(P, device=self.dev).view(1, P, 1)     # candidate position
            k = pos_idx.unsqueeze(1)                                    # [R,1,n]
            # virtual job at slot k for candidate p: k<p -> order[k]; k==p -> jid; k>p -> order[k-1]
            src = torch.where(k < p_cand, k, (k - 1).clamp(min=0))
            vjob = torch.gather(self.order.unsqueeze(1).expand(R, P, n), 2, src)
            vjob = torch.where(k == p_cand, jid.view(R, 1, 1).expand(R, P, n), vjob)
            vlen = (self.len + 1).view(R, 1)                            # virtual length

            t = torch.zeros(R, P, dtype=torch.int64, device=self.dev)
            state = torch.full((R, P), self.init_state, dtype=torch.int64, device=self.dev)
            cost = torch.zeros(R, P, dtype=torch.int64, device=self.dev)
            bad = torch.zeros(R, P, dtype=torch.bool, device=self.dev)
            # A replica that has scheduled all n jobs is already inactive for this
            # step (ptr >= n), so its virtual row is never applied; clamping keeps
            # the scan inside vjob's n columns instead of running one past the end.
            max_len = min(int(self.len.max().item()) + 1, n)
            for pos in range(max_len):
                on = pos < vlen                                          # [R,1] -> broadcast
                jj = vjob[:, :, pos]
                st = self.setup_t[state, self.fam[jj]]
                ss = torch.maximum(t, self.rel[jj] - st)
                f = ss + st + self.p[jj]
                late = (f - self.due[jj]).clamp(min=0)
                c = self.setup_c[state, self.fam[jj]] + self.mode[jj] + late * self.w[jj]
                viol = f > self.end_max[jj]
                cost = torch.where(on, cost + c, cost)
                bad = bad | (on & viol)
                t = torch.where(on, f, t)
                state = torch.where(on, self.fam[jj], state)
            # scheduled-jobs cost + rejection of everything else (jid now scheduled)
            sched_rej = torch.zeros(R, dtype=torch.int64, device=self.dev)
            in_seq_mask = ar.unsqueeze(0) < self.len.unsqueeze(1)
            sched_rej = torch.where(in_seq_mask, self.rej[self.order], 0).sum(dim=1) + self.rej[jid]
            total = cost + (self.rej_total - sched_rej).unsqueeze(1)
            total = torch.where(bad, torch.full_like(total, INF), total)
            # candidate positions beyond len+1 are duplicates of p=len; mask them
            valid_p = torch.arange(P, device=self.dev).unsqueeze(0) <= self.len.unsqueeze(1)
            total = torch.where(valid_p, total, torch.full_like(total, INF))

            best_val, best_p = total.min(dim=1)                         # [R]
            do = active & (best_val < self.cur_cost)

            # apply insertion via gather-rebuild: move row[ptr] to best_p, shift [best_p, ptr) right
            kk = ar.unsqueeze(0)
            bp = best_p.unsqueeze(1)
            pt = ptr_c.unsqueeze(1)
            src_idx = torch.where(kk == bp, pt, torch.where((kk > bp) & (kk <= pt), kk - 1, kk))
            new_order = torch.gather(self.order, 1, src_idx)
            self.order = torch.where(do.unsqueeze(1), new_order, self.order)
            self.len = torch.where(do, self.len + 1, self.len)
            self.cur_cost = torch.where(do, best_val, self.cur_cost)

    # ---------------------------------------------------------------- destroy

    def _destroy(self) -> None:
        """Binomial destroy: each scheduled job is removed with prob d_eff/len,
        where d_eff ramps with per-replica stagnation (expected removals ≈ d_eff)."""
        R, n = self.R, self.n
        ar = self.arange_n
        d_eff = torch.minimum(torch.tensor(self.dmax, device=self.dev),
                              self.d + self.stall // 30)
        prob = (d_eff.to(torch.float32) / self.len.clamp(min=1).to(torch.float32)).clamp(max=1.0)
        u = torch.rand(R, n, generator=self.g).to(self.dev)
        in_seq = ar.unsqueeze(0) < self.len.unsqueeze(1)
        remove = in_seq & (u < prob.unsqueeze(1))
        # stable partition: kept scheduled first, removed pushed to pool-front
        sort_key = torch.where(remove, n + ar, ar)
        sort_key = torch.where(in_seq, sort_key, 2 * n + ar)  # pool stays behind
        perm = torch.argsort(sort_key, dim=1, stable=True)
        self.order = torch.gather(self.order, 1, perm)
        self.len = self.len - remove.sum(dim=1)
        # recompute current cost after destruction
        self.cur_cost = self._price_current()

    def _price_current(self) -> torch.Tensor:
        R, n = self.R, self.n
        ar = self.arange_n
        t = torch.zeros(R, dtype=torch.int64, device=self.dev)
        state = torch.full((R,), self.init_state, dtype=torch.int64, device=self.dev)
        cost = torch.zeros(R, dtype=torch.int64, device=self.dev)
        srej = torch.zeros(R, dtype=torch.int64, device=self.dev)
        max_len = int(self.len.max().item()) if self.R else 0
        for pos in range(max_len):
            on = pos < self.len
            jj = self.order[:, pos]
            st = self.setup_t[state, self.fam[jj]]
            f = torch.maximum(t, self.rel[jj] - st) + st + self.p[jj]
            c = self.setup_c[state, self.fam[jj]] + self.mode[jj] + (f - self.due[jj]).clamp(min=0) * self.w[jj]
            cost = torch.where(on, cost + c, cost)
            srej = torch.where(on, srej + self.rej[jj], srej)
            t = torch.where(on, f, t)
            state = torch.where(on, self.fam[jj], state)
        return cost + (self.rej_total - srej)

    # ---------------------------------------------------------------- loop

    def iterate(self, iters: int = 1) -> None:
        for _ in range(iters):
            self.iterations += 1
            self._destroy()
            self._repair()
            improved = self.cur_cost < self.best_cost
            self.best_cost = torch.where(improved, self.cur_cost, self.best_cost)
            self.best_order = torch.where(improved.unsqueeze(1), self.order, self.best_order)
            self.best_len = torch.where(improved, self.len, self.best_len)
            self.stall = torch.where(improved, torch.zeros_like(self.stall), self.stall + 1)

    def construct(self) -> None:
        self._repair()
        self.best_cost = self.cur_cost.clone()
        self.best_order = self.order.clone()
        self.best_len = self.len.clone()

    def global_best(self) -> tuple[float, list[int]]:
        i = int(self.best_cost.argmin())
        cost = float(self.best_cost[i]) / 10.0
        L = int(self.best_len[i])
        return cost, self.best_order[i, :L].tolist()


# -------------------------------------------------------------------- cli


def cmd_verify(args) -> None:
    from ig_scheduler import State
    inst = Instance.parse(ROOT / args.instance)
    fl = Fleet(inst, replicas=8, d=2, dmax=0, device=args.device, seed=7)
    fl.construct()
    ok = True
    for r in range(fl.R):
        L = int(fl.len[r])
        order = fl.order[r, :L].tolist()
        s = State(inst)
        s.rebuild()
        for pos, jid in enumerate(order):
            s.insert(jid, pos)
        want, got = s.total(), int(fl.cur_cost[r])
        if want != got:
            ok = False
            print(f"replica {r}: fleet={got} cpu={want}  MISMATCH")
    print(f"{inst.name}: fleet pricing {'MATCHES' if ok else 'DIVERGES from'} the CPU engine "
          f"across {fl.R} constructed replicas")
    sys.exit(0 if ok else 1)


def cmd_solve(args) -> None:
    inst = Instance.parse(ROOT / args.instance)
    dev = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    fl = Fleet(inst, args.replicas, args.d, args.dmax, dev, args.seed)
    t0 = time.perf_counter()
    fl.construct()
    best, _ = fl.global_best()
    print(f"{inst.name}: n={inst.n} R={args.replicas} device={dev} | construction best={best:g}")
    last = t0
    while time.perf_counter() - t0 < args.seconds:
        fl.iterate(1)
        if args.target and fl.global_best()[0] <= args.target:
            break
        if time.perf_counter() - last > 5:
            b, _ = fl.global_best()
            el = time.perf_counter() - t0
            rate = fl.iterations * args.replicas / el
            print(f"  t={el:5.1f}s iter={fl.iterations:5d} best={b:g} "
                  f"({rate:,.0f} replica-iters/s)")
            last = time.perf_counter()
    el = time.perf_counter() - t0
    b, order = fl.global_best()
    print(f"final: best={b:g} iters={fl.iterations} elapsed={el:.1f}s "
          f"({fl.iterations * args.replicas / el:,.0f} replica-iters/s) "
          f"scheduled={len(order)}/{inst.n}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verify")
    v.add_argument("instance")
    v.add_argument("--device", default="cpu")
    s = sub.add_parser("solve")
    s.add_argument("instance")
    s.add_argument("--replicas", type=int, default=4096)
    s.add_argument("--seconds", type=float, default=60.0)
    s.add_argument("--d", type=int, default=2)
    s.add_argument("--dmax", type=int, default=0)
    s.add_argument("--seed", type=int, default=1)
    s.add_argument("--target", type=float, default=None)
    s.add_argument("--device", default=None)
    args = ap.parse_args()
    if args.cmd == "verify":
        cmd_verify(args)
    else:
        cmd_solve(args)


if __name__ == "__main__":
    main()
