//! Greedy construction — the simplest racer, and the only one that terminates
//! on its own. Its job in the race is to show where an unimproved construction
//! lands: one pass over a shuffled pending list, each job placed at its best
//! insertion position, no second look.
//!
//! Ported from `makeGreedy` in `studio/src/race/strategies.js` (lines 178-206)
//! together with the `bestInsertion` helper it calls (lines 115-128):
//!
//! ```text
//! r.step = function step(budget) {
//!   if (this.done) return 0;
//!   let used = 0;
//!   const pend = this.pend || (this.pend = (() => {
//!     const p = this.cur.rejected.slice();
//!     for (let i = p.length - 1; i > 0; i--) {
//!       const k = Math.floor(this.rng() * (i + 1));
//!       [p[i], p[k]] = [p[k], p[i]];
//!     }
//!     return p;
//!   })());
//!   while (pend.length && used < budget) {
//!     const id = pend.shift();
//!     const bi = bestInsertion(this.cur.order, this.cur.rejected, id);
//!     used += bi.evals; this.evals += bi.evals;
//!     if (bi.pos >= 0) {
//!       this.cur.order.splice(bi.pos, 0, id);
//!       this.cur.rejected.splice(this.cur.rejected.indexOf(id), 1);
//!       this.note(bi.cost, this.cur);
//!     }
//!   }
//!   if (!pend.length) { this.done = true; this.status = { key: "doneConstructive" }; }
//!   return used;
//! };
//! ```
//!
//! The Rust is that loop, one for one, with three deliberate differences, all
//! forced by the non-negotiables rather than chosen:
//!
//! 1. **PRNG.** The shuffle draws from SplitMix64 (`crate::rng`), seeded from
//!    the method *name*, not from JS `mulberry32`. Same Fisher-Yates, different
//!    stream, so the shuffled order differs from today's page — unavoidable
//!    once every method shares one integer PRNG, and the point of doing it.
//! 2. **Exact arithmetic.** JS compares costs with a `1e-9` epsilon because it
//!    accumulates `late * w` in float; here every cost is an `i64` in
//!    deci-units, so selection is exact `<` and a Greedy cost is bit-identical
//!    to a CLI cost instead of merely within tolerance.
//! 3. **Credit carries across slices.** JS measures `used < budget` per call
//!    and forgets the overshoot; `Ctx` carries the unspent (or overspent)
//!    credit, which is what makes `slice = 1e9` and `slice = 137` produce the
//!    same run. Greedy would be slice-invariant either way — its job order and
//!    outcome do not depend on where the slices fall — but the invariant is
//!    tested here so the property is not accidental.
//!
//! Budget: one full objective evaluation is one unit, and one insertion scan of
//! a job costs exactly `order.len() + 1` units — the same count the JS charges
//! (`bestInsertion` computes its `base` uncharged, then charges one per tested
//! position). `State::best_insertion` credits back the positions its cutoff
//! skipped, so prune-on and prune-off spend identically.

use crate::eval::State;
use crate::instance::Instance;
use crate::ops::Move;
use crate::race::{Ctx, ST_CONSTRUCTING, ST_DONE_CONSTRUCTIVE};

/// JS: `r.status = { key: "constructing" }` at construction time.
pub const STATUS_INITIAL: u32 = ST_CONSTRUCTING;

pub struct GreedyState {
    cur: State,
    /// the shuffled pending list; consumed by cursor rather than by `shift()`
    pend: Vec<u32>,
    at: usize,
    shuffled: bool,
}

impl GreedyState {
    pub fn new(inst: &Instance) -> GreedyState {
        let mut cur = State::all_rejected(inst);
        cur.rebuild(inst);
        GreedyState { cur, pend: Vec::new(), at: 0, shuffled: false }
    }

