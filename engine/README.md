# engine — the Rust core

The validated solver: MaScLib parser, incremental evaluator (recompute only downstream of an edit, stop at the first absorbing idle gap), and the Iterated Greedy. (The dynamic deadline d̄ⱼ of the 2015 study is documented in ../docs/algorithm.md and implemented in ../legacy/ig.py; this engine is not required to compute it, because `State::best_insertion`'s strict improvement test decides the same accept/reject economics at every position.) Money is handled in fixed-point deci-units (the data has 0.1-granular tardiness weights); reported costs are in data units.

```bash
cargo run --release -- solve <instance.csv> [--seconds 5] [--d 2] [--dmax 0] [--accept current|best] [--no-permute] [--seed 1] [--target COST]
cargo run --release -- validate <masclib_dir> <benchmark.json> [--seconds 45] [--runs 3]
cargo test --release          # property test vs brute-force oracle, cross-impl golden tests, best-known regression
```

WASM build (powers the [live demo](https://alexmarinho.github.io/IG/); 116 KB, hand-rolled C-ABI exports, no wasm-bindgen):

```bash
rustup target add wasm32-unknown-unknown
RUSTFLAGS="-C panic=abort" cargo build --release --target wasm32-unknown-unknown --no-default-features
# NOTE: ../tools/build_demo.py does not exist in this tree. The demo's
# embedded payload is rebuilt by the studio pipeline — see ../studio/scripts/.
```

Library surface for custom heuristics: `Instance` (parser), `solver::State` (incremental `try_insert` / `try_replace` / `insert` / `replace` / `remove_random`), `Run` (step-based search driver — what both the CLI and the WASM exports wrap). How it is verified and what it found: [`../RESULTS.md`](../RESULTS.md).
