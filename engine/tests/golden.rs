//! Cross-implementation golden tests: the Rust engine and the Python rewrite
//! (`python/ig_scheduler.py`) must price the exact same sequences identically,
//! on real instances of every flavor (no-setup NCOS, setup STC, cost-only-setup
//! STC, synthetic GPU/LLM). The expected values below were produced by the
//! Python implementation; any semantic drift in either engine breaks this test.

use ig_core::solver::State;
use ig_core::Instance;
use std::path::PathBuf;

fn load(rel: &str) -> Instance {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join(rel);
    Instance::parse(&path).expect("parse instance")
}

/// Append the jobs in order through the incremental API; total in deci-units.
fn price_append(inst: &Instance, order: &[u32]) -> i64 {
    let mut s = State::all_rejected(inst);
    s.rebuild(inst);
    for &jid in order {
        let pos = s.order.len();
        assert!(s.try_insert(inst, jid, pos).is_some(), "append must be feasible");
        s.insert(inst, jid, pos);
    }
    s.total()
}

#[test]
fn matches_python_reference_costs() {
    let cases: Vec<(&str, Vec<u32>, i64)> = vec![
        ("masclib/NCOS_01.csv", vec![0, 1, 2, 3, 4, 5, 6, 7], 29600),
        ("masclib/NCOS_31.csv", vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 444400),
        ("masclib/STC_NCOS_31.csv", vec![5, 1, 9, 3, 7, 0, 12, 20], 670150),
        ("masclib-gpu/GPU_RUSH_60.csv", vec![3, 1, 4, 5], 69925),
    ];
    for (path, order, expected) in cases {
        let inst = load(path);
        let got = price_append(&inst, &order);
        assert_eq!(got, expected, "cost mismatch on {path}");
    }
}

/// The engine must reach the 2015 best-known value on a small instance fast —
/// a regression guard for both search quality and evaluator correctness.
#[test]
fn reaches_best_known_on_ncos_11() {
    let inst = load("masclib/NCOS_11.csv");
    let out = ig_core::solve(
        &inst,
        &ig_core::Params {
            d: 2,
            d_max: 0,
            accept: ig_core::Accept::Current,
            permute: true,
            seconds: 10.0,
            target: Some(2022),
            seed: 1,
        },
    );
    assert_eq!(out.best_cost, 20220, "expected best-known 2022 (deci 20220)");
}

/// Multi-machine guard: the MASC dialect can carry several RESOURCE rows and
/// several MODE rows per activity, but this engine is single-machine — such
/// files must be REJECTED loudly, never silently collapsed (see
/// docs/research/multi-machine-benchmark-decision.md).
#[test]
fn rejects_multi_resource_files() {
    let txt = "RESOURCE|NAMES,RESOURCE_ID,SETUP_MATRIX_ID,INITIAL_SETUP_STATE,CAPACITY,START_MIN\n\
               RESOURCE,0,0,0,1,0\n\
               RESOURCE,1,1,0,1,0\n";
    let err = Instance::parse_str(txt).unwrap_err();
    assert!(err.contains("multi-resource"), "unexpected error: {err}");
}

#[test]
fn rejects_multi_mode_files() {
    let txt = "MODE|NAMES,ACTIVITY_ID,MODE_ID,RESOURCE_ID,MODE_COST,PROCESSING_TIME,START_MIN,END_MAX,UNPERFORMED_COST\n\
               MODE,0,0,0,0,5,0,100,10\n\
               MODE,0,1,1,0,3,0,100,10\n";
    let err = Instance::parse_str(txt).unwrap_err();
    assert!(err.contains("MODE rows"), "unexpected error: {err}");
}
