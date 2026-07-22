# Production Multi-Model GPU Serving: How Ordering/Admission/Model-Swap Is ACTUALLY Done (2024–2026)

**Headline finding (honest):** No production system solves the joint problem (sequence-dependent setup + due dates + rejection) as a single scheduling optimization. Production decomposes it into layers: (a) a **router** that does model/cache-affinity placement (implicit setup avoidance), (b) a **per-model queue** that is almost always FIFO + continuous batching (sometimes static priority classes), (c) an **LRU eviction policy** for which models stay resident (the "setup" decision is reactive, not planned), and (d) **load shedding/fallback** at the gateway (the "rejection" decision, made by timeout/queue-depth thresholds, not by opportunity cost). The closest things to an OAS-style solver are academic: **QLM** (SoCC 2024, explicitly plans model swaps against SLOs), **Niyama/Scorpio/SLOs-Serve** (deadline-aware admission control + shedding), and **MuxServe/ServerlessLLM** (placement optimizing model-switch cost).

---

## 1. Model multiplexing / hot-swapping systems

### Ray Serve model multiplexing
- API: `@serve.multiplexed(max_num_models_per_replica=N)` — each replica holds up to N models (default **3**), evicted by **LRU**; user implements `__del__` for cleanup ([Ray docs](https://docs.ray.io/en/latest/serve/model-multiplexing.html), [RFC #33253](https://github.com/ray-project/ray/issues/33253)).
- Routing = **model affinity**: request carries `serve_multiplexed_model_id` header; if any replica already has that model loaded, traffic routes there, avoiding a load. This is the "batch same-family jobs on the machine already set up" heuristic — but purely greedy/reactive, no lookahead ([Ray docs](https://docs.ray.io/en/latest/serve/model-multiplexing.html)).
- Admission: `max_queued_requests` per deployment → hard cap, excess requests get **HTTP 503** (`BackPressureError`); plus `request_timeout_s` end-to-end timeout ([Ray best practices](https://docs.ray.io/en/latest/serve/production-guide/best-practices.html), [issue #42950 "active load shedding"](https://github.com/ray-project/ray/issues/42950)).

### AWS SageMaker Multi-Model Endpoints (MME) on GPU — Triton-backed
- Thousands of models share GPU instances; models are **dynamically loaded on first invocation** and cached; when memory is full, SageMaker **unloads least-recently-used models** to make room ([AWS blog](https://aws.amazon.com/blogs/machine-learning/run-multiple-deep-learning-models-on-gpu-with-amazon-sagemaker-multi-model-endpoints/), [NVIDIA blog](https://developer.nvidia.com/blog/run-multiple-ai-models-on-same-gpu-with-sagemaker-mme-powered-by-triton/)).
- Routing is load/affinity-based to instances that already have the model; the caller eats the cold-load latency on a miss. No deadline awareness.

### KServe ModelMesh
- Explicitly self-described as a **"distributed LRU cache"** of models across multi-model server pods: capacity auto-filled with registered models, LRU eviction, and **placement balanced by cache age × request load**; hot models get scaled to more pods (second copies) ([ModelMesh README](https://github.com/kserve/modelmesh/blob/main/README.md), [IBM blog](https://www.ibm.com/opensource/blogs/kserve-and-watson-modelmesh-extreme-scale-model-inferencing-for-trusted-ai/), [KServe docs](https://kserve.github.io/website/docs/admin-guide/modelmesh)).
- This is the most mature production "family scheduling" layer — but the policy is still LRU + load heuristics, not optimization.

### NVIDIA Triton (engine level)
- Three model-control modes: NONE / **EXPLICIT** (load/unload via HTTP/gRPC API) / POLL. Explicit mode is the hot-swap primitive used by MME and custom stacks ([Triton model management docs](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_management.html)).
- Queue policy per model (see §2).

### vLLM: multi-model status + Sleep Mode
- **vLLM serves one model per engine instance** — multi-model is delegated to orchestrators (Ray Serve LLM, vLLM production-stack, llm-d). Its native answer to model swapping is **Sleep Mode** (blog Oct 2025): Level 1 offloads weights to CPU RAM; Level 2 discards weights (reload from disk on wake) but keeps process/allocator/CUDA graphs/JIT kernels alive. Wake times **0.26 s (Qwen 0.6B L1) – ~0.85 s (L2)**, ~0.8 s Phi-3-vision L1; **18–200× faster than cold reload**, works from 0.6B to 235B; endpoints `/sleep`, `/wake_up` ([vLLM blog](https://vllm-project.github.io/2025/10/26/sleep-mode.html), [production-stack sleep/wake docs](https://docs.vllm.ai/projects/production-stack/en/latest/use_cases/sleep-wakeup-mode.html)).
- Mapping note: Sleep Mode makes the "setup time" σ asymmetric and state-dependent (first load expensive, subsequent switches ~1 s) — exactly a sequence-dependent setup structure.

### ServerlessLLM (OSDI 2024 — academic but deployed as OSS)
- Three parts: (1) **loading-optimized checkpoint format** + multi-tier loader (NVMe→DRAM→GPU, direct I/O, pinned memory, chunked parallel loads) that saturates storage (≈12 GB/s on NVMe RAID0; 6–8.2× vs PyTorch, 3.6–4.7× vs safetensors; **OPT-30B onto 4 GPUs in 7.5 s vs 213 s for Ray Serve**); (2) **live migration of in-flight inference** by shipping tokens (10–100 KB) and recomputing KV on the destination, so a hot GPU can be freed for a model whose checkpoint is local; (3) **startup-time-optimized scheduler**: estimates per-server start latency as queue + model_size/bandwidth vs migration cost a·(tokens)+b and picks the min — i.e., **locality-aware placement minimizing setup**, the closest production-grade analog to setup-cost-aware machine assignment ([USENIX page](https://www.usenix.org/conference/osdi24/presentation/fu), [arXiv 2401.14351](https://arxiv.org/html/2401.14351v2)).

### NVIDIA Dynamo
- Datacenter-scale layer above vLLM/SGLang/TensorRT-LLM: **KV-cache-aware routing**, prefill/decode disaggregation, memory tiering, and an **SLO "Planner"** that shifts GPUs between prefill/decode pools based on demand ([NVIDIA blog](https://developer.nvidia.com/blog/introducing-nvidia-dynamo-a-low-latency-distributed-inference-framework-for-scaling-reasoning-ai-models/), [disaggregated serving docs](https://docs.nvidia.com/dynamo/user-guides/disaggregated-serving)).
- Router cost function is explicit and tunable: score = overlap (cached blocks × `kv-overlap-score-credit`) vs load (active decode blocks + `prefill-load-scale`·prompt tokens), optional softmax `temperature` for stochastic routing; KV state propagated via events (NATS/ZMQ) or approximated from the router's own decisions with TTL expiry; degrades to pure load balancing with no cache signal ([router guide](https://docs.nvidia.com/dynamo/latest/user-guides/kv-cache-aware-routing)). This is a **weighted setup-avoidance vs load-balance tradeoff, hand-tuned**, not solved.

### Serverless platforms (cold start = setup time economics)
- **Modal**: CPU+**GPU memory snapshots** — boot new replicas from an in-memory snapshot taken post-init; 2–10× typical speedup; **vLLM + Qwen2.5-0.5B: 45 s → 5 s**; ViT 8.5 s → 2.25 s; keep-warm = min replicas + `@modal.enter(snap=True)` lifecycle hooks; explicitly combines vLLM sleep mode with snapshots ([GPU snapshot blog](https://modal.com/blog/gpu-mem-snapshots), [cold-start guide](https://modal.com/docs/guide/cold-start), [example](https://modal.com/docs/examples/gpu_snapshot)).
- **Baseten**: **Baseten Delivery Network** = multi-tier weight cache (own blob store → in-cluster cache → node cache), parallel byte-range downloads; "cold start for large models to a few seconds"; keep-warm via `min_replica≥1` or a **wake endpoint** on scale-to-zero deployments ([BDN blog](https://www.baseten.co/blog/how-the-baseten-delivery-network-bdn-makes-cold-starts-fast/), [cold-starts docs](https://docs.baseten.co/performance/cold-starts)).
- **Replicate**: historical cold boots of minutes for big models; fine-tuned models (adapter-style) now **boot <1 s** by keeping base weights hot and hot-swapping the fine-tune ([Replicate blog](https://replicate.com/blog/fine-tune-cold-boots), [how it works](https://replicate.com/docs/how-does-replicate-work)).
- **Hugging Face Inference Endpoints**: scale-to-zero after **15 min idle**; on cold start clients get **HTTP 502** unless they send `X-Scale-Up-Timeout: <secs>` to have the proxy hold the request; scale-up trigger = 80% GPU util over 1-min window ([HF autoscaling docs](https://huggingface.co/docs/inference-endpoints/en/guides/autoscaling)).

---

## 2. What policy actually orders the queue

| System | Queue order | Reorders for setup avoidance? | Admission/shedding |
|---|---|---|---|
| vLLM (in-engine) | **FCFS default**; optional `--scheduling-policy priority` = heap on (priority, arrival_time); continuous batching; preemption = recompute/swap of lowest-priority/newest | No (single model per engine) | No native rejection; requests queue unboundedly (gateway's job) |
| SGLang (in-engine) | **`lpm` (longest-prefix-match) default** — waiting queue is *sorted by radix-cache prefix hit length*, i.e., genuine reordering to avoid "setup" (KV recompute); also fcfs, dfs-weight, random | **Yes** — the only mainstream engine that reorders the queue for cache affinity ([hyperparameter docs](https://github.com/sgl-project/sglang/blob/main/docs/backend/hyperparameter_tuning.md), [DeepWiki scheduling](https://deepwiki.com/sgl-project/sglang/3.3-scheduling-policies-and-batch-formation)) | No native |
| SGLang router (fleet) | Cache-aware balancing: approximate radix tree per worker, route to highest predicted hit rate unless imbalanced; **1.9× throughput, 3.8× hit rate** vs round-robin ([SGLang v0.4 blog](https://www.lmsys.org/blog/2024-12-04-sglang-v0-4/)) | Yes (placement-level) | — |
| Triton dynamic batcher | Per-model FIFO with **`priority_levels`** (strict: all P1 before P2…); per-priority `ModelQueuePolicy` | Batches are inherently per-model (per-family) | **Yes**: `default_timeout_microseconds` + `timeout_action` (default **REJECT**) and max queue size → closest production thing to "reject if it will be tardy" ([batcher docs](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/batcher.html)) |
| Ray Serve | FIFO per deployment handle; affinity routing by multiplexed model ID | Yes (routing-level, greedy) | **Yes**: `max_queued_requests` → 503 ([docs](https://docs.ray.io/en/latest/serve/production-guide/best-practices.html)) |
| Dynamo | Router cost = α·cache-overlap − β·load with temperature; FIFO within worker | Yes (KV/model affinity weight is an explicit knob) | SLO planner scales resources rather than rejecting |
| LiteLLM / gateways | simple-shuffle default; latency-, cost-based routing; deployment `order` priority tiers | No | **Yes — this is where "reject = route elsewhere" lives**: `fallbacks` across model groups/providers on 429/500/timeout, context-window fallbacks, cooldowns ([LiteLLM routing](https://docs.litellm.ai/docs/routing), [reliability](https://docs.litellm.ai/docs/proxy/reliability)) |

**vLLM details**: two policies only — FCFS and priority; priority preempts by evicting the request with the worst (priority, arrival) tuple; preemption modes recompute-or-swap KV ([RFC #6077](https://github.com/vllm-project/vllm/issues/6077), [DeepWiki request scheduling](https://deepwiki.com/vllm-project/vllm/2.5-request-scheduling)).

**Kubernetes-native (2025, GA)**: [Gateway API Inference Extension](https://kubernetes.io/blog/2025/06/05/introducing-gateway-api-inference-extension/) standardizes "endpoint picker" routing with criticality classes and **flow control/saturation shedding of low-priority ("sheddable") traffic**; [llm-d](https://developers.redhat.com/articles/2025/10/07/master-kv-cache-aware-routing-llm-d-efficient-ai-inference) (IBM/Google/Red Hat) implements prefix-hash → replica KV-cache-aware picking; [AIBrix](https://arxiv.org/html/2504.03648v1) (ByteDance/vLLM control plane) similar.

**Academic admission control (2025) — nearest to OAS rejection semantics:**
- **QLM** (SoCC 2024): multi-model queue management; global scheduler assigns **request groups** to virtual queues and plans **model swaps** (swap weights, flush KV) as an explicit scheduling action against SLOs, using a stochastic programming formulation; +40–90% SLO attainment, +20–400% throughput ([paper](https://dl.acm.org/doi/10.1145/3698038.3698523), [arXiv](https://arxiv.org/pdf/2407.00047), [IBM blog](https://research.ibm.com/blog/qlm-chiron-llm-orchestration)). **This is the closest published analog to your OAS mapping** (multi-model + swap cost + SLOs + eviction).
- **Niyama** (Microsoft, 2025): QoS classes with deadlines; hybrid SJF↔EDF scheduling; **"eagerly relegating" requests predicted to miss deadlines** to degrade gracefully — i.e., early rejection by predicted tardiness ([paper](https://arxiv.org/html/2503.22562v1)).
- **Scorpio** (2025): TTFT Guard = least-deadline-first reordering + **reject unattainable requests**; TPOT Guard = admission control via batch feasibility ([paper](https://arxiv.org/html/2505.23022)).
- **SLOs-Serve** (2025): dynamic-programming token allocation + **soft admission control with fallback handling of declined requests** ([paper](https://arxiv.org/pdf/2504.08784)).
- **MuxServe** (ICML 2024): serves multiple LLMs on shared GPUs via **enumeration-based greedy placement** (colocate by popularity) + adaptive batching; 1.8× throughput / 2.9× SLO vs partitioning ([arXiv 2404.02015](https://arxiv.org/abs/2404.02015), [blog](https://hao-ai-lab.github.io/blogs/muxserve/)).

---

## 3. LoRA serving (cheap "setup" within a family)

- **vLLM multi-LoRA**: adapters selected per-request; tiered cache — `--max-loras` on GPU, `--max-cpu-loras` in RAM (LRU), disk below; per-request adapter swap is sub-millisecond once cached; compute overhead ~3% (rank 16)–7% (rank 64); dynamic load/unload via REST since v0.6.2 ([vLLM LoRA docs](https://docs.vllm.ai/en/latest/features/lora/), [Anyscale multi-LoRA guide](https://docs.anyscale.com/llm/serving/multi-lora)). Disk→CPU is the slow hop; CPU→GPU is fast.
- **S-LoRA** (MLSys 2024): thousands of concurrent adapters; all adapters in host RAM, active ones paged to GPU via **Unified Paging** (one pool for KV cache + adapter weights); custom CUDA kernels batch **heterogeneous adapters in one batch** — i.e., it *eliminates* the setup-batching constraint rather than scheduling around it; 4×+ throughput vs vLLM's earlier LoRA path ([arXiv 2311.03285](https://arxiv.org/abs/2311.03285), [LMSYS blog](https://www.lmsys.org/blog/2023-11-15-slora/)).
- **dLoRA** (OSDI 2024): key insight = merged (zero-overhead, single-adapter) vs unmerged (batchable, multi-adapter) execution is a scheduling decision; **credit-based batching algorithm** decides merge/unmerge; **request-adapter co-migration** rebalances replicas ([USENIX](https://www.usenix.org/conference/osdi24/presentation/wu-bingyang)). Direct analog to "is the setup worth amortizing for this run of same-family jobs."
- Mapping note: LoRA = near-zero sequence-dependent setup within a base-model family; the big setup only exists between base models. Production therefore collapses families where possible (Replicate's <1 s fine-tune boots are exactly this: [blog](https://replicate.com/blog/fine-tune-cold-boots)).

---

## 4. Model load times today and the tricks

Typical numbers (checkpoint → GPU-ready):

| Path | 7–8B class | 70B class | Source |
|---|---|---|---|
| Naive HF transformers / PyTorch | tens of s | **~600 s** (HF), 84 s (PyTorch loader) | [Anyscale](https://www.anyscale.com/blog/loading-llama-2-70b-20x-faster-with-anyscale-endpoints), [ServerlessLLM](https://arxiv.org/html/2401.14351v2) |
| safetensors on local NVMe | ~47 s (15 GB Llama-3-8B) | ~150 s | [NVIDIA Run:ai streamer blog](https://developer.nvidia.com/blog/reducing-cold-start-latency-for-llm-inference-with-nvidia-runai-model-streamer/), [fastsafetensors](https://www.alphaxiv.org/overview/2505.23072v1) |
| Run:ai Model Streamer (concurrent read + overlap H2D) | **4.9 s from S3 / 7.5 s from SSD** (weights only); vLLM total-ready ~23–35 s | — | [NVIDIA blog](https://developer.nvidia.com/blog/reducing-cold-start-latency-for-llm-inference-with-nvidia-runai-model-streamer/) |
| fastsafetensors (GDS, GPU-direct) | — | **<30 s**, 26.4 GB/s NVMe on 4 GPUs | [paper](https://www.alphaxiv.org/overview/2505.23072v1), [vLLM integration](https://docs.vllm.ai/en/v0.8.5/models/extensions/fastsafetensor.html) |
| Anyscale streaming S3→GPU (250 threads) | — | **~6 s** (vs 127 s vLLM-from-S3) | [Anyscale blog](https://www.anyscale.com/blog/loading-llama-2-70b-20x-faster-with-anyscale-endpoints) |
| ServerlessLLM multi-tier loader | OPT-6.7B ~0.8 s | OPT-30B/4 GPUs 7.5 s; ~12 GB/s NVMe RAID0 | [OSDI'24](https://www.usenix.org/conference/osdi24/presentation/fu) |
| vLLM Sleep Mode switch (already-initialized engine) | **0.26–0.85 s** | 235B: seconds | [vLLM blog](https://vllm-project.github.io/2025/10/26/sleep-mode.html) |
| Modal GPU snapshot restore | vLLM 0.5B: 45→**5 s** | 70B FP16 snapshot ≈140 GB → ~40 s @3.5 GB/s | [Modal blog](https://modal.com/blog/gpu-mem-snapshots), [Spheron overview](https://www.spheron.network/blog/gpu-cold-start-llm-inference-2026/) |

Tricks, ranked by adoption: (1) safetensors + **parallel/streaming readers overlapping storage→CPU→GPU** (Run:ai streamer now in vLLM, `--load-format runai_streamer`); (2) **weight caching tiers** (node/cluster/CDN — Baseten BDN, SageMaker, Modal volumes); (3) **GPU-direct storage** (fastsafetensors/GDS); (4) **CPU RAM pooling of weights** (vLLM sleep L1, ServerlessLLM DRAM tier, S-LoRA host-RAM adapters); (5) **process/memory snapshots** (Modal GPU snapshots); (6) **engine-state preservation** (sleep mode keeping allocator + CUDA graphs — most of "setup" is not the weights).

---

## Key deltas vs the OAS formulation (for the comparison doc)

1. **Nobody optimizes the sequence.** Production setup-avoidance is greedy affinity routing (Ray/ModelMesh/Dynamo/SGLang-router) + LRU eviction; only QLM and MuxServe *plan* swaps/placement, and only SGLang's in-engine `lpm` actually reorders a queue for cache affinity.
2. **Rejection exists but is threshold-triggered, not value-based**: Triton queue REJECT-on-timeout, Ray 503 on queue cap, GIE sheddable-class dropping, LiteLLM/OpenRouter-style fallback-to-another-provider. Niyama/Scorpio's predicted-tardiness rejection (2025 papers) is the frontier; none weigh a per-job rejection *cost* like OAS.
3. **Setup times collapsed by engineering, not scheduling**: the 2024–2026 trend attacks σ itself (0.3–8 s swaps via sleep mode/streamers/snapshots) rather than sequencing around it — which shrinks but does not eliminate the sequencing gain, since engine re-init, CUDA graph capture and KV flush remain per-switch costs and switch frequency still costs throughput.
4. **Due dates are per-token SLOs (TTFT/TPOT), not job completion times** — tardiness is on the stream, which is why continuous batching + preemption replaced job-level sequencing.