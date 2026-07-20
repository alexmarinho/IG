# Results: the modern engines vs. the 2015 baselines

This is the delta document: what the modern engine changes relative to the original 2015/2017 implementations (preserved under [`legacy/`](legacy/)), how it is verified, and what it measures. The algorithm, instances and best-known values originate in a 2015 study ([PDF](docs/monografia-2015.pdf)); the interactive comparison keeps the live instructional view separate from the recorded historical benchmark.

## What changed

| | 2015 Excel/VBA · 2017 Python | This repo (Rust `engine/`, Python `python/`) |
|---|---|---|
| Candidate evaluation | full O(n) schedule recomputation per candidate (plus `deepcopy` state in the 2017 Python) | **incremental**: recompute only downstream of the edit, stop at the first absorbing idle gap — an optimization first proposed as future work in the 2015 study |
| Throughput | VBA: enough for n×30 s budgets; 2017 Python: a few hundred evals/s | **~20M evals/s/core (Rust)**, ~150–330k (Python rewrite) — roughly *a second here per two hours of the 2017 code* |
| Weights | fractional tardiness weights handled implicitly (VBA) / incorrectly (2017 Python read 0.8 as float but diverged on the 500-job set) | exact **fixed-point deci-units** (×10), no float drift |
| Objective semantics | undocumented corner cases | recovered and documented: setup cost + mode cost + weighted tardiness (ASAP timing), rejection cost; earliness fields in the data are *not* part of the 2015 objective (tested and refuted); `benchmark.json` carried one transcription typo vs. the published 2015 results (Table 4.1) (`NCOS_32a`: 14720, not 4720 — fixed) |
| API | GUI-driven runs | library (`Instance`/`State`/`Run`) + CLI (`solve`, `validate`) + WASM exports driving the [live demo](https://alexmarinho.github.io/IG/) |
| Acceptance / params | fixed per-run | `--accept current|best`, `--d`, seeds; d=50 auto on 500-job instances (matching the 2015 experimental setup) |

## How it is tested

Three independent layers, all runnable locally and in [CI](.github/workflows/ci.yml):

1. **Property test vs. a brute-force oracle** (`engine/src/solver.rs::tests`) — 500 random insert/replace/remove operations; the incremental evaluator must match a from-scratch evaluation exactly, every step.
2. **Cross-implementation golden tests** (`engine/tests/golden.rs` ↔ `python/test_ig_scheduler.py`) — both engines price identical fixed sequences on real instances of every flavor (no-setup NCOS, timed-setup STC, cost-only-setup STC, synthetic GPU/LLM) and must agree to the deci-unit.
3. **Benchmark validation** (`cargo run --release -- validate masclib benchmark.json`) — the search must reproduce the 2015 best-known values; CI spot-checks one instance to its exact best known, plus a best-known regression test on `NCOS_11`.

```bash
cd engine && cargo test --release                 # layers 1–2
cargo run --release -- validate ../masclib ../benchmark.json --seconds 45 --runs 3   # layer 3
python3 python/test_ig_scheduler.py               # Python mirror
```

## Measured results (45 s × 3 seeds per instance, single core)

**37/44 instances matched or beat the 2015 best-known values.** On the four 500-job instances the engine matched two references and came within 0.04% on the other two. It also **independently rediscovered improvements on `NCOS_31` (9,490) and `STC_NCOS_32` (24,054)**: the same two instances where the 2015 implementation improved on the published literature values, providing strong evidence of semantic equivalence. The two large remaining gaps (`STC_NCOS_51/51a`, the long-standing stagnation cases from 2015) were later **closed exactly** by the adaptive destruction ramp described below.

<details>
<summary>Full per-instance table</summary>

```
instance           n      found   best2015     gap%
NCOS_01            8      800.0        800     0.00 ✓
NCOS_01a           8      800.0        800     0.00 ✓
NCOS_02           10     2570.0       2570     0.00 ✓
NCOS_02a          10     1210.0       1210     0.00 ✓
NCOS_03           10     6460.0       6460     0.00 ✓
NCOS_03a          10     1690.0       1690     0.00 ✓
NCOS_04           10     1011.0       1011     0.00 ✓
NCOS_04a          10     1008.0       1008     0.00 ✓
NCOS_05           15     1500.0       1500     0.00 ✓
NCOS_05a          15     1500.0       1500     0.00 ✓
NCOS_11           20     2022.0       2022     0.00 ✓
NCOS_11a          20     2006.0       2006     0.00 ✓
NCOS_12           24     6844.0       6844     0.00 ✓
NCOS_12a          24     4270.0       4270     0.00 ✓
NCOS_13           24     3912.0       3912     0.00 ✓
NCOS_13a          24     3441.0       3441     0.00 ✓
NCOS_14           25     6990.0       6990     0.00 ✓
NCOS_14a          25     3195.0       3195     0.00 ✓
NCOS_15           30     3052.0       3052     0.00 ✓
NCOS_15a          30     3035.0       3035     0.00 ✓
NCOS_31           75     9490.0       9510    -0.21 ✨ NEW BEST
NCOS_31a          75     8715.0       8715     0.00 ✓
NCOS_32           75    17310.0      17310     0.00 ✓
NCOS_32a          75    14720.0      14720     0.00 ✓
NCOS_41           90    13513.0      13484     0.22
NCOS_41a          90    10551.0      10539     0.11
NCOS_51          200    36170.0      36170     0.00 ✓
NCOS_51a         200    36170.0      36170     0.00 ✓
NCOS_61          500  1269865.0    1269365     0.04
NCOS_61a         500  1485309.0    1485232     0.01
STC_NCOS_01        8      700.0        700     0.00 ✓
STC_NCOS_01a       8      610.0        610     0.00 ✓
STC_NCOS_15       30    17611.0      17611     0.00 ✓
STC_NCOS_15a      30     5584.0       5584     0.00 ✓
STC_NCOS_31       75     6615.0       6615     0.00 ✓
STC_NCOS_31a      75     7590.0       7590     0.00 ✓
STC_NCOS_32       75    24054.0      24068    -0.06 ✨ NEW BEST
STC_NCOS_32a      75    16798.0      16798     0.00 ✓
STC_NCOS_41       90    43201.0      43201     0.00 ✓
STC_NCOS_41a      90    19032.0      18579     2.44
STC_NCOS_51      200   206155.0     139675    47.60
STC_NCOS_51a     200   214540.0     148230    44.73
STC_NCOS_61      500  1495045.0    1495045     0.00 ✓
STC_NCOS_61a     500  1814605.0    1814605     0.00 ✓

matched-or-beat best-known: 37/44 (improved: 2)  mean gap 2.162%
```

</details>

## New best values found by this engine

Beyond the validation run above, dedicated runs have produced values below the published 2015 best-knowns:

| Instance | 2015 best known | Found | Gap | Evidence |
|---|---|---|---|---|
| `NCOS_31` | 9,510 | **9,420** | **−0.95%** | reached by **6/6 seeds** in 10 s each (`ig solve masclib/NCOS_31.csv --seconds 10 --seed <s>`, ~19M evals/s, Apple-silicon single core) — also found at 9,460 by the WASM build in-browser |
| `STC_NCOS_32` | 24,068 | **24,054** | −0.06% | 45 s × 3-seed validation run |

Both are instances where the 2015 results had already improved on the literature — consistent with the engine being a faithful, faster continuation of the same search. Reproduce with the commands above; improvements on any instance are welcome as issues/PRs with the seed and command line.

## Closing the long-standing stagnation cases — adaptive destruction

Varying the destruction size during the run was flagged as future work in the 2015 study. Implemented as a stagnation-driven ramp (`--dmax`): while the best solution stagnates, the destruction size grows from `d` by +1 every 30 stagnant iterations up to `d_max`, snapping back to `d` on improvement (`Run::new_adaptive`; default off — all previously published numbers remain reproducible).

On the two 200-job instances where both the 2015 VBA (~21% mean error) and this engine's fixed-d search (+45–48%) stagnated, the ramp **lands on the exact best-known values**:

| Instance | Best known | Fixed d (60–90 s) | Adaptive (90 s) | Result |
|---|---|---|---|---|
| `STC_NCOS_51` | 139,675 | 206,155 (+47.6%) | `--dmax 160`: **139,675** in 3/3 runs (also at `--dmax 190`) | **exact, gap closed** |
| `STC_NCOS_51a` | 148,230 | 214,540 (+44.7%) | `--dmax 150`: **148,230**; `--dmax 120`: 148,300 (+0.05%) | **exact, gap closed** |

Reading: these instances (many identical jobs) form one enormous attraction basin — escaping it requires destroying **60–80% of the schedule**, far beyond any fixed d. The same experiment also produced the honest negative result: on fine-grained instances (`NCOS_41` family, the 500-job set) aggressive ramps *hurt* within equal time budgets — over-diversification destroys good structure faster than greedy reconstruction recovers it. Adaptive destruction is medicine for coarse multi-basin landscapes, not a universal upgrade; hence off by default.

**Updated scorecard: 39/44 best-knowns matched or beaten** (including two values below the 2015 records); the five remaining gaps are ≤ 0.34% except `STC_NCOS_41a` (2.44%).

## The LLM heuristic factory

[`factory/`](factory/) evolves the IG's **destroy operator** (which d jobs to remove each iteration) — scored by the Python engine on a train split of MaScLib instances, held-out test split for honesty. Two backends: an offline `local` mutation loop (runs in CI, no API key) and a pluggable `llm` loop (an LLM writes free-form Python operators; DeepSeek by default).

**First engineering finding — destruction must sample, not select.** A deterministic top-d destroy (always removing the highest-scored jobs) scored **8.75%** mean gap vs **4.15%** for random destruction — *worse*, because removing the same jobs every iteration kills the diversification IG depends on. Replacing it with a **standardized-softmax biased sampler** (which degrades to exactly random when scores are equal) restored competitiveness and is the operator interface the factory evolves.

**Evolution result — honest, and a cautionary one.** A `local` run (16 population × 12 generations, 120-iteration budget, seed 7) drove the **training** gap from 4.15% down to 1.16%. But evaluated properly — the winning operator re-scored across 5 seeds on both splits — the picture is sober:

| Split | Random destroy | Evolved operator | Δ |
|---|---|---|---|
| train (4 instances) | 3.15% [1.56–4.24] | 2.65% [1.99–4.14] | **+0.50 pp** |
| test (3 held-out) | 3.73% [2.31–4.77] | 4.53% [3.06–5.54] | **−0.81 pp** |

The operator **overfit its training seed**: the dramatic single-seed training drop shrinks to a modest +0.5 pp mean gain, and it *loses* to random on held-out instances. This is exactly the known failure mode of LLM-driven heuristic design flagged in [our survey](docs/gpu-serving.md) — evolved heuristics overfit the training set — reproduced here in miniature. The infrastructure is correct and end-to-end; the *method* at this scale (linear basis, one seed per candidate, four train instances) does not yet generalize.

**Multi-seed scoring (the first fix) — implemented, and the null got stronger.** `score_candidate(..., seeds=...)` now averages each candidate over several IG seeds, removing the single-trajectory exploit. Re-running the same campaign with 3-seed scoring (`--eval-seeds 3`) still produces a winner that looks good on its evolution seeds (3.32% → 1.78%) but **fails fresh held-out seeds (11–15): train −0.18 pp, test −0.98 pp vs. random**. The honest conclusion sharpens: at this scale, with a linear feature basis, evolved destroy operators do not beat uniform random destruction — which matches the classic Iterated Greedy literature, where random destruction is a famously strong default. The open avenues are richer operator programs via the `llm` backend and a larger, more diverse train split; the factory is the harness for both, and the null result is the baseline any future campaign must clear.

**The real-LLM campaign — three models, and the null holds.** The avenue above was then
run. A `--style structural` prompt was added that asks for a *program* (local variables,
`if`/`elif` regimes, ratios, normalisation) instead of the short weighted-sum expression
the original prompt requested, and seeds the population with programs so the few-shot
elites stop anchoring every child to a linear form. Fifteen campaigns were scored:
three models — `deepseek-v4-flash`, `deepseek-v4-pro` and a locally served
`Qwen3.6-35B` — five evolution seeds each, identical budget (`--gens 2 --pop 4
--eval-seeds 3`), winners re-scored on held-out seeds 11–15. The success criterion was
registered before the runs: *median test Δpp > 0*.

| model | median test Δpp | mean | range | beat random |
|---|---|---|---|---|
| `deepseek-v4-pro` | **−1.673** | −1.493 | −2.639 … −0.393 | 0/5 |
| `deepseek-v4-flash` | −1.536 | −1.361 | −2.314 … −0.421 | 0/5 |
| `Qwen3.6-35B` (local) | −0.916 | −0.806 | −1.547 … **+0.184** | 1/5 |
| **all** | **−1.255** | −1.220 | | **1/15** |

**Verdict: null.** Free-form programs do not beat uniform random destruction here, and
model capability does not rescue them — the ranking is *inverse* to capability and price
(the strongest model scored worst, the free local one best), with within-model spread
several times the between-model difference. That is noise, not a model effect: paying for
the larger model bought nothing measurable.

**What the campaign does establish is sharper than the earlier null.** Train and test are
scored on the *same* fresh seeds; only the instance set differs. Across the fifteen
winners the median gain on the training instances is **+0.645 pp (10/15 beat random)**
while on held-out instances it is **−1.255 pp (1/15)**. The evolved operators therefore
survive unseen *seeds* and fail on unseen *instances*: this is instance-level overfitting,
not the lucky-trajectory exploit that multi-seed scoring already removed. Knowing which
generalisation breaks is what a larger campaign has to attack — a wider, more diverse
train split, not a better model or a longer budget.

**Three harness defects surfaced and were fixed, all of which would have corrupted a paid
campaign.** (1) `llm_compile` accepted a reply that compiled but returned `None` — which a
whole-function reply (`def score(f): …`) produces once wrapped — and the sampler's
`except` turned every job score into `0.0`, i.e. *exactly uniform random destruction*
reported as a winning heuristic; five runs returning byte-identical results was the tell.
(2) The 60-second request timeout made `deepseek-v4-pro` unrunnable: every one of its
runs died mid-campaign, so the strongest model could not be evaluated at all. (3) A single
transient timeout aborted the entire campaign, with no retry — over the ~2,000 calls a
serious campaign needs, that is close to certain. The smoke test now requires a finite
number, whole-function replies are unwrapped instead of nested, the timeout is
configurable (`OPENAI_TIMEOUT`, default 300 s) with three attempts, and a generation that
cannot compile enough children gives up instead of spinning forever.

## GPU fleet (RTX 3090)

First hardware results of [`gpu/fleet_torch.py`](gpu/README.md) — thousands of lockstep IG replicas in PyTorch on an RTX 3090 (torch 2.13, CUDA 13):

| Run | Config | Outcome |
|---|---|---|
| correctness | `verify` on NCOS / STC / GPU instances | fleet pricing **matches the CPU engines to the deci-unit** across all constructed replicas |
| `NCOS_31` (n=75) | R=4,096 · 60 s | reached the 2015 best-known **9,510 at ~11 s**; ~5,000 replica-iters/s, GPU at 100% |
| `STC_NCOS_51a` (n=200) | R=2,048 · `--dmax 150` · 128 s | 173,400 — only 12 fleet iterations ran, far too few for the adaptive ramp; the CPU engine with `--dmax 150` remains the right tool here (exact best-known in 90 s) |
| `GPU_HEAVY_120` | R=4,096 · 62 s | 2,555.4 — the CPU record (2,133.5) stands |

**Honest reading:** v1 proves the *correctness* and the *architecture* (the GPU is fully saturated), but is **kernel-launch-overhead-bound**: aggregate throughput is currently below one optimized CPU core (~20M evals/s). This matches our own survey's prediction — GPUs pay off in the arithmetic-bound regime, which v1's Python-level loops don't reach. The known headroom, in order: `torch.compile`/CUDA graphs (collapse the per-step launch overhead), pricing multiple pending jobs per scan, and larger R. The fleet's *current* practical value is diversity (4,096 simultaneous seeds) and as the scoring harness for the LLM heuristic factory; single-instance speed records stay with the Rust engine for now. Contributions welcome — this is the most improvable file in the repo.

## GPU/LLM instance records

The [GPU/LLM instances](masclib-gpu/) had no published values — these are the inaugural records (this engine, 20 s × 3 seeds, `--dmax 12`; costs in credits). Beat one and open a PR with your seed and command line:

| Instance | Record | Seeds agreeing | Note |
|---|---|---|---|
| `GPU_CALM_40` | **378.5** | 3/3 | all 40 requests served locally — likely optimal |
| `GPU_RUSH_60` | **1,077** | best of 3 (1,077–1,083) | burst traffic; several requests routed to the cloud |
| `GPU_HEAVY_120` | **2,133.5** | best of 3 (2,133.5–2,194.7) | widest seed variance — the most open record The [LLM manifests](masclib-llm/) keep the best-knowns of the 44 original MaScLib instances valid under the LLM reading. Bring your own heuristic: entry points in [masclib-llm/README.md](masclib-llm/README.md#test-your-own-heuristics).
