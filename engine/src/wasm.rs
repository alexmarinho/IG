//! Hand-rolled WASM exports (no wasm-bindgen): the browser demo instantiates
//! the module from bytes, writes MaScLib CSV text into linear memory, and
//! drives the solver one batch of iterations per animation frame.
//!
//! Single-threaded by construction (wasm), so plain statics behind unsafe are fine.

use crate::instance::Instance;
use crate::race::{IgConfig, Race, RacerSnapshot};
use crate::solver::{Accept, Run};

struct Registry {
    instances: Vec<Instance>,
    runs: Vec<(usize, Run)>, // (instance id, run)
    race: Option<(usize, Race)>, // (instance id, race) — at most one at a time
}

fn reg() -> &'static mut Registry {
    static mut REG: Option<Registry> = None;
    unsafe {
        #[allow(static_mut_refs)]
        REG.get_or_insert_with(|| Registry {
            instances: Vec::new(),
            runs: Vec::new(),
            race: None,
        })
    }
}

/// Allocate `len` bytes inside wasm memory; the caller writes into it.
#[no_mangle]
pub extern "C" fn wasm_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Parse MaScLib CSV text previously written at (ptr, len). Returns instance id or -1.
#[no_mangle]
pub extern "C" fn inst_load(ptr: *mut u8, len: usize) -> i32 {
    let bytes = unsafe { Vec::from_raw_parts(ptr, len, len) };
    let Ok(text) = String::from_utf8(bytes) else {
        return -1;
    };
    match Instance::parse_str(&text) {
        Ok(inst) => {
            let r = reg();
            r.instances.push(inst);
            (r.instances.len() - 1) as i32
        }
        Err(_) => -1,
    }
}

#[no_mangle]
pub extern "C" fn inst_n(inst_id: i32) -> i32 {
    reg().instances[inst_id as usize].n() as i32
}

/// Start a run. accept: 0 = current, 1 = best. Returns run id.
#[no_mangle]
pub extern "C" fn run_new(inst_id: i32, d: u32, accept: u32, permute: u32, seed: u32) -> i32 {
    let r = reg();
    let inst = &r.instances[inst_id as usize];
    let run = Run::new(
        inst,
        d as usize,
        if accept == 1 { Accept::Best } else { Accept::Current },
        permute == 1,
        seed as u64,
    );
    r.runs.push((inst_id as usize, run));
    (r.runs.len() - 1) as i32
}

/// Run a batch of iterations; returns 1 if the best solution improved.
#[no_mangle]
pub extern "C" fn run_step(run_id: i32, iters: u32) -> i32 {
    let r = reg();
    let (inst_id, run) = &mut r.runs[run_id as usize];
    let inst = &r.instances[*inst_id];
    run.step(inst, iters as u64) as i32
}

/// Best cost in data units (deci-units / 10).
#[no_mangle]
pub extern "C" fn run_best_cost(run_id: i32) -> f64 {
    reg().runs[run_id as usize].1.best.total() as f64 / 10.0
}

#[no_mangle]
pub extern "C" fn run_iters(run_id: i32) -> f64 {
    reg().runs[run_id as usize].1.iterations as f64
}

#[no_mangle]
pub extern "C" fn run_evals(run_id: i32) -> f64 {
    reg().runs[run_id as usize].1.evaluations as f64
}

#[no_mangle]
pub extern "C" fn run_best_len(run_id: i32) -> i32 {
    reg().runs[run_id as usize].1.best.order.len() as i32
}

/// Write the best sequence (u32 job ids) at `out` (caller allocs via wasm_alloc).
#[no_mangle]
pub extern "C" fn run_best_write(run_id: i32, out: *mut u32) {
    let order = &reg().runs[run_id as usize].1.best.order;
    unsafe {
        std::ptr::copy_nonoverlapping(order.as_ptr(), out, order.len());
    }
}

/// Drop all runs (keeps parsed instances) — used when the UI restarts a solve.
#[no_mangle]
pub extern "C" fn runs_clear() {
    reg().runs.clear();
}