    pub fn advance(&mut self, ctx: &mut Ctx) {
        if !self.shuffled {
            // JS: `this.cur.rejected.slice()` — ascending job id — then
            // Fisher-Yates. `rejected_into` reproduces that initial order, and
            // it must: the shuffle result depends on it.
            self.cur.rejected_into(&mut self.pend);
            ctx.rng().shuffle(&mut self.pend);
            self.shuffled = true;
        }

        // One insertion scan is the indivisible group: credit is checked
        // between jobs, never inside a scan, so a slice overshoots by at most
        // one scan and `close()` reports the truth.
        while self.at < self.pend.len() && ctx.has_credit() {
            let job = self.pend[self.at];
            self.at += 1;
            // Same `State::best_insertion` the IG's construction calls: the
            // best strictly-improving position, earliest on ties, or nothing
            // (JS `bi.pos < 0`) when leaving the job rejected is no worse.
            if let Some((pos, cost)) = ctx.best_insertion(&self.cur, job) {
                self.cur.apply(ctx.inst(), Move::Insert { job, pos: pos as u32 });
                ctx.note(cost, &self.cur);
                // Greedy only ever commits a strict improvement, so the noted
                // cost *is* the incumbent's. Said explicitly because the shared
                // `note` no longer says it (see `Ctx::note`).
                ctx.set_cur_cost(cost);
            }
        }

        if self.at == self.pend.len() {
            // "done — a constructive does not iterate"
            ctx.finish(ST_DONE_CONSTRUCTIVE);
        }
    }

    pub fn incumbent(&self) -> &State {
        &self.cur
    }
}

#[cfg(test)]
mod tests {
    use crate::eval::tests::{brute, tiny};
    use crate::instance::{Instance, Job};
    use crate::race::{IgConfig, Method, Racer, ST_DONE_CONSTRUCTIVE};
    use crate::solver::Accept;

    const IG: IgConfig = IgConfig { d: 4, accept: Accept::Current, permute: true };

    fn racer(inst: &Instance, budget: u64) -> Racer {
        Racer::new(inst, Method::Greedy, 1234, budget, IG)
    }

    /// A ten-job instance with two setup families, tight-ish deadlines and a
    /// mix of rejection costs, so Greedy has to reject some jobs and the
    /// insertion positions actually differ.
    fn ten() -> Instance {
        let n_states = 2;
        let mut setup_t = vec![0i64; 4];
        let mut setup_c = vec![0i64; 4];
        for (f, t, st, sc) in [(0usize, 1usize, 4i64, 30i64), (1, 0, 3, 20)] {
            setup_t[f * n_states + t] = st;
            setup_c[f * n_states + t] = sc;
        }
        let job = |id: usize, fam, p, rel, due, w, rej| Job {
            id,
            fam,
            p,
            rel,
            due,
            w,
            e: 0,
            mode_cost: 25,
            rej,
            end_max: 120,
        };
        Instance {
            name: "ten".into(),
            jobs: vec![
                job(0, 0, 9, 0, 20, 20, 300),
                job(1, 1, 7, 3, 25, 5, 120),
                job(2, 0, 12, 0, 40, 10, 260),
                job(3, 1, 5, 10, 30, 30, 90),
                job(4, 0, 8, 6, 35, 15, 150),
                job(5, 1, 11, 0, 50, 8, 400),
                job(6, 0, 6, 15, 45, 25, 70),
                job(7, 1, 9, 20, 60, 12, 210),
                job(8, 0, 4, 2, 18, 40, 330),
                job(9, 1, 10, 8, 55, 6, 180),
            ],
            n_states,
            init_state: 0,
            setup_t,
            setup_c,
        }
    }

    fn run_to_end(inst: &Instance, slice: i64) -> Racer {
        let mut r = racer(inst, u64::MAX);
        while !r.common.done {
            r.advance(inst, slice);
        }
        r
    }

