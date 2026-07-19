# Multi-machine GRAS: benchmark strategy decision

*Research date: 2026-07-17. Every claim below marked VERIFIED was checked against a live source during this research pass (links inline); the full problem statement is at the end.*

## The question

The next target is the heterogeneous fleet problem: **n unlike machines** (e.g. an RTX 3090 box and an Apple M2 Ultra) serving LLM inference requests — each machine with its own model-loading times, swap costs and per-model speeds — plus a **cloud/token option** with tiered cost, latency and *result quality*. Formally close to `R_m | r_j, s_ijk (machine- and sequence-dependent) | Σ w_j T_j + outsourcing costs`, with a quality dimension on the outsourcing tiers.

Do the existing MaScLib variables cover this? Should the benchmark be adapted, adopted from elsewhere, or created new?

## What the research established

### 1. There is no benchmark for the full problem — and that is the opportunity

No widely adopted public benchmark covers the union (unrelated machines + release dates + due dates/weighted tardiness + rejection/outsourcing tiers + quality). Parallel-machine order-acceptance is nearly virgin territory: a 2022 survey states outright that *no heuristic research exists for OAS on unrelated parallel machines* (Xie 2022, HBEM 4:37-40 — VERIFIED, read in full). The only public parallel-machine OAS set found (OAS_M-SDST, [Mendeley Data 10.17632/zkh2x8mb6p.2](https://doi.org/10.17632/zkh2x8mb6p.2), CC BY) has near-zero community traction.

### 2. Two literature anchors exist for the *pieces*, both alive and downloadable

- **Cesaret/Oğuz/Salman OAS set** (single machine, sequence-dependent setups, release dates, revenue − weighted tardiness with rejection): 750–1,500 instances, fully documented generator, per-instance published upper bounds (tightened by Silva et al. 2018), ~10 published algorithms benchmarked head-to-head by the Sparrow paper (He et al., C&IE 2020). VERIFIED downloadable today ([Koç University ZIP](https://ku-people.s3.eu-west-1.amazonaws.com/cdn/files/Mysite/coguz/Dataset_OAS.zip), HTTP 200, 3.2 MB; mirrored at [AlgTUDelft](https://github.com/AlgTUDelft/Decision-Diagrams-for-Single-Machine-Scheduling)). **Headline gap: across four targeted searches, no standalone Iterated Greedy paper on this standard benchmark was found** — the nearest cousin, ILS (Silva et al. 2018), is the *slowest* state-of-the-art method per Sparrow's own benchmark. An IG entry here would be the first, on the community's reference set.
- **Vallada & Ruiz `R|s_ijk|Cmax`** (unrelated machines + sequence-dependent setups): 1,640 instances, the de-facto standard (EJOR 2011, 400+ citations). Original host soa.iti.es is **dead (502 — VERIFIED)**; live mirror with best-known solutions at [UFOP/GOAL](http://goal.ufop.br/upmsp) (HTTP 200 — VERIFIED). Iterated Greedy has direct published precedent on exactly this terrain: Fanjul-Peyró & Ruiz (EJOR 2010) beat the then-state-of-the-art on `R||Cmax` with simple IG; Lin, Lu & Ying (IJAMT 2011) report IG *significantly better than state-of-the-art* on unrelated machines with sequence- **and machine-dependent setups minimizing total tardiness** — the closest published relative of the target objective. Honest nuance: on the Vallada-Ruiz makespan set specifically, simulated annealing (Santos/Toffolo et al., ITOR 2019) holds the strongest published results; IG is top-tier there, not uniquely dominant.
- No popular public `R_m` benchmark **with due dates/tardiness** exists (several small sets, none dominant — VERIFIED absence). A 2022 EJCO paper critiques the common due-date generators as producing too-loose deadlines; any new set should generate *tight* due dates.

### 3. The MaScLib format can express the problem; the current parsers cannot

VERIFIED from file headers: the ILOG MASC 1.0 dialect already carries the degrees of freedom — `RESOURCE` rows are keyed by `RESOURCE_ID` with per-resource `SETUP_MATRIX_ID` and initial state; `MODE` rows are keyed by `(ACTIVITY_ID, MODE_ID)` with per-mode `RESOURCE_ID`, `PROCESSING_TIME` and `MODE_COST` — i.e. machine choice with machine-dependent times, per-machine setup matrices. Missing only: outsourcing *tiers* (today a single `UNPERFORMED_COST`) and any quality dimension.

**Parser landmine (VERIFIED in `engine/src/instance.rs` and `python/ig_scheduler.py`):** both parsers key modes by activity only and ignore `SETUP_MATRIX_ID` — a multi-machine file would parse **without error and produce silently wrong single-machine numbers** (last-wins clobbering). Until multi-machine support lands, the parsers must *reject* files with >1 resource.

**Engine cost (VERIFIED in `engine/src/solver.rs`):** the extension is moderate and concentrated — `State` becomes machine-indexed (~220 lines), while the differentiating asset survives: the incremental absorbed-shift evaluator generalizes *per machine chain* (inserting on machine m only perturbs m's chain), and the whole IG driver (adaptive destruction, acceptance, construct/permute) works unchanged on job-ids.

### 4. Real traces can ground the instances

- **BurstGPT** ([HPMLL/BurstGPT](https://github.com/HPMLL/BurstGPT), KDD 2025): 10.31M requests / 213 days, **the only public trace with both arrival timestamps and a model column** (GPT-3.5 vs GPT-4 — a 2-tier mix that mirrors local-vs-frontier quality tiering), plus token counts and measured latencies. VERIFIED.
- **Azure LLM inference traces** ([AzurePublicDataset](https://github.com/Azure/AzurePublicDataset), 2023/2024/2025 releases): production arrivals + context/generated token counts, CC-BY; no model IDs. Token counts map directly to per-machine processing times via measured tok/s of each local machine. VERIFIED.
- No public trace of a heterogeneous multi-GPU cluster with explicit model-swap events exists; the systems state of the art for multi-model GPU pooling (Aegaeon, SOSP'25 — 97% switch-latency reduction on Alibaba's marketplace) did not release its trace. The standard workaround (ServerlessLLM, OSDI'24) models per-model arrivals on the Azure Functions 2019 trace. VERIFIED.

## The decision

**Adopt two anchors, create one extension. Do not stretch the 44 MaScLib instances into the multi-machine story.**

1. **Adopt Cesaret OAS** as the single-machine literature bridge: small text loader, run the existing engine against published per-instance upper bounds, report gaps. This is the cheapest credibility available anywhere — and the first standalone IG on the reference OAS benchmark.
2. **Adopt Vallada-Ruiz** (vendored from the UFOP mirror — academic hosting demonstrably rots) as the multi-machine validation core once the engine speaks `R_m`: compare against best-known solutions from a 400-citation literature.
3. **Create `GRAS-Rm`** — the homelab benchmark, as a documented extension, because nothing else covers the union:
   - **Format:** the MaScLib dialect, using the RESOURCE/MODE columns as designed (multi-resource, per-mode times/costs), after fixing the parser landmine; cloud tiers as pseudo-machines carrying cost + latency, plus one new column for the **quality penalty** (the genuinely novel dimension — absent from every benchmark surveyed).
   - **Machine side calibrated from the real fleet:** measured model-load times, swap costs and tok/s of the actual 3090 and M2 Ultra machines.
   - **Arrival side grounded in BurstGPT/Azure traces** (bursty arrivals, real token-length distributions, 2-tier model mix remapped to the local model families).
   - **Tight due dates** per the EJCO-2022 critique, so tardiness actually binds.
   - Instances + generator + best-found solutions published in-repo (and mirrorable on Zenodo).
4. **Keep the 44 NCOS/STC instances** exactly as they are: the legacy single-machine regression suite that anchors the 2015 lineage — not the vehicle for the multi-machine claim.

### Sequencing

| Step | What | Why first |
|---|---|---|
| 1 | Parser guard: reject >1-resource files in both parsers | Kills the silent-wrong-numbers landmine before any multi-machine file exists |
| 2 | Cesaret loader + engine run vs. published UBs | Cheapest literature win; first IG on the reference OAS set |
| 3 | `R_m` engine extension (machine-indexed `State`, per-chain incremental eval) validated on Vallada-Ruiz | The multi-machine core, checked against 1,640 instances with best-knowns |
| 4 | `GRAS-Rm` generator + instances (trace-grounded, fleet-calibrated, quality tiers) + demo integration | The actual homelab problem, on a foundation the literature can evaluate |

---

*Problem statement researched: n heterogeneous machines (RTX 3090; Apple M2 Ultra) serving LLM inference; per-machine model-loading times, swap costs, per-model speeds; cloud/token outsourcing tiers with distinct cost, latency and result quality; release times, SLO due dates, tardiness penalties. Target formalization: `R_m | r_j, s_ijk | Σ w_j T_j + outsourcing` + quality-tiered rejection.*
