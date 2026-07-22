# Academic landscape (2023–2026): scheduling formulations for multi-model GPU serving & admission control

Raw data for comparison document. Organized per the 4 questions. All claims sourced; where a paper's formulation is unverified from primary text, it is flagged.

---

## 1. Multi-model placement / serving papers: formalization + algorithm

| System (venue) | Optimization problem formalized | Solving algorithm |
|---|---|---|
| **AlpaServe** (OSDI'23) | Joint model placement + parallelism-degree selection across a GPU cluster to maximize SLO attainment under bursty arrivals (statistical multiplexing vs. model-parallelism overhead trade-off) | Enumeration over GPU-group partitions + **simulator-guided greedy model placement** (no ILP; a discrete-event simulator scores candidate placements) |
| **MuxServe** (ICML'24) | Colocation of multiple LLMs on shared GPUs (spatial-temporal multiplexing), maximize throughput subject to fairness; placement + SM-partitioning via CUDA MPS | **Enumeration-based greedy placement** (prioritize high-arrival-rate models onto mesh with most free memory) + adaptive batch scheduler |
| **SpotServe** (ASPLOS'24) | Serving on preemptible spot instances: dynamic re-parallelization when instances appear/vanish; instance migration cost minimization | Parallelization-config optimizer + migration formulated as **bipartite graph matching solved with Kuhn–Munkres (Hungarian)**; stateful inference recovery for grace periods |
| **ServerlessLLM** (OSDI'24) | Startup-time-optimized model scheduling: which server should load/run a cold model given checkpoint locality across multi-tier storage (DRAM/SSD/network) | **Cost-model greedy**: estimated load time `q + n/b` and migration time per server; pick min-estimated-startup server; live migration migrates tokens (recompute KV) — DP used for migration-time minimization. No global optimization |
| **dLoRA** (OSDI'24) | LoRA multi-adapter serving: when to merge/unmerge adapters with base model; when to co-migrate requests+adapters across replicas (load balance vs. adapter locality) | **Credit-based batching algorithm** (merge/unmerge decision) + **request-adapter co-migration algorithm** (periodic; exact formulation not confirmed from primary text — do not cite as ILP without checking the paper PDF) |
| **QLM** (SoCC'24) | **Closest to your OAS mapping.** Multi-model queue management: assign *request groups* to virtual queues/positions on heterogeneous devices to satisfy SLOs; actions = model swap, request eviction, GPU-CPU state swap, load balance, warm start | Request Waiting Time estimator (Bayesian) + **linear program**: binary `x_{g,i,j}` (group i → position j in queue g), minimize Σ penalty where penalty = waiting time − SLO. Model swapping is amortized by construction: swap once per request group, not per request |
| **Llumnix** (OSDI'24) | Cross-instance request rescheduling (dispatch + live KV-cache migration) for load balance, de-fragmentation, priority isolation — "OS context switching" analogy | Heuristic dynamic scheduling policy over a **near-zero-overhead KV migration mechanism**; no formal optimization program |
| **Shepherd** (NSDI'23, pre-LLM DNN serving) | Two-level: offline planner aggregates request streams into serving groups (provisioning), online scheduler orders/batches/preempts | Planner = **ILP** (maximize minimum burst tolerance across streams); online = **preemptive greedy with proven goodput guarantee**, exploits linear latency-vs-batch-size model |
| **SLOs-Serve** (arXiv 2025) | Multi-SLO token allocation: per-stage/per-application SLOs; chunked prefill + optional speculative decoding as decision variables | **Dynamic programming** over token allocations per batch, plus request routing across replicas and **admission control (rejection)** under burst |
| **BlendServe** (arXiv 2024 / ASPLOS'26) | Offline (relaxed-deadline) batch inference: reorder requests to overlap compute-bound and memory-bound demands while preserving prefix sharing | **Resource-aware prefix tree** + reordering heuristic (greedy tree construction/sorting); 1.44× over vLLM/SGLang |
| **Prism** (arXiv 2025) | Multi-LLM serving on shared GPUs with cross-model memory coordination (time- and space-sharing) for cost + SLO attainment | On-demand VA→PA page remapping ("memory ballooning") + **two-level heuristic scheduling policy** that switches sharing strategy by runtime demand; >2× cost savings, 3.3× SLO attainment |
| **Aegaeon** (SOSP'25, Alibaba/PKU, production) | GPU pooling for concurrent serving of many models on the inference *market*; auto-scaling decisions at **token granularity** | Token-level preemptive scheduling + auto-scaling policy; engineering to cut switch cost 97% (component reuse, explicit memory mgmt, fine-grained KV sync). Production: 1,192→213 GPUs (−82%) serving dozens of models; up to 7 models/GPU, 1.5–9× goodput |
| **MIG-Serving** (arXiv 2021, ByteDance) | **Explicit scheduling-theory framing**: serving DNNs on NVIDIA MIG partitions defined as the "Reconfigurable Machine Scheduling Problem" (NP-hard) | **Greedy heuristics + Genetic Algorithm + Monte Carlo Tree Search** pipeline on Kubernetes; saves up to 40% GPUs |
| **TORTA** (arXiv 2025) | Temporal-aware GPU allocation for distributed LLM inference; explicitly criticizes single-time-slot (myopic) schedulers for ignoring temporal dependencies → excessive migration/switching | **RL + optimal transport** (macro, inter-region) + local allocator minimizing latency and switching cost (micro) |

Sources: [AlpaServe arXiv](https://arxiv.org/abs/2302.11665), [AlpaServe OSDI PDF](https://www.usenix.org/system/files/osdi23-li-zhuohan.pdf), [MuxServe arXiv](https://arxiv.org/abs/2404.02015), [MuxServe ICML](https://proceedings.mlr.press/v235/duan24a.html), [SpotServe arXiv](https://arxiv.org/abs/2311.15566), [SpotServe ACM](https://dl.acm.org/doi/10.1145/3620665.3640411), [ServerlessLLM arXiv](https://arxiv.org/abs/2401.14351), [ServerlessLLM OSDI](https://www.usenix.org/conference/osdi24/presentation/fu), [dLoRA OSDI](https://www.usenix.org/conference/osdi24/presentation/wu-bingyang), [QLM SoCC](https://dl.acm.org/doi/10.1145/3698038.3698523), [QLM arXiv](https://arxiv.org/abs/2407.00047v1), [Llumnix OSDI PDF](https://www.usenix.org/system/files/osdi24-sun-biao.pdf), [Shepherd NSDI](https://www.usenix.org/conference/nsdi23/presentation/zhang-hong), [SLOs-Serve arXiv](https://arxiv.org/abs/2504.08784), [BlendServe arXiv](https://arxiv.org/abs/2411.16102), [Prism arXiv](https://arxiv.org/abs/2505.04021), [Aegaeon ACM SOSP](https://dl.acm.org/doi/10.1145/3731569.3764815), [Aegaeon production numbers — Tom's Hardware](https://www.tomshardware.com/tech-industry/semiconductors/alibaba-says-new-pooling-system-cut-nvidia-gpu-use-by-82-percent), [Alibaba Cloud blog](https://www.alibabacloud.com/blog/602623), [MIG-Serving arXiv](https://arxiv.org/pdf/2109.11067), [TORTA arXiv](https://arxiv.org/abs/2507.10259).

**Pattern worth stating in the doc:** every systems paper solves its placement/sequencing problem with *enumeration + greedy + simulator/cost-model*, occasionally one LP/ILP/DP at a coarse level (Shepherd planner, QLM group-to-queue LP, SLOs-Serve DP, SpotServe Hungarian). Nobody runs a local-search/perturbation metaheuristic in the loop.

---

## 2. Admission control / rejection as a first-class decision

- **SCORPIO** (arXiv 2025): most explicit rejection machinery. TTFT Guard = least-deadline-first reordering + **reject requests whose TTFT SLO is unattainable**; TPOT Guard = admission control via "Value-Based Scheduling" batch-size cap + credit-based batching. Rejection is feasibility-driven — no monetary rejection cost in the objective. [arXiv](https://arxiv.org/abs/2505.23022)
- **SLOs-Serve** (arXiv 2025): admission control rejects incoming requests when DP planner can't fit them without violating running requests' SLOs. Again feasibility valve, not priced. [arXiv](https://arxiv.org/abs/2504.08784)
- **QLM** (SoCC'24): request **eviction** is one of five LSOs, but the LP objective assigns **no explicit cost to eviction/rejection** — scheduler either finds a feasible assignment or fails. [arXiv](https://arxiv.org/html/2407.00047v2)
- **Niyama** (arXiv 2025, Microsoft): overload handling via **"eager relegation"** — graceful degradation of low-QoS requests (deadline-slack-aware dynamic chunking + hybrid prioritization); meets targets for >95% of requests at 50% overload. Degradation, not priced rejection. [arXiv](https://arxiv.org/html/2503.22562v1), [MSR PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2025/04/niyama.pdf)
- **Shepherd** (NSDI'23): preemption (implicit dropping of started work) with a competitive-ratio goodput guarantee — closest to theory-grounded admission, but no per-request rejection cost.
- **Rejection-with-cost actually exists in a different literature — routing/cascades**, which is the exact analog of "reject = route to cloud API at a cost":
  - **FrugalGPT** (arXiv 2023/TMLR'24): LLM cascade — router + answer scorer + stop judge; learned thresholds decide whether to escalate to a more expensive API under a **budget**; matches GPT-4 at up to 98% cost reduction. [arXiv](https://arxiv.org/abs/2305.05176)
  - **RouteLLM** (ICLR'25): binary strong/weak routing trained on preference data; minimize cost s.t. quality target (e.g., 90% of strong model); >2× cost cut. [arXiv](https://arxiv.org/abs/2406.18665), [OpenReview](https://openreview.net/forum?id=8sSqNntaMr)
  - **Local-cloud offloading** (arXiv 2025): explicit reward/cost trade-off for local-vs-cloud LLM inference decisions. [arXiv](https://arxiv.org/html/2502.11007v3); survey of edge-SLM/cloud-LLM collaboration: [arXiv](https://arxiv.org/abs/2507.16731); routing/cascading survey: [arXiv](https://arxiv.org/pdf/2603.04445)
  - **Online LP for multi-objective routing in LLM serving** (arXiv 2026) — routing as online linear programming. [arXiv PDF](https://arxiv.org/pdf/2607.03948)

**Honest gap for the doc:** systems papers treat rejection as a *feasibility valve* (binary, unpriced); routing papers price the "send elsewhere" decision but ignore queueing, setup/swap costs, and sequencing. **No 2023–2026 paper found that unifies them the way OAS does** — rejection cost + sequence-dependent setup + weighted tardiness in one objective. That is precisely the OAS formulation's differentiator.

---

## 3. OR metaheuristics / OAS literature applied to LLM-GPU serving: essentially a NULL result

Explicit searches for "order acceptance and scheduling" + inference/GPU, "iterated greedy" + LLM serving, "sequence-dependent setup" + model loading, tabu/ALNS + inference serving returned **no direct hits**. What exists at the boundary:

- **MIG-Serving** (arXiv 2021) is the only found paper that (a) names a classical-scheduling problem class ("reconfigurable machine scheduling") and (b) uses real metaheuristics (**GA + MCTS + greedy**) for GPU serving — but for MIG partitioning, pre-LLM, no rejection, no tardiness. [arXiv](https://arxiv.org/pdf/2109.11067)
- **Position paper (arXiv 2026): "LLM Serving Needs Mathematical Optimization and Algorithmic Foundations, Not Just Heuristics"** (Zijie Zhou) — argues the field runs on FIFO/round-robin/JSQ/LRU defaults and needs OR-style models with provable guarantees. Direct evidence the gap is recognized inside the community. [arXiv](https://arxiv.org/pdf/2605.01280)
- The theory strand that does exist is **queueing/online-algorithms, not metaheuristics**: fluid-guided online scheduling with memory constraints ([arXiv 2504.11320](https://arxiv.org/html/2504.11320)), throughput-optimal scheduling for LLM inference/agents ([arXiv 2504.07347](https://arxiv.org/html/2504.07347v1)), geometry-aware online scheduling ([arXiv PDF 2606.22327](https://arxiv.org/pdf/2606.22327)).
- **RL replaces metaheuristics** where search would be used: TORTA (RL + optimal transport, explicitly models switching costs and temporal dependencies — the closest conceptual cousin to sequence-dependent setup) [arXiv](https://arxiv.org/abs/2507.10259); Splitwise-style Lyapunov-assisted DRL edge-cloud offloading [arXiv PDF](https://arxiv.org/pdf/2512.23310).
- Tardiness objectives appear only in **GPU training-job scheduling** (e.g., Hydra: dynamic tardiness penalty on Alibaba traces, −85.8% total tardiness) and in ML-assisted solvers for classical single-machine total tardiness (the reverse direction: DL to solve SMTTP, [arXiv 2402.14847](https://arxiv.org/abs/2402.14847)) — not in inference serving. Survey context: [Deep Learning Workload Scheduling in GPU Datacenters: A Survey](https://tianweiz07.github.io/Papers/24-csur.pdf), [Electronics survey 2025](https://doi.org/10.3390/electronics14051048).

**Conclusion for the doc:** mapping OAS (single machine, rejection, sequence-dependent family setups, weighted tardiness, iterated greedy) onto multi-model GPU serving appears to be **unoccupied territory** as of mid-2026. The nearest neighbors are QLM (request groups ≈ family batching, LP, but unpriced rejection and coarse) and MIG-Serving (metaheuristics, but no rejection/tardiness/setup-sequence).

---

## 4. Reported model-switch overheads and same-model batching gains

**Switch/load overheads (the "setup time" quantities):**

| Source | Number |
|---|---|
| ServerlessLLM (OSDI'24) | Baseline PyTorch load: OPT-30B → **34 s** (4 GPUs); LLaMA-2-70B → **84 s** (8 GPUs); downloading 130 GB 70B ckpt ≥ 26 s at 5 GB/s. Their loader: 6–8.2× faster than PyTorch, 3.6–4.7× vs safetensors; full-system startup OPT-6.7B **0.8 s** vs Ray Serve 12.1 s. [arXiv HTML](https://arxiv.org/html/2401.14351v2) |
| SwapServeLLM (SC'25 wksp) | vLLM cold start **1 m 41 s – 2 m 53 s** (1B–14B); engine-agnostic hot-swap gets swap-in to **0.75 s (1B) – 4.6 s (14B)**. [PDF](https://www.dpss.inesc-id.pt/~rbruno/papers/rstoyanov-canoppie25.pdf), [ACM](https://dl.acm.org/doi/10.1145/3731599.3767354) |
| OServe (arXiv 2026) | Naive model reload **>50 s** (≈+17% avg latency); ad-hoc switching cuts it to **~10 s**. [arXiv PDF](https://arxiv.org/pdf/2602.12151) |
| C2CServe (arXiv 2026) | Dense-model switch: ServerlessLLM 1.7 s, Aegaeon 119 ms, C2C 50 ms; MoE switch: ServerlessLLM 12 s, MoE-Infinity 105 s, FineMoE 128 s → 318 ms. [arXiv PDF](https://arxiv.org/pdf/2605.19481) |
| QLM (SoCC'24) | Model swap time **exceeds the 20 s interactive SLO** → policy: never swap for interactive queues; request-grouping exists precisely to pay the swap **once per group** instead of per request. [arXiv HTML](https://arxiv.org/html/2407.00047v2) |
| vLLM Sleep Mode (2025, industrial) | Reload penalty 30–100 s → sub-second switches (18–200×). [vLLM blog](https://vllm.ai/blog/2025-10-26-sleep-mode) |
| Aegaeon (SOSP'25) | Auto-scaling (switch) overhead cut **97%** via component reuse + explicit memory mgmt + fine-grained KV sync — switching cost is the central enemy the whole system is built around. [ACM](https://dl.acm.org/doi/10.1145/3731569.3764815) |

**Gains from multiplexing / grouping same-model work (the "why family batching pays" quantities):**

- Orca (OSDI'22): iteration-level continuous batching → **36.9×** throughput vs FasterTransformer at same latency (GPT-3 175B). [USENIX](https://www.usenix.org/conference/osdi22/presentation/yu)
- AlpaServe: multiplexed placement handles **10× higher rates / 6× more burstiness** within SLO. [arXiv](https://arxiv.org/abs/2302.11665)
- MuxServe: up to **1.8×** throughput vs spatial/temporal-only sharing. [arXiv](https://arxiv.org/abs/2404.02015)
- BlendServe: **1.44×** vs vLLM/SGLang via reordering (relaxed deadlines = the offline analog of your tardiness slack). [arXiv](https://arxiv.org/abs/2411.16102)
- QLM: grouping + swap amortization → **+20–400%** throughput, +40–90% SLO attainment. [ACM](https://dl.acm.org/doi/10.1145/3698038.3698523)
- Prism: **>2×** cost savings, 3.3× SLO attainment from cross-model memory coordination. [arXiv](https://arxiv.org/abs/2505.04021)
- Aegaeon (production): **1.5–9×** goodput; 82% GPU reduction (1,192→213) at Alibaba Cloud Model Studio. [Alibaba blog](https://www.alibabacloud.com/blog/602623)

**Framing note for the comparison doc:** setup times in this domain are effectively family-dependent but *sequence-dependent mostly through what is currently resident* (load time depends on source tier/locality — ServerlessLLM's `q + n/b` — and on whether the outgoing model must be evicted first); they span ~50 ms (NVLink-C2C hot state) to ~100+ s (MoE cold load), i.e., 3–4 orders of magnitude, which is exactly the regime where setup-aware sequencing (and an OAS-style rejection option) matters most.