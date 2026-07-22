//! The Iterated Greedy racer — a thin wrapper over `solver::Run`.
//!
//! This is the one racer that is not a port. IG is already in the engine, it is
//! what `benchmark.json` was measured with and what the CLI runs, and the whole
//! point of racing it is that the line on the page is *that* engine and not a
//! second implementation of it. So this file adds no search: it drives
//! `solver::Run` one destroy–rebuild iteration at a time and translates what the
//! run reports into what the race reports.
//!
//! Three things the wrapper is responsible for, and they are the only three:
//!
//! 1. **One PRNG family.** `Run` is seeded with `method_seed(race_seed,
//!    Method::Ig)`, the same derivation every other racer uses, so IG draws from
//!    the same SplitMix64 at a name-derived offset rather than from a private
//!    stream. `Run` never had a different generator — `crate::rng::Rng` *is* its
//!    generator — so this costs the published benchmark nothing.
//!
//! 2. **One budget currency.** `Run` keeps its own `evaluations` counter,
//!    incremented deep inside `State::best_insertion`, and a `Ctx` cannot reach
//!    in there. The wrapper therefore reads the counter's delta after every
//!    iteration and hands exactly that to `Ctx::charge_engine`. Nothing is
//!    estimated and nothing is rounded: IG pays the same unit for the same work
//!    as the five ports, because it is literally the same `ops::greedy_pass`
//!    doing the work and the same counter counting it.
//!
//! 3. **One readout.** `note` on improvement, the incumbent's live cost every
//!    iteration, `ST_IG_LOOP` with the iteration number, `phase_arg = d`.
//!
//! The construction is built lazily, on the first `advance`, for the same reason
//! every other racer builds inside its first slice: it spends budget, and budget
//! may only be spent through a `Ctx`. It is one indivisible phase and can
//! overshoot the slice it was handed, exactly like everyone else's `greedy_pass`.
//!
//! Two honest limits, stated rather than hidden:
//!
//! * **`Run` decides its own pruning.** It calls `ops::prune_is_exact` in
//!   `new_adaptive`, so forcing `common.prune = false` on the racer — which the
//!   other five honour — does not reach it. The prune-on/prune-off equivalence
//!   test therefore cannot be run against IG without a `Run` that takes the flag.
//! * **`d_eff` is not observable.** The adaptive ramp lives on `Run::stall`,
//!   which is private, so `phase_arg` reports the configured `d` rather than the
//!   ramped one. With `d_max == d` — what `race_new` configures — they are the
//!   same number anyway.

use super::{status, Common, Ctx, IgConfig};
use crate::eval::State;
use crate::rng::method_seed;
use crate::solver::Run;

pub struct IgState {
    cfg: IgConfig,
    seed: u64,
    /// `None` until the first slice builds it; see the module note.
    run: Option<Run>,
    /// `run.evaluations` as of the last time the ledger was settled
    settled: u64,
    iterations: u64,
}

impl IgState {
    pub fn new(race_seed: u32, cfg: IgConfig, common: &mut Common) -> IgState {
        common.status_key = status::CONSTRUCTING_GREEDY;
        common.status_arg = 0;
        common.phase_arg = cfg.d as u32;
        IgState {
            cfg,
            seed: method_seed(race_seed, super::Method::Ig),
            run: None,
            settled: 0,
            iterations: 0,
        }
    }

    /// The live incumbent — `Run::cur`, not `Run::best`, so the page draws the
    /// solution IG is actually working on. Falls back to the racer's best while
    /// the construction has not happened yet.
    pub fn incumbent<'s>(&'s self, common: &'s Common) -> &'s State {
        match &self.run {
            Some(run) => &run.cur,
            None => &common.best,
        }
    }

    pub fn advance(&mut self, ctx: &mut Ctx) {
        if self.run.is_none() {
            // The construction, plus the optional swap phase. One indivisible
            // phase: it runs to completion inside this slice and the overshoot
            // is carried as debt against the next one.
            let run = Run::new(
                ctx.inst(),
                self.cfg.d,
                self.cfg.accept,
                self.cfg.permute,
                self.seed,
            );
            ctx.charge_engine(run.evaluations - self.settled);
            self.settled = run.evaluations;
            let cost = run.best.total();
            ctx.note(cost, &run.best);
            ctx.set_cur_cost(run.cur.total());
            ctx.status(status::IG_LOOP, 0);
            self.run = Some(run);
            return;
        }

        let run = self.run.as_mut().expect("built above");
        while ctx.has_credit() {
            // One destroy–rebuild iteration is IG's indivisible group, the same
            // way one neighbourhood scan is Tabu's and one generation is AMA's.
            run.step(ctx.inst(), 1);
            self.iterations += 1;
            ctx.charge_engine(run.evaluations - self.settled);
            self.settled = run.evaluations;
            ctx.note(run.best.total(), &run.best);
            ctx.set_cur_cost(run.cur.total());
            ctx.status(status::IG_LOOP, self.iterations as u32);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::{Instance, Job};
    use crate::race::{Body, Method, Racer};
    use crate::solver::Accept;

    const IG: IgConfig = IgConfig { d: 3, accept: Accept::Current, permute: true };

    /// Nine jobs, three families, asymmetric setups, one binding deadline.
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
            name: "ig-fixture".into(),
            jobs: vec![
                job(0, 0, 10, 0, 15, 2, 50, 1000),
                job(1, 1, 8, 5, 30, 3, 60, 1000),
                job(2, 0, 6, 0, 12, 1, 40, 1000),
                job(3, 2, 7, 2, 20, 4, 55, 90),
                job(4, 1, 4, 0, 9, 5, 70, 1000),
                job(5, 2, 9, 12, 26, 1, 35, 1000),
                job(6, 0, 5, 18, 40, 2, 45, 1000),
                job(7, 1, 11, 3, 33, 2, 65, 1000),
                job(8, 2, 3, 7, 17, 6, 80, 1000),
            ],
            n_states,
            init_state: 2,
            setup_t,
            setup_c,
        }
    }

