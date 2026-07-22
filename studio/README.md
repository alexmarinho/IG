# IG Studio

Standalone browser-native analytics workspace for the fixed IG scheduling
catalog. Its 53 bundled instances combine 44 MaScLib benchmarks, three native
GPU-serving workloads, and six deterministic kitchen and surgery workloads.

The Studio has two experiment shapes:

- **One run** — follow convergence, inspect the final schedule, and verify the
  exact objective decomposition.
- **Compare seeds** — run equal deterministic iteration budgets and summarize
  dispersion, reference hits, seed ranking, and convergence bands.

Only bundled instances are available. There is no instance editor, generator,
upload, or external CSV path.

The **Method** page connects the experiment to the wider project: runnable
Google Sheets and Colab versions, the readable Python implementation, the
original 2015 project, and the engineering-results ledger.

## Local development

```sh
RUSTFLAGS="-C panic=abort" cargo build \
  --manifest-path engine/Cargo.toml \
  --release --target wasm32-unknown-unknown --no-default-features

node studio/scripts/build-engine-payload.mjs \
  --out=studio/src/generated/engine-payload.js

python3 -m http.server 8766 --directory .
```

Open <http://localhost:8766/studio/>. Serving the repository root keeps the
read-only links to the notebook and original Python implementation valid.

## Checks

```sh
npm --prefix studio test
npm --prefix studio run check
npm --prefix studio run build
```

The generated standalone file is written under `studio/dist/` and can be
previewed at <http://localhost:8766/studio/dist/>. Its link configuration is
adjusted for the extra directory level, while all runtime CSS, JavaScript,
WebAssembly, and fixed instance data are embedded in that single HTML file.

## Home-page integration

The public home page embeds the standalone document on demand through an
`iframe` and `srcdoc`. This preserves the Studio layout while isolating its CSS,
document language, Web Worker and responsive viewport from the surrounding
presentation. The Studio engine does not start during the initial home-page
load. Its solver, catalog, styles and application code are already contained in
the single HTML payload, and the active EN/PT-BR language is passed across the
frame boundary.
