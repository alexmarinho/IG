//! The one neighbourhood, and the one construction pass.
//!
//! Four move families, matching `bestNeighbor` in `studio/src/race/strategies.js`
//! one-for-one ("add" / "rem" / "mov" / "swp"), plus the shuffled greedy
//! construction that used to be `solver::construct`. Everything a method does
//! to a solution goes through this file, so "one shared objective" extends to
//! "one shared way of touching a solution": only the search loops differ.

use crate::eval::{job_cost, State};
use crate::instance::Instance;
use crate::rng::Rng;

/// The shared neighbourhood. Positions are indices into `State::order`; a
/// `Reposition` target follows the JS convention (`splice` out, then `splice`
/// in), i.e. `to` indexes the sequence *after* the job has been removed.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Move {
    /// JS "add" — rejected job into position
    Insert { job: u32, pos: u32 },
    /// JS "rem"
    Remove { pos: u32 },
    /// JS "mov"
    Reposition { from: u32, to: u32 },
    /// JS "swp" — scheduled job at `pos` <-> rejected `job`
    Swap { pos: u32, job: u32 },
}

impl State {
    /// Price one candidate. Returns `None` when the candidate is infeasible
    /// (some job would finish after its hard deadline), and otherwise the total
    /// cost — exact whenever it is below `cutoff`, and a valid lower bound at
    /// or above it (see `try_insert_within`). Pass `i64::MAX` for no pruning.
    ///
    /// This is the *only* pricing route; there is no full-rebuild path for a
    /// method to fall back on. Incrementality is therefore never a budget
    /// discount, only a wall-clock one.
    #[inline]
    pub fn price(&self, inst: &Instance, mv: Move, cutoff: i64) -> Option<i64> {
        match mv {
            Move::Insert { job, pos } => self.try_insert_within(inst, job, pos as usize, cutoff),
            Move::Remove { pos } => self.try_remove_within(inst, pos as usize, cutoff),
            Move::Reposition { from, to } => {
                self.try_reposition_within(inst, from as usize, to as usize, cutoff)
            }
            Move::Swap { pos, job } => self.try_replace_within(inst, job, pos as usize, cutoff),
        }
    }

    /// Commit a move. O(n) rebuild, prices nothing — commits are free (every
    /// commit is preceded by at least one priced candidate).
    pub fn apply(&mut self, inst: &Instance, mv: Move) {
        match mv {
            Move::Insert { job, pos } => self.insert(inst, job, pos as usize),
            Move::Remove { pos } => {
                let jid = self.order.remove(pos as usize);
                self.in_seq[jid as usize] = false;
                self.rej_cost += inst.jobs[jid as usize].rej;
                self.rebuild(inst);
            }
            Move::Reposition { from, to } => {
                let jid = self.order.remove(from as usize);
                self.order.insert(to as usize, jid);
                self.rebuild(inst);
            }
            Move::Swap { pos, job } => self.replace(inst, job, pos as usize),
        }
    }

    /// The job a move touches — the tabu key. Matches the JS `consider(..., job)`
    /// argument for each family: the entering job for "add"/"swp", the moved or
    /// removed job otherwise.
    pub fn touched_job(&self, mv: Move) -> u32 {
        match mv {
            Move::Insert { job, .. } => job,
            Move::Remove { pos } => self.order[pos as usize],
            Move::Reposition { from, .. } => self.order[from as usize],
            Move::Swap { job, .. } => job,
        }
    }

