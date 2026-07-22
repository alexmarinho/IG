# gpu — the replica fleet

Thousands of Iterated Greedy searches advancing in lockstep on one GPU. Not a smarter search — a **wider** one: the fleet trades single-trajectory speed for massive diversity, which is exactly what restarts-hungry landscapes, parameter sweeps and record hunts want.

## Requirements & quick start

Any CUDA GPU (developed on an RTX 3090; a few GB of VRAM is plenty — state is tiny) — or no GPU at all: `--device cpu` runs the identical numbers, slowly.

```bash
python -m venv .venv && .venv/bin/pip install torch   # the only dependency
.venv/bin/python gpu/fleet_torch.py verify masclib/STC_NCOS_31.csv   # must MATCH
.venv/bin/python gpu/fleet_torch.py solve masclib/NCOS_31.csv --replicas 4096 --seconds 60
.venv/bin/python gpu/fleet_torch.py solve masclib/STC_NCOS_51a.csv --replicas 2048 --seconds 120 --d 2 --dmax 150
```

`verify` prices fleet-constructed schedules against the CPU reference implementation and must match to the deci-unit — run it once on your hardware before trusting anything else.

## How it works (one screen)

- **State**: `order[R, n]` (schedule prefix + pool suffix) + lengths — ~2 KB per replica, so tens of thousands of replicas fit trivially.
- **Evaluation**: completion times are a running recurrence (`t ← max(t, release − setup) + setup + p`), computed in an n-step loop vectorized across replicas.
- **Repair**: for the pending job, *every* insertion position across *all* replicas is priced in a single n-step scan over virtual (replica × position) rows — no materialized copies.
- **Destroy**: binomial removal with expected size `d_eff`, where `d_eff` ramps per replica with stagnation up to `--dmax` (the [adaptive destruction](../RESULTS.md#closing-the-long-standing-stagnation-cases--adaptive-destruction) that closes the 200-job stagnation cases).
- Each replica keeps its own incumbent; the fleet reports the global best.

## What to extract from this step

1. **Restart diversity for hard instances** — a 4,096-replica fleet is 4,096 independent seeds exploring simultaneously; basins that trap single trajectories get escaped by *someone* in the fleet.
2. **Parameter sweeps as data** — because replicas are independent, you can shard the fleet across `(d, dmax, accept)` configurations and get an empirical tuning table from one run.
3. **Record hunting** — the [GPU/LLM instances](../masclib-gpu/) have open records; the fleet is the natural record-hunting rig. Beat one, open a PR with your command line.
4. **A scoring engine for evolved heuristics** — the roadmap's LLM heuristic factory (an LLM mutating destroy/repair operators, ReEvo/OpenEvolve-style) needs thousands of candidate evaluations per generation; the fleet is that harness.
5. **Your own problem** — anything you can encode in the MaScLib CSV format (jobs, families/setup matrix, due dates, rejection costs) rides the whole toolchain: this fleet, the [Rust engine](../engine/), the [Python reference](../python/), the [browser demo](https://alexmarinho.github.io/IG/). The [LLM manifests](../masclib-llm/) show one way to give your encoding real-world meaning.

## Honest limits

- Per-replica progress is slower than one CPU core running the Rust engine — the win is aggregate width, not single-trajectory depth (our CPU engine does ~20M evaluations/s/core; use it for single runs).
- The fleet repair skips the swap (`permute`) phase and uses binomial (expected-size) destruction — slightly different neighborhood than the CPU engines; costs it reports are exact, search trajectory differs.
- Kernel-launch overhead dominates small instances; the fleet shines as n and R grow. `torch.compile`/CUDA-graphs are the known headroom, contributions welcome.

Measured numbers from the reference RTX 3090: see [RESULTS.md](../RESULTS.md#gpu-fleet-rtx-3090).
