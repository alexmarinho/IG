//! Local descent — steepest improvement over the shared neighbourhood, stopping
//! at a local minimum. The reference for what a plain hill-climb buys.
//!
//! Ported from `makeDescent` in `studio/src/race/strategies.js`:
//!
//! ```js
//! function makeDescent() {
//!   const r = baseRacer("descent", "Descent", "--race-descent");
//!   r.phase = "build"; r.status = { key: "constructingGreedy" };
//!   r.step = function step(budget) {
//!     if (this.done) return 0;
//!     let used = 0;
//!     if (this.phase === "build") {
//!       used = greedyPass(this.cur, this.rng, (c) => this.note(c, this.cur));
//!       this.evals += used; this.phase = "search"; this.status = { key: "descending" };
//!       return used;
//!     }
//!     this.credit += budget;
//!     while (this.credit > 0 && !this.done) {
//!       const { best, evals } = bestNeighbor(this.cur, null, 0, this.bestCost, this.rng);
//!       used += evals; this.evals += evals; this.credit -= evals;
//!       if (best && best.cost < this.bestCost - 1e-9) {
//!         applyMove(this.cur, best.apply);
//!         this.note(best.cost, this.cur);
//!       } else {
//!         this.done = true; this.status = { key: "stuckLocal" };
//!       }
//!     }
//!     return used;
//!   };
//!   return r;
//! }
//! ```
//!
//! Two lives: one greedy construction, then steepest descent. It is *steepest*,
//! not first-improvement — `bestNeighbor` scans the whole neighbourhood and
//! returns the single cheapest candidate, and descent takes it only if it beats
//! the incumbent. That is the honest reading of the JS and it is what the page's
//! "Descent" line has always meant; the brief's "first or best improvement" is
//! resolved to best, because that is what is being ported.

use super::{status, Common, Ctx};
use crate::eval::State;
use crate::instance::Instance;
use crate::ops::Move;

/// Past this instance size the exhaustive O(n^2) scan would block a frame for
/// seconds, so large instances sample a bounded random move set per scan instead
/// (uniform over the same four families). Straight from the JS `createSearchOps`.
const STOCHASTIC_N: usize = 240;
const STOCHASTIC_BUDGET: usize = 6_000;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Build,
    Search,
}

pub struct DescentState {
    cur: State,
    phase: Phase,
}

impl DescentState {
    pub fn new(inst: &Instance, common: &mut Common) -> DescentState {
        let mut cur = State::all_rejected(inst);
        cur.rebuild(inst);
        common.cur_cost = cur.total();
        common.status_key = status::CONSTRUCTING_GREEDY;
        cur.rejected_into(&mut common.rej);
        DescentState {
            cur,
            phase: Phase::Build,
        }
    }

    pub fn incumbent(&self) -> &State {
        &self.cur
    }

    pub fn advance(&mut self, ctx: &mut Ctx) {
        if ctx.done() {
            return;
        }

        // `greedyPass(this.cur, this.rng, (c) => this.note(c, this.cur))`
        //
        // The construction is one indivisible phase: it runs to completion inside
        // a single slice and returns, exactly as the JS `step` does. On a large
        // instance that first slice can cost far more than it was handed; the
        // racer reports what it truly spent and the overshoot is owed back out of
        // the next slice's credit.
        if self.phase == Phase::Build {
            ctx.greedy_pass(&mut self.cur, true);
            ctx.refresh_rejected(&self.cur);
            // The shared `greedy_pass` reports what it spent, not what it built;
            // the live cost is the method's to declare. It is load-bearing here
            // and not cosmetic: the scan below uses `cur_cost` as its cutoff.
            ctx.set_cur_cost(self.cur.total());
            self.phase = Phase::Search;
            ctx.status(status::DESCENDING, 0);
            return;
        }

        // `while (this.credit > 0 && !this.done)`
        while ctx.has_credit() {
            match self.best_neighbor(ctx) {
                // `if (best && best.cost < this.bestCost - 1e-9)`
                //
                // The epsilon is gone because the currency is gone: costs are
                // deci-unit i64, so "strictly cheaper" is `<` and needs no slack.
                // The comparison is against the live incumbent rather than
                // `bestCost`; for a descent the two are the same number, since it
                // only ever moves to a strictly cheaper solution. See the note on
                // the empty-construction case in the report.
                Some((mv, cost)) if cost < ctx.cur_cost() => {
                    self.cur.apply(ctx.inst(), mv);
                    // A chosen candidate always priced strictly below the cutoff,
                    // so it was priced exactly, so the incumbent must land on the
                    // number the convergence chart was just told about.
                    debug_assert_eq!(self.cur.total(), cost, "apply disagreed with price");
                    ctx.refresh_rejected(&self.cur);
                    ctx.note(cost, &self.cur);
                    // A descent only ever moves to a strictly cheaper solution,
                    // so the committed cost is the incumbent's.
                    ctx.set_cur_cost(cost);
                }
                // `else { this.done = true; this.status = { key: "stuckLocal" }; }`
                _ => {
                    ctx.finish(status::STUCK_LOCAL);
                    return;
                }
            }
        }
    }

