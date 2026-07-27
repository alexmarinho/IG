# Iterated Greedy Scheduling

Single-machine scheduling with job rejection, sequence-dependent family setups,
release dates and weighted tardiness — the order acceptance and scheduling
family, `1 | rⱼ, sᵢⱼ | Σ wⱼTⱼ + rejection`.

A Rust core that evaluates roughly 20M candidate schedules per second per core
and also compiles to WebAssembly, plus a single-file Python implementation with
no runtime dependencies that mirrors it exactly and keeps it honest.

On the 44 MaScLib instances, under a uniform 45s × 3 seeds protocol, it matches
or beats the published best-known value on 37. Documented adaptive runs raise
that to 39, including two new best-knowns. Protocols, per-instance numbers and
the negative results are in [`RESULTS.md`](RESULTS.md).

## Run it

```bash
git clone https://github.com/alexmarinho/IG && cd IG
python3 python/ig_scheduler.py solve masclib/NCOS_01.csv --seconds 3
```

```text
NCOS_01: n=8 best=800 iters=119177 evals=3218727 (1073k evals/s) t=3.00s
  performed 2 / rejected 6
```

`best=800` is the published best-known for that instance. Six of the eight jobs
are rejected on purpose — turning them away costs less than the setup,
processing and lateness of running them. That trade-off is the problem.

The Rust engine, same semantics, considerably faster:

```bash
cd engine && cargo run --release -- solve ../masclib/NCOS_01.csv --seconds 3
```

## Read

- [`docs/algorithm.md`](docs/algorithm.md) — the model, the loop, the dynamic deadline
- [`RESULTS.md`](RESULTS.md) — every instance, the protocol, what did not work
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces fit together
- An interactive explanation runs the same WebAssembly engine in a browser:
  <https://alexmarinho.github.io/IG/>

## Layout

```
engine/    Rust core — native CLI and WebAssembly target
python/    one file, zero dependencies, the reference implementation
masclib/   the 44 benchmark instances
docs/      the published page and the written explanation
studio/    browser analytics workspace and notebooks
legacy/    the original 2015–2017 project, preserved unchanged
```

`masclib-gpu/`, `masclib-domains/` and `masclib-llm/` hold generated workloads;
`factory/` and `gpu/` hold research prototypes. Each has its own README.

## Verify

```bash
cd engine && cargo test --release      # unit, golden and race tests
python3 python/test_ig_scheduler.py    # the reference implementation agrees
```

Both run in CI on every push.

## When not to use this

Reach for something else if your shop has parallel or heterogeneous machines,
if jobs have multi-operation routings, or if you need a real-time dispatcher
reacting to live events — this solves one machine, offline.

For small instances where you need a *proven* optimum rather than a very good
schedule, use an exact solver such as CP-SAT or MILP.

The GPU replica fleet is a correctness prototype and is currently slower than
the CPU engine for single-instance search. The first evolved destroy operators
did not beat uniform random destruction on held-out instances; that negative
result is kept as the baseline rather than removed.

## License

GPL-3.0 — see [`LICENSE.txt`](LICENSE.txt). Citation metadata and the 2015
thesis reference are in [`CITATION.cff`](CITATION.cff).