    /// Golden run: fixed instance, fixed seed, pinned outcome. If the shuffle,
    /// the seeding, the selection rule or the charging changes, this fails.
    #[test]
    fn greedy_golden_run_on_ten() {
        let inst = ten();
        let r = run_to_end(&inst, 1_000_000_000);

        // one scan per job, of order.len() + 1 positions, in insertion order
        assert_eq!(r.common.evals, 51);
        assert_eq!(r.common.status_key, ST_DONE_CONSTRUCTIVE);
        assert!(r.common.done);

        assert_eq!(r.incumbent().order, vec![0, 8, 4, 3, 1, 7, 5, 9]);
        assert_eq!(r.common.best_cost, 748);
        assert_eq!(r.common.best.order, r.incumbent().order);

        // the trace is monotone and its last point is the best cost
        assert_eq!(
            r.common.trace,
            vec![
                (1, 1765),
                (3, 1490),
                (6, 1365),
                (10, 1180),
                (15, 1115),
                (27, 1084),
                (34, 831),
                (42, 748)
            ]
        );

        // and the cost the racer reports is the objective, not a private one
        assert_eq!(r.common.best_cost, brute(&inst, &r.common.best.order));
        assert_eq!(r.incumbent().total(), r.common.best_cost);
    }

    /// Rule 7: the slice size is an implementation detail of the animation. Same
    /// evals, same trace, same solution at 1 / 7 / 137 / 1e9 per slice.
    #[test]
    fn slice_size_is_invariant() {
        let inst = ten();
        let reference = run_to_end(&inst, 1_000_000_000);
        for slice in [1i64, 7, 137, 5_000] {
            let r = run_to_end(&inst, slice);
            assert_eq!(r.common.evals, reference.common.evals, "slice {slice}");
            assert_eq!(r.common.trace, reference.common.trace, "slice {slice}");
            assert_eq!(r.incumbent().order, reference.incumbent().order, "slice {slice}");
            assert_eq!(r.common.best_cost, reference.common.best_cost, "slice {slice}");
        }
    }

    /// Rule 3: pruning may only move wall-clock. With the cutoff disabled the
    /// run must be identical — same trace, same eval count, same final cost.
    #[test]
    fn pruning_does_not_change_the_run() {
        let inst = ten();
        let pruned = run_to_end(&inst, 1_000_000_000);
        let mut plain = racer(&inst, u64::MAX);
        plain.common.prune = false;
        while !plain.common.done {
            plain.advance(&inst, 137);
        }
        assert_eq!(plain.common.evals, pruned.common.evals);
        assert_eq!(plain.common.trace, pruned.common.trace);
        assert_eq!(plain.incumbent().order, pruned.incumbent().order);
        assert_eq!(plain.common.best_cost, pruned.common.best_cost);
    }

    /// A constructive stops because it ran out of jobs; a racer that runs out of
    /// budget first stops with the budget-exhausted status instead, exactly like
    /// the JS driver in race/view.js.
    #[test]
    fn budget_exhaustion_is_reported_not_hidden() {
        let inst = ten();
        let mut r = racer(&inst, 5);
        let spent = r.advance(&inst, 1);
        assert!(spent >= 1, "an insertion scan is indivisible");
        while !r.common.done {
            r.advance(&inst, 1);
        }
        assert_eq!(r.common.status_key, crate::race::ST_BUDGET_EXHAUSTED);
        assert!(r.common.evals >= 5, "the standings must see the overshoot");
    }

    /// Greedy never worsens the incumbent: it only commits strictly improving
    /// insertions, so the trace is strictly decreasing and equals the objective
    /// at every point.
    #[test]
    fn greedy_only_commits_improvements() {
        let inst = tiny();
        let r = run_to_end(&inst, 3);
        for w in r.common.trace.windows(2) {
            assert!(w[1].1 < w[0].1, "trace must be strictly decreasing");
        }
        assert_eq!(r.incumbent().total(), brute(&inst, &r.incumbent().order));
        assert!(r.common.evals > 0);
    }
}
