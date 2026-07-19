//! Incremental-evaluation state + the Iterated Greedy metaheuristic.
//!
//! Objective (as in the thesis / Thevenin et al. 2015): for performed jobs,
//! setup cost + mode cost + weighted tardiness, scheduled ASAP; for rejected
//! jobs, the rejection cost. Money values are in deci-units (×10) because the
//! data has fractional tardiness weights with 0.1 granularity.
//!
//! The evaluator keeps, for the current sequence, per-position finish times and
//! cumulative costs. A candidate insertion/replacement recomputes only from the
//! touched position onward and stops as soon as a downstream job's finish time
//! matches its old value (the shift was absorbed by an idle gap) — the
//! optimization suggested as future work in the 2015 thesis.

use crate::instance::Instance;

/// Deterministic small PRNG (SplitMix64).
pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.wrapping_add(0x9E3779B97F4A7C15))
    }
    #[inline(always)]
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
    #[inline(always)]
    pub fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }
    pub fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            v.swap(i, self.below(i + 1));
        }
    }
}

#[inline(always)]
fn job_cost(inst: &Instance, state: usize, fam: usize, mode_cost: i64, f: i64, due: i64, w: i64) -> i64 {
    inst.setup_c(state, fam) + mode_cost + (f - due).max(0) * w
}

/// Evaluated state of one solution: sequence + rejected set + cached times/costs.
#[derive(Clone)]
pub struct State {
    pub order: Vec<u32>,
    pub in_seq: Vec<bool>,
    fin: Vec<i64>,   // finish time per position
    cum: Vec<i64>,   // cumulative performed cost up to position (inclusive)
    pub perf_cost: i64,
    pub rej_cost: i64,
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
    fn state_before(&self, inst: &Instance, pos: usize) -> (i64, usize) {
        if pos == 0 {
            (0, inst.init_state)
        } else {
            (self.fin[pos - 1], inst.jobs[self.order[pos - 1] as usize].fam)
        }
    }

    /// Cost of inserting job `jid` at position `pos`, or None if infeasible.
    /// Incremental: O(k) where k = downstream jobs until the shift is absorbed.
    pub fn try_insert(&self, inst: &Instance, jid: u32, pos: usize) -> Option<i64> {
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
        for i in pos..self.order.len() {
            let k = &inst.jobs[self.order[i] as usize];
            let st = inst.setup_t(state, k.fam);
            let ss = t.max(k.rel - st);
            let f = ss + st + k.p;
            if f > k.end_max {
                return None;
            }
            new_cost += job_cost(inst, state, k.fam, k.mode_cost, f, k.due, k.w);
            t = f;
            state = k.fam;
            // absorbed: same finish and same setup pairs from here on
            if i > pos && f == self.fin[i] {
                let tail = self.perf_cost - self.cum[i];
                return Some(prefix + new_cost + tail + self.rej_cost - j.rej);
            }
        }
        Some(prefix + new_cost + self.rej_cost - j.rej)
    }

