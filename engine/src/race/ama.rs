//! AMA — the memetic racer: a population, tournament selection, OX-lite
//! crossover, and the shared greedy construction as the local search on every
//! offspring.
//!
//! Ported from `makeAMA` in studio/src/race/strategies.js. The numbers that
//! define the method are all here and none of them are guesses:
//!
//! * **population 6**, fixed, allocated once and never resized;
//! * **tournament 3**, with replacement, strictly-better wins so a tie keeps the
//!   earliest draw;
//! * **one crossover per generation**, cut uniform in `1..=max(1, |A|-1)`;
//! * **local search = one `ops::greedy_pass` on the child**, plus a second pass
//!   after mutation. That is the memetic part: the child is repaired *and*
//!   intensified by the same construction every other racer uses, so AMA's local
//!   search is not a private neighbourhood — it is the shared one.
//! * **mutation p = 0.35**, destroy 2 and reinsert, guarded on `|child| > 2`;
//! * **steady-state replacement**: the child displaces the worst member iff it
//!   is strictly cheaper.
//!
//! ### Budget, per generation
//!
//! `1` (the child, produced whole and never priced — the implied full
//! evaluation) `+ greedy_pass(repair)` `+ greedy_pass(mutation repair, if it
//! fired)` `+ 1` (scoring the finished child). Exactly the JS `e`. Per
//! population member during the build phase: `greedy_pass + 1`. Nothing else
//! spends budget: AMA never prices a single move, so it never touches
//! `Ctx::price`, and every evaluation it spends flows through `greedy_pass`
//! (which charges inside `State::best_insertion`, skipped positions included) or
//! through `charge_unpriced`.
//!
//! Credit is checked at the top of a generation and at the top of a population
//! member, so an overshoot is bounded by one generation / one construction.
//! Construction is indivisible: on a large instance the first slice can cost one
//! full greedy pass in a single call. That matches the JS, where `greedyPass`
//! also runs to completion inside one `step`.

use super::ctx::Ctx;
use super::{ST_BREEDING as STATUS_BREEDING, ST_GENERATION as STATUS_GENERATION};
use crate::eval::State;
use crate::instance::Instance;

/// Population size. JS: `while (this.pop.length < 6 …)` and `if (this.pop.length >= 6)`.
const POP: usize = 6;

/// Tournament size. JS: `for (let k = 0; k < 3; k++)`.
const TOURNAMENT: usize = 3;

/// Mutation probability 0.35, as an exact integer threshold on a u64 draw:
/// `floor(35 · 2^64 / 100)`. The JS writes `this.rng() < 0.35` over a float in
/// `[0,1)`; a float in a decision path is precisely what breaks cross-machine
/// determinism, so the comparison is done in integers. One draw either way.
const MUTATE_THRESHOLD: u64 = 6_456_360_425_798_343_065;

/// Jobs destroyed by a mutation. JS: `for (let k = 0; k < 2; k++)`.
const MUTATE_DESTROY: usize = 2;

pub struct AmaState {
    pop: Vec<State>,
    /// index of the cheapest member — the racer's live incumbent
    best_idx: usize,
    gen: u32,
    evolving: bool,
    /// reused across generations so a generation allocates nothing
    child: State,
    head_mark: Vec<bool>,
    order_buf: Vec<u32>,
}

impl AmaState {
    pub fn new(inst: &Instance, common: &mut super::Common) -> AmaState {
        common.status_key = STATUS_BREEDING;
        common.status_arg = 0;
        common.phase_arg = POP as u32;
        let mut child = State::all_rejected(inst);
        child.rebuild(inst);
        AmaState {
            pop: Vec::with_capacity(POP),
            best_idx: 0,
            gen: 0,
            evolving: false,
            child,
            head_mark: vec![false; inst.n()],
            order_buf: Vec::with_capacity(inst.n()),
        }
    }

    /// The cheapest member of the population — what the page draws as AMA's
    /// current schedule. JS: `r.view()` reduces `r.pop` to its minimum, falling
    /// back to the empty solution while the population is still being bred.
    pub fn incumbent<'s>(&'s self, common: &'s super::Common) -> &'s State {
        self.pop.get(self.best_idx).unwrap_or(&common.best)
    }

