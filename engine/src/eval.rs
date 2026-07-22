//! The one objective. `State` is the shared solution *and* the shared
//! evaluator: the same struct the CLI validates against `benchmark.json`, so a
//! cost printed by any racer is by construction on the published scale.
//!
//! Objective (as in the thesis / Thevenin et al. 2015): for performed jobs,
//! setup cost + mode cost + weighted tardiness, scheduled ASAP; for rejected
//! jobs, the rejection cost. Money values are in deci-units (x10) because the
//! data has fractional tardiness weights with 0.1 granularity.
//!
//! The evaluator keeps, for the current sequence, per-position finish times and
//! cumulative costs. A candidate insertion/replacement recomputes only from the
//! touched position onward and stops as soon as a downstream job's finish time
//! matches its old value (the shift was absorbed by an idle gap) - the
//! optimization suggested as future work in the 2015 thesis.
//!
//! Moved verbatim out of `solver.rs` (lines 41-291 and its two test modules) so
//! that it stops being the Iterated Greedy's private property: every method in
//! the race prices through this file and no other.

use crate::instance::Instance;
use crate::rng::Rng;

// `job_cost`, `fin`, `cum` and `state_before` widen from private to
// `pub(crate)` here: the two new incremental pricers live in `ops.rs` (a
// sibling module), and they must reuse *these* cached arrays rather than grow a
// second copy of the objective. Still crate-private, so nothing outside the
// engine can touch them.
#[inline(always)]
pub(crate) fn job_cost(inst: &Instance, state: usize, fam: usize, mode_cost: i64, f: i64, due: i64, w: i64) -> i64 {
    inst.setup_c(state, fam) + mode_cost + (f - due).max(0) * w
}

/// Evaluated state of one solution: sequence + rejected set + cached times/costs.
pub struct State {
    pub order: Vec<u32>,
    pub in_seq: Vec<bool>,
    pub(crate) fin: Vec<i64>,   // finish time per position
    pub(crate) cum: Vec<i64>,   // cumulative performed cost up to position (inclusive)
    pub perf_cost: i64,
    pub rej_cost: i64,
}

// Manual Clone so `clone_from` reuses the destination's Vec capacity instead of
// allocating fresh ones every accepted move / every Accept::Best iteration. The
// derived `clone_from` falls back to `*self = other.clone()`, which reuses
// nothing; overriding it per field is where the allocation win actually comes
// from. Contents are identical to a plain clone.
impl Clone for State {
    fn clone(&self) -> Self {
        State {
            order: self.order.clone(),
            in_seq: self.in_seq.clone(),
            fin: self.fin.clone(),
            cum: self.cum.clone(),
            perf_cost: self.perf_cost,
            rej_cost: self.rej_cost,
        }
    }

    fn clone_from(&mut self, other: &Self) {
        self.order.clone_from(&other.order);
        self.in_seq.clone_from(&other.in_seq);
        self.fin.clone_from(&other.fin);
        self.cum.clone_from(&other.cum);
        self.perf_cost = other.perf_cost;
        self.rej_cost = other.rej_cost;
    }
}

impl State {
    pub fn all_rejected(inst: &Instance) -> State {
        let rej_cost = inst.jobs.iter().map(|j| j.rej).sum();
        State {
            order: Vec::new(),
            in_seq: vec![false; inst.n()],
            fin: Vec::new(),
            cum: Vec::new(),
            perf_cost: 0,
            rej_cost,
        }
    }

    #[inline(always)]
    pub fn total(&self) -> i64 {
        self.perf_cost + self.rej_cost
    }

    pub fn rejected(&self) -> Vec<u32> {
        (0..self.in_seq.len())
            .filter(|&j| !self.in_seq[j])
            .map(|j| j as u32)
            .collect()
    }

    /// `rejected()` into a caller-owned buffer, so a racer that needs indexed
    /// access to the rejected set can refresh it after every committed move
    /// without allocating. Same ascending-job-id order as `rejected()`, and
    /// that is load-bearing: `ops::greedy_pass` Fisher-Yates shuffles this
    /// vector, so changing its initial order changes the IG's results and
    /// would break the published benchmark.
    pub fn rejected_into(&self, out: &mut Vec<u32>) {
        out.clear();
        for j in 0..self.in_seq.len() {
            if !self.in_seq[j] {
                out.push(j as u32);
            }
        }
    }

