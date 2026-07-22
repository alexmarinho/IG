use ig_core::{solve, Accept, Instance, Params};
use rayon::prelude::*;
use std::path::{Path, PathBuf};

fn arg_val(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1).cloned())
}

fn params_from(args: &[String], default_secs: f64) -> Params {
    Params {
        d: arg_val(args, "--d").and_then(|v| v.parse().ok()).unwrap_or(2),
        d_max: arg_val(args, "--dmax").and_then(|v| v.parse().ok()).unwrap_or(0),
        accept: match arg_val(args, "--accept").as_deref() {
            Some("best") => Accept::Best,
            _ => Accept::Current,
        },
        permute: arg_val(args, "--no-permute").is_none(),
        seconds: arg_val(args, "--seconds").and_then(|v| v.parse().ok()).unwrap_or(default_secs),
        target: arg_val(args, "--target").and_then(|v| v.parse().ok()),
        seed: arg_val(args, "--seed").and_then(|v| v.parse().ok()).unwrap_or(1),
    }
}

fn cmd_solve(args: &[String]) {
    let path = PathBuf::from(&args[0]);
    let inst = Instance::parse(&path).expect("parse");
    let params = params_from(args, 5.0);
    let out = solve(&inst, &params);
    println!(
        "{}: n={} best={} iters={} evals={} ({:.2} Mevals/s) t={:.2}s",
        inst.name,
        inst.n(),
        out.best_cost as f64 / 10.0,
        out.iterations,
        out.evaluations,
        out.evaluations as f64 / out.elapsed / 1e6,
        out.elapsed
    );
    let perf = out.best_order.len();
    println!("  performed {} / rejected {}", perf, inst.n() - perf);
}

fn cmd_validate(args: &[String]) {
    let dir = PathBuf::from(&args[0]);
    let bench: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&args[1]).expect("benchmark.json")).unwrap();
    let params_proto = params_from(args, 2.0);
    let runs: u64 = arg_val(args, "--runs").and_then(|v| v.parse().ok()).unwrap_or(1);

    let mut names: Vec<String> = bench.as_object().unwrap().keys().cloned().collect();
    names.sort();

    let results: Vec<(String, usize, i64, i64, f64, f64)> = names
        .par_iter()
        .map(|name| {
            let inst = Instance::parse(&dir.join(format!("{name}.csv"))).expect("parse");
            let best_known = bench[name][1].as_i64().unwrap();
            // instances with many identical 500-job tasks: thesis used d=50, no permutation
            let d = if inst.n() >= 500 { 50 } else { params_proto.d };
            let mut best = i64::MAX;
            let mut secs = 0.0;
            for run in 0..runs {
                let p = Params {
                    d,
                    d_max: params_proto.d_max,
                    accept: params_proto.accept,
                    permute: params_proto.permute && inst.n() < 500,
                    seconds: params_proto.seconds,
                    target: Some(best_known),
                    seed: params_proto.seed + run * 1000,
                };
                let out = solve(&inst, &p);
                best = best.min(out.best_cost);
                secs += out.elapsed;
            }
            let gap = 100.0 * (best as f64 / 10.0 - best_known as f64) / best_known as f64;
            (name.clone(), inst.n(), best, best_known, gap, secs)
        })
        .collect();

    let mut hits = 0;
    let mut improved = 0;
    println!("{:<14} {:>5} {:>10} {:>10} {:>8}", "instance", "n", "found", "best2015", "gap%");
    for (name, n, found_deci, known, gap, _) in &results {
        let found = &(*found_deci as f64 / 10.0);
        let mark = if *found < *known as f64 {
            improved += 1;
            " ✨ NEW BEST"
        } else if *found == *known as f64 {
            hits += 1;
            " ✓"
        } else {
            ""
        };
        println!("{name:<14} {n:>5} {found:>10.1} {known:>10} {gap:>8.2}{mark}");
    }
    let mean_gap: f64 = results.iter().map(|r| r.4.max(0.0)).sum::<f64>() / results.len() as f64;
    println!(
        "\nmatched-or-beat best-known: {}/{} (improved: {improved})  mean gap {:.3}%",
        hits + improved,
        results.len(),
        mean_gap
    );
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(|s| s.as_str()) {
        Some("solve") if args.len() >= 2 => cmd_solve(&args[1..]),
        Some("validate") if args.len() >= 3 => cmd_validate(&args[1..]),
        _ => {
            eprintln!("usage:");
            eprintln!("  ig solve <instance.csv> [--seconds 5] [--d 2] [--dmax 0] [--accept current|best] [--no-permute] [--seed 1] [--target COST]");
            eprintln!("  ig validate <masclib_dir> <benchmark.json> [--seconds 2] [--runs 1] [--d 2] [--dmax 0] [--accept current|best]");
            std::process::exit(2);
        }
    }
    let _ = Path::new("");
}
