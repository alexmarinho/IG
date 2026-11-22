# Project overview

A one-page map of this project for someone arriving cold: what it does, how it
is put together, where it runs, which outside services it touches, and what is
unfinished. It was written from a read-only pass over both repositories.

- Snapshot: 2026-11-22. Public repo `alexmarinho/IG` at `master` `29b1101`
  (2026-07-27). Private repo `alexmarinho/IG-private` at `main` `d3744ae`
  (2026-07-26).
- This file holds no credentials and no personal data. Anything sensitive is
  cited by its location in the private repository only.
- Deeper, more technical map: [`ARCHITECTURE.md`](ARCHITECTURE.md). Scorecard:
  [`../RESULTS.md`](../RESULTS.md). Algorithm in prose: [`algorithm.md`](algorithm.md).

---

## 1. What the project is

A validated **Iterated Greedy** solver for one-machine scheduling with order
acceptance: given jobs with release dates, due dates, lateness penalties,
family-dependent changeover time and cost, and a price for turning a job away,
decide which jobs to run, in which order, and which to refuse
(`1 | rⱼ, sᵢⱼ | Σ wⱼTⱼ + rejection`).

It began as a 2015 study (the thesis PDF is [`monografia-2015.pdf`](monografia-2015.pdf))
with a 2015 Excel/VBA and a 2017 Python/PyQt implementation, both preserved
unchanged in [`../legacy/`](../legacy/). In July 2026 it was rebuilt as:

- a Rust core that compiles to a native CLI and to WebAssembly;
- a zero-dependency Python reference that must price every schedule exactly
  like the Rust core;
- a self-contained interactive web page, a browser analytics "Studio", a
  Google Sheets lab and Colab notebooks, all running the same engine;
- a short explainer film (English and Portuguese, narrated, captioned) at the
  top of the page.

Headline result, always with its protocol: **37 of 44** MaScLib benchmark
instances matched or beaten under a uniform 45 s × 3 seeds protocol, **39 of 44**
including documented adaptive runs, two of them below the published 2015 record
([`../RESULTS.md`](../RESULTS.md)).

It is a research and portfolio artefact: no customers, no revenue, no SLA. The
private repository states its intended audiences (researchers, engineering
reviewers, practitioners) in `docs/BRD.md` §3.

## 2. Two repositories, one working tree

| | `alexmarinho/IG` | `alexmarinho/IG-private` |
|---|---|---|
| Visibility | public, GPL-3.0 | private |
| Default branch | `master` | `main` (only branch) |
| Holds | engine, Python reference, benchmarks, page, Studio, Sheets lab, research prototypes, rendered film | the film's Remotion source and data pipeline, the agent briefs (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`), product and design docs (BRD, TDD, VIDEO, DATA-PROVENANCE, NARRATION, ONBOARDING, WORKLOG, 10 ADRs) |
| History | 34 commits; the modern work is two squashed publishes (`d69c314`, `853b4c8`) plus a CI bot commit | 6 commits, all on 2026-07-26 |

**How they fit locally.** `IG-private` is cloned *inside* the public checkout as
`IG/private/`. It is not a submodule; the public `.gitignore` hides it, along
with symlinks at the public root (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) that
point into it so every AI coding tool finds the same brief. Setup steps:
IG-private `docs/ONBOARDING.md` §1 and §6.

**The boundary.** Remotion, the film's framework, is not open source, which is
the main reason the private repository exists. Only rendered output crosses
into the public repo, through one allow-listed script
(IG-private `tools/publish-film.mjs`). A pre-commit hook that refuses private
paths, credentials and large blobs lives in IG-private `tools/hooks/pre-commit`.
Git hooks are not versioned, so it must be linked by hand in every clone.