    /// Full O(n) rebuild of the cached arrays from `self.order`.
    pub fn rebuild(&mut self, inst: &Instance) {
        self.fin.clear();
        self.cum.clear();
        let mut t = 0i64;
        let mut state = inst.init_state;
        let mut cum = 0i64;
        for &jid in &self.order {
            let j = &inst.jobs[jid as usize];
            let st = inst.setup_t(state, j.fam);
            let ss = t.max(j.rel - st);
            let f = ss + st + j.p;
            cum += job_cost(inst, state, j.fam, j.mode_cost, f, j.due, j.w);
            self.fin.push(f);
            self.cum.push(cum);
            t = f;
            state = j.fam;
        }
        self.perf_cost = cum;
    }

    #[inline(always)]
    pub(crate) fn state_before(&self, inst: &Instance, pos: usize) -> (i64, usize) {
        if pos == 0 {
            (0, inst.init_state)
        } else {
            (self.fin[pos - 1], inst.jobs[self.order[pos - 1] as usize].fam)
        }
    }

    /// Cost of inserting job `jid` at position `pos`, or None if infeasible.
    /// Incremental: O(k) where k = downstream jobs until the shift is absorbed.
    pub fn try_insert(&self, inst: &Instance, jid: u32, pos: usize) -> Option<i64> {
        self.try_insert_within(inst, jid, pos, i64::MAX)
    }

    /// Like `try_insert`, but abandons the candidate as soon as the partial cost
    /// accumulated over the jobs walked so far reaches `cutoff`. Every objective
    /// term is non-negative, so that partial cost only grows and is a valid lower
    /// bound on the final candidate cost — a candidate that already reaches the
    /// incumbent can never be selected (selection is strict `<`). With
    /// `cutoff == i64::MAX` this is byte-for-byte `try_insert`; a candidate that
    /// can still win never trips the bound, so its returned cost is exact.
    pub fn try_insert_within(&self, inst: &Instance, jid: u32, pos: usize, cutoff: i64) -> Option<i64> {
        let j = &inst.jobs[jid as usize];
        let (mut t, mut state) = self.state_before(inst, pos);
        let st = inst.setup_t(state, j.fam);
        let ss = t.max(j.rel - st);
        let f = ss + st + j.p;
        if f > j.end_max {
            return None;
        }
        let mut new_cost = job_cost(inst, state, j.fam, j.mode_cost, f, j.due, j.w);
        t = f;
        state = j.fam;
        let prefix = if pos == 0 { 0 } else { self.cum[pos - 1] };
        let base = prefix + self.rej_cost - j.rej;
        let budget = cutoff - base; // bail once new_cost >= budget
        for i in pos..self.order.len() {
            let k = &inst.jobs[self.order[i] as usize];
            let st = inst.setup_t(state, k.fam);
            let ss = t.max(k.rel - st);
            let f = ss + st + k.p;
            if f > k.end_max {
                return None;
            }
            new_cost += job_cost(inst, state, k.fam, k.mode_cost, f, k.due, k.w);
            if new_cost >= budget {
                // base + new_cost >= cutoff: candidate can no longer win
                return Some(base + new_cost);
            }
            t = f;
            state = k.fam;
            // absorbed: same finish and same setup pairs from here on
            if i > pos && f == self.fin[i] {
                return Some(base + new_cost + (self.perf_cost - self.cum[i]));
            }
        }
        Some(base + new_cost)
    }

    /// Cost of replacing the job at `pos` by rejected job `jid` (swap Π×Ω), or None.
    pub fn try_replace(&self, inst: &Instance, jid: u32, pos: usize) -> Option<i64> {
        self.try_replace_within(inst, jid, pos, i64::MAX)
    }

    /// Like `try_replace`, with the same exact partial-cost cutoff as
    /// `try_insert_within` (see it). `cutoff == i64::MAX` reproduces `try_replace`.
    pub fn try_replace_within(&self, inst: &Instance, jid: u32, pos: usize, cutoff: i64) -> Option<i64> {
        let out = &inst.jobs[self.order[pos] as usize];
        let j = &inst.jobs[jid as usize];
        let (mut t, mut state) = self.state_before(inst, pos);
        let st = inst.setup_t(state, j.fam);
        let ss = t.max(j.rel - st);
        let f = ss + st + j.p;
        if f > j.end_max {
            return None;
        }
        let mut new_cost = job_cost(inst, state, j.fam, j.mode_cost, f, j.due, j.w);
        t = f;
        state = j.fam;
        let prefix = if pos == 0 { 0 } else { self.cum[pos - 1] };
        let base = prefix + self.rej_cost - j.rej + out.rej;
        let budget = cutoff - base; // bail once new_cost >= budget
        for i in (pos + 1)..self.order.len() {
            let k = &inst.jobs[self.order[i] as usize];
            let st = inst.setup_t(state, k.fam);
            let ss = t.max(k.rel - st);
            let f = ss + st + k.p;
            if f > k.end_max {
                return None;
            }
            new_cost += job_cost(inst, state, k.fam, k.mode_cost, f, k.due, k.w);
            if new_cost >= budget {
                return Some(base + new_cost);
            }
            t = f;
            state = k.fam;
            if i > pos + 1 && f == self.fin[i] {
                return Some(base + new_cost + (self.perf_cost - self.cum[i]));
            }
        }
        Some(base + new_cost)
    }

