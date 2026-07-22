#!/usr/bin/env python3
"""Build deterministic restaurant and surgery workloads in MaScLib format.

These files are synthetic scheduling instances for the IG Studio.  They keep
the original single-resource objective intact while giving the two scenario
lenses native, reproducible values instead of relabeling manufacturing data.

Usage:
    python3 tools/gen_domain_instances.py
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import random


OUT = Path(__file__).resolve().parent.parent / "masclib-domains"


@dataclass(frozen=True)
class WorkloadSpec:
    name: str
    domain: str
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
    WorkloadSpec("KITCHEN_SERVICE_60", "kitchen", 60, 6103, 360),
    WorkloadSpec("KITCHEN_SERVICE_120", "kitchen", 120, 6127, 720),
    WorkloadSpec("KITCHEN_SERVICE_240", "kitchen", 240, 6151, 1_320),
    WorkloadSpec("SURGERY_BLOCK_40", "surgery", 40, 7103, 3_600),
    WorkloadSpec("SURGERY_BLOCK_90", "surgery", 90, 7127, 7_200),
    WorkloadSpec("SURGERY_BLOCK_180", "surgery", 180, 7151, 14_400),
)


# One modeled finishing station. Families represent the station state needed
# for the next dish: (label, minimum minutes, maximum minutes, clean-out,
# prepare-in, relative demand share, execution credits/minute).
KITCHEN_FAMILIES = (
    ("cold-prep", 2, 5, 2, 2, 20, 0.7),
    ("grill", 5, 10, 7, 6, 22, 1.2),
    ("fryer", 3, 7, 6, 5, 16, 1.0),
    ("saute-pan", 4, 9, 5, 5, 20, 1.1),
    ("oven", 6, 12, 4, 8, 12, 1.0),
    ("dessert", 2, 6, 3, 4, 10, 0.8),
)

# One modeled operating room. Families represent specialty/layout states:
# (label, minimum procedure minutes, maximum procedure minutes, clean-out,
# prepare-in, relative case share, execution credits/minute).
SURGERY_FAMILIES = (
    ("general", 55, 110, 18, 18, 24, 2.0),
    ("orthopedic", 80, 165, 28, 34, 19, 2.8),
    ("cardiac", 125, 240, 38, 48, 10, 4.2),
    ("thoracic", 100, 195, 34, 40, 10, 3.6),
    ("neurological", 125, 260, 36, 52, 9, 4.5),
    ("urology", 45, 105, 20, 24, 16, 2.3),
    ("ent", 35, 90, 16, 20, 12, 1.9),
)


def one_decimal(value: float) -> float:
    return round(value + 1e-9, 1)


def weighted_index(rng: random.Random, families: tuple[tuple, ...]) -> int:
    return rng.choices(range(len(families)), weights=[row[5] for row in families], k=1)[0]


def kitchen_release(rng: random.Random, index: int, spec: WorkloadSpec) -> int:
    """Mix planned tickets with reproducible last-minute order waves."""
    service_window = int(spec.horizon * 0.72)
    if rng.random() < 0.48:
        # Reservations and pre-orders are ready early but not all at time zero.
        return rng.randint(0, max(1, int(service_window * 0.30)))
    waves = (0.22, 0.40, 0.58, 0.72)
    wave = waves[(index + rng.randrange(len(waves))) % len(waves)]
    return max(0, min(service_window, round(service_window * wave + rng.gauss(0, spec.horizon * 0.018))))


def kitchen_jobs(spec: WorkloadSpec, rng: random.Random) -> list[Job]:
    jobs: list[Job] = []
    for index in range(spec.jobs):
        family = weighted_index(rng, KITCHEN_FAMILIES)
        _, p_min, p_max, _, _, _, rate = KITCHEN_FAMILIES[family]
        processing = rng.randint(p_min, p_max)
        release = kitchen_release(rng, index, spec)
        service_class = rng.choices(("priority", "standard", "flexible"), weights=(22, 58, 20), k=1)[0]
        target, weight, slack = {
            "priority": (18, 4.5, 50),
            "standard": (32, 2.2, 85),
            "flexible": (55, 0.9, 140),
        }[service_class]
        due = release + target + rng.randint(-3, 5)
        hard_deadline = min(spec.horizon, max(release + processing, due + slack))
        execution = one_decimal(processing * rate)
        # Recovery represents a modeled outside option: substitution, discount,
        # or cancellation. It remains costly enough that local service matters.
        rejection = one_decimal(execution + rng.uniform(58, 155) + weight * 5)
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


def surgery_release(rng: random.Random, index: int, spec: WorkloadSpec) -> int:
    """Place known cases in daily blocks with patient/team readiness variation."""
    days = spec.horizon // 720
    day = min(days - 1, (index * days) // spec.jobs)
    if rng.random() < 0.18:
        day = min(days - 1, max(0, day + rng.choice((-1, 1))))
    return day * 720 + rng.randint(0, 150)


def surgery_jobs(spec: WorkloadSpec, rng: random.Random) -> list[Job]:
    jobs: list[Job] = []
    for index in range(spec.jobs):
        family = weighted_index(rng, SURGERY_FAMILIES)
        _, p_min, p_max, _, _, _, rate = SURGERY_FAMILIES[family]
        processing = rng.randint(p_min, p_max)
        release = surgery_release(rng, index, spec)
        service_class = rng.choices(("time-sensitive", "priority", "elective"), weights=(14, 36, 50), k=1)[0]
        target, weight, slack = {
            "time-sensitive": (300, 7.0, 540),
            "priority": (960, 2.8, 1_440),
            "elective": (1_800, 1.1, 2_880),
        }[service_class]
        due = release + target + rng.randint(-60, 90)
        hard_deadline = min(spec.horizon, max(release + processing, due + slack))
        execution = one_decimal(processing * rate)
        # Transfer is a numeric capacity outside option, not a clinical decision.
        rejection = one_decimal(execution + rng.uniform(850, 2_450) + weight * 70)
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


def setup_rows(domain: str, families: tuple[tuple, ...]) -> list[tuple[int, int, int, float]]:
    """Return a complete asymmetric matrix, including the clean initial state."""
    initial = len(families)
    rows: list[tuple[int, int, int, float]] = []
    for previous in range(initial + 1):
        for following in range(initial):
            if previous == following:
                minutes = 0
            elif previous == initial:
                minutes = families[following][4]
            else:
                clean_out = families[previous][3]
                prepare_in = families[following][4]
                minutes = round(clean_out * 0.62 + prepare_in * 0.82)
                if domain == "kitchen":
                    # Allergen sanitation after dessert/cold prep and preheating
                    # for oven/grill make direction materially important.
                    if previous in (0, 5) and following in (1, 2, 3):
                        minutes += 3
                    if following == 4:
                        minutes += 4
                else:
                    # Implant/high-instrument specialties need extra preparation;
                    # following them with a clean field adds a different turnover.
                    if following in (1, 2, 4):
                        minutes += 8
                    if previous in (1, 2, 4) and following in (0, 5, 6):
                        minutes += 6
            cost_rate = 1.8 if domain == "kitchen" else 3.6
            fixed = 0 if minutes == 0 else (4 if domain == "kitchen" else 35)
            rows.append((previous, following, minutes, one_decimal(minutes * cost_rate + fixed)))
    return rows


def render(spec: WorkloadSpec) -> str:
    rng = random.Random(spec.seed)
    families = KITCHEN_FAMILIES if spec.domain == "kitchen" else SURGERY_FAMILIES
    jobs = kitchen_jobs(spec, rng) if spec.domain == "kitchen" else surgery_jobs(spec, rng)
    initial_state = len(families)

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
        for previous, following, minutes, cost in setup_rows(spec.domain, families)
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
