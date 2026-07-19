//! Hand-rolled WASM exports (no wasm-bindgen): the browser demo instantiates
//! the module from bytes, writes MaScLib CSV text into linear memory, and
//! drives the solver one batch of iterations per animation frame.
//!
//! Single-threaded by construction (wasm), so plain statics behind unsafe are fine.

use crate::instance::Instance;
use crate::solver::{Accept, Run};

struct Registry {
    instances: Vec<Instance>,
    runs: Vec<(usize, Run)>, // (instance id, run)
}

fn reg() -> &'static mut Registry {
    static mut REG: Option<Registry> = None;
    unsafe {
        #[allow(static_mut_refs)]
        REG.get_or_insert_with(|| Registry {
            instances: Vec::new(),
            runs: Vec::new(),
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