    /// Cost of removing the job at `pos`, or None if infeasible.
    ///
    /// Same shape and same cutoff contract as `try_insert_within`. Removal can
    /// only pull finishes earlier *except* through the changed setup family at
    /// the seam, so the `f > end_max` check stays inside the loop rather than
    /// being skipped as "can only improve".
    pub fn try_remove_within(&self, inst: &Instance, pos: usize, cutoff: i64) -> Option<i64> {
        let out = &inst.jobs[self.order[pos] as usize];
        let (mut t, mut state) = self.state_before(inst, pos);
        let prefix = if pos == 0 { 0 } else { self.cum[pos - 1] };
        let base = prefix + self.rej_cost + out.rej;
        let budget = cutoff - base; // bail once new_cost >= budget
        let mut new_cost = 0i64;
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
            // absorbed: same finish and same predecessor family from here on.
            // Guarded past the seam job (i > pos + 1), the same discipline as
            // the `i > pos` / `i > pos + 1` guards in the existing pricers.
            if i > pos + 1 && f == self.fin[i] {
                return Some(base + new_cost + (self.perf_cost - self.cum[i]));
            }
        }
        Some(base + new_cost)
    }

    /// Cost of moving the job at `from` to index `to` of the sequence *after*
    /// the removal (the JS `splice`-out-then-in convention), or None if
    /// infeasible. Two-point edit: the walk starts at `min(from, to)`.
    pub fn try_reposition_within(
        &self,
        inst: &Instance,
        from: usize,
        to: usize,
        cutoff: i64,
    ) -> Option<i64> {
        let n = self.order.len();
        if from == to {
            return Some(self.total()); // identity; the JS scan skips it
        }
        let lo = from.min(to);
        let hi = from.max(to);
        let moved = self.order[from];
        let (mut t, mut state) = self.state_before(inst, lo);
        let prefix = if lo == 0 { 0 } else { self.cum[lo - 1] };
        let base = prefix + self.rej_cost; // the rejected set is untouched
        let budget = cutoff - base;
        let mut new_cost = 0i64;
        for i in lo..n {
            // job at new position `i`
            let jid = if i == to {
                moved
            } else if from < to && i < to {
                self.order[i + 1]
            } else if to < from && i <= from {
                self.order[i - 1]
            } else {
                self.order[i]
            };
            let k = &inst.jobs[jid as usize];
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
            // The absorption early-exit compares against the *old* position i,
            // so it is only meaningful once the suffix has realigned — past
            // max(from, to) the job at new position i is again `order[i]`.
            if i > hi && f == self.fin[i] {
                return Some(base + new_cost + (self.perf_cost - self.cum[i]));
            }
        }
        Some(base + new_cost)
    }
}

/// The shared greedy construction over a shuffled pending list.
///
/// This was `solver::construct`; it is now the single construction pass in the
/// engine, so IG's construction, Greedy's whole life, Descent/Tabu's build
/// phase and AMA's seeding + repair are literally the same code. `evals` is
/// charged exactly as the exhaustive scan would be (see `best_insertion`).
///
/// `on_insert` receives `(cost, evals-so-far, state)` after every committed
/// insertion. The eval count is what a trace point has to be stamped with —
/// a caller that only had the cost would have to guess where in the budget the
/// improvement landed — and the state is what a `note` has to clone. The four
/// ports wrote this callback with the same three arguments in two orders; this
/// is the one they are all adapted onto.
pub fn greedy_pass(
    inst: &Instance,
    s: &mut State,
    rng: &mut Rng,
    evals: &mut u64,
    prune: bool,
    mut on_insert: impl FnMut(i64, u64, &State),
) {
    let mut pend: Vec<u32> = s.rejected();
    rng.shuffle(&mut pend);
    for jid in pend {
        if let Some((p, c)) = s.best_insertion(inst, jid, evals, prune) {
            s.insert(inst, jid, p);
            on_insert(c, *evals, &*s);
        }
    }
}

/// The swap phase (scheduled <-> rejected) of the IG recipe. Was `solver::permute`.
pub fn permute_pass(inst: &Instance, s: &mut State, rng: &mut Rng, evals: &mut u64, prune: bool) {
    let mut pend: Vec<u32> = s.rejected();
    rng.shuffle(&mut pend);
    for jid in pend {
        let cur = s.total();
        let mut best: Option<(usize, i64)> = None;
        let mut cutoff = cur;
        for p in 0..s.order.len() {
            *evals += 1;
            let c = if prune {
                s.try_replace_within(inst, jid, p, cutoff)
            } else {
                s.try_replace(inst, jid, p)
            };
            if let Some(c) = c {
                if c < cur && best.map_or(true, |(_, bc)| c < bc) {
                    best = Some((p, c));
                    cutoff = c;
                }
            }
        }
        if let Some((p, _)) = best {
            s.replace(inst, jid, p);
        }
    }
}

