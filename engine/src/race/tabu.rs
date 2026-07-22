//! Tabu search, and Tabu-with-diversification.
//!
//! Ported from `makeTabu(div)` in `studio/src/race/strategies.js` (lines
//! 235-276) together with the `bestNeighbor` / `applyMove` helpers it calls
//! (lines 56-113). `div == true` is the racer the page calls "tabudiv": the
//! same search plus a periodic kick that rejects the 30% least recently
//! (re-)admitted jobs and makes them tabu for a while.
//!
//! The JS being ported, verbatim:
//!
//! ```js
//! this.credit += budget;
//! while (this.credit > 0) {
//!   this.iter++;
//!   if (div && this.iter % 45 === 0) { // diversification: reject the 30% oldest
//!     const byAge = this.cur.order.slice().sort((a, b) => (this.age[a] || 0) - (this.age[b] || 0));
//!     const k = Math.max(1, Math.floor(this.cur.order.length * 0.3));
//!     for (const j of byAge.slice(0, k)) {
//!       this.cur.order.splice(this.cur.order.indexOf(j), 1);
//!       this.cur.rejected.push(j);
//!       this.tabuUntil[j] = this.iter + 12;
//!     }
//!     this.evals++; used++; this.credit--;
//!     this.jumps++;
//!     this.status = { key: "diversified", arg: this.jumps };
//!     continue;
//!   }
//!   const { best, evals } = bestNeighbor(this.cur, this.tabuUntil, this.iter, this.bestCost, this.rng);
//!   used += evals; this.evals += evals; this.credit -= evals;
//!   if (!best) break;
//!   applyMove(this.cur, best.apply);
//!   this.tabuUntil[best.job] = this.iter + 8;
//!   if (best.apply.type === "add") this.age[best.job] = this.iter;
//!   this.note(best.cost, this.cur);
//!   if (!div) this.status = { key: "iteration", arg: this.iter };
//! }
//! ```
//!
//! Note the ordinary tabu acceptance: the scan keeps the cheapest admissible
//! candidate and commits it *even when it is worse than the incumbent*. Only
//! `note()` filters on improvement. That is what lets tabu leave a local
//! optimum, and it is why the scan cutoff below is the scan's own running best
//! and not the racer's global best.

use super::{status, Common, Ctx};
use crate::eval::State;
use crate::instance::Instance;
use crate::ops::Move;

/// Past this many jobs the exhaustive O(n^2) scan would be a quarter of a
/// million evaluations per iteration, so large instances sample a bounded
/// random move set per scan instead (uniform over the same four families).
/// Straight from `createSearchOps` in `strategies.js`; keeping it is not
/// cosmetic for *this* method — TabuDiv only diversifies every 45 iterations,
/// and with the exhaustive scan an n=500 instance would never reach iteration
/// 45 inside a plausible budget, so "tabudiv" would silently become "tabu".
const STOCHASTIC_N: usize = 240;
const STOCHASTIC_BUDGET: usize = 6_000;

/// Tabu tenure after a committed move, and after a diversification eject.
/// `pub` because the snapshot reports it as this racer's `phase_arg` (the
/// "d_eff / tenure / population" slot) — carried over from the tabu tree, whose
/// `TabuState::phase_arg()` returned exactly this constant.
pub const TENURE: u32 = 8;
const TENURE_DIV: u32 = 12;
/// One diversification every this many iterations.
const DIV_EVERY: u32 = 45;

pub struct TabuState {
    div: bool,
    building: bool,
    cur: State,
    iter: u32,
    jumps: u32,
    /// Per job index; a job is tabu while `tabu_until[j] > iter`. A `Vec`, not a
    /// map: the determinism contract forbids a HashMap's iteration order in a
    /// decision, and a Vec removes the question instead of answering it.
    tabu_until: Vec<u32>,
    /// Iteration at which the job was last (re-)admitted by an "add" move.
    age: Vec<u32>,
    /// Scratch. `rej` is refreshed unconditionally after every committed move,
    /// which is what makes desync impossible; it costs one O(n) fill per commit
    /// against thousands of priced candidates.
    rej: Vec<u32>,
    /// Packed `(age << 32) | job` keys; see `diversify`.
    by_age: Vec<u64>,
    eject: Vec<bool>,
}

