# masclib-llm — the LLM reading of the benchmark

This folder adapts the MaScLib benchmark to the **LLM serving context** — one GPU, several models, SLOs, and a cloud API as the paid escape valve — while changing **none of the numbers**.

## The adaptation, and why it is shaped this way

MaScLib families are anonymous integers, so the honest adaptation is a **semantic layer, not a rewrite**: each instance keeps its combinatorial structure byte-for-byte, and gains a manifest (`<name>.llm.json`) that fixes its interpretation:

| Original element | LLM reading (from the manifest) |
|---|---|
| machine, time units | one GPU, seconds |
| job family | a **model** from a realistic catalog (Qwen-7B, Llama-8B, Mistral-24B, Llama-70B, SDXL, Whisper…) |
| sequence-dependent setup | **model load/swap** — `load_seconds` and/or `swap_cost_credits` per model (some instances price the swap in GPU credits without stalling the queue; others stall it for real) |
| release / processing | request arrival / inference seconds |
| due date + tardiness weight | SLO deadline + penalty per second late, tiered into **interactive / standard / batch** classes |
| rejection cost uⱼ | the **cloud-API price** of that request, in credits (1 credit ≈ $0.0001) |

Because the numbers are untouched, **every published best-known objective value remains valid** for the LLM-read instances — `LLM(STC_NCOS_31)` still has best known 6,615, now meaning "6,615 credits of swaps + SLO penalties + cloud spend". A regenerated benchmark could never offer that continuity.

The 44 `NCOS_*`/`STC_NCOS_*` manifests cover the original MaScLib set (the `NCOS` ones read as a **single resident model** — a pure admission/SLO problem with no swaps). The `GPU_*` manifests cover the [synthetic instances](../masclib-gpu/) generated natively in this context, with bursty arrivals and catalog-derived load times — those are genuinely new instances, with no best-knowns yet: **records are open**.

## Test your own heuristics

Everything consumes the same CSV format, so plugging in a custom heuristic takes minutes:

- **Python** (easiest to hack): [`python/ig_scheduler.py`](../python/) is one dependency-free file — fork `solve()`, or reuse `Instance`/`State` (incremental evaluator included) and write your own loop.
  ```bash
  python python/ig_scheduler.py solve masclib/STC_NCOS_31.csv --seconds 5
  ```
- **Rust** (fast harness, ~20M evaluations/s/core): [`engine/`](../engine/) — implement against `ig_core::{Instance, State, Run}` and validate with
  ```bash
  cargo run --release --manifest-path engine/Cargo.toml -- validate masclib benchmark.json --seconds 45
  ```
- **Browser**: the [live demo](https://alexmarinho.github.io/IG/) runs the same Rust engine compiled to WASM on all of these instances, with per-instance personal records stored locally.

Regenerate the manifests after adding instances: `python tools/llm_manifest.py`. Background on how industry solves this problem today, and where this formulation stands: [`docs/gpu-serving.md`](../docs/gpu-serving.md).
