# The 2026 reading: GPU/LLM inference queues

*A classic Order Acceptance and Scheduling problem, re-instantiated for 2026 infrastructure. Full source surveys: [production systems](research/llm-serving-2026-producao.md) · [academic formulations](research/llm-serving-2026-academia.md) (July 2026).*

## Proposal: GRAS

We propose reading OAS — Order Acceptance and Scheduling — in its modern incarnation as **GRAS: GPU Request Acceptance and Scheduling**. One GPU, several models, a queue of requests with SLOs, and a cloud API as the paid escape valve:

| OAS (1|rⱼ, sᵢⱼ| ΣwT + Σu + Σc) | GRAS |
|---|---|
| machine | the GPU |
| job family | model (load time 0 if already resident) |
| sequence-dependent setup time/cost | **model swap**: 50 ms (hot state transfer) to 100+ s (cold MoE load) — 3–4 orders of magnitude, exactly the regime where setup-aware sequencing pays |
| release / due / tardiness weight | arrival / SLO / penalty per second late (per class) |
| **rejection cost uⱼ** | **route to a cloud API and pay its price** |

Playable instances in this format: [`masclib-gpu/`](../masclib-gpu/) — the whole toolchain (Rust engine, Python rewrite, browser demo) consumes them unchanged.

## How production actually solves this today

**Nobody solves the joint problem.** Production stacks decompose it into four independent heuristic layers:

1. **Router** (setup avoidance, implicit): model/cache-affinity routing — Ray Serve multiplexing routes to replicas that already hold the model; NVIDIA Dynamo scores `KV-overlap × credit − load` with hand-tuned weights; ServerlessLLM picks the server minimizing estimated `queue + size/bandwidth`.
2. **Per-model queue** (sequencing): almost always **FIFO + continuous batching**, sometimes static priority classes. No reordering against setup or deadlines.
3. **Residency policy** (the "setup" decision): **LRU eviction** everywhere — Ray Serve (3 models/replica, LRU), KServe ModelMesh (a "distributed LRU cache" of models), SageMaker MME (LRU unload on memory pressure). Reactive, no lookahead.
4. **Shedding/fallback** (the "rejection" decision): timeout and queue-depth thresholds (Ray's `max_queued_requests` → HTTP 503), not opportunity cost.

Meanwhile, an entire engineering front attacks the *setup itself*: vLLM Sleep Mode (30–100 s reload → sub-second wake), ServerlessLLM's loading-optimized checkpoints (OPT-30B in 7.5 s vs 213 s), Modal's GPU memory snapshots (45 s → 5 s cold start), Alibaba's Aegaeon (97% lower switch cost; 1,192 → 213 GPUs in production). Setup costs are falling but remain wildly heterogeneous — which *raises* the value of deciding their order well.

## How academia formalizes it

Across AlpaServe, MuxServe, SpotServe, ServerlessLLM, dLoRA, Llumnix, Prism, Aegaeon: **enumeration + greedy + cost model/simulator**, with an occasional coarse LP/DP (Shepherd's ILP planner, SLOs-Serve's DP token allocator, SpotServe's Hungarian matching). The closest formulation to GRAS is **QLM** (SoCC 2024): request *groups* assigned to queue positions by a linear program, with model swap as a first-class action amortized per group — request grouping is exactly OAS family batching. But QLM's eviction carries **no price**; like every systems paper, rejection is a *feasibility valve*, not an economic decision.

The literature that *does* price the "send it elsewhere" decision — LLM routing and cascades (FrugalGPT, RouteLLM, local-vs-cloud offloading) — ignores queueing, setups and sequencing entirely.

**The gap, stated plainly:** as of mid-2026 we found no published work applying order-acceptance-and-scheduling or perturbation metaheuristics (IG/ALNS/tabu) to multi-model GPU serving — and a 2026 position paper (*"LLM Serving Needs Mathematical Optimization and Algorithmic Foundations, Not Just Heuristics"*, arXiv 2605.01280) argues the field runs on FIFO/LRU/JSQ defaults precisely for lack of such formulations. The nearest neighbors: QLM (LP, unpriced rejection) and MIG-Serving (GA+MCTS for GPU partitioning, 2021, pre-LLM, no rejection/tardiness).

## Our solver vs. the state of practice — honest comparison

**What the OAS/IG formulation adds that no production layer has:**

- **One objective unifies all four layers**: swap costs + SLO penalties + cloud spend, traded against each other explicitly. LRU never asks "is this swap worth 90 credits of cloud fallback?"; the IG asks nothing else.
- **Priced rejection**: the decision "serve locally late vs. pay the cloud" is exactly the dynamic deadline d̄ⱼ — *past this delay, the cloud is cheaper* — computed per request, per position, per current setup state.
- **Setup-aware sequencing with lookahead**: batching same-model requests emerges from optimization rather than from affinity-routing luck. (Published gains for grouping/reordering elsewhere: QLM +20–400% throughput; BlendServe 1.44×.)
- **Anytime and fast**: the Rust engine evaluates ~20M candidate schedules/s/core; a 120-request window re-optimizes in milliseconds — fast enough to re-solve at every arrival burst.

**What production has that this formulation ignores (the honest limits):**

- **Online arrivals**: OAS is offline; serving is a stream. The practical shape is *rolling-horizon re-solve* (re-run the IG over the current queue every Δt or on every arrival), which this engine is fast enough for — but no regret guarantee comes with that.
- **Continuous batching & preemption**: modern engines interleave requests at token granularity (Orca-style, 36.9× throughput); our "job" is an atomic batch. GRAS operates one level above the engine: it decides *which model is resident and which macro-batch runs next*, not token scheduling inside the batch.
- **Stochastic durations**: inference time is roughly predictable per token budget but not deterministic; a robust/quantile extension would be needed for tight SLOs.
- **Parallelism dimensions** (multi-GPU sharding, MIG partitions, KV transfer) are out of scope — that is placement, the AlpaServe/MuxServe layer.

**Where GRAS is genuinely useful today:** self-hosted fleets juggling several models on scarce GPUs with a cloud fallback (a homelab, a startup's single node, an edge box) — deciding load order, batch grouping and what to offload; batch/overnight inference planning (the BlendServe regime, with a rejection option); admission-policy synthesis and *what-if* simulation ("does a second GPU beat paying the cloud at this traffic?"); and as a benchmark generator ([`masclib-gpu/`](../masclib-gpu/)) connecting the OR community's 20 years of OAS results to a live systems problem.

## Try it

```bash
python tools/gen_gpu_instances.py
cargo run --release --manifest-path engine/Cargo.toml -- solve masclib-gpu/GPU_RUSH_60.csv --seconds 3
# → serves 52/60 locally, routes 8 to the cloud, batches by model to dodge swaps
```

Or pick a `GPU_*` instance in the [live demo](https://alexmarinho.github.io/IG/) and watch the schedule assemble.