impl TabuState {
    pub fn new(inst: &Instance, div: bool, common: &mut Common) -> TabuState {
        let n = inst.n();
        let mut cur = State::all_rejected(inst);
        cur.rebuild(inst);
        common.status_key = status::CONSTRUCTING_GREEDY;
        common.status_arg = 0;
        TabuState {
            div,
            building: true,
            cur,
            iter: 0,
            jumps: 0,
            tabu_until: vec![0; n],
            age: vec![0; n],
            rej: Vec::with_capacity(n),
            by_age: Vec::with_capacity(n),
            eject: vec![false; n],
        }
    }

    /// The live incumbent (the schedule strip / the firefly), not the best.
    pub fn cur(&self) -> &State {
        &self.cur
    }
    pub fn iter(&self) -> u32 {
        self.iter
    }
    pub fn jumps(&self) -> u32 {
        self.jumps
    }

    pub fn advance(&mut self, ctx: &mut Ctx) {
        if self.building {
            // JS: `used = greedyPass(this.cur, this.rng, c => this.note(c, this.cur));`
            // then `this.phase = "search"` and an immediate `return used` — the
            // construction is one indivisible phase and can overshoot the slice.
            ctx.greedy_pass(&mut self.cur, true);
            // JS: `this.cur.order.forEach(j => { this.age[j] = 0; })`. A no-op
            // here (ages start at 0, and a job that was never admitted reads as
            // age 0 in the JS too, via `this.age[a] || 0`); kept so the port
            // reads against the original.
            for &j in &self.cur.order {
                self.age[j as usize] = 0;
            }
            self.cur.rejected_into(&mut self.rej);
            self.building = false;
            ctx.set_cur_cost(self.cur.total());
            return;
        }

        while ctx.has_credit() {
            self.iter += 1;
            if self.div && self.iter % DIV_EVERY == 0 {
                self.diversify(ctx);
                continue;
            }
            let before = ctx.spent();
            match self.best_neighbor(ctx) {
                Some((mv, cost)) => {
                    let job = self.cur.touched_job(mv) as usize; // before apply
                    self.cur.apply(ctx.inst(), mv);
                    // The scan's winner was priced below the then-current
                    // cutoff, so its price is exact, not a lower bound. If this
                    // ever fires, one of the incremental pricers is wrong.
                    debug_assert_eq!(self.cur.total(), cost, "winner mispriced: {mv:?}");
                    self.cur.rejected_into(&mut self.rej);
                    self.tabu_until[job] = self.iter + TENURE;
                    if matches!(mv, Move::Insert { .. }) {
                        self.age[job] = self.iter;
                    }
                    ctx.note(cost, &self.cur);
                    ctx.set_cur_cost(cost);
                    if !self.div {
                        ctx.status(status::ITERATION, self.iter);
                    }
                }
                None => {
                    // JS: `if (!best) break;` — the racer is not marked done, a
                    // later slice may find a candidate again (the tabu list
                    // expires). Defensive extra: a scan that priced *nothing*
                    // can never make progress and would spin forever, so it
                    // terminates the racer instead. Only reachable on a 0-job
                    // instance; the JS would hang there.
                    if ctx.spent() == before {
                        ctx.finish_with(status::STUCK_LOCAL, self.iter);
                    }
                    break;
                }
            }
        }
    }

