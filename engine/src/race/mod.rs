//! The method race: six search strategies over one instance, one objective,
//! one PRNG family and one budget currency.
//!
//! The page used to race five JavaScript methods against one WASM engine, which
//! made any wall-clock number a measurement of the *language*. With every
//! method behind this module the evaluation budget stays the headline currency
//! and wall-clock becomes an honest secondary readout.
//!
//! Dispatch is a `match` over a closed enum, not a trait object: the set of
//! methods is known at compile time and constructed in exactly one place, so a
//! vtable would only cost binary size (an entry plus a `drop_in_place` per
//! impl, every `advance` address-taken, no inlining of the shared accounting
//! into the arms, nothing DCE-able) and force the per-frame snapshot writer to
//! dispatch six times just to read scalars. `Common` sits at a fixed offset on
//! every `Racer`, so the snapshot path never dispatches at all.

pub mod ctx;
pub mod greedy;

pub use ctx::Ctx;

use greedy::GreedyState;

use crate::eval::State;
use crate::instance::Instance;
use crate::rng::{method_seed, Rng};
use crate::solver::Accept;

// ---------------------------------------------------------------------------
// Status keys — indices into STATUS_KEYS on the JS side, which maps 1:1 onto
// the keys already in `studio/src/i18n.js` under `race.status`. The numbering
// is a wire format: append, never reorder. Index 3 (`constructingEDD`) is
// reserved-and-dead — the IG racer is now `solver::Run`, which constructs by
// shuffled greedy, so nothing emits it.
// ---------------------------------------------------------------------------
pub const ST_PREPARING: u32 = 0;
pub const ST_CONSTRUCTING: u32 = 1;
pub const ST_CONSTRUCTING_GREEDY: u32 = 2;
pub const ST_CONSTRUCTING_EDD: u32 = 3; // reserved, unused
pub const ST_DESCENDING: u32 = 4;
pub const ST_STUCK_LOCAL: u32 = 5;
pub const ST_DONE_CONSTRUCTIVE: u32 = 6;
pub const ST_ITERATION: u32 = 7;
pub const ST_GENERATION: u32 = 8;
pub const ST_DIVERSIFIED: u32 = 9;
pub const ST_BREEDING: u32 = 10;
pub const ST_IG_LOOP: u32 = 11;
pub const ST_BUDGET_EXHAUSTED: u32 = 12;

/// No cost yet / infeasible. Kept out of band so the snapshot can turn it into
/// `f64::INFINITY` without the search ever touching a float.
pub const NO_COST: i64 = i64::MAX;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Method {
    Greedy = 0,
    Descent = 1,
    Tabu = 2,
    TabuDiv = 3,
    Ama = 4,
    Ig = 5,
}

pub const METHODS: [Method; 6] = [
    Method::Greedy,
    Method::Descent,
    Method::Tabu,
    Method::TabuDiv,
    Method::Ama,
    Method::Ig,
];

impl Method {
    /// The racer id the page uses. The seed derives from this string, so
    /// changing one renames a method *and* re-rolls its race.
    pub fn id(self) -> &'static str {
        match self {
            Method::Greedy => "greedy",
            Method::Descent => "descent",
            Method::Tabu => "tabu",
            Method::TabuDiv => "tabudiv",
            Method::Ama => "ama",
            Method::Ig => "ig",
        }
    }
    pub fn from_u32(m: u32) -> Option<Method> {
        METHODS.get(m as usize).copied()
    }
}

/// IG's controls, carried from `race_new` so the IG racer is the same engine
/// the page's controls describe.
#[derive(Clone, Copy)]
pub struct IgConfig {
    pub d: usize,
    pub accept: Accept,
    pub permute: bool,
}

