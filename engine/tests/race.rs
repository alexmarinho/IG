//! The race, end to end: six methods, one instance, one objective, one budget.
//!
//! The unit tests in `race/*.rs` each pin one method against its own fixture.
//! This is the test the merge needed and none of the six trees could have
//! written, because none of them had the other five: it drives all six racers
//! through the public `Race` on a real MaScLib instance and checks the things
//! that only become checkable once they share a crate.

use ig_core::race::{IgConfig, Race, RacerSnapshot, METHODS};
use ig_core::solver::{Accept, State};
use ig_core::Instance;
use std::path::PathBuf;

fn load(rel: &str) -> Instance {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join(rel);
    Instance::parse(&path).expect("parse instance")
}

const IG: IgConfig = IgConfig { d: 2, accept: Accept::Current, permute: true };

/// Round-robin every racer to exhaustion, as the page's worker does.
fn run(inst: &Instance, seed: u32, budget: u64, slice: i64) -> Race {
    let mut race = Race::new(inst, seed, budget, IG);
    let mut guard = 0;
    loop {
        let mut live = false;
        for m in 0..METHODS.len() {
            if !race.racers[m].common.done {
                race.step(inst, m as u32, slice);
                live = true;
            }
        }
        guard += 1;
        assert!(guard < 1_000_000, "a racer never finished");
        if !live {
            return race;
        }
    }
}

/// Re-evaluate a sequence from scratch through the shared evaluator.
fn reprice(inst: &Instance, order: &[u32]) -> i64 {
    let mut s = State::all_rejected(inst);
    s.order = order.to_vec();
    for &j in order {
        s.in_seq[j as usize] = true;
        s.rej_cost -= inst.jobs[j as usize].rej;
    }
    s.rebuild(inst);
    s.total()
}

/// The claim the whole refactor exists to make: a cost printed by *any* racer
/// is on the published scale, because every racer prices through one evaluator.
/// Each reported best must re-evaluate, from scratch, to exactly the number the
/// racer reported.
#[test]
fn every_racer_reports_a_cost_the_shared_objective_agrees_with() {
    let inst = load("masclib/NCOS_11.csv");
    let race = run(&inst, 1234, 60_000, 4096);
    for (m, meth) in METHODS.iter().enumerate() {
        let c = &race.racers[m].common;
        assert!(!c.best.order.is_empty(), "{} found nothing", meth.id());
        assert_eq!(
            reprice(&inst, &c.best.order),
            c.best_cost,
            "{} reported a cost its own sequence does not have",
            meth.id()
        );
    }
}

/// All six are actually wired into the dispatch — none is still a stub that
/// reports itself finished without spending anything. Greedy is the exception
/// by design: it is one construction pass and stops.
#[test]
fn all_six_racers_run() {
    let inst = load("masclib/NCOS_11.csv");
    let race = run(&inst, 7, 40_000, 2048);
    for (m, meth) in METHODS.iter().enumerate() {
        let c = &race.racers[m].common;
        assert!(c.evals > 0, "{} spent nothing", meth.id());
        assert!(c.done, "{} never finished", meth.id());
        assert!(!c.trace.is_empty(), "{} recorded no improvement", meth.id());
    }
}

/// Six distinct streams. The bug fixed in 7eff5f8 was two racers drawing the
/// same one; the guard against it regressing is that no two *iterating* methods
/// land on the same trace. (Greedy and Descent share a construction and may
/// agree on a cost; the traces are what distinguish the searches.)
#[test]
fn the_racers_are_independent_runs() {
    let inst = load("masclib/NCOS_31.csv");
    let race = run(&inst, 99, 50_000, 4096);
    let traces: Vec<_> = (0..METHODS.len()).map(|m| race.racers[m].common.trace.clone()).collect();
    for i in 0..METHODS.len() {
        for j in (i + 1)..METHODS.len() {
            assert_ne!(
                traces[i],
                traces[j],
                "{} and {} produced the identical run",
                METHODS[i].id(),
                METHODS[j].id()
            );
        }
    }
}

/// Contract rule 7, across the whole race: the slice size is an animation
/// detail. Every racer's ledger, trace and solution must be identical whether
/// the worker hands out 1 evaluation at a time or a billion.
#[test]
fn the_race_does_not_depend_on_the_slice_size() {
    let inst = load("masclib/NCOS_11.csv");
    let reference = run(&inst, 5, 20_000, 1_000_000_000);
    for slice in [1i64, 97, 4096] {
        let race = run(&inst, 5, 20_000, slice);
        for (m, meth) in METHODS.iter().enumerate() {
            let a = &reference.racers[m].common;
            let b = &race.racers[m].common;
            assert_eq!(a.evals, b.evals, "{} evals at slice {slice}", meth.id());
            assert_eq!(a.trace, b.trace, "{} trace at slice {slice}", meth.id());
            assert_eq!(a.best_cost, b.best_cost, "{} best at slice {slice}", meth.id());
            assert_eq!(a.best.order, b.best.order, "{} order at slice {slice}", meth.id());
        }
    }
}

/// A race is reproducible: the same seed replays exactly, a different seed does
/// not. Determinism is the non-negotiable, and it is the one property a reader
/// of the page cannot check for themselves.
#[test]
fn a_race_replays_from_its_seed() {
    let inst = load("masclib/NCOS_11.csv");
    let a = run(&inst, 2026, 30_000, 1024);
    let b = run(&inst, 2026, 30_000, 1024);
    let c = run(&inst, 2027, 30_000, 1024);
    let mut differs = false;
    for m in 0..METHODS.len() {
        assert_eq!(a.racers[m].common.trace, b.racers[m].common.trace, "same seed must replay");
        assert_eq!(a.racers[m].common.evals, b.racers[m].common.evals);
        differs |= a.racers[m].common.trace != c.racers[m].common.trace;
    }
    assert!(differs, "a different seed must be a different race");
}

/// The snapshot block the page reads once per frame: costs in data units, the
/// order blocks filled to the lengths the scalars advertise.
#[test]
fn the_snapshot_block_describes_the_race() {
    let inst = load("masclib/NCOS_11.csv");
    let mut race = run(&inst, 3, 25_000, 2048);
    let mut snap = [RacerSnapshot::EMPTY; 6];
    race.snapshot(&mut snap, 3);
    let n = inst.n();
    for (m, meth) in METHODS.iter().enumerate() {
        let c = &race.racers[m].common;
        assert_eq!(snap[m].best_cost, c.best_cost as f64 / 10.0, "{}", meth.id());
        assert_eq!(snap[m].evals, c.evals as f64, "{}", meth.id());
        assert_eq!(snap[m].best_len as usize, c.best.order.len(), "{}", meth.id());
        assert_eq!(snap[m].flags & 1, 1, "{} should be done", meth.id());
        let best = &race.best[m * n..m * n + c.best.order.len()];
        assert_eq!(best, &c.best.order[..], "{} best block", meth.id());
    }
}