    pub fn advance(&mut self, ctx: &mut Ctx) {
        if !self.evolving {
            self.build(ctx);
            if !self.evolving {
                return; // ran out of credit mid-population
            }
        }
        self.evolve(ctx);
    }

    // -- phase 1: breed the initial population ------------------------------

    /// JS:
    /// ```js
    /// while (this.pop.length < 6 && used < budget + 4000) {
    ///   const sol = { order: [], rejected: inst.jobs.map((j) => j.id) };
    ///   const e = greedyPass(sol, this.rng, null);
    ///   used += e; this.evals += e;
    ///   const c = inst.costOnly(sol.order, sol.rejected); used++; this.evals++;
    ///   this.pop.push({ ...sol, cost: c });
    ///   this.note(c, sol);
    /// }
    /// ```
    /// Six independent shuffled greedy constructions off the same stream. The
    /// members differ only by the shuffle, which is the whole diversity budget
    /// this method starts with.
    fn build(&mut self, ctx: &mut Ctx) {
        let inst = ctx.inst();
        while self.pop.len() < POP && ctx.has_credit() {
            let mut sol = State::all_rejected(inst);
            sol.rebuild(inst);
            ctx.greedy_pass(&mut sol, false);
            ctx.charge_unpriced(); // the JS `costOnly` that scores the member
            let cost = sol.total();
            ctx.note(cost, &sol);
            self.pop.push(sol);
            self.refresh_incumbent(ctx);
        }
        if self.pop.len() == POP {
            self.evolving = true;
            ctx.status(STATUS_GENERATION, 0);
        }
    }

    // -- phase 2: evolve ----------------------------------------------------

    fn evolve(&mut self, ctx: &mut Ctx) {
        let inst = ctx.inst();
        while ctx.has_credit() {
            self.gen += 1;

            // JS: `const pa = pick(); let pb = pick(); if (pb === pa) pb = pick();`
            // Re-picked once if it drew the same *object*; it may still come back
            // equal, and the JS does not care — so neither does this. Comparing
            // indices is exactly comparing objects here, because every member is
            // a distinct object pushed once.
            let ia = self.tournament(ctx);
            let mut ib = self.tournament(ctx);
            if ib == ia {
                ib = self.tournament(ctx);
            }

            self.crossover(ctx, ia, ib);
            ctx.charge_unpriced(); // JS: `let e = 1; this.evals++`

            ctx.greedy_pass(&mut self.child, false); // repair / intensification

            // JS: `if (this.rng() < 0.35 && child.order.length > 2)`. `&&`
            // short-circuits left to right, so the draw happens on *every*
            // generation regardless of the length guard — consume it either way
            // or the whole stream shifts.
            let roll = ctx.rng().next_u64();
            if roll < MUTATE_THRESHOLD && self.child.order.len() > MUTATE_DESTROY {
                self.child.remove_random(inst, MUTATE_DESTROY, ctx.rng());
                ctx.greedy_pass(&mut self.child, false);
            }

            ctx.charge_unpriced(); // JS: `const cc = costOnly(...); e++`
            let cc = self.child.total();

            // steady-state replacement of the worst member. JS reduces with a
            // strict `>`, so a tie keeps the earliest index; and the child must
            // be strictly cheaper to get in.
            let mut worst = 0;
            for k in 1..self.pop.len() {
                if self.pop[k].total() > self.pop[worst].total() {
                    worst = k;
                }
            }
            if cc < self.pop[worst].total() {
                self.pop[worst].clone_from(&self.child);
            }

            ctx.note(cc, &self.child);
            self.refresh_incumbent(ctx);
            ctx.status(STATUS_GENERATION, self.gen);
        }
    }

    /// JS:
    /// ```js
    /// const pick = () => {
    ///   let b = null;
    ///   for (let k = 0; k < 3; k++) {
    ///     const c = this.pop[Math.floor(this.rng() * this.pop.length)];
    ///     if (!b || c.cost < b.cost) b = c;
    ///   }
    ///   return b;
    /// };
    /// ```
    /// Three draws with replacement, strictly-better wins, so drawing the same
    /// index twice is a no-op and a tie keeps the earliest draw. Costs no budget:
    /// every member's cost is already known.
    fn tournament(&self, ctx: &mut Ctx) -> usize {
        let mut best = usize::MAX;
        for _ in 0..TOURNAMENT {
            let k = ctx.rng().below(self.pop.len());
            if best == usize::MAX || self.pop[k].total() < self.pop[best].total() {
                best = k;
            }
        }
        best
    }

