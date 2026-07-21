//! The Iterated Greedy metaheuristic.
//!
//! What used to live here and no longer does: the PRNG (now `crate::rng`), the
//! incremental evaluator `State` (now `crate::eval`), and the construction /
//! swap passes (now `crate::ops`). None of those were ever IG's property —
//! every method in the race needs them, and sharing them is what makes a cost
//! printed by any method comparable to the published best-known. What is left
//! below is the search loop, which *is* IG's.

use crate::instance::Instance;
use crate::ops::{greedy_pass, permute_pass, prune_is_exact};

// Re-exported so `main.rs`, `wasm.rs` and every existing
// `use crate::solver::{...}` keep compiling against the same paths.
pub use crate::eval::State;
pub use crate::rng::Rng;

fn construct(inst: &Instance, s: &mut State, rng: &mut Rng, evals: &mut u64, prune: bool) {
    greedy_pass(inst, s, rng, evals, prune, |_, _, _| {});
}

fn permute(inst: &Instance, s: &mut State, rng: &mut Rng, evals: &mut u64, prune: bool) {
    permute_pass(inst, s, rng, evals, prune);
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
    /// exact cutoff pruning is enabled (all objective costs are non-negative)
    prune: bool,
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
        // cutoff pruning is exact only when every objective cost is non-negative
        let prune = prune_is_exact(inst);
        let mut cur = State::all_rejected(inst);
        cur.rebuild(inst);
        construct(inst, &mut cur, &mut rng, &mut evals, prune);
        if permute_on {
            permute(inst, &mut cur, &mut rng, &mut evals, prune);
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
            prune,
        }
    }

    /// Runs `iters` destroy–rebuild iterations; returns true if the best improved.
    pub fn step(&mut self, inst: &Instance, iters: u64) -> bool {
        const RAMP: u64 = 30; // stagnant iterations per +1 destruction size
        let before = self.best.total();
        for _ in 0..iters {
            self.iterations += 1;
            if let Accept::Best = self.accept {
                self.cur.clone_from(&self.best);
            }
            let d_eff = if self.d_max > self.d {
                (self.d + (self.stall / RAMP) as usize).min(self.d_max)
            } else {
                self.d
            };
            self.cur.remove_random(inst, d_eff, &mut self.rng);
            construct(inst, &mut self.cur, &mut self.rng, &mut self.evaluations, self.prune);
            if self.permute {
                permute(inst, &mut self.cur, &mut self.rng, &mut self.evaluations, self.prune);
            }
            if self.cur.total() < self.best.total() {
                self.best.clone_from(&self.cur);
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