    pub fn insert(&mut self, inst: &Instance, jid: u32, pos: usize) {
        self.order.insert(pos, jid);
        self.in_seq[jid as usize] = true;
        self.rej_cost -= inst.jobs[jid as usize].rej;
        self.rebuild(inst);
    }

    pub fn replace(&mut self, inst: &Instance, jid: u32, pos: usize) {
        let out = self.order[pos];
        self.in_seq[out as usize] = false;
        self.rej_cost += inst.jobs[out as usize].rej;
        self.order[pos] = jid;
        self.in_seq[jid as usize] = true;
        self.rej_cost -= inst.jobs[jid as usize].rej;
        self.rebuild(inst);
    }

    pub fn remove_random(&mut self, inst: &Instance, d: usize, rng: &mut Rng) {
        let d = d.min(self.order.len());
        for _ in 0..d {
            let i = rng.below(self.order.len());
            let jid = self.order.remove(i);
            self.in_seq[jid as usize] = false;
            self.rej_cost += inst.jobs[jid as usize].rej;
        }
        self.rebuild(inst);
    }

    /// Best feasible insertion position for `jid` (must improve on staying rejected).
    /// With `prune`, tightens a running cutoff and skips positions that provably
    /// cannot win — an outer break on the monotone prefix cost plus the inner
    /// partial-cost bound in `try_insert_within`. Skipped positions are credited
    /// to `evals` so the count matches the exhaustive scan exactly.
    pub fn best_insertion(&self, inst: &Instance, jid: u32, evals: &mut u64, prune: bool) -> Option<(usize, i64)> {
        let cur = self.total();
        let mut best: Option<(usize, i64)> = None;
        let mut cutoff = cur;
        let n = self.order.len();
        for p in 0..=n {
            if prune && p > 0 && self.cum[p - 1] >= cutoff {
                *evals += (n + 1 - p) as u64; // no later position can beat cutoff
                break;
            }
            *evals += 1;
            let c = if prune {
                self.try_insert_within(inst, jid, p, cutoff)
            } else {
                self.try_insert(inst, jid, p)
            };
            if let Some(c) = c {
                if c < cur && best.map_or(true, |(_, bc)| c < bc) {
                    best = Some((p, c));
                    cutoff = c;
                }
            }
        }
        best
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::instance::{Instance, Job};

    /// Shared by the `ops.rs` pricer tests: three jobs, non-zero setup times and
    /// costs, so the seam effects the incremental pricers have to get right are
    /// actually exercised.
    pub(crate) fn tiny() -> Instance {
        let n_states = 3;
        let mut setup_t = vec![0i64; 9];
        let mut setup_c = vec![0i64; 9];
        for (f, t, st, sc) in [
            (0usize, 1usize, 5i64, 7i64),
            (1, 0, 4, 6),
            (2, 0, 2, 3),
            (2, 1, 3, 4),
        ] {
            setup_t[f * n_states + t] = st;
            setup_c[f * n_states + t] = sc;
        }
        let job = |id, fam, p, rel, due, w, rej| Job {
            id,
            fam,
            p,
            rel,
            due,
            w,
            e: 0,
            mode_cost: 10,
            rej,
            end_max: 1000,
        };
        Instance {
            name: "tiny".into(),
            jobs: vec![
                job(0, 0, 10, 0, 15, 2, 50),
                job(1, 1, 8, 5, 30, 3, 60),
                job(2, 0, 6, 0, 12, 1, 40),
            ],
            n_states,
            init_state: 2,
            setup_t,
            setup_c,
        }
    }

    /// brute-force evaluation for cross-checking
    pub(crate) fn brute(inst: &Instance, order: &[u32]) -> i64 {
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
            cost += inst.setup_c(state, j.fam) + j.mode_cost + (f - j.due).max(0) * j.w;
            t = f;
            state = j.fam;
        }
        for (jid, &pres) in in_seq.iter().enumerate() {
            if !pres {
                cost += inst.jobs[jid].rej;
            }
        }
        cost
    }