    /// OX-lite: A's prefix, then everything else in B's order.
    ///
    /// JS:
    /// ```js
    /// const cut = 1 + Math.floor(this.rng() * Math.max(1, pa.order.length - 1));
    /// const head = pa.order.slice(0, cut);
    /// const tail = pb.order.filter((j) => !head.includes(j));
    /// const child = {
    ///   order: head.concat(tail),
    ///   rejected: inst.jobs.map((j) => j.id)
    ///                      .filter((j) => !head.includes(j) && !tail.includes(j)),
    /// };
    /// ```
    /// `!head.includes(j) && !tail.includes(j)` is just "not in `head ++ tail`",
    /// i.e. the complement of the child's sequence, taken over `inst.jobs` in
    /// ascending id — which is exactly the rejected set `State` maintains, in
    /// exactly the order `rejected()` yields. That order matters: the repair pass
    /// shuffles it.
    fn crossover(&mut self, ctx: &mut Ctx, ia: usize, ib: usize) {
        let inst = ctx.inst();
        let pa_len = self.pop[ia].order.len();
        // `Math.max(1, len - 1)` — and `len - 1` on an empty parent is -1 in JS,
        // which `max(1, …)` swallows; `saturating_sub` swallows it here.
        let span = pa_len.saturating_sub(1).max(1);
        // `slice(0, cut)` clamps to the parent's length; `min` does it explicitly.
        let cut = (1 + ctx.rng().below(span)).min(pa_len);

        for mark in self.head_mark.iter_mut() {
            *mark = false;
        }
        self.order_buf.clear();
        for &jid in &self.pop[ia].order[..cut] {
            self.head_mark[jid as usize] = true;
            self.order_buf.push(jid);
        }
        for &jid in &self.pop[ib].order {
            if !self.head_mark[jid as usize] {
                self.order_buf.push(jid);
            }
        }
        seat(inst, &mut self.child, &self.order_buf);
    }

    fn refresh_incumbent(&mut self, ctx: &mut Ctx) {
        if self.pop.is_empty() {
            return;
        }
        let mut b = 0;
        for k in 1..self.pop.len() {
            if self.pop[k].total() < self.pop[b].total() {
                b = k;
            }
        }
        self.best_idx = b;
        ctx.set_cur_cost(self.pop[b].total());
    }
}