    /// `bestNeighbor(cur, tabuUntil, iter, bestCost, rng)`: the cheapest
    /// admissible candidate over the four move families, or None.
    fn best_neighbor(&self, ctx: &mut Ctx) -> Option<(Move, i64)> {
        let cur = &self.cur;
        let tabu_until = &self.tabu_until;
        let rej = &self.rej;
        let iter = self.iter;
        let global_best = ctx.best_cost();
        let mut best: Option<(Move, i64)> = None;

        // `const consider = (cost, apply, job) => { evals++; ... }`.
        // The cutoff handed to the pricer is the scan's own running best: a
        // candidate is selected only on a strict `cost < best.cost`, so a
        // candidate priced at or above the cutoff cannot win and never needs an
        // exact price. The tabu/aspiration filter is safe under that cutoff too
        // — it can only ever *admit* a candidate that the strict-improvement
        // test then rejects — so pruning changes wall-clock and never a
        // decision (contract rule 3), which the prune-on/prune-off test pins.
        //
        // Outlined, not inlined: it is called from eight places and each copy
        // would carry the full four-way pricing dispatch into the binary, and
        // the page pays for wasm bytes.
        #[inline(never)]
        fn consider(
            cur: &State,
            tabu_until: &[u32],
            iter: i64,
            global_best: i64,
            best: &mut Option<(Move, i64)>,
            ctx: &mut Ctx,
            mv: Move,
        ) {
            let cutoff = best.map_or(i64::MAX, |(_, c)| c);
            if let Some(cost) = ctx.price(cur, mv, cutoff) {
                let job = cur.touched_job(mv) as usize;
                // `if (isTabu && cost >= bestCost) return;` — aspiration: a tabu
                // move is admissible only if it beats the global best.
                let is_tabu = tabu_until[job] as i64 > iter;
                if !(is_tabu && cost >= global_best) && cost < cutoff {
                    *best = Some((mv, cost));
                }
            }
        }
        let iter = iter as i64;
        macro_rules! consider {
            ($mv:expr) => {
                consider(cur, tabu_until, iter, global_best, &mut best, ctx, $mv)
            };
        }

        let o = cur.order.len();
        let r = rej.len();
        if ctx.inst().n() <= STOCHASTIC_N {
            for ri in 0..r {
                for p in 0..=o {
                    consider!(Move::Insert { job: rej[ri], pos: p as u32 });
                }
            }
            for oi in 0..o {
                consider!(Move::Remove { pos: oi as u32 });
            }
            for oi in 0..o {
                for p in 0..o {
                    // `if (p === oi) return;` — the identity move is not a
                    // candidate and is not charged.
                    if p != oi {
                        consider!(Move::Reposition { from: oi as u32, to: p as u32 });
                    }
                }
            }
            for oi in 0..o {
                for ri in 0..r {
                    consider!(Move::Swap { pos: oi as u32, job: rej[ri] });
                }
            }
        } else {
            let per_family = (STOCHASTIC_BUDGET / 4).max(64);
            // Draw order matches the JS argument evaluation order exactly
            // (left to right), because the draws are the search.
            if r > 0 {
                for _ in 0..per_family {
                    let ri = ctx.rng().below(r);
                    let p = ctx.rng().below(o + 1);
                    consider!(Move::Insert { job: rej[ri], pos: p as u32 });
                }
            }
            if o > 0 {
                for _ in 0..per_family {
                    let oi = ctx.rng().below(o);
                    consider!(Move::Remove { pos: oi as u32 });
                }
                for _ in 0..per_family {
                    let oi = ctx.rng().below(o);
                    let p = ctx.rng().below(o);
                    if p != oi {
                        consider!(Move::Reposition { from: oi as u32, to: p as u32 });
                    }
                }
                if r > 0 {
                    for _ in 0..per_family {
                        let oi = ctx.rng().below(o);
                        let ri = ctx.rng().below(r);
                        consider!(Move::Swap { pos: oi as u32, job: rej[ri] });
                    }
                }
            }
        }
        best
    }

