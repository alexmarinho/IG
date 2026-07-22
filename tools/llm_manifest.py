#!/usr/bin/env python3
"""Generate the LLM reading of every MaScLib instance.

The adaptation deliberately does NOT change a single number: MaScLib families
are anonymous integers, so the combinatorial structure of each instance is
preserved byte-for-byte — which keeps the 2015 best-known values valid.
What this script adds is the semantic layer: for each instance, a
``masclib-llm/<name>.llm.json`` manifest that maps

  family            -> a model from a realistic catalog (load time = the
                       instance's median setup time into that family)
  time units        -> seconds
  money             -> credits (1 credit ~ $0.0001)
  tardiness weight  -> an SLO class (interactive / standard / batch tiers)
  rejection cost    -> the cloud-API price of that request

Usage: python tools/llm_manifest.py     (writes masclib-llm/*.llm.json)
"""
from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))
from ig_scheduler import Instance  # noqa: E402

# model catalog: (name, size class) — load time comes from the instance itself
CATALOG = [
    ("qwen-7b", "S"), ("llama-8b", "S"), ("mistral-24b", "M"), ("qwen-32b", "M"),
    ("sdxl-image", "S"), ("whisper-large", "S"), ("embed-8b", "S"), ("llama-70b", "L"),
    ("rerank-4b", "S"), ("deepseek-67b", "L"),
]


def slo_class(w_deci: int, tiers: list[int]) -> str:
    """Tier the tardiness weight into an SLO class, per instance."""
    if len(tiers) <= 1 or w_deci >= tiers[-1]:
        return "interactive"
    if w_deci <= tiers[0]:
        return "batch"
    return "standard"


def manifest(inst: Instance) -> dict:
    fams = sorted({j.fam for j in inst.jobs})
    models = {}
    for i, f in enumerate(fams):
        loads = [inst.setup_t[g][f] for g in range(inst.n_states) if inst.setup_t[g][f] > 0]
        costs = [inst.setup_c[g][f] for g in range(inst.n_states) if inst.setup_c[g][f] > 0]
        name, size = CATALOG[i % len(CATALOG)]
        models[f] = {
            "model": name if len(fams) > 1 else "qwen-7b (single resident model)",
            "size_class": size,
            "load_seconds": statistics.median(loads) if loads else 0,
            "swap_cost_credits": statistics.median(costs) / 10 if costs else 0,
        }
    ws = sorted({j.w for j in inst.jobs})
    tiers = [ws[0], ws[-1]] if ws else []
    jobs = [
        {
            "id": j.id,
            "model": models[j.fam]["model"],
            "arrival_s": j.rel,
            "inference_s": j.p,
            "slo_deadline_s": j.due,
            "slo_class": slo_class(j.w, tiers),
            "late_penalty_credits_per_s": j.w / 10,
            "cloud_price_credits": j.rej / 10,
        }
        for j in inst.jobs
    ]
    swaps = inst.n_states > 1
    return {
        "instance": inst.name,
        "source": f"masclib/{inst.name}.csv" if not inst.name.startswith("GPU_") else f"masclib-gpu/{inst.name}.csv",
        "reading": {
            "machine": "one GPU",
            "time_unit": "seconds",
            "money_unit": "credits (1 credit ≈ $0.0001)",
            "setup": ("model load/swap (time and/or GPU-credit cost — some instances price the swap without stalling the queue)") if swaps else "none — a single resident model (pure admission/SLO problem)",
            "rejection": "route the request to a cloud API and pay its price",
            "note": "numbers are identical to the source instance — only the semantics layer is new, so published best-known objective values remain valid",
        },
        "requests": len(jobs),
        "models": models,
        "jobs": jobs,
    }


def main() -> None:
    out = ROOT / "masclib-llm"
    out.mkdir(exist_ok=True)
    count = 0
    for src in [ROOT / "masclib", ROOT / "masclib-gpu"]:
        for csv in sorted(src.glob("*.csv")):
            inst = Instance.parse(csv)
            (out / f"{inst.name}.llm.json").write_text(json.dumps(manifest(inst), indent=1))
            count += 1
    print(f"wrote {count} manifests to masclib-llm/")


if __name__ == "__main__":
    main()