    #[test]
    fn incremental_matches_bruteforce() {
        let inst = tiny();
        let mut rng = Rng::new(42);
        let mut s = State::all_rejected(&inst);
        s.rebuild(&inst);
        for _ in 0..500 {
            let choice = rng.below(3);
            if choice == 0 && s.order.len() < inst.n() {
                let rej = s.rejected();
                let jid = rej[rng.below(rej.len())];
                let pos = rng.below(s.order.len() + 1);
                if let Some(pred) = s.try_insert(&inst, jid, pos) {
                    let mut o2 = s.order.clone();
                    o2.insert(pos, jid);
                    assert_eq!(pred, brute(&inst, &o2), "insert mismatch");
                    s.insert(&inst, jid, pos);
                    assert_eq!(s.total(), pred);
                }
            } else if choice == 1 && !s.order.is_empty() && s.order.len() < inst.n() {
                let rej = s.rejected();
                let jid = rej[rng.below(rej.len())];
                let pos = rng.below(s.order.len());
                if let Some(pred) = s.try_replace(&inst, jid, pos) {
                    let mut o2 = s.order.clone();
                    o2[pos] = jid;
                    assert_eq!(pred, brute(&inst, &o2), "replace mismatch");
                    s.replace(&inst, jid, pos);
                    assert_eq!(s.total(), pred);
                }
            } else if !s.order.is_empty() {
                s.remove_random(&inst, 1, &mut rng);
                assert_eq!(s.total(), brute(&inst, &s.order));
            }
        }
    }

    /// The `_within` cutoff variants must be exact-and-safe: with `i64::MAX` they
    /// reproduce the unpruned methods byte-for-byte, and for *any* cutoff a
    /// candidate whose true cost is `< cutoff` is returned exactly, while every
    /// other outcome (a loser, or an infeasible candidate) is reported as `None`
    /// or a value `>= cutoff` — never as a spuriously-cheap winner. This is the
    /// regression guard for the cutoff-pruning search path.
    fn check_within(exact: Option<i64>, within: Option<i64>, cutoff: i64) {
        match exact {
            Some(e) if e < cutoff => {
                assert_eq!(within, Some(e), "a winner must be priced exactly")
            }
            _ => {
                if let Some(w) = within {
                    assert!(w >= cutoff, "loser reported below cutoff: {w} < {cutoff}");
                    if let Some(e) = exact {
                        assert!(w <= e, "lower bound exceeded true cost: {w} > {e}");
                    }
                }
            }
        }
    }

    #[test]
    fn within_cutoff_is_exact_and_safe() {
        let inst = tiny(); // has non-zero setup times and costs
        let mut rng = Rng::new(123);
        let mut s = State::all_rejected(&inst);
        s.rebuild(&inst);
        for _ in 0..4000 {
            match rng.below(3) {
                0 if s.order.len() < inst.n() => {
                    let rej = s.rejected();
                    let jid = rej[rng.below(rej.len())];
                    let pos = rng.below(s.order.len() + 1);
                    if s.try_insert(&inst, jid, pos).is_some() {
                        s.insert(&inst, jid, pos);
                    }
                }
                1 if !s.order.is_empty() && s.order.len() < inst.n() => {
                    let rej = s.rejected();
                    let jid = rej[rng.below(rej.len())];
                    let pos = rng.below(s.order.len());
                    if s.try_replace(&inst, jid, pos).is_some() {
                        s.replace(&inst, jid, pos);
                    }
                }
                _ if !s.order.is_empty() => s.remove_random(&inst, 1, &mut rng),
                _ => {}
            }
            let total = s.total();
            let cutoffs = [0, total / 2, total, total + 1, i64::MAX];
            for jid in s.rejected() {
                for pos in 0..=s.order.len() {
                    let exact = s.try_insert(&inst, jid, pos);
                    assert_eq!(exact, s.try_insert_within(&inst, jid, pos, i64::MAX));
                    for &c in &cutoffs {
                        check_within(exact, s.try_insert_within(&inst, jid, pos, c), c);
                    }
                }
                for pos in 0..s.order.len() {
                    let exact = s.try_replace(&inst, jid, pos);
                    assert_eq!(exact, s.try_replace_within(&inst, jid, pos, i64::MAX));
                    for &c in &cutoffs {
                        check_within(exact, s.try_replace_within(&inst, jid, pos, c), c);
                    }
                }
            }
        }
    }
}