    /// Cost of replacing the job at `pos` by rejected job `jid` (swap Π×Ω), or None.
    pub fn try_replace(&self, inst: &Instance, jid: u32, pos: usize) -> Option<i64> {
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
        for i in (pos + 1)..self.order.len() {
            let k = &inst.jobs[self.order[i] as usize];
            let st = inst.setup_t(state, k.fam);
            let ss = t.max(k.rel - st);
            let f = ss + st + k.p;
            if f > k.end_max {
                return None;
            }
            new_cost += job_cost(inst, state, k.fam, k.mode_cost, f, k.due, k.w);
            t = f;
            state = k.fam;
            if i > pos + 1 && f == self.fin[i] {
                let tail = self.perf_cost - self.cum[i];
                return Some(prefix + new_cost + tail + self.rej_cost - j.rej + out.rej);
            }
        }
        Some(prefix + new_cost + self.rej_cost - j.rej + out.rej)
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
    pub fn best_insertion(&self, inst: &Instance, jid: u32, evals: &mut u64) -> Option<(usize, i64)> {
        let cur = self.total();
        let mut best: Option<(usize, i64)> = None;
        for p in 0..=self.order.len() {
            *evals += 1;
            if let Some(c) = self.try_insert(inst, jid, p) {
                if c < cur && best.map_or(true, |(_, bc)| c < bc) {
                    best = Some((p, c));
                }
            }
        }
        best
    }
}

#[derive(Clone, Copy)]
pub enum Accept {
    /// keep iterating from the current solution (thesis default)
    Current,
    /// restart every iteration from the best solution found
    Best,
}

pub struct Params {
    pub d: usize,
    /// adaptive destruction (the thesis' future-work idea): while the best
    /// stagnates, the destruction size ramps from `d` up to `d_max` (one step
    /// every RAMP stagnant iterations), snapping back to `d` on improvement.
    /// `d_max <= d` disables the ramp.
    pub d_max: usize,
    pub accept: Accept,
    pub permute: bool,
    pub seconds: f64,
    /// in data units (scaled ×10 internally)
    pub target: Option<i64>,
    pub seed: u64,
}

pub struct Outcome {
    /// deci-units (divide by 10 for data units)
    pub best_cost: i64,
    pub best_order: Vec<u32>,
    pub iterations: u64,
    pub evaluations: u64,
    pub elapsed: f64,
}

fn construct(inst: &Instance, s: &mut State, rng: &mut Rng, evals: &mut u64) {
    let mut pend: Vec<u32> = s.rejected();
    rng.shuffle(&mut pend);
    for jid in pend {
        if let Some((p, _)) = s.best_insertion(inst, jid, evals) {
            s.insert(inst, jid, p);
        }
    }
}

fn permute(inst: &Instance, s: &mut State, rng: &mut Rng, evals: &mut u64) {
    let mut pend: Vec<u32> = s.rejected();
    rng.shuffle(&mut pend);
    for jid in pend {
        let cur = s.total();
        let mut best: Option<(usize, i64)> = None;
        for p in 0..s.order.len() {
            *evals += 1;
            if let Some(c) = s.try_replace(inst, jid, p) {
                if c < cur && best.map_or(true, |(_, bc)| c < bc) {
                    best = Some((p, c));
                }
            }
        }
        if let Some((p, _)) = best {
            s.replace(inst, jid, p);
        }
    }
}

/// Step-based run of the IG — the browser (WASM) drives this per frame, the
/// CLI wraps it in a wall-clock loop.
pub struct Run {
    pub cur: State,
    pub best: State,
    rng: Rng,
    pub iterations: u64,
    pub evaluations: u64,
    pub d: usize,
    pub d_max: usize,
    stall: u64,
    pub accept: Accept,
    pub permute: bool,
}

impl Run {
    /// Builds the initial solution (shuffled greedy construction + optional swap phase).
    pub fn new(inst: &Instance, d: usize, accept: Accept, permute_on: bool, seed: u64) -> Run {
        Self::new_adaptive(inst, d, d, accept, permute_on, seed)
    }

    /// Like `new`, with the adaptive destruction ramp enabled up to `d_max`.
    pub fn new_adaptive(inst: &Instance, d: usize, d_max: usize, accept: Accept, permute_on: bool, seed: u64) -> Run {
        let mut rng = Rng::new(seed);
        let mut evals: u64 = 0;
        let mut cur = State::all_rejected(inst);
        cur.rebuild(inst);
        construct(inst, &mut cur, &mut rng, &mut evals);
        if permute_on {
            permute(inst, &mut cur, &mut rng, &mut evals);
        }
        let best = cur.clone();
        Run {
            cur,
            best,
            rng,
            iterations: 0,
            evaluations: evals,
            d,
            d_max: d_max.max(d),
            stall: 0,
            accept: accept,
            permute: permute_on,
        }
    }

    /// Runs `iters` destroy–rebuild iterations; returns true if the best improved.
    pub fn step(&mut self, inst: &Instance, iters: u64) -> bool {
        const RAMP: u64 = 30; // stagnant iterations per +1 destruction size
        let before = self.best.total();
        for _ in 0..iters {
            self.iterations += 1;
            if let Accept::Best = self.accept {
                self.cur = self.best.clone();
            }
            let d_eff = if self.d_max > self.d {
                (self.d + (self.stall / RAMP) as usize).min(self.d_max)
            } else {
                self.d
            };
            self.cur.remove_random(inst, d_eff, &mut self.rng);
            construct(inst, &mut self.cur, &mut self.rng, &mut self.evaluations);
            if self.permute {
                permute(inst, &mut self.cur, &mut self.rng, &mut self.evaluations);
            }
            if self.cur.total() < self.best.total() {
                self.best = self.cur.clone();
                self.stall = 0;
            } else {
                self.stall += 1;
            }
        }
        self.best.total() < before
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn solve(inst: &Instance, params: &Params) -> Outcome {
    let start = std::time::Instant::now();
    let target = params.target.map(|t| t * 10);
    let mut run = Run::new_adaptive(inst, params.d, params.d_max, params.accept, params.permute, params.seed);

    while start.elapsed().as_secs_f64() < params.seconds {
        if target.map_or(false, |t| run.best.total() <= t) {
            break;
        }
        run.step(inst, 1);
    }

    Outcome {
        best_cost: run.best.total(),
        best_order: run.best.order.clone(),
        iterations: run.iterations,
        evaluations: run.evaluations,
        elapsed: start.elapsed().as_secs_f64(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::{Instance, Job};

    fn tiny() -> Instance {
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
    fn brute(inst: &Instance, order: &[u32]) -> i64 {
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
}