// ---------------------------------------------------------------------------
// The race: six methods, one module, one objective.
//
// Execution model, decided and not to be redesigned: ONE worker, round-robin
// slices. A budget race is deterministic per method, so parallelism would change
// nothing about the result, and a fair parallel race would need a barrier every
// slice — without SharedArrayBuffer (GitHub Pages cannot set COOP/COEP) that
// barrier is a postMessage round trip, which costs more than it buys. The gain
// from Rust here is throughput on one thread, not concurrency.
//
// Nothing below allocates per slice: the scalar block is a `static mut` in the
// data segment (fixed address, never moves) and the two order blocks are
// allocated once by `race_new`. JS binds its views once and rebinds only when
// `memory.buffer` has been detached by growth.
// ---------------------------------------------------------------------------

static mut SNAPSHOT: [RacerSnapshot; 6] = [RacerSnapshot::EMPTY; 6];

fn snapshot_block() -> &'static mut [RacerSnapshot; 6] {
    unsafe {
        #[allow(static_mut_refs)]
        &mut SNAPSHOT
    }
}

/// Create the six racers over `inst_id`. Drops any previous race. Returns 6, or -1.
/// The budget crosses as two u32 halves. `d`/`accept`/`permute` configure the IG
/// racer, so it is the same engine the page's controls describe.
#[no_mangle]
pub extern "C" fn race_new(
    inst_id: i32,
    seed: u32,
    budget_lo: u32,
    budget_hi: u32,
    d: u32,
    accept: u32,
    permute: u32,
) -> i32 {
    let r = reg();
    if inst_id < 0 || inst_id as usize >= r.instances.len() {
        return -1;
    }
    let inst = &r.instances[inst_id as usize];
    let budget = ((budget_hi as u64) << 32) | budget_lo as u64;
    let ig = IgConfig {
        d: d as usize,
        accept: if accept == 1 { Accept::Best } else { Accept::Current },
        permute: permute == 1,
    };
    r.race = Some((inst_id as usize, Race::new(inst, seed, budget, ig)));
    *snapshot_block() = [RacerSnapshot::EMPTY; 6];
    6
}

/// THE step function: advance method `m` by at most `slice` evaluations.
/// Returns the evaluations actually spent, which may exceed `slice` — a method
/// checks its credit only at phase boundaries, and the overshoot is carried
/// against the next slice so the result never depends on the slice size.
#[no_mangle]
pub extern "C" fn race_step(m: u32, slice: u32) -> u32 {
    let r = reg();
    let Some((inst_id, race)) = &mut r.race else {
        return 0;
    };
    let inst = &r.instances[*inst_id];
    race.step(inst, m, slice as i64) as u32
}

/// Refresh the fixed snapshot block from live state.
/// flags bit0: also refresh the incumbent-orders block. bit1: also best-orders.
#[no_mangle]
pub extern "C" fn race_snapshot(flags: u32) {
    if let Some((_, race)) = &mut reg().race {
        race.snapshot(snapshot_block(), flags);
    }
}

/// Fixed address of the 384-byte scalar block (6 × 64). Call once after `race_new`.
#[no_mangle]
pub extern "C" fn race_snapshot_ptr() -> *const u8 {
    snapshot_block().as_ptr() as *const u8
}

/// Incumbent orders: 6 × n u32, stride n. Call once after `race_new`.
#[no_mangle]
pub extern "C" fn race_orders_ptr() -> *const u32 {
    match &reg().race {
        Some((_, race)) => race.orders.as_ptr(),
        None => core::ptr::null(),
    }
}

/// Best orders: 6 × n u32, stride n. Call once after `race_new`.
#[no_mangle]
pub extern "C" fn race_best_ptr() -> *const u32 {
    match &reg().race {
        Some((_, race)) => race.best.as_ptr(),
        None => core::ptr::null(),
    }
}

/// Trace delta pull: `from` is how many points JS already holds. Writes
/// (evals, cost-in-data-units) f64 pairs into `out`; returns pairs written.
#[no_mangle]
pub extern "C" fn race_trace_write(m: u32, from: u32, out: *mut f64, cap: u32) -> u32 {
    let Some((_, race)) = &reg().race else {
        return 0;
    };
    let trace = race.trace(m);
    let from = from as usize;
    if from >= trace.len() {
        return 0;
    }
    let n = (trace.len() - from).min(cap as usize);
    for (k, &(at, cost)) in trace[from..from + n].iter().enumerate() {
        unsafe {
            *out.add(2 * k) = at as f64;
            *out.add(2 * k + 1) = cost as f64 / 10.0;
        }
    }
    n as u32
}

#[no_mangle]
pub extern "C" fn race_clear() {
    reg().race = None;
    *snapshot_block() = [RacerSnapshot::EMPTY; 6];
}