    /// The diversification kick: reject the 30% least recently admitted jobs and
    /// make them tabu for `TENURE_DIV` iterations. Charged one unpriced unit —
    /// the new incumbent was never priced, so it costs the implied full
    /// evaluation (contract rule 4), matching the JS `this.evals++`.
    fn diversify(&mut self, ctx: &mut Ctx) {
        let inst = ctx.inst();
        // Key = (age, job index), packed into one u64 so the comparison is a
        // single integer compare. The job index is an explicit tiebreak: the
        // ejected set has to be a property of the state, not of a sort's
        // internals. Sorted by hand — `slice::sort_by_key` drags in the stable
        // drift/quicksort, which is ~5.4 KB of a page-cost budget, while this is
        // a couple of hundred bytes. It runs once every `DIV_EVERY` iterations,
        // between two exhaustive neighbourhood scans, so O(n^2) here is far
        // below the noise floor of the search around it.
        self.by_age.clear();
        for &j in &self.cur.order {
            self.by_age.push(((self.age[j as usize] as u64) << 32) | j as u64);
        }
        for i in 1..self.by_age.len() {
            let key = self.by_age[i];
            let mut p = i;
            while p > 0 && self.by_age[p - 1] > key {
                self.by_age[p] = self.by_age[p - 1];
                p -= 1;
            }
            self.by_age[p] = key;
        }
        // `Math.max(1, Math.floor(len * 0.3))` in integers: no float ever enters
        // a decision. `* 3 / 10` is exactly `floor(len * 0.3)` for any len here.
        let k = (self.cur.order.len() * 3 / 10).max(1).min(self.by_age.len());
        for e in self.eject.iter_mut() {
            *e = false;
        }
        for &key in &self.by_age[..k] {
            let j = key as u32;
            self.eject[j as usize] = true;
            self.cur.in_seq[j as usize] = false;
            self.cur.rej_cost += inst.jobs[j as usize].rej;
            self.tabu_until[j as usize] = self.iter + TENURE_DIV;
        }
        let eject = &self.eject;
        // `retain` keeps the survivors in order — the repeated
        // `splice(indexOf(j), 1)` of the JS, without the O(n^2).
        self.cur.order.retain(|&j| !eject[j as usize]);
        self.cur.rebuild(inst);
        self.cur.rejected_into(&mut self.rej);
        ctx.charge_unpriced();
        self.jumps += 1;
        ctx.set_cur_cost(self.cur.total());
        ctx.status(status::DIVERSIFIED, self.jumps);
        // No `note()`: an eject can only raise the cost, and the JS does not
        // note here either.
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::Job;
    use crate::race::{IgConfig, Method, Racer};
    use crate::solver::Accept;

    /// A fixed 12-job instance: three setup families with an asymmetric,
    /// non-zero setup matrix, releases and due dates tight enough that
    /// tardiness bites, rejection costs low enough that some jobs stay
    /// rejected (so the "add" and "swap" families are non-empty), and two hard
    /// deadlines so infeasible candidates actually occur.
    fn fixture() -> Instance {
        let n_states = 3;
        let mut setup_t = vec![0i64; 9];
        let mut setup_c = vec![0i64; 9];
        for (f, t, st, sc) in [
            (0usize, 1usize, 5i64, 7i64),
            (0, 2, 6, 2),
            (1, 0, 4, 6),
            (1, 2, 1, 9),
            (2, 0, 2, 3),
            (2, 1, 3, 4),
        ] {
            setup_t[f * n_states + t] = st;
            setup_c[f * n_states + t] = sc;
        }
        // (fam, p, rel, due, w, rej, end_max)
        let spec: [(usize, i64, i64, i64, i64, i64, i64); 12] = [
            (0, 10, 0, 15, 2, 120, 400),
            (1, 8, 5, 30, 3, 90, 400),
            (0, 6, 0, 12, 1, 140, 400),
            (2, 7, 2, 20, 4, 60, 95),
            (1, 4, 0, 9, 5, 150, 400),
            (2, 9, 12, 26, 1, 70, 400),
            (0, 5, 18, 40, 2, 110, 400),
            (1, 11, 3, 33, 2, 80, 400),
            (2, 3, 7, 17, 6, 130, 400),
            (0, 12, 20, 55, 1, 100, 400),
            (1, 6, 9, 24, 3, 75, 120),
            (2, 8, 1, 28, 2, 95, 400),
        ];
        Instance {
            name: "tabudiv-fixture".into(),
            jobs: spec
                .iter()
                .enumerate()
                .map(|(i, &(fam, p, rel, due, w, rej, end_max))| Job {
                    id: i,
                    fam,
                    p,
                    rel,
                    due,
                    w,
                    e: 0,
                    mode_cost: 10,
                    rej,
                    end_max,
                })
                .collect(),
            n_states,
            init_state: 2,
            setup_t,
            setup_c,
        }
    }

    fn run(m: Method, seed: u32, budget: u64, slice: i64, prune: Option<bool>) -> Racer {
        let inst = fixture();
        let mut r = Racer::new(
            &inst,
            m,
            seed,
            budget,
            IgConfig { d: 4, accept: Accept::Current, permute: true },
        );
        if let Some(p) = prune {
            r.common.prune = p;
        }
        let mut guard = 0;
        while !r.common.done {
            r.advance(&inst, slice);
            guard += 1;
            assert!(guard < 5_000_000, "racer never finished");
        }
        r
    }

    fn body(r: &Racer) -> &TabuState {
        match &r.body {
            super::super::Body::Tabu(s) => s,
            _ => panic!("not a tabu racer"),
        }
    }

    /// Golden: a fixed seed and budget pin the whole run. If a refactor changes
    /// the search, the PRNG, the move order or the accounting, this fails.
    #[test]
    fn tabudiv_golden_run() {
        let r = run(Method::TabuDiv, GOLD_SEED, 60_000, 4096, None);
        let b = body(&r);
        assert_eq!(r.common.evals, GOLD_EVALS, "evaluations");
        assert_eq!(r.common.best_cost, GOLD_BEST, "best cost (deci-units)");
        assert_eq!(b.iter, GOLD_ITER, "iterations");
        assert_eq!(b.jumps, GOLD_JUMPS, "diversifications");
        assert_eq!(r.common.trace, gold_trace(), "improvement trace");
        assert_eq!(r.common.status_key, status::BUDGET_EXHAUSTED);
        // The best solution the racer reports must actually evaluate to the cost
        // it reports, through the same evaluator the CLI validates against.
        let inst = fixture();
        let mut check = State::all_rejected(&inst);
        check.order = r.common.best.order.clone();
        for &j in &check.order {
            check.in_seq[j as usize] = true;
            check.rej_cost -= inst.jobs[j as usize].rej;
        }
        check.rebuild(&inst);
        assert_eq!(check.total(), r.common.best_cost, "best order re-evaluates");
        // It diversified, i.e. this really is the tabudiv path and not tabu.
        assert!(b.jumps > 0, "tabudiv never diversified");
        // And the tabu search itself improved on the greedy construction — a
        // golden that only pinned the build would pass even if the search loop
        // were inert.
        let after_build = r.common.trace.iter().filter(|&&(e, _)| e > 200).count();
        assert!(after_build >= 9, "search contributed only {after_build} improvements");
    }

    /// Contract rule 7. The JS side adapts the slice toward ~8 ms per round;
    /// that is only safe if the slice cannot be observed by the search.
    #[test]
    fn slice_size_invariance() {
        let a = run(Method::TabuDiv, GOLD_SEED, 60_000, 1_000_000_000, None);
        let b = run(Method::TabuDiv, GOLD_SEED, 60_000, 137, None);
        let c = run(Method::TabuDiv, GOLD_SEED, 60_000, 1, None);
        for x in [&b, &c] {
            assert_eq!(a.common.evals, x.common.evals);
            assert_eq!(a.common.best_cost, x.common.best_cost);
            assert_eq!(a.common.trace, x.common.trace);
            assert_eq!(a.common.best.order, x.common.best.order);
            assert_eq!(body(&a).iter, body(x).iter);
            assert_eq!(body(&a).jumps, body(x).jumps);
        }
    }

    /// Contract rule 3. Pruning may move wall-clock and nothing else.
    #[test]
    fn pruning_changes_nothing_observable() {
        let on = run(Method::TabuDiv, 7, 40_000, 512, Some(true));
        let off = run(Method::TabuDiv, 7, 40_000, 512, Some(false));
        assert_eq!(on.common.evals, off.common.evals);
        assert_eq!(on.common.best_cost, off.common.best_cost);
        assert_eq!(on.common.trace, off.common.trace);
        assert_eq!(on.common.best.order, off.common.best.order);
        assert_eq!(body(&on).iter, body(&off).iter);
    }

    /// The bug fixed in 7eff5f8, pinned from the Rust side: "descent" and
    /// "tabudiv" are both seven characters, so a length-derived seed made them
    /// the same run. Also pins the six FNV-1a constants against the JS
    /// `hashId()`, which is the shared spec for the seed derivation.
    #[test]
    fn method_seeds_are_name_derived_and_distinct() {
        use crate::rng::fnv1a32;
        let expect = [
            ("greedy", 2201204921u32),
            ("descent", 1339691317),
            ("tabu", 102613947),
            ("tabudiv", 803104750),
            ("ama", 740798902),
            ("ig", 976777113),
        ];
        for (id, h) in expect {
            assert_eq!(fnv1a32(id), h, "FNV-1a 32 of {id}");
        }
        assert_ne!(fnv1a32("descent"), fnv1a32("tabudiv"));
        assert_ne!(fnv1a32("tabu"), fnv1a32("tabudiv"));
    }

    /// TabuDiv is not Tabu: same neighbourhood, different stream and a periodic
    /// kick. If these ever coincide, the race is showing one method twice.
    #[test]
    fn tabudiv_differs_from_tabu() {
        let d = run(Method::TabuDiv, GOLD_SEED, 60_000, 4096, None);
        let t = run(Method::Tabu, GOLD_SEED, 60_000, 4096, None);
        assert_eq!(body(&t).jumps, 0, "plain tabu must never diversify");
        assert!(body(&d).jumps > 0);
        assert_ne!(d.common.trace, t.common.trace);
    }

    /// The budget is a hard ceiling in the sense that matters: a racer stops,
    /// and it overshoots by at most one indivisible group (contract rule 6).
    #[test]
    fn budget_overshoot_is_bounded_by_one_scan() {
        let r = run(Method::TabuDiv, 3, 20_000, 4096, None);
        assert!(r.common.evals >= 20_000);
        // one exhaustive scan over 12 jobs is at most n*(n+1) + n + n*n + n*n
        assert!(r.common.evals < 20_000 + 4 * 12 * 13, "overshoot {}", r.common.evals);
    }

    // --- golden values, produced by `cargo test -- --nocapture print_golden` ---
    const GOLD_SEED: u32 = 3;
    const GOLD_EVALS: u64 = 60_014;
    const GOLD_BEST: i64 = 486; // deci-units -> 48.6 in data units
    const GOLD_ITER: u32 = 449;
    const GOLD_JUMPS: u32 = 9;
    /// The first ten points are the greedy construction (one per improving
    /// insertion); everything from (213, 568) on is the tabu search itself, so
    /// this pins the search and not just the build.
    fn gold_trace() -> Vec<(u64, i64)> {
        vec![
            (1, 1133),
            (3, 1075),
            (6, 971),
            (10, 900),
            (20, 856),
            (26, 812),
            (33, 799),
            (41, 785),
            (50, 750),
            (60, 690),
            (213, 568),
            (355, 540),
            (497, 535),
            (639, 506),
            (777, 503),
            (915, 501),
            (1057, 498),
            (5067, 489),
            (5205, 486),
        ]
    }

    #[test]
    #[ignore]
    fn probe_search_progress() {
        for seed in [1234u32, 7, 3, 42, 99, 2026] {
            let r = run(Method::TabuDiv, seed, 60_000, 4096, None);
            let b = body(&r);
            let build_end = r.common.trace.iter().take_while(|&&(e, _)| e < 400).count();
            println!(
                "seed={seed} best={} iter={} jumps={} trace_pts={} after_build={}",
                r.common.best_cost,
                b.iter,
                b.jumps,
                r.common.trace.len(),
                r.common.trace.len() - build_end
            );
        }
    }

    #[test]
    #[ignore]
    fn print_golden() {
        let r = run(Method::TabuDiv, GOLD_SEED, 60_000, 4096, None);
        let b = body(&r);
        println!("evals={} best={} iter={} jumps={}", r.common.evals, r.common.best_cost, b.iter, b.jumps);
        println!("trace={:?}", r.common.trace);
    }
}
