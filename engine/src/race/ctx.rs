//! `Ctx` — the only thing in the engine that may spend budget.
//!
//! Every unit of the evaluation budget, for every method, is spent through a
//! method on this struct. Nothing in `race/` outside this file touches the
//! counter, which is meant to be checkable rather than merely stated:
//! `accounting_is_confined_to_this_file` below enforces it over the whole
//! `race/` directory, and it is the gate the architecture writes as
//! `rg 'evals\s*(\+=|=)' engine/src/race` returning nothing.

use crate::eval::State;
use crate::instance::Instance;
use crate::ops::Move;
use crate::race::Common;
use crate::rng::Rng;

/// A slice of budget, opened around one `advance` call.
///
/// Every unit of budget in the whole race is spent through a method on this
/// struct — there is no `evals += 1` anywhere in `race/`, and that is meant to
/// be grep-able (`rg 'evals\s*(\+=|=)' engine/src/race` returns nothing).
pub struct Ctx<'a> {
    pub inst: &'a Instance,
    pub common: &'a mut Common,
    credit: i64,
    start: u64,
}

impl<'a> Ctx<'a> {
    pub fn open(inst: &'a Instance, common: &'a mut Common, slice: i64) -> Ctx<'a> {
        let credit = common.credit.saturating_add(slice);
        let start = common.evals;
        Ctx { inst, common, credit, start }
    }

    /// Evaluations actually spent this slice (may exceed the slice: a method
    /// only checks credit at phase boundaries, so overshoot is bounded by one
    /// indivisible group — for Greedy, one insertion scan).
    pub fn close(self) -> u64 {
        self.common.credit = self.credit;
        self.common.evals - self.start
    }

    #[inline]
    fn charge(&mut self, k: u64) {
        self.common.evals += k;
        self.credit -= k as i64;
    }

    /// One candidate priced = one unit, whether the pricer walked one job or n.
    ///
    /// The cutoff is *gated on `prune`*: with pruning off the pricer is handed
    /// `i64::MAX` and returns an exact cost for every candidate. That gate is
    /// what makes `charge_skipped`'s promise true in both directions — a run
    /// with pruning disabled must produce the identical trace, the identical
    /// eval count and the identical solution, and it is the only safe reading
    /// on an instance with a negative cost term, where a partial cost is no
    /// longer a lower bound. (Three of the five ports had this gate; the one
    /// the canonical `Ctx` came from did not, because its method never called
    /// `price`. The gate is the substrate's own stated invariant, so it stays.)
    #[inline]
    pub fn price(&mut self, s: &State, mv: Move, cutoff: i64) -> Option<i64> {
        self.charge(1);
        let cutoff = if self.common.prune { cutoff } else { i64::MAX };
        s.price(self.inst, mv, cutoff)
    }

    /// A new incumbent that was never priced costs 1 unit — the implied full
    /// evaluation (IG's destruction, TabuDiv's eject, AMA's crossover child).
    #[inline]
    pub fn charge_unpriced(&mut self) {
        self.charge(1);
    }

    /// Pruning is charged as if it had not happened: a scan that provably skips
    /// `k` candidates still pays for them, so prune-on and prune-off produce
    /// identical traces and pruning can only move wall-clock.
    #[inline]
    pub fn charge_skipped(&mut self, k: u64) {
        self.charge(k);
    }

    /// `k` evaluations already counted by a sub-engine that owns its own
    /// counter — today, `solver::Run`, whose `evaluations` field is incremented
    /// inside `State::best_insertion` where no `Ctx` can reach. The IG racer
    /// settles the delta after every iteration, so nothing is estimated: the
    /// unit is the same unit, counted by the same code, in the same place.
    ///
    /// Deliberately not spelled `charge_skipped`: that name is a claim about
    /// pruning and this is not one.
    #[inline]
    pub fn charge_engine(&mut self, k: u64) {
        self.charge(k);
    }

    /// Best feasible insertion of `job`, charging exactly what the exhaustive
    /// scan over all `order.len() + 1` positions costs — `State::best_insertion`
    /// already credits the positions its cutoff skipped, which is the precedent
    /// budget rule 3 generalizes. Same function IG's construction calls.
    #[inline]
    pub fn best_insertion(&mut self, s: &State, job: u32) -> Option<(usize, i64)> {
        let mut units: u64 = 0;
        let out = s.best_insertion(self.inst, job, &mut units, self.common.prune);
        self.charge(units);
        out
    }

    #[inline]
    pub fn has_credit(&self) -> bool {
        self.credit > 0 && !self.common.done && self.common.evals < self.common.budget
    }

    pub fn rng(&mut self) -> &mut Rng {
        &mut self.common.rng
    }

    /// The instance, for methods that hold a `&mut Ctx` and cannot also borrow
    /// the field. Same reference as `ctx.inst`.
    #[inline]
    pub fn inst(&self) -> &'a Instance {
        self.inst
    }

    /// Evaluations spent by this racer so far, ever. Read-only: a method may
    /// look at the ledger, it may not write to it.
    #[inline]
    pub fn spent(&self) -> u64 {
        self.common.evals
    }

    /// Whether exact cutoff pruning is available on this instance.
    #[inline]
    pub fn prune(&self) -> bool {
        self.common.prune
    }

    /// The best cost found so far — Tabu's aspiration threshold.
    #[inline]
    pub fn best_cost(&self) -> i64 {
        self.common.best_cost
    }

    /// The live incumbent's cost — Descent's improvement test.
    #[inline]
    pub fn cur_cost(&self) -> i64 {
        self.common.cur_cost
    }

    #[inline]
    pub fn done(&self) -> bool {
        self.common.done
    }

    /// Record an improvement: the best solution and one trace point, when the
    /// cost strictly beats the incumbent best.
    ///
    /// Deliberately *not* the live cost. Two of the five ports had `note` also
    /// write `cur_cost` and three did not, and the three are right: a method
    /// that notes a candidate before committing it (AMA notes its child, Tabu
    /// notes a move it may not keep) would otherwise leave the page drawing a
    /// cost that is not the incumbent's. Every method says what its live cost
    /// is, explicitly, through `set_cur_cost`.
    pub fn note(&mut self, cost: i64, s: &State) {
        if cost < self.common.best_cost {
            self.common.best_cost = cost;
            self.common.best.clone_from(s);
            self.common.best_changed = true;
            let at = self.common.evals;
            self.common.trace.push((at, cost));
        }
    }

    /// The live incumbent's cost — the height of this racer's marker.
    #[inline]
    pub fn set_cur_cost(&mut self, cost: i64) {
        self.common.cur_cost = cost;
        self.common.cur_changed = true;
    }

    pub fn status(&mut self, key: u32, arg: u32) {
        self.common.status_key = key;
        self.common.status_arg = arg;
    }

    /// `phase_arg` for the snapshot: d_eff (IG) / tenure (Tabu) / population (AMA).
    #[inline]
    pub fn set_phase_arg(&mut self, arg: u32) {
        self.common.phase_arg = arg;
    }

    /// The method has nothing left to do (not the same as running out of budget).
    pub fn finish(&mut self, key: u32) {
        self.common.done = true;
        self.common.status_key = key;
        self.common.status_arg = 0;
    }

    /// `finish`, keeping an argument on the status (Tabu reports the iteration
    /// it got stuck at).
    pub fn finish_with(&mut self, key: u32, arg: u32) {
        self.common.done = true;
        self.common.status_key = key;
        self.common.status_arg = arg;
    }

    // -- the scratch rejected set -------------------------------------------

    /// Refresh the scratch rejected set from `s`. Called unconditionally after
    /// every commit; see `State::rejected_into`.
    pub fn refresh_rejected(&mut self, s: &State) {
        s.rejected_into(&mut self.common.rej);
    }

    #[inline]
    pub fn rej_len(&self) -> usize {
        self.common.rej.len()
    }

    #[inline]
    pub fn rej_at(&self, i: usize) -> u32 {
        self.common.rej[i]
    }

    // -- the shared passes, charged -----------------------------------------

    /// The shared greedy construction, charged through the same counter.
    ///
    /// `note` mirrors the JS callback argument of `greedyPass`: Descent and
    /// Tabu record every accepted insertion, AMA and IG pass none. Indivisible
    /// by design (see the slice rule): on a large instance the first slice of a
    /// method that builds can cost far more than the slice asked for. The racer
    /// reports what it actually spent.
    pub fn greedy_pass(&mut self, s: &mut State, note: bool) {
        let before = self.common.evals;
        let inst = self.inst;
        {
            let Common {
                rng,
                evals,
                prune,
                best,
                best_cost,
                best_changed,
                trace,
                ..
            } = &mut *self.common;
            crate::ops::greedy_pass(inst, s, rng, evals, *prune, |cost, at, st| {
                // `note == false` is the JS `greedyPass(sol, rng, null)`: the
                // pass must not touch the best at all, or AMA's and IG's
                // comparisons would shift under them.
                if note && cost < *best_cost {
                    *best_cost = cost;
                    best.clone_from(st);
                    *best_changed = true;
                    trace.push((at, cost));
                }
            });
        }
        self.credit -= (self.common.evals - before) as i64;
    }

    /// The shared swap phase (scheduled <-> rejected), charged.
    pub fn permute_pass(&mut self, s: &mut State) {
        let before = self.common.evals;
        let inst = self.inst;
        let Common { rng, evals, prune, .. } = &mut *self.common;
        crate::ops::permute_pass(inst, s, rng, evals, *prune);
        self.credit -= (self.common.evals - before) as i64;
    }
}

#[cfg(test)]
mod tests {
    /// The budget-accounting gate: no file in `race/` other than this one may
    /// touch an evaluation counter. Comment lines are exempt (`greedy.rs`
    /// quotes the JavaScript it was ported from, which does its own counting).
    #[test]
    fn accounting_is_confined_to_this_file() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/race");
        let mut offenders = Vec::new();
        let mut stack = vec![dir];
        while let Some(d) = stack.pop() {
            for entry in std::fs::read_dir(&d).expect("read race/") {
                let path = entry.expect("dir entry").path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.extension().map_or(true, |e| e != "rs") {
                    continue;
                }
                if path.file_name().is_some_and(|f| f == "ctx.rs") {
                    continue;
                }
                let text = std::fs::read_to_string(&path).expect("read source");
                for (i, line) in text.lines().enumerate() {
                    let code = line.trim_start();
                    if code.starts_with("//") {
                        continue;
                    }
                    if code.contains("evals +=") || code.contains("evals =") {
                        offenders.push(format!("{}:{}: {}", path.display(), i + 1, code.trim()));
                    }
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "budget accounting must go through Ctx, but found:\n{}",
            offenders.join("\n")
        );
    }
}
