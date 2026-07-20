#!/usr/bin/env python3
"""Build deterministic 3D-print-farm workloads in MaScLib format.

Same conventions as tools/gen_domain_instances.py (restaurant/surgery):
synthetic, reproducible from committed seeds, single-capacity resource,
sequence-dependent setups, tardiness, execution and rejection costs.

One FDM printer runs a small farm's order book. Families are filament and
profile states; swaps cost unload/purge/load time, and abrasive PA-CF jobs
also demand a hardened-nozzle change. Orders that no longer fit go to a
partner farm at a price.

Usage:
    python3 tools/gen_print3d_instances.py
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import random


OUT = Path(__file__).resolve().parent.parent / "masclib-domains"


@dataclass(frozen=True)
class WorkloadSpec:
    name: str
    jobs: int
    seed: int
    horizon: int


@dataclass(frozen=True)
class Job:
    id: int
    family: int
    processing: int
    release: int
    due: int
    hard_deadline: int
    tardiness_weight: float
    execution_cost: float
    rejection_cost: float


SPECS = (
    WorkloadSpec("3DPRINT_FARM_45", 45, 8101, 5_760),    # 4-day order book
    WorkloadSpec("3DPRINT_FARM_90", 90, 8127, 11_520),   # 8-day order book
    WorkloadSpec("3DPRINT_FARM_180", 180, 8151, 23_040), # 16-day reference
)

# Filament/profile states of the single printer:
# (label, min print minutes, max print minutes, unload/purge minutes,
#  load/temp/nozzle minutes, relative demand share, credits per print minute)
PRINT_FAMILIES = (
    ("pla", 35, 300, 8, 10, 26, 0.9),
    ("petg", 40, 320, 10, 12, 18, 1.1),
    ("tpu", 60, 380, 12, 14, 12, 1.4),
    ("asa", 45, 340, 10, 14, 14, 1.3),
    ("pa-cf", 25, 200, 14, 26, 10, 2.2),
    ("pla-silk", 40, 320, 10, 16, 20, 1.0),
)


def one_decimal(value: float) -> float:
    return round(value + 1e-9, 1)


def weighted_index(rng: random.Random) -> int:
    return rng.choices(range(len(PRINT_FAMILIES)), weights=[row[5] for row in PRINT_FAMILIES], k=1)[0]


def print_release(rng: random.Random, index: int, spec: WorkloadSpec) -> int:
    """Order approvals arrive in daily batches with an early-booked share."""
    window = int(spec.horizon * 0.8)
    if rng.random() < 0.40:
        return rng.randint(0, max(1, int(window * 0.25)))
    waves = (0.10, 0.25, 0.40, 0.55, 0.70, 0.80)
    wave = waves[(index + rng.randrange(len(waves))) % len(waves)]
    return max(0, min(window, round(window * wave + rng.gauss(0, spec.horizon * 0.015))))


def tiered_processing(rng: random.Random, p_min: int, p_max: int) -> int:
    """Order sizes cluster like a real order book: many restock-size parts,
    fewer mid-size runs, and the occasional large centerpiece print."""
    span = p_max - p_min
    tier = rng.choices(("restock", "mid-run", "centerpiece"), weights=(45, 40, 15), k=1)[0]
    lo_frac, hi_frac = {"restock": (0.0, 0.35), "mid-run": (0.35, 0.75), "centerpiece": (0.75, 1.0)}[tier]
    return rng.randint(p_min + round(span * lo_frac), p_min + round(span * hi_frac))


def print_jobs(spec: WorkloadSpec, rng: random.Random) -> list[Job]:
    jobs: list[Job] = []
    for index in range(spec.jobs):
        family = weighted_index(rng)
        _, p_min, p_max, _, _, _, rate = PRINT_FAMILIES[family]
        processing = tiered_processing(rng, p_min, p_max)
        release = print_release(rng, index, spec)
        service_class = rng.choices(("same-day", "express", "standard"), weights=(12, 33, 55), k=1)[0]
        target, class_weight, slack = {
            "same-day": (240, 6.0, 240),
            "express": (720, 2.5, 720),
            "standard": (2_160, 0.6, 2_160),
        }[service_class]
        # Per-order premium/discount around the class anchor so audited jobs
        # read like negotiated promises, not table lookups.
        weight = one_decimal(class_weight * rng.uniform(0.8, 1.3))
        due = release + target + rng.randint(-30, 60)
        hard_deadline = min(spec.horizon, max(release + processing, due + slack))
        execution = one_decimal(processing * rate)
        # Partner farm charges a premium over own cost and penalizes rush jobs.
        rejection = one_decimal(execution + rng.uniform(300, 1_200) + weight * 60)
        jobs.append(Job(
            id=index,
            family=family,
            processing=processing,
            release=release,
            due=due,
            hard_deadline=hard_deadline,
            tardiness_weight=weight,
            execution_cost=execution,
            rejection_cost=rejection,
        ))
    return jobs


def setup_rows() -> list[tuple[int, int, int, float]]:
    """Complete asymmetric matrix, including the clean (empty) initial state."""
    initial = len(PRINT_FAMILIES)
    rows: list[tuple[int, int, int, float]] = []
    for previous in range(initial + 1):
        for following in range(initial):
            if previous == following:
                minutes = 0
            elif previous == initial:
                minutes = PRINT_FAMILIES[following][4]
            else:
                clean_out = PRINT_FAMILIES[previous][3]
                prepare_in = PRINT_FAMILIES[following][4]
                minutes = round(clean_out * 0.62 + prepare_in * 0.82)
                if following == 4:   # swap to hardened nozzle for abrasive PA-CF
                    minutes += 18
                if previous == 4:    # swap back to the standard nozzle
                    minutes += 8
                if previous == 2:    # flexible residue needs a deeper purge
                    minutes += 6
                if following == 5:   # color purge for silk finishes
                    minutes += 5
            cost_rate = 2.4
            fixed = 0 if minutes == 0 else 18
            rows.append((previous, following, minutes, one_decimal(minutes * cost_rate + fixed)))
    return rows


def render(spec: WorkloadSpec) -> str:
    rng = random.Random(spec.seed)
    jobs = print_jobs(spec, rng)
    initial_state = len(PRINT_FAMILIES)

    lines = [
        "ILOG_CSV_FORMAT,1.0",
        "",
        "ILOG_DATA_SCHEMA,MASC,1.0",
        "",
        "MODEL|NAMES,NAME,START_MIN",
        "MODEL|TYPES,string,int",
        f"MODEL,{spec.name},0",
        "",
        "RESOURCE|NAMES,RESOURCE_ID,SETUP_MATRIX_ID,INITIAL_SETUP_STATE,CAPACITY,START_MIN",
        "RESOURCE|TYPES,int,int,int,int,int",
        f"RESOURCE,0,0,{initial_state},1,0",
        "",
        "ACTIVITY|NAMES,ACTIVITY_ID,SETUP_STATE,PERFORMED_STATUS",
        "ACTIVITY|TYPES,int,int,string",
    ]
    lines.extend(f"ACTIVITY,{job.id},{job.family},PerformedOrUnperformed" for job in jobs)
    lines.extend((
        "",
        "SETUP_MATRIX|NAMES,SETUP_MATRIX_ID,FROM_STATE,TO_STATE,SETUP_TIME,SETUP_COST",
        "SETUP_MATRIX|TYPES,int,int,int,int,float",
    ))
    lines.extend(
        f"SETUP_MATRIX,0,{previous},{following},{minutes},{cost:.1f}"
        for previous, following, minutes, cost in setup_rows()
    )
    lines.extend((
        "",
        "DUE_DATE|NAMES,ACTIVITY_ID,DUE_TIME,TYPE,EARLINESS_VARIABLE_COST,TARDINESS_VARIABLE_COST",
        "DUE_DATE|TYPES,int,int,string,float,float",
    ))
    lines.extend(
        f"DUE_DATE,{job.id},{job.due},End,0,{job.tardiness_weight:.1f}"
        for job in jobs
    )
    lines.extend((
        "",
        "MODE|NAMES,ACTIVITY_ID,MODE_ID,RESOURCE_ID,REQUIRED_CAPACITY,MODE_COST,"
        "PROCESSING_TIME,START_MIN,START_MAX,END_MIN,END_MAX,UNPERFORMED_COST,"
        "UNPERFORMED_SETUP_TIME,UNPERFORMED_SETUP_COST",
        "MODE|TYPES,int,int,int,int,float,int,int,int,int,int,float,int,int",
    ))
    lines.extend(
        f"MODE,{job.id},0,0,1,{job.execution_cost:.1f},{job.processing},"
        f"{job.release},{spec.horizon - job.processing},{job.release + job.processing},"
        f"{job.hard_deadline},{job.rejection_cost:.1f},0,0"
        for job in jobs
    )
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for spec in SPECS:
        target = OUT / f"{spec.name}.csv"
        target.write_text(render(spec), encoding="utf-8")
        print(f"{spec.name}: {spec.jobs} jobs, horizon {spec.horizon}, seed {spec.seed}")


if __name__ == "__main__":
    main()