/// Re-seat `s` on `order`: membership, rejection cost and the cached time/cost
/// arrays, with the complement of `order` becoming the rejected set. AMA is the
/// only method that produces a whole sequence at once rather than editing one
/// position, so this lives here rather than on `State` — it needs nothing
/// private and adds nothing to the shared evaluator.
fn seat(inst: &Instance, s: &mut State, order: &[u32]) {
    s.order.clear();
    s.order.extend_from_slice(order);
    for slot in s.in_seq.iter_mut() {
        *slot = false;
    }
    for &jid in &s.order {
        s.in_seq[jid as usize] = true;
    }
    let rej_cost = inst
        .jobs
        .iter()
        .enumerate()
        .filter(|(j, _)| !s.in_seq[*j])
        .map(|(_, job)| job.rej)
        .sum();
    s.rej_cost = rej_cost;
    s.rebuild(inst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::{Instance, Job};
    use crate::race::{IgConfig, Method, Racer};
    use crate::rng::{method_seed, Rng};
    use crate::solver::Accept;

    /// AMA ignores it; the canonical `Racer::new` carries it for the IG racer.
    const IG: IgConfig = IgConfig { d: 4, accept: Accept::Current, permute: true };

    /// Nine jobs, three setup families, asymmetric setups, a mix of rejection
    /// costs cheap and dear enough that both scheduling and rejecting win
    /// somewhere — so the population is not all one solution.
    fn bench() -> Instance {
        let n_states = 3;
        let mut setup_t = vec![0i64; 9];
        let mut setup_c = vec![0i64; 9];
        for (f, t, st, sc) in [
            (0usize, 1usize, 5i64, 7i64),
            (0, 2, 3, 4),
            (1, 0, 4, 6),
            (1, 2, 6, 9),
            (2, 0, 2, 3),
            (2, 1, 3, 4),
        ] {
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
            mode_cost: 10,
            rej,
            end_max: 400,
        };
        Instance {
            name: "bench9".into(),
            jobs: vec![
                job(0, 0, 10, 0, 15, 2, 50),
                job(1, 1, 8, 5, 30, 3, 60),
                job(2, 0, 6, 0, 12, 1, 40),
                job(3, 2, 12, 3, 40, 2, 90),
                job(4, 1, 7, 10, 25, 5, 30),
                job(5, 2, 9, 0, 55, 1, 70),
                job(6, 0, 4, 20, 35, 4, 25),
                job(7, 1, 11, 2, 60, 2, 85),
                job(8, 2, 5, 15, 45, 3, 45),
            ],
            n_states,
            init_state: 2,
            setup_t,
            setup_c,
        }
    }

    fn run(inst: &Instance, seed: u32, budget: u64, slice: i64) -> Racer {
        let mut r = Racer::new(inst, Method::Ama, seed, budget, IG);
        while r.common.evals < budget {
            let spent = r.advance(inst, slice);
            assert!(spent > 0, "a slice must make progress");
        }
        r
    }

    /// Golden trace. Pinned so a determinism regression fails loudly: same seed,
    /// same budget, same instance must give the same cost on every machine, and
    /// the whole improvement history must match, not just the endpoint.
    #[test]
    fn ama_golden_trace() {
        let inst = bench();
        let r = run(&inst, 2026, 20_000, 4_096);
        assert_eq!(
            r.common.trace,
            vec![(43, 218), (217, 215), (258, 204), (2_873, 202), (3_554, 191)],
            "AMA golden trace (evals, deci-cost) drifted"
        );
        assert_eq!(r.common.best_cost, 191, "19.1 in data units");
        assert_eq!(r.common.best.order, vec![0, 2, 6, 3, 8, 5, 7]);
        // 20_040, not 20_000: the last generation is indivisible and overshoots.
        // The racer reports the truth; the progress bar may clamp, the standings
        // table must not.
        assert_eq!(r.common.evals, 20_040);
        assert_eq!(r.common.status_arg, 694, "generations run");
    }

    /// Slice-size invariance. This is what makes the JS-side adaptive slice safe,
    /// and the property that breaks first if someone adds a credit-dependent
    /// decision. One giant slice must equal many tiny ones — same cost, same
    /// evaluations, same trace, same incumbent.
    #[test]
    fn ama_is_slice_invariant() {
        let inst = bench();
        let huge = run(&inst, 7, 30_000, 1_000_000_000);
        let tiny = run(&inst, 7, 30_000, 137);
        assert_eq!(huge.common.evals, tiny.common.evals);
        assert_eq!(huge.common.best_cost, tiny.common.best_cost);
        assert_eq!(huge.common.trace, tiny.common.trace);
        assert_eq!(huge.common.best.order, tiny.common.best.order);
        assert_eq!(huge.incumbent().order, tiny.incumbent().order);
        assert_eq!(huge.common.status_arg, tiny.common.status_arg);
    }

    /// Pruning is charged as if it had not happened, so disabling it must move
    /// wall-clock and nothing else: identical trace, identical evals, identical
    /// final cost.
    #[test]
    fn ama_prune_off_matches_prune_on() {
        let inst = bench();
        let on = run(&inst, 99, 25_000, 512);

        let mut off = Racer::new(&inst, Method::Ama, 99, 25_000, IG);
        off.common.prune = false;
        while off.common.evals < 25_000 {
            off.advance(&inst, 512);
        }

        assert_eq!(on.common.evals, off.common.evals);
        assert_eq!(on.common.trace, off.common.trace);
        assert_eq!(on.common.best_cost, off.common.best_cost);
        assert_eq!(on.common.best.order, off.common.best.order);
    }

    /// The build phase is exactly six shared constructions, each scored once —
    /// and "the shared construction" is meant literally. Replay `ops::greedy_pass`
    /// off an independently-seeded copy of AMA's stream and the totals must agree
    /// to the evaluation, with exactly `+1` per member for the scoring the JS
    /// charges (`const c = costOnly(...); used++`).
    ///
    /// This is the budget-fairness test: it proves AMA buys nothing cheaper than
    /// any other racer and pays for the one thing it produces without pricing.
    #[test]
    fn build_phase_is_six_shared_constructions_plus_one_each() {
        let inst = bench();
        const SEED: u32 = 3;

        // the reference: the same construction, the same stream, no racer
        let mut rng = Rng::new(method_seed(SEED, Method::Ama));
        let mut reference: u64 = 0;
        for _ in 0..POP {
            let mut s = State::all_rejected(&inst);
            s.rebuild(&inst);
            crate::ops::greedy_pass(&inst, &mut s, &mut rng, &mut reference, true, |_, _, _| {});
        }

        let mut r = Racer::new(&inst, Method::Ama, SEED, u64::MAX, IG);
        let mut total = 0;
        // A construction is indivisible, so a slice that has credit yields
        // exactly one member and then carries the overshoot as debt; the slices
        // that follow spend nothing until the debt is repaid.
        let mut productive = 0;
        while r.common.status_key == STATUS_BREEDING {
            let spent = r.advance(&inst, 1);
            if spent > 0 {
                productive += 1;
            }
        total += spent;
        }
        assert_eq!(productive, POP as u64, "one member per credited slice");
        assert_eq!(
            total,
            reference + POP as u64,
            "build must cost the shared construction plus one scoring per member"
        );
        assert_eq!(r.common.status_key, STATUS_GENERATION);
        assert_eq!(r.common.phase_arg, POP as u32);
    }

    /// A generation costs 1 (the unpriced child) + the repair pass + 1 (scoring),
    /// plus a second repair when the mutation fires. Nothing else may charge, and
    /// one unit of credit buys exactly one generation.
    ///
    /// Note the credit carried out of the build phase is deeply negative — a
    /// construction overshoots by design — so this advances until the debt is
    /// paid off and only then measures the slice that actually runs a generation.
    #[test]
    fn one_credit_buys_exactly_one_generation() {
        let inst = bench();
        let mut r = Racer::new(&inst, Method::Ama, 11, u64::MAX, IG);
        while r.common.status_key == STATUS_BREEDING {
            r.advance(&inst, 1);
        }
        assert_eq!(r.common.status_arg, 0, "no generation has run yet");

        let mut spent = 0;
        while r.common.status_arg == 0 {
            spent = r.advance(&inst, 1);
        }
        assert_eq!(r.common.status_arg, 1, "exactly one generation, never two");
        // a repair pass over 9 jobs charges at most 1+2+…+9 = 45, two at most 90;
        // the two unpriced charges (child, scoring) are always there.
        assert!((2..=92).contains(&spent), "generation charged {spent}");
    }

    /// The population never grows past six and every member stays a valid,
    /// self-consistent state under the shared evaluator.
    #[test]
    fn population_stays_six_and_consistent() {
        let inst = bench();
        let r = run(&inst, 5, 15_000, 333);
        assert_eq!(r.common.phase_arg, POP as u32);
        // the incumbent is a member, and it is the cheapest one
        let inc = r.incumbent();
        assert_eq!(inc.total(), r.common.cur_cost);
        // the incumbent's cached cost agrees with a from-scratch rebuild
        let mut fresh = State::all_rejected(&inst);
        seat(&inst, &mut fresh, &inc.order);
        assert_eq!(fresh.total(), inc.total(), "incumbent cost is not self-consistent");
        // and the best-ever is at least as good as the incumbent
        assert!(r.common.best_cost <= inc.total());
    }

    /// `seat` must leave exactly the state a sequence of `insert`s would.
    #[test]
    fn seat_matches_incremental_construction() {
        let inst = bench();
        let order: Vec<u32> = vec![4, 0, 7, 2];
        let mut seated = State::all_rejected(&inst);
        seat(&inst, &mut seated, &order);

        let mut built = State::all_rejected(&inst);
        built.rebuild(&inst);
        for (p, &jid) in order.iter().enumerate() {
            built.insert(&inst, jid, p);
        }
        assert_eq!(seated.order, built.order);
        assert_eq!(seated.in_seq, built.in_seq);
        assert_eq!(seated.rej_cost, built.rej_cost);
        assert_eq!(seated.perf_cost, built.perf_cost);
        assert_eq!(seated.rejected(), built.rejected());
    }

    /// The mutation threshold is the exact integer image of `< 0.35`.
    #[test]
    fn mutation_threshold_is_exactly_thirty_five_percent() {
        assert_eq!(MUTATE_THRESHOLD, ((35u128 << 64) / 100) as u64);
    }
}