    /// `bestNeighbor(cur, null, 0, bestCost, rng)` with `tabuUntil = null`: no
    /// tabu list, no aspiration, so the whole thing reduces to "cheapest feasible
    /// candidate, ties to the first one enumerated".
    ///
    /// Enumeration order is load-bearing — it *is* the tie-break — so the four
    /// families are visited in the JS order: add, remove, reposition, swap.
    ///
    /// Every candidate is charged one unit, including the ones the cutoff lets us
    /// abandon early: `cutoff` starts at the incumbent (a candidate that does not
    /// improve can never be chosen) and tightens to the best found so far.
    /// Selection is strict `<`, and a bounded price is always `>= cutoff`, so a
    /// pruned scan and an exhaustive scan choose the identical move and spend the
    /// identical budget. Pruning moves wall-clock and nothing else.
    fn best_neighbor(&self, ctx: &mut Ctx) -> Option<(Move, i64)> {
        let n_o = self.cur.order.len();
        let n_r = ctx.rej_len();
        let mut best: Option<(Move, i64)> = None;
        let mut cutoff = ctx.cur_cost();

        // `const consider = (cost, apply, job) => { evals++; ... if (!best || cost < best.cost) ... }`
        macro_rules! consider {
            ($mv:expr) => {{
                let mv = $mv;
                if let Some(c) = ctx.price(&self.cur, mv, cutoff) {
                    // `if (!best || cost < best.cost)` — strict, so the first
                    // candidate enumerated wins a tie. `cutoff` is always
                    // `min(incumbent, best so far)`, which folds in the JS's
                    // later `best.cost < this.bestCost` test without changing
                    // which move is chosen.
                    if c < cutoff {
                        best = Some((mv, c));
                        cutoff = c;
                    }
                }
            }};
        }

        if ctx.inst().n() <= STOCHASTIC_N {
            // for (ri) for (p) tryAdd; for (oi) tryRem; for (oi) for (p) tryMov; for (oi) for (ri) trySwp
            for ri in 0..n_r {
                let job = ctx.rej_at(ri);
                for p in 0..=n_o {
                    consider!(Move::Insert {
                        job,
                        pos: p as u32
                    });
                }
            }
            for oi in 0..n_o {
                consider!(Move::Remove { pos: oi as u32 });
            }
            for oi in 0..n_o {
                for p in 0..n_o {
                    // `if (p === oi) return;` — the identity, never priced and
                    // never charged, in the JS either.
                    if p != oi {
                        consider!(Move::Reposition {
                            from: oi as u32,
                            to: p as u32
                        });
                    }
                }
            }
            for oi in 0..n_o {
                for ri in 0..n_r {
                    consider!(Move::Swap {
                        pos: oi as u32,
                        job: ctx.rej_at(ri)
                    });
                }
            }
        } else {
            // `const perFamily = Math.max(64, Math.floor(STOCHASTIC_BUDGET / 4));`
            let per_family = (STOCHASTIC_BUDGET / 4).max(64);
            // Argument order matters: the JS draws the family index first, then
            // the position, so the stream is consumed in that order here too.
            if n_r > 0 {
                for _ in 0..per_family {
                    let ri = ctx.rng().below(n_r);
                    let pos = ctx.rng().below(n_o + 1) as u32;
                    let job = ctx.rej_at(ri);
                    consider!(Move::Insert { job, pos });
                }
            }
            if n_o > 0 {
                for _ in 0..per_family {
                    let pos = ctx.rng().below(n_o) as u32;
                    consider!(Move::Remove { pos });
                }
                for _ in 0..per_family {
                    let from = ctx.rng().below(n_o) as u32;
                    let to = ctx.rng().below(n_o) as u32;
                    // `if (p === oi) return;` — drawn, then discarded uncharged,
                    // exactly as the JS does. The draw still happens, so the
                    // stream advances identically whether or not it collides.
                    if from != to {
                        consider!(Move::Reposition { from, to });
                    }
                }
                if n_r > 0 {
                    for _ in 0..per_family {
                        let pos = ctx.rng().below(n_o) as u32;
                        let ri = ctx.rng().below(n_r);
                        let job = ctx.rej_at(ri);
                        consider!(Move::Swap { pos, job });
                    }
                }
            }
        }
        best
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::{Instance, Job};
    use crate::race::{IgConfig, Method, Racer};
    use crate::solver::Accept;

    /// Nine jobs, three setup families, asymmetric setups, one binding hard
    /// deadline and rejection costs cheap enough that some jobs stay out. Fixed
    /// integers: this is the pin, so nothing about it may drift.
    fn fixture() -> Instance {
        let n_states = 3;
        let mut setup_t = vec![0i64; 9];
        let mut setup_c = vec![0i64; 9];
        for (f, t, st, sc) in [
            (0usize, 1usize, 5i64, 7i64),
            (0, 2, 9, 11),
            (1, 0, 4, 6),
            (1, 2, 6, 8),
            (2, 0, 2, 3),
            (2, 1, 3, 4),
        ] {
            setup_t[f * n_states + t] = st;
            setup_c[f * n_states + t] = sc;
        }
        let job = |id, fam, p, rel, due, w, rej, end_max| Job {
            id,
            fam,
            p,
            rel,
            due,
            w,
            e: 0,
            mode_cost: 10,
            rej,
            end_max,
        };
        Instance {
            name: "descent-fixture".into(),
            jobs: vec![
                job(0, 0, 10, 0, 15, 2, 50, 1000),
                job(1, 1, 8, 5, 30, 3, 60, 1000),
                job(2, 0, 6, 0, 12, 1, 40, 1000),
                job(3, 2, 7, 3, 25, 4, 70, 95),
                job(4, 1, 5, 12, 20, 2, 30, 1000),
                job(5, 2, 9, 0, 40, 1, 55, 1000),
                job(6, 0, 4, 20, 45, 3, 45, 1000),
                job(7, 1, 12, 0, 55, 1, 80, 1000),
                job(8, 2, 3, 8, 18, 5, 25, 1000),
            ],
            n_states,
            init_state: 2,
            setup_t,
            setup_c,
        }
    }

    /// Independent, cache-free evaluation. Deliberately not the incremental path.
    fn brute(inst: &Instance, order: &[u32]) -> Option<i64> {
        let mut t = 0i64;
        let mut state = inst.init_state;
        let mut cost = 0i64;
        let mut in_seq = vec![false; inst.n()];
        for &jid in order {
            let j = &inst.jobs[jid as usize];
            in_seq[jid as usize] = true;
            let st = inst.setup_t(state, j.fam);
            let ss = t.max(j.rel - st);
            let f = ss + st + j.p;
            if f > j.end_max {
                return None;
            }
            cost += inst.setup_c(state, j.fam) + j.mode_cost + (f - j.due).max(0) * j.w;
            t = f;
            state = j.fam;
        }
        for (jid, &present) in in_seq.iter().enumerate() {
            if !present {
                cost += inst.jobs[jid].rej;
            }
        }
        Some(cost)
    }

    /// `u64::MAX` is "no budget ceiling" on the canonical `Racer`, which reads
    /// the budget as a plain number; this port's own scaffold spelled the same
    /// thing `0`. Descent stops at a local minimum either way.
    fn racer(inst: &Instance, seed: u32) -> Racer {
        Racer::new(
            inst,
            Method::Descent,
            seed,
            u64::MAX,
            IgConfig { d: 4, accept: Accept::Current, permute: true },
        )
    }

    fn run(inst: &Instance, seed: u32, slice: i64) -> Racer {
        let mut r = racer(inst, seed);
        let mut guard = 0;
        while !r.common.done {
            r.advance(inst, slice);
            guard += 1;
            assert!(guard < 1_000_000, "descent did not terminate");
        }
        r
    }

    /// THE PIN. A fixed instance, a fixed seed, an exact expected outcome. If a
    /// refactor moves any of these numbers, determinism broke and this fails loudly.
    #[test]
    fn descent_is_pinned_on_the_fixture() {
        let inst = fixture();
        let r = run(&inst, 1, i64::MAX / 4);

        assert_eq!(r.common.best_cost, 197, "best cost (deci-units)");
        assert_eq!(r.common.evals, 432, "evaluations spent");
        assert_eq!(r.incumbent().order, vec![5, 8, 3, 1, 6, 7], "final sequence");
        assert_eq!(r.common.status_key, status::STUCK_LOCAL);
        // The first seven points are the construction (one per improving
        // insertion, stamped at the evaluation it happened on); the rest are
        // descent steps, each one a full neighbourhood scan apart.
        assert_eq!(
            r.common.trace,
            vec![
                (1, 440),
                (3, 380),
                (6, 363),
                (10, 352),
                (15, 327),
                (27, 296),
                (41, 243),
                (120, 229),
                (199, 206),
                (278, 201),
                (357, 197),
            ],
            "improvement trace (evals, deci-cost)"
        );

        // the cost the racer reports is the cost an independent evaluation agrees
        // with — the whole point of one shared objective
        assert_eq!(brute(&inst, &r.incumbent().order), Some(197));
        assert_eq!(r.common.best.order, r.incumbent().order);
        assert_eq!(r.common.best_cost, r.common.cur_cost);
    }

    /// Slice size is a scheduling detail, never an input to the search. This is
    /// what makes the JS-side adaptive slice safe.
    #[test]
    fn slice_size_does_not_change_the_result() {
        let inst = fixture();
        for seed in [1u32, 7, 12345, 0xDEAD_BEEF] {
            let a = run(&inst, seed, i64::MAX / 4);
            for slice in [1i64, 3, 137, 5000] {
                let b = run(&inst, seed, slice);
                assert_eq!(a.common.best_cost, b.common.best_cost, "seed {seed} slice {slice}");
                assert_eq!(a.common.evals, b.common.evals, "seed {seed} slice {slice}");
                assert_eq!(a.common.trace, b.common.trace, "seed {seed} slice {slice}");
                assert_eq!(a.incumbent().order, b.incumbent().order, "seed {seed} slice {slice}");
            }
        }
    }

    /// Pruning is charged as if it had not happened, so it may move wall-clock
    /// and nothing else: same trace, same evals, same final sequence.
    #[test]
    fn pruning_changes_only_wall_clock() {
        let inst = fixture();
        for seed in [1u32, 7, 12345] {
            let pruned = run(&inst, seed, 500);
            let mut plain = racer(&inst, seed);
            plain.common.prune = false;
            while !plain.common.done {
                plain.advance(&inst, 500);
            }
            assert_eq!(pruned.common.evals, plain.common.evals, "seed {seed}");
            assert_eq!(pruned.common.trace, plain.common.trace, "seed {seed}");
            assert_eq!(pruned.common.best_cost, plain.common.best_cost, "seed {seed}");
            assert_eq!(pruned.incumbent().order, plain.incumbent().order, "seed {seed}");
        }
    }

    /// It is a descent: the trace only ever goes down, and it stops where nothing
    /// in the neighbourhood is cheaper. The second half is checked exhaustively
    /// against brute force, not against the incremental pricers being tested.
    #[test]
    fn it_stops_at_a_true_local_optimum() {
        let inst = fixture();
        for seed in [1u32, 2, 3, 4, 5] {
            let r = run(&inst, seed, 999);
            for w in r.common.trace.windows(2) {
                assert!(w[1].1 < w[0].1, "trace not monotone: {:?}", r.common.trace);
                assert!(w[1].0 >= w[0].0, "trace evals went backwards");
            }
            let order = r.incumbent().order.clone();
            let cost = brute(&inst, &order).expect("final sequence is feasible");
            assert_eq!(cost, r.common.best_cost);

            let rejected: Vec<u32> = (0..inst.n() as u32)
                .filter(|j| !order.contains(j))
                .collect();
            let mut candidates: Vec<Vec<u32>> = Vec::new();
            for &j in &rejected {
                for p in 0..=order.len() {
                    let mut o = order.clone();
                    o.insert(p, j);
                    candidates.push(o);
                }
            }
            for i in 0..order.len() {
                let mut o = order.clone();
                o.remove(i);
                candidates.push(o);
                for p in 0..order.len().saturating_sub(1) {
                    if p == i {
                        continue;
                    }
                    let mut o = order.clone();
                    let j = o.remove(i);
                    o.insert(p, j);
                    candidates.push(o);
                }
                for &j in &rejected {
                    let mut o = order.clone();
                    o[i] = j;
                    candidates.push(o);
                }
            }
            for cand in candidates {
                if let Some(c) = brute(&inst, &cand) {
                    assert!(
                        c >= cost,
                        "seed {seed}: not a local optimum, {cand:?} costs {c} < {cost}"
                    );
                }
            }
        }
    }

    /// Different seeds must be different runs — the regression that motivated
    /// seeding from the method name in the first place.
    #[test]
    fn seeds_produce_independent_runs() {
        let inst = fixture();
        let traces: Vec<_> = (0..8u32).map(|s| run(&inst, s, 777).common.trace).collect();
        assert!(
            traces.windows(2).any(|w| w[0] != w[1]),
            "every seed produced the identical trace"
        );
    }

    /// A racer that is done stays done and stops charging.
    #[test]
    fn a_finished_racer_spends_nothing() {
        let inst = fixture();
        let mut r = run(&inst, 1, i64::MAX / 4);
        // Named `spent`, not `evals`: `ctx.rs`'s accounting gate greps `race/`
        // for `evals =` and cannot tell a read binding from a write. Renaming
        // the local is the cheap side of that trade — loosening the gate to
        // admit this line would loosen it for a real one too.
        let spent = r.common.evals;
        assert_eq!(r.advance(&inst, 10_000), 0);
        assert_eq!(r.common.evals, spent);
    }
}