**Multi-agent working style.** The project is worked from several AI coding
providers (Claude Code, Codex, Gemini/Antigravity, Kimi) on a shared tree. The
rules for that (explicit-path commits only, a claim ledger in
IG-private `docs/WORKLOG.md`, never touching another session's dirty files) are
in IG-private `AGENTS.md`.

## 3. Components

| Path | What it is | Status |
|---|---|---|
| `engine/` | Rust crate `ig-core` (lib `ig_core`, bin `ig`): parser, incremental evaluator, IG solver, six-method "race", hand-rolled WASM exports | core, tested |
| `python/` | `ig_scheduler.py`, the reference engine and CLI; packaged as `ig-scheduler` with an `ig-solve` command (`../pyproject.toml`) | core, tested |
| `masclib/`, `benchmark.json` | the 44 benchmark instances and their 2015 best-known values | data of record, never regenerate |
| `masclib-gpu/`, `masclib-domains/`, `masclib-llm/` | synthetic workloads (GPU serving; kitchen, surgery, coffee, brewery, 3D print) and semantic overlays | illustrative only, no published references |
| `docs/index.html` | the public explainer page, hand-maintained, about 550 KB, embeds the film | live |
| `docs/studio-app.html` | the Studio, built from `studio/` and auto-committed by CI | live |
| `studio/` | zero-npm-dependency browser analytics app, notebooks, 68 tests | live |
| `google-sheets/` | Apps Script lab that runs the same WASM inside Google Sheets, plus a downloadable `.xlsx` | live |
| `factory/` | LLM-driven evolution of the destroy operator | research; headline result is a registered null |
| `gpu/` | PyTorch fleet of thousands of lockstep IG replicas | research; correct but slower than one CPU core |
| `tools/` | deterministic instance and manifest generators | partly broken, see §7 |
| `legacy/` | the 2015–2017 project | frozen |

## 4. Where it runs

| What | Where | Trigger |
|---|---|---|
| Public site `alexmarinho.github.io/IG` | GitHub Pages, served from `docs/` on `master` | any push to `master` rebuilds Pages automatically |
| CI gate | GitHub Actions `ci.yml` on `ubuntu-latest` | every push to `master` and every pull request |
| Studio rebuild | GitHub Actions `deploy-studio.yml`; **commits to `master`** as `github-actions[bot]` | pushes to `master` touching `studio/`, `engine/`, `masclib*/` |
| Engine in the page and Studio | the visitor's browser (WASM in a Web Worker; no server, no network fetch) | on demand |
| Sheets lab | the visitor's own copy of a public Google Sheet (Apps Script V8) | on demand; links in [`../google-sheets/README.md`](../google-sheets/README.md) |
| Notebooks | Google Colab, driving the Python reference | on demand; links in `studio/notebooks/` |
| Development, film rendering, benchmark runs | the author's own Macs (local checkout with `private/` nested inside) | by hand |
| GPU fleet | an RTX 3090 machine (per `../RESULTS.md` and `../gpu/README.md`) | by hand |
| Locally served LLM used in the factory campaign | a local machine; which one is not recorded | by hand |

There is no backend server, database or container deployment anywhere in
either repository.

## 5. Outside services and accounts

| Service | Used for | Where the credential lives |
|---|---|---|
| GitHub | both repositories, Actions, Pages | GitHub account; Actions use the built-in token only |
| Google (Sheets, Apps Script, Drive, Colab) | the public master workbook and its bound script; notebooks | the author's Google account. The master must stay shared as Viewer only ([`../google-sheets/README.md`](../google-sheets/README.md)) |
| OpenAI-compatible LLM API, DeepSeek by default | `factory/evolve.py --backend llm` | a local `.env` at the public repo root, never committed; template in [`../.env.example`](../.env.example). See IG-private `AGENTS.md`, rule 8 |
| Locally served open-weights LLM | one arm of the factory campaign | local machine, no account |
| ElevenLabs (text-to-speech) | the film's narration | not on the dev machine and never in a repo; see IG-private `docs/NARRATION.md`, section "The voice — decided" |
| Remotion | rendering the film | licence terms are why the film source is private; IG-private `docs/decisions/0010-remotion-in-repo-despite-licence.md` |
| Kimi | hosted the scenario images that the spent `import-assets.yml` workflow downloaded once | none in the repo |
| AI coding providers (Claude Code, Codex, Gemini/Antigravity, Kimi) | development | per-tool local config, gitignored. IG-private `docs/ONBOARDING.md` §2 |

## 6. Verification, as run for this overview

Run on 2026-11-22 in a fresh cloud clone of `master` (Linux, Node 22). Only
gitignored build output was written.

| Command | Result |
|---|---|
| `cd engine && cargo test --release` | 38 passed, 2 ignored (developer probes); 4 golden; 6 race |
| `python3 python/test_ig_scheduler.py` | 4 tests OK |
| `python3 factory/test_factory.py` | 3 tests OK |
| WASM build (`--target wasm32-unknown-unknown --no-default-features`) | builds, 116,610 bytes |
| `npm --prefix studio test` | 68 of 68 pass once the WASM is built (5 fail before, by design) |
| `node --test google-sheets/tests/*.test.mjs` | 16 of 16 pass once the WASM is built |

Last CI and Studio deploy runs on `master` (`853b4c8`, 2026-07-27) succeeded.
Not re-run here: the 99-minute full benchmark protocol, the film's
`check-hero-data.mjs`, and any render.

## 7. Unfinished work and open threads

Ordered by how much each one matters. Each item was checked against the files,
not inferred.

1. **The private repo is behind the published film.** `master` ships a 2 min
   16 s film with real narration in both languages (the audio tracks are not
   silent) and WebVTT captions, and `docs/index.html` says the captions are
   generated by `private/tools/synth-narration.mjs`. IG-private on GitHub has
   no such file, its `video/src/film/timing.ts` describes a 111 s cut, and its
   `docs/NARRATION.md` "Status" still says "Written, not yet recorded". The
   source of the published film appears to exist only in a local checkout.
2. **The film's data pipeline no longer matches the public repo.** IG-private
   `video/scripts/build-hero-data.mjs` (`readThroughput`) requires the phrase
   `~NM evaluations/s/core` in `README.md`. The README was cut from 256 to 86
   lines on 2026-07-27 and no longer contains it, so the pipeline as pushed
   would stop with an error. CI does not run the film checks at all.
3. **`docs/index.html` has no builder in the tree.** `engine/README.md` notes
   that `tools/build_demo.py` does not exist. Whether the page is meant to be
   hand-maintained or its builder was lost is undecided.
4. **The next research step is decided but not started.** The multi-machine
   extension (a heterogeneous fleet serving LLM inference, `R_m`-style) has a
   recorded benchmark decision in
   [`research/multi-machine-benchmark-decision.md`](research/multi-machine-benchmark-decision.md).
   The engine still refuses multi-machine files at parse time, on purpose.
5. **Film loose ends** (IG-private `docs/WORKLOG.md` and `docs/VIDEO.md`): three
   dead act modules still on disk, a `cut` prop that is accepted and ignored,
   an Act 1 payoff beat that never reaches the screen, and stale frame numbers
   in act headers.
6. **Generators that cannot run in a clone.** `tools/generate_llm_layers.py` and
   `tools/generate_extra_llm_layers.py` hardcode an absolute path from another
   machine; `tools/gen_extra_scenarios.py` registers eight domains, of which
   two exist as CSVs.
7. **Research prototypes with known headroom.** The GPU fleet is below one CPU
   core in throughput (`torch.compile` / CUDA graphs untried). The LLM factory
   result is a registered null, and its strongest model could not finish under
   the 60 s request timeout (`../RESULTS.md`, factory section).
8. **Latent engine divergences for third-party files.** Rust and Python differ
   on the default `END_MAX` and on rounding of two-decimal money values; no
   shipped instance triggers either. IG-private `docs/TDD.md` §5.4.
9. **Two TDDs in the private repo.** `docs/TDD.md` is canonical;
   `docs/TDD-independent-pass.md` is labelled deletable once read.
10. **Kimi's brief filename is unverified** (IG-private `docs/ONBOARDING.md` §2.3).

## 8. Stale documentation and housekeeping

None of these breaks code. All of them mislead a reader.

- [`ARCHITECTURE.md`](ARCHITECTURE.md) was written inside the private tree on
  2026-07-26. It has nine links that only resolve there (`../AGENTS.md`,
  `VIDEO.md`, `DATA-PROVENANCE.md`, `decisions/…`), and it still describes the
  `race-rust-unified` branch, a `video/` debris folder and an empty `private/`
  repository, none of which is true on `master` today.
- `../RESULTS.md:20` puts the brute-force property test in
  `engine/src/solver.rs`; it is `engine/src/eval.rs` (`incremental_matches_bruteforce`).
- Python throughput is quoted three different ways (`../RESULTS.md:10`,
  `algorithm.md:74`, `../README.md`); the README figure is the measured one.
- `../masclib-domains/README.md` documents 6 of the 15 domain CSVs.
- `assets/architecture.svg` says the Studio carries 53 instances; it carries 62.
  `assets/architecture.png` is referenced by nothing.
- `../.github/workflows/import-assets.yml` is a spent one-shot bound to
  `feat/scenario-levels` that still carries expiring signed download URLs.
- Three stale remote branches hold pre-squash history: `backup-pre-squash`,
  `deploy/staging-2026-07-20`, `feat/scenario-levels`. No open pull requests or
  issues exist.
- IG-private `video/README.md` still describes a scaffold with no acts.

## 9. Where to read next

| If you want | Read |
|---|---|
| to run it | [`../README.md`](../README.md) |
| the numbers and how they are verified | [`../RESULTS.md`](../RESULTS.md) |
| the algorithm | [`algorithm.md`](algorithm.md) |
| the build and data flow in detail | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| the rules for working in the tree | IG-private `AGENTS.md` |
| purpose, audiences, risks | IG-private `docs/BRD.md` |
| solver internals | IG-private `docs/TDD.md` |
| the film | IG-private `docs/VIDEO.md`, `docs/NARRATION.md`, `docs/DATA-PROVENANCE.md` |
| why things are the way they are | IG-private `docs/decisions/` |
| who did what, and current claims | IG-private `docs/WORKLOG.md` |