// ---------------------------------------------------------------------------
// Common: everything the race owns about a racer, at a fixed offset for all six
// ---------------------------------------------------------------------------
pub struct Common {
    pub method: Method,
    /// evaluations spent, ever
    pub evals: u64,
    pub budget: u64,
    /// unspent slice credit, carried across slices — this is what makes the
    /// slice size irrelevant to the result (see the slice-invariance test)
    pub credit: i64,
    pub best: State,
    pub best_cost: i64,
    pub cur_cost: i64,
    pub trace: Vec<(u64, i64)>,
    pub status_key: u32,
    pub status_arg: u32,
    /// d_eff (IG) / tenure (Tabu) / population (AMA)
    pub phase_arg: u32,
    pub done: bool,
    pub best_changed: bool,
    pub cur_changed: bool,
    pub rng: Rng,
    /// scratch rejected set for racers that need indexed access; refreshed
    /// unconditionally after every committed move, which is what makes desync
    /// impossible
    pub rej: Vec<u32>,
    /// exact cutoff pruning is available (all objective terms non-negative).
    /// Public so a test can force it off: with pruning disabled the trace, the
    /// eval count and the final cost must be identical (budget rule 3).
    pub prune: bool,
}

impl Common {
    fn new(inst: &Instance, method: Method, race_seed: u32, budget: u64) -> Common {
        let mut best = State::all_rejected(inst);
        best.rebuild(inst);
        Common {
            method,
            evals: 0,
            budget,
            credit: 0,
            best,
            best_cost: NO_COST,
            cur_cost: NO_COST,
            trace: Vec::new(),
            status_key: ST_PREPARING,
            status_arg: 0,
            phase_arg: 0,
            done: false,
            best_changed: true,
            cur_changed: true,
            rng: Rng::new(method_seed(race_seed, method)),
            rej: Vec::new(),
            prune: crate::ops::prune_is_exact(inst),
        }
    }
}

// ---------------------------------------------------------------------------
// Racer
// ---------------------------------------------------------------------------
pub(crate) enum Body {
    Greedy(GreedyState),
    /// NOT YET PORTED. Each remaining method lands here as its own variant
    /// (`Descent(DescentState)`, ...); until then a placeholder racer that
    /// spends nothing and reports itself finished, so the race can terminate.
    /// This variant disappears once all six are in.
    Pending,
}

pub struct Racer {
    pub common: Common,
    pub(crate) body: Body,
}

impl Racer {
    pub fn new(inst: &Instance, method: Method, race_seed: u32, budget: u64, _ig: IgConfig) -> Racer {
        let mut common = Common::new(inst, method, race_seed, budget);
        let body = match method {
            Method::Greedy => {
                common.status_key = greedy::STATUS_INITIAL;
                Body::Greedy(GreedyState::new(inst))
            }
            _ => Body::Pending,
        };
        Racer { common, body }
    }

    /// Advance this method by at most `slice` evaluations; returns what it
    /// actually spent.
    pub fn advance(&mut self, inst: &Instance, slice: i64) -> u64 {
        if self.common.done {
            return 0;
        }
        // Same lifecycle as the JS driver in race/view.js: a racer that has
        // reached the budget is finished, with the budget-exhausted status.
        if self.common.evals >= self.common.budget {
            self.common.done = true;
            self.common.status_key = ST_BUDGET_EXHAUSTED;
            self.common.status_arg = 0;
            return 0;
        }
        let Racer { common, body } = self;
        let mut ctx = Ctx::open(inst, common, slice);
        match body {
            Body::Greedy(s) => s.advance(&mut ctx),
            Body::Pending => ctx.finish(ST_PREPARING),
        }
        ctx.close()
    }

    /// The solution the page draws as this racer's live schedule strip. One
    /// match, once per snapshot — the scalar block above never dispatches.
    pub fn incumbent(&self) -> &State {
        match &self.body {
            Body::Greedy(s) => s.incumbent(),
            Body::Pending => &self.common.best,
        }
    }
}