    fn run_to(inst: &Instance, seed: u32, budget: u64, slice: i64) -> Racer {
        let mut r = Racer::new(inst, Method::Ig, seed, budget, IG);
        while !r.common.done {
            r.advance(inst, slice);
        }
        r
    }

    fn body(r: &Racer) -> &IgState {
        match &r.body {
            Body::Ig(s) => s,
            _ => panic!("not the IG racer"),
        }
    }

    /// THE test for this file. The racer must be the engine, not a copy of it:
    /// a bare `solver::Run` on the same seed, stepped the same number of
    /// iterations, must land on the identical cost, the identical sequence and
    /// the identical evaluation count. If this fails, the race is showing the
    /// page something the CLI would not reproduce.
    #[test]
    fn the_racer_is_exactly_solver_run() {
        let inst = fixture();
        let r = run_to(&inst, 7, 40_000, 4096);
        let iters = body(&r).iterations;

        let mut bare = Run::new(&inst, IG.d, IG.accept, IG.permute, method_seed(7, Method::Ig));
        bare.step(&inst, iters);

        assert_eq!(r.common.best_cost, bare.best.total(), "best cost");
        assert_eq!(r.common.best.order, bare.best.order, "best sequence");
        assert_eq!(r.common.evals, bare.evaluations, "evaluations");
        assert_eq!(r.incumbent().order, bare.cur.order, "live incumbent");
    }

    /// Every evaluation `Run` counted reached the race's ledger, and none was
    /// counted twice.
    #[test]
    fn the_ledger_matches_the_engines_own_counter() {
        let inst = fixture();
        let r = run_to(&inst, 11, 25_000, 512);
        let run = body(&r).run.as_ref().expect("built");
        assert_eq!(r.common.evals, run.evaluations);
        assert_eq!(body(&r).settled, run.evaluations);
    }

    /// Contract rule 7: the slice size is an animation detail. IG carries its
    /// credit like everyone else, so the whole run must be identical at 1, 137
    /// and 1e9 evaluations per slice.
    #[test]
    fn slice_size_is_invariant() {
        let inst = fixture();
        let reference = run_to(&inst, 3, 20_000, 1_000_000_000);
        for slice in [1i64, 137, 5_000] {
            let r = run_to(&inst, 3, 20_000, slice);
            assert_eq!(r.common.evals, reference.common.evals, "slice {slice}");
            assert_eq!(r.common.trace, reference.common.trace, "slice {slice}");
            assert_eq!(r.common.best_cost, reference.common.best_cost, "slice {slice}");
            assert_eq!(r.common.best.order, reference.common.best.order, "slice {slice}");
            assert_eq!(body(&r).iterations, body(&reference).iterations, "slice {slice}");
        }
    }

    /// The trace is monotone, every point is stamped at a real evaluation count,
    /// and the last one is the reported best.
    #[test]
    fn the_trace_is_monotone_and_ends_at_the_best() {
        let inst = fixture();
        let r = run_to(&inst, 5, 30_000, 1024);
        assert!(!r.common.trace.is_empty());
        for w in r.common.trace.windows(2) {
            assert!(w[1].1 < w[0].1, "trace must strictly decrease");
            assert!(w[1].0 >= w[0].0, "trace must advance in evaluations");
        }
        assert_eq!(r.common.trace.last().expect("non-empty").1, r.common.best_cost);
        assert!(r.common.evals >= 30_000, "the standings must see the overshoot");
    }

    /// A different race seed is a different IG run — the seed reaches the engine.
    #[test]
    fn the_race_seed_reaches_the_engine() {
        let inst = fixture();
        let a = run_to(&inst, 1, 15_000, 2048);
        let b = run_to(&inst, 2, 15_000, 2048);
        assert_ne!(a.common.trace, b.common.trace);
    }
}