/// Cutoff pruning is exact only when every objective term is non-negative
/// (the partial cost is then a lower bound on the candidate's total).
pub fn prune_is_exact(inst: &Instance) -> bool {
    inst.setup_c.iter().all(|&c| c >= 0)
        && inst.jobs.iter().all(|j| j.mode_cost >= 0 && j.w >= 0 && j.rej >= 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eval::tests::{brute, tiny};

    /// Brute-force cross-check of the two new pricers, in the same shape as
    /// `incremental_matches_bruteforce`: the predicted cost must equal a full
    /// re-evaluation of the resulting order, for every position pair, over a
    /// random walk of states.
    #[test]
    fn new_pricers_match_bruteforce() {
        let inst = tiny();
        let mut rng = Rng::new(9);
        let mut s = State::all_rejected(&inst);
        s.rebuild(&inst);
        for _ in 0..2000 {
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
            let n = s.order.len();
            for pos in 0..n {
                let mut o2 = s.order.clone();
                o2.remove(pos);
                let expect = brute(&inst, &o2);
                assert_eq!(
                    s.try_remove_within(&inst, pos, i64::MAX),
                    Some(expect),
                    "remove mismatch at {pos} of {:?}",
                    s.order
                );
                assert_eq!(s.price(&inst, Move::Remove { pos: pos as u32 }, i64::MAX), Some(expect));
            }
            for from in 0..n {
                for to in 0..n {
                    let mut o2 = s.order.clone();
                    let j = o2.remove(from);
                    o2.insert(to, j);
                    let expect = brute(&inst, &o2);
                    assert_eq!(
                        s.try_reposition_within(&inst, from, to, i64::MAX),
                        Some(expect),
                        "reposition {from}->{to} of {:?}",
                        s.order
                    );
                }
            }
        }
    }

    /// The `_within` contract for the two new pricers: a candidate whose true
    /// cost is `< cutoff` is priced exactly; anything else is `None` or a value
    /// `>= cutoff` that never exceeds the true cost. Same guard as
    /// `within_cutoff_is_exact_and_safe`.
    #[test]
    fn new_pricers_within_cutoff_is_exact_and_safe() {
        let inst = tiny();
        let mut rng = Rng::new(31);
        let mut s = State::all_rejected(&inst);
        s.rebuild(&inst);
        let check = |exact: Option<i64>, within: Option<i64>, cutoff: i64| match exact {
            Some(e) if e < cutoff => assert_eq!(within, Some(e), "a winner must be priced exactly"),
            _ => {
                if let Some(w) = within {
                    assert!(w >= cutoff, "loser reported below cutoff: {w} < {cutoff}");
                    if let Some(e) = exact {
                        assert!(w <= e, "lower bound exceeded true cost: {w} > {e}");
                    }
                }
            }
        };
        for _ in 0..2000 {
            if s.order.len() < inst.n() && rng.below(2) == 0 {
                let rej = s.rejected();
                let jid = rej[rng.below(rej.len())];
                let pos = rng.below(s.order.len() + 1);
                if s.try_insert(&inst, jid, pos).is_some() {
                    s.insert(&inst, jid, pos);
                }
            } else if !s.order.is_empty() {
                s.remove_random(&inst, 1, &mut rng);
            }
            let total = s.total();
            let cutoffs = [0, total / 2, total, total + 1, i64::MAX];
            for pos in 0..s.order.len() {
                let exact = s.try_remove_within(&inst, pos, i64::MAX);
                for &c in &cutoffs {
                    check(exact, s.try_remove_within(&inst, pos, c), c);
                }
                for to in 0..s.order.len() {
                    let exact = s.try_reposition_within(&inst, pos, to, i64::MAX);
                    for &c in &cutoffs {
                        check(exact, s.try_reposition_within(&inst, pos, to, c), c);
                    }
                }
            }
        }
    }

    /// `apply` must land on exactly the state the pricer predicted.
    #[test]
    fn apply_lands_where_price_said() {
        let inst = tiny();
        let mut rng = Rng::new(77);
        let mut s = State::all_rejected(&inst);
        s.rebuild(&inst);
        for _ in 0..400 {
            let rej = s.rejected();
            let mv = match rng.below(4) {
                0 if !rej.is_empty() => Move::Insert {
                    job: rej[rng.below(rej.len())],
                    pos: rng.below(s.order.len() + 1) as u32,
                },
                1 if !s.order.is_empty() => Move::Remove { pos: rng.below(s.order.len()) as u32 },
                2 if s.order.len() > 1 => Move::Reposition {
                    from: rng.below(s.order.len()) as u32,
                    to: rng.below(s.order.len()) as u32,
                },
                _ if !s.order.is_empty() && !rej.is_empty() => Move::Swap {
                    pos: rng.below(s.order.len()) as u32,
                    job: rej[rng.below(rej.len())],
                },
                _ => continue,
            };
            if let Some(c) = s.price(&inst, mv, i64::MAX) {
                s.apply(&inst, mv);
                assert_eq!(s.total(), c, "apply disagreed with price for {mv:?}");
                assert_eq!(s.total(), brute(&inst, &s.order));
            }
        }
    }
}