// ---------------------------------------------------------------------------
// Snapshot block: the fixed-layout scalars JS reads once per frame
// ---------------------------------------------------------------------------
#[repr(C)]
#[derive(Clone, Copy)]
pub struct RacerSnapshot {
    /// DATA units (deci/10), `f64::INFINITY` until the first solution
    pub best_cost: f64, // 0
    /// live incumbent cost, data units (the firefly's height)
    pub cur_cost: f64, // 8
    /// f64 so JS reads it exactly past 2^32
    pub evals: f64, // 16
    pub status_key: u32, // 24
    pub status_arg: u32, // 28
    /// bit0 done, bit1 best-order changed, bit2 incumbent changed
    pub flags: u32, // 32
    /// total improvement points recorded (JS pulls the delta)
    pub trace_len: u32, // 36
    pub order_len: u32, // 40
    pub best_len: u32,  // 44
    /// d_eff (IG) / tenure (Tabu) / population (AMA)
    pub phase_arg: u32, // 48
    pub _pad: [u32; 3], // 52..64
}

impl RacerSnapshot {
    pub const EMPTY: RacerSnapshot = RacerSnapshot {
        best_cost: f64::INFINITY,
        cur_cost: f64::INFINITY,
        evals: 0.0,
        status_key: ST_PREPARING,
        status_arg: 0,
        flags: 0,
        trace_len: 0,
        order_len: 0,
        best_len: 0,
        phase_arg: 0,
        _pad: [0; 3],
    };
}

#[inline]
fn data_units(c: i64) -> f64 {
    if c == NO_COST {
        f64::INFINITY
    } else {
        c as f64 / 10.0
    }
}

// ---------------------------------------------------------------------------
// Race
// ---------------------------------------------------------------------------
pub struct Race {
    pub racers: Vec<Racer>,
    pub n: usize,
    /// 6 * n, stride n — incumbent orders
    pub orders: Vec<u32>,
    /// 6 * n, stride n — best orders
    pub best: Vec<u32>,
    pub ig: IgConfig,
}

impl Race {
    pub fn new(inst: &Instance, seed: u32, budget: u64, ig: IgConfig) -> Race {
        let n = inst.n();
        Race {
            racers: METHODS
                .iter()
                .map(|&m| Racer::new(inst, m, seed, budget, ig))
                .collect(),
            n,
            orders: vec![0; 6 * n],
            best: vec![0; 6 * n],
            ig,
        }
    }

    pub fn step(&mut self, inst: &Instance, m: u32, slice: i64) -> u64 {
        match self.racers.get_mut(m as usize) {
            Some(r) => r.advance(inst, slice),
            None => 0,
        }
    }

    pub fn trace(&self, m: u32) -> &[(u64, i64)] {
        match self.racers.get(m as usize) {
            Some(r) => &r.common.trace,
            None => &[],
        }
    }

    /// Refresh the scalar block, and the order blocks when asked
    /// (flags bit0 incumbent orders, bit1 best orders).
    pub fn snapshot(&mut self, out: &mut [RacerSnapshot; 6], flags: u32) {
        let n = self.n;
        for (i, r) in self.racers.iter().enumerate() {
            let c = &r.common;
            let inc = r.incumbent();
            out[i] = RacerSnapshot {
                best_cost: data_units(c.best_cost),
                cur_cost: data_units(c.cur_cost),
                evals: c.evals as f64,
                status_key: c.status_key,
                status_arg: c.status_arg,
                flags: (c.done as u32)
                    | ((c.best_changed as u32) << 1)
                    | ((c.cur_changed as u32) << 2),
                trace_len: c.trace.len() as u32,
                order_len: inc.order.len() as u32,
                best_len: c.best.order.len() as u32,
                phase_arg: c.phase_arg,
                _pad: [0; 3],
            };
            if flags & 1 != 0 {
                let dst = &mut self.orders[i * n..i * n + inc.order.len()];
                dst.copy_from_slice(&inc.order);
            }
            if flags & 2 != 0 {
                let dst = &mut self.best[i * n..i * n + c.best.order.len()];
                dst.copy_from_slice(&c.best.order);
            }
        }
        for r in self.racers.iter_mut() {
            r.common.best_changed = false;
            r.common.cur_changed = false;
        }
    }
}
