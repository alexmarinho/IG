# GPU/LLM instances — the thesis problem, renamed for 2026

The same optimization problem, wearing today's clothes: **one GPU serving several models**. Every element of the 2015 formulation has an exact modern counterpart:

| OAS / thesis (2015) | GPU inference queue (2026) |
|---|---|
| machine | the GPU |
| job family | **model** (Qwen-7B, Llama-8B, Mistral-24B, Qwen-32B, SDXL…) |
| sequence-dependent setup time | **model load/swap time** (same model already loaded = 0) |
| setup cost | GPU-seconds burned loading instead of serving |
| job | inference request (or micro-batch) |
| release date | request arrival |
| due date + tardiness weight | **SLO** per class (interactive / standard / batch) + penalty per second late |
| rejection cost uⱼ | **route the request to a cloud API** and pay its price |
| mode cost | marginal cost of running locally (energy/wear) |
| initial setup state | cold GPU (nothing loaded) |

Units: time in seconds; money in "credits" (1 credit ≈ $0.0001), so an RTX-3090-class marginal cost is ~0.5 credits/s and a 32B-class cloud request costs 140–420 credits.

Files are standard MaScLib CSV, so **every tool in this repo consumes them unchanged** — the Rust engine, the Python rewrite, and the browser demo (picker group "GPU/LLM"):

```bash
python ../tools/gen_gpu_instances.py               # regenerate (seeded)
cargo run --release --manifest-path ../engine/Cargo.toml -- solve GPU_RUSH_60.csv --seconds 3
```

| Instance | Requests | Scenario |
|---|---|---|
| `GPU_CALM_40` | 40 | low load — the solver serves everything locally, batching same-model requests to dodge swaps |
| `GPU_RUSH_60` | 60 | bursty arrivals — under pressure it starts **rejecting to the cloud** (in a sample run: 8 of 60) |
| `GPU_HEAVY_120` | 120 | long mixed horizon with heavier big-model traffic |

What the solver's decisions *mean* here: batching by family = model-affinity batching; rejection = admission control / cloud fallback; the dynamic deadline d̄ⱼ = "past this delay, paying the cloud beats serving locally". See [`docs/gpu-serving.md`](../docs/gpu-serving.md) for how production systems solve this today and where this formulation fits.
