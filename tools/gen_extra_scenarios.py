#!/usr/bin/env python3
"""Build deterministic workloads for eight extra IG Studio scenarios.

Same conventions as tools/gen_domain_instances.py: synthetic, reproducible
from committed seeds, single-capacity resource, sequence-dependent setups,
tardiness, execution and rejection costs. One configurable generator, one
domain registry — easier to extend than one script per domain.

Usage:
    python3 tools/gen_extra_scenarios.py
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import math
import random

OUT = Path(__file__).resolve().parent.parent / "masclib-domains"


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


# ----------------------------------------------------------------------------
# Domain registry
# families: (label, p_min, p_max, clean_out, prepare_in, demand share, credits/min)
# classes:  (label, target, weight, slack, share)  — service/promise classes
# setup_rules(previous, following, minutes) -> minutes  (directional extras)
# release(rng, index, spec, horizon) -> minute
# ----------------------------------------------------------------------------
DOMAINS = {}


def domain(key, label, families, classes, cost_rate, fixed, setup_rules,
           release_kind, day_length, rej_lo, rej_hi, rej_w, load_target=0.88):
    DOMAINS[key] = dict(
        label=label, families=families, classes=classes, cost_rate=cost_rate,
        fixed=fixed, setup_rules=setup_rules, release_kind=release_kind,
        day_length=day_length, rej_lo=rej_lo, rej_hi=rej_hi, rej_w=rej_w,
        load_target=load_target,
    )


def _rel_waves(rng, index, horizon, window_frac, early_p, early_frac, waves, jitter_frac):
    window = int(horizon * window_frac)
    if rng.random() < early_p:
        return rng.randint(0, max(1, int(window * early_frac)))
    wave = waves[(index + rng.randrange(len(waves))) % len(waves)]
    return max(0, min(window, round(window * wave + rng.gauss(0, horizon * jitter_frac))))


# 1. Coffee roastery — one drum roaster, profile/origin families. -----------
domain(
    "coffee", "Coffee roastery",
    families=(
        ("filter-light", 14, 22, 3, 4, 24, 1.6),
        ("espresso-medium", 16, 26, 3, 5, 26, 1.4),
        ("dark-blend", 15, 24, 4, 5, 20, 1.2),
        ("decaf", 15, 24, 6, 8, 10, 1.5),
        ("micro-lot", 12, 20, 5, 7, 12, 2.6),
        ("natural-experimental", 13, 21, 5, 6, 8, 2.2),
    ),
    classes=(
        ("same-week-wholesale", 2880, 3.0, 1440, 30),
        ("subscription-ship", 1440, 5.0, 720, 45),
        ("cafe-standing-order", 720, 7.0, 480, 25),
    ),
    cost_rate=2.2, fixed=15,
    setup_rules=lambda p, f, m: m
        + (10 if f == 3 else 0)          # full clean-out before decaf (flavor carryover)
        + (6 if p == 3 else 0)           # extra sweep after decaf
        + (5 if f == 4 else 0),          # careful profile for micro-lots
    release_kind="roastery", day_length=720, load_target=1.0,
    rej_lo=180, rej_hi=720, rej_w=40,
)

# 2. Bakery deck oven — temp/steam lines, morning counter peak. --------------
domain(
    "bakery", "Bakery deck oven",
    families=(
        ("baguette", 18, 30, 4, 6, 26, 1.0),
        ("sourdough", 30, 50, 5, 8, 18, 1.6),
        ("brioche", 22, 38, 5, 7, 14, 1.5),
        ("cake", 35, 60, 6, 8, 14, 1.8),
        ("pizza", 12, 20, 4, 5, 16, 0.9),
        ("cookie", 15, 25, 4, 5, 12, 1.1),
    ),
    classes=(
        ("counter-opening", 240, 8.0, 180, 30),
        ("morning-peak", 480, 5.0, 240, 40),
        ("wholesale-route", 960, 2.0, 480, 30),
    ),
    cost_rate=1.8, fixed=12,
    setup_rules=lambda p, f, m: m
        + (12 if p in (3,) and f in (0, 4) else 0)   # oven must cool from cake temp to high-heat
        + (4 if f == 1 else 0)                        # steam program for sourdough
        + (3 if p == 5 and f in (2, 3) else 0),       # butter aroma carryover guard
    release_kind="waves", day_length=1440, rej_lo=90, rej_hi=380, rej_w=25,
)

# 3. Dental CAD/CAM lab — one milling machine, material families. ------------
domain(
    "dental", "Dental milling lab",
    families=(
        ("zirconia", 25, 70, 8, 10, 30, 2.8),
        ("pmma-provisional", 18, 45, 6, 8, 22, 1.6),
        ("wax-pattern", 12, 30, 4, 6, 14, 1.1),
        ("titanium-abutment", 40, 95, 14, 22, 8, 4.5),
        ("emax-ceramic", 30, 75, 10, 12, 18, 3.6),
        ("peek-framework", 28, 60, 9, 11, 8, 3.0),
    ),
    classes=(
        ("chairside-same-day", 300, 8.0, 240, 20),
        ("next-appointment", 1440, 4.0, 720, 45),
        ("lab-standing-order", 4320, 1.5, 1440, 35),
    ),
    cost_rate=3.2, fixed=25,
    setup_rules=lambda p, f, m: m
        + (18 if f == 3 else 0)          # wet/coolant tooling for titanium
        + (10 if p == 3 and f != 3 else 0)  # full flush after titanium
        + (5 if f == 4 else 0),          # fine calibration for ceramics
    release_kind="waves", day_length=1440, rej_lo=220, rej_hi=900, rej_w=55,
)

# 4. Fiber laser cutting — material/thickness families, gas + lens swaps. ----
domain(
    "laser", "Laser cutting",
    families=(
        ("steel-1mm", 8, 25, 5, 6, 22, 1.2),
        ("steel-3mm", 15, 45, 6, 8, 18, 1.6),
        ("aluminium-2mm", 12, 35, 7, 9, 16, 1.8),
        ("acrylic-5mm", 10, 30, 5, 7, 14, 1.4),
        ("wood-mdf-3mm", 9, 28, 5, 6, 14, 1.0),
        ("brass-1mm", 12, 32, 8, 10, 8, 2.2),
    ),
    classes=(
        ("hot-job", 240, 7.0, 180, 20),
        ("fab-order", 960, 3.0, 480, 50),
        ("stock-nesting", 2880, 1.0, 1440, 30),
    ),
    cost_rate=2.6, fixed=20,
    setup_rules=lambda p, f, m: m
        + (9 if (p in (0, 1) and f in (2, 5)) else 0)   # O2 -> N2 gas change for shiny metals
        + (6 if p in (3, 4) and f in (0, 1, 2, 5) else 0)  # deep clean after organics
        + (4 if f == 5 else 0),                            # lens check for brass
    release_kind="waves", day_length=1440, rej_lo=150, rej_hi=650, rej_w=45,
)

# 5. Industrial laundry — one tunnel line, linen classes. --------------------
domain(
    "laundry", "Industrial laundry",
    families=(
        ("hotel-white", 25, 50, 6, 8, 26, 1.0),
        ("hotel-color", 25, 50, 6, 8, 20, 1.0),
        ("restaurant-grease", 35, 65, 9, 10, 16, 1.3),
        ("healthcare-barrier", 40, 75, 14, 16, 14, 1.8),
        ("delicate", 20, 40, 6, 9, 12, 1.5),
        ("spa-towel", 28, 55, 7, 8, 12, 1.2),
    ),
    classes=(
        ("route-am", 480, 5.0, 240, 35),
        ("route-pm", 960, 3.0, 480, 40),
        ("contract-weekly", 4320, 1.0, 1440, 25),
    ),
    cost_rate=1.9, fixed=14,
    setup_rules=lambda p, f, m: m
        + (20 if p == 3 else 0)          # sanitation flush after healthcare linen
        + (8 if p == 2 and f in (0, 1, 4, 5) else 0)  # degrease rinse before hotel loads
        + (4 if f == 4 else 0),          # gentle program change
    release_kind="waves", day_length=1440, rej_lo=120, rej_hi=500, rej_w=30,
)

# 6. Podcast/video studio — one room, set/lighting families. -----------------
domain(
    "studio", "Podcast & video studio",
    families=(
        ("solo-interview", 45, 90, 10, 15, 26, 2.0),
        ("duo-table", 50, 110, 12, 18, 20, 2.2),
        ("video-youtube", 60, 130, 20, 30, 18, 3.0),
        ("audiobook-vo", 40, 80, 8, 12, 12, 1.8),
        ("livestream", 55, 120, 18, 25, 12, 3.4),
        ("branded-set", 65, 140, 25, 35, 12, 4.0),
    ),
    classes=(
        ("publish-today", 360, 6.0, 240, 20),
        ("weekly-slot", 1440, 3.0, 720, 50),
        ("season-batch", 4320, 1.2, 1440, 30),
    ),
    cost_rate=2.4, fixed=30,
    setup_rules=lambda p, f, m: m
        + (12 if f == 5 else 0)          # branded set build
        + (8 if p == 5 else 0)           # branded set strike
        + (6 if f == 4 else 0),          # live rig check
    release_kind="waves", day_length=1440, rej_lo=300, rej_hi=1100, rej_w=70,
)

# 7. Clinical testing lab — one analyzer, assay panels. Modeled, non-clinical.
domain(
    "lab", "Clinical testing lab",
    families=(
        ("hematology", 12, 30, 8, 10, 26, 1.2),
        ("biochemistry", 15, 38, 10, 12, 26, 1.4),
        ("immunology", 20, 50, 12, 14, 14, 1.9),
        ("coagulation", 10, 25, 8, 10, 12, 1.3),
        ("toxicology", 25, 60, 16, 18, 10, 2.4),
        ("microbiology", 18, 45, 14, 16, 12, 2.0),
    ),
    classes=(
        ("stat", 60, 9.0, 60, 15),
        ("same-day-report", 480, 4.0, 240, 45),
        ("routine-panel", 1440, 1.5, 720, 40),
    ),
    cost_rate=2.8, fixed=22,
    setup_rules=lambda p, f, m: m
        + (14 if p == 4 else 0)          # decontamination after toxicology
        + (8 if p == 5 else 0)           # biological safety flush
        + (5 if f == 2 else 0),          # immunoassay calibration
    release_kind="lab", day_length=1440, rej_lo=200, rej_hi=800, rej_w=50,
)

# 8. Craft brewery — one brew house, style families. -------------------------
domain(
    "brewery", "Craft brewery",
    families=(
        ("pilsner", 240, 330, 25, 30, 24, 0.9),
        ("ipa", 260, 360, 30, 38, 22, 1.2),
        ("stout", 250, 340, 28, 34, 14, 1.1),
        ("sour", 270, 380, 45, 55, 10, 1.5),
        ("wheat", 240, 320, 26, 32, 18, 1.0),
        ("lager", 250, 350, 28, 34, 12, 1.0),
    ),
    classes=(
        ("tank-window-critical", 720, 6.0, 480, 25),
        ("release-scheduled", 2880, 2.5, 1440, 50),
        ("contract-seasonal", 7200, 1.0, 2880, 25),
    ),
    cost_rate=1.6, fixed=40,
    setup_rules=lambda p, f, m: m
        + (35 if p == 3 else 0)          # extra sanitation after sour (contamination risk)
        + (6 if f == 1 else 0),          # dry-hop prep for IPA
    release_kind="waves", day_length=1440, rej_lo=800, rej_hi=2600, rej_w=150,
)


# ----------------------------------------------------------------------------
# Generator
# ----------------------------------------------------------------------------
SIZES = (("S", 45), ("M", 90), ("L", 180))


def one_decimal(value: float) -> float:
    return round(value + 1e-9, 1)


def make_release(cfg, rng, index, horizon):
    kind = cfg["release_kind"]
    if kind == "roastery":
        return _rel_waves(rng, index, horizon, 0.85, 0.35, 0.25,
                          (0.15, 0.35, 0.55, 0.75, 0.85), 0.02)
    if kind == "lab":
        # STAT/routine sample arrivals cluster around courier pickups.
        return _rel_waves(rng, index, horizon, 0.80, 0.30, 0.20,
                          (0.10, 0.30, 0.50, 0.70, 0.80), 0.012)
    return _rel_waves(rng, index, horizon, 0.80, 0.40, 0.25,
                      (0.10, 0.25, 0.40, 0.55, 0.70, 0.80), 0.015)


def tiered_processing(rng, p_min, p_max):
    """Batch sizes cluster like a real order book: many small batches, fewer
    mid-size runs, and the occasional large flagship batch."""
    span = p_max - p_min
    tier = rng.choices(("small", "mid", "flagship"), weights=(45, 40, 15), k=1)[0]
    lo_frac, hi_frac = {"small": (0.0, 0.35), "mid": (0.35, 0.75), "flagship": (0.75, 1.0)}[tier]
    return rng.randint(p_min + round(span * lo_frac), p_min + round(span * hi_frac))


def build_jobs(cfg, rng, n, horizon):
    jobs = []
    fams = cfg["families"]
    classes = cfg["classes"]
    for index in range(n):
        family = rng.choices(range(len(fams)), weights=[f[5] for f in fams], k=1)[0]
        _, p_min, p_max, _, _, _, rate = fams[family]
        processing = tiered_processing(rng, p_min, p_max)
        release = make_release(cfg, rng, index, horizon)
        _, target, class_weight, slack, _share = classes[
            rng.choices(range(len(classes)), weights=[c[4] for c in classes], k=1)[0]]
        # Per-order premium/discount around the class anchor so audited jobs
        # read like negotiated promises, not table lookups.
        weight = one_decimal(class_weight * rng.uniform(0.8, 1.3))
        due = release + target + rng.randint(-max(5, target // 20), max(10, target // 12))
        hard_deadline = min(horizon, max(release + processing, due + slack))
        execution = one_decimal(processing * rate)
        rejection = one_decimal(execution + rng.uniform(cfg["rej_lo"], cfg["rej_hi"]) + weight * cfg["rej_w"])
        jobs.append(Job(index, family, processing, release, due, hard_deadline,
                        weight, execution, rejection))
    return jobs


def setup_rows(cfg):
    fams = cfg["families"]
    initial = len(fams)
    rows = []
    for previous in range(initial + 1):
        for following in range(initial):
            if previous == following:
                minutes = 0
            elif previous == initial:
                minutes = fams[following][4]
            else:
                minutes = round(fams[previous][3] * 0.62 + fams[following][4] * 0.82)
                minutes = cfg["setup_rules"](previous, following, minutes)
            cost = 0 if minutes == 0 else one_decimal(minutes * cfg["cost_rate"] + cfg["fixed"])
            rows.append((previous, following, minutes, cost))
    return rows


def render(domain_key, size_tag, n, seed):
    cfg = DOMAINS[domain_key]
    rng = random.Random(seed)
    jobs = build_jobs(cfg, rng, n, 10**9)  # horizon decided from load below
    # horizon: fit total load at the domain's utilization target, rounded up
    # to whole working days (coffee roasts in 12h days; brewery runs 24h).
    avg_setup = 12
    load = sum(j.processing for j in jobs) + n * avg_setup
    day = cfg["day_length"]
    horizon = int(math.ceil((load / cfg["load_target"]) / day) * day)
    # rebuild jobs with the real horizon (same rng sequence is NOT reusable)
    rng = random.Random(seed)
    jobs = build_jobs(cfg, rng, n, horizon)
    name = f"{domain_key.upper()}_{size_tag}_{n}"
    initial_state = len(cfg["families"])

    lines = [
        "ILOG_CSV_FORMAT,1.0", "", "ILOG_DATA_SCHEMA,MASC,1.0", "",
        "MODEL|NAMES,NAME,START_MIN", "MODEL|TYPES,string,int", f"MODEL,{name},0", "",
        "RESOURCE|NAMES,RESOURCE_ID,SETUP_MATRIX_ID,INITIAL_SETUP_STATE,CAPACITY,START_MIN",
        "RESOURCE|TYPES,int,int,int,int,int", f"RESOURCE,0,0,{initial_state},1,0", "",
        "ACTIVITY|NAMES,ACTIVITY_ID,SETUP_STATE,PERFORMED_STATUS", "ACTIVITY|TYPES,int,int,string",
    ]
    lines.extend(f"ACTIVITY,{j.id},{j.family},PerformedOrUnperformed" for j in jobs)
    lines.extend(("", "SETUP_MATRIX|NAMES,SETUP_MATRIX_ID,FROM_STATE,TO_STATE,SETUP_TIME,SETUP_COST",
                  "SETUP_MATRIX|TYPES,int,int,int,int,float"))
    lines.extend(f"SETUP_MATRIX,0,{p},{f},{m},{c:.1f}" for p, f, m, c in setup_rows(cfg))
    lines.extend(("", "DUE_DATE|NAMES,ACTIVITY_ID,DUE_TIME,TYPE,EARLINESS_VARIABLE_COST,TARDINESS_VARIABLE_COST",
                  "DUE_DATE|TYPES,int,int,string,float,float"))
    lines.extend(f"DUE_DATE,{j.id},{j.due},End,0,{j.tardiness_weight:.1f}" for j in jobs)
    lines.extend(("", "MODE|NAMES,ACTIVITY_ID,MODE_ID,RESOURCE_ID,REQUIRED_CAPACITY,MODE_COST,"
                  "PROCESSING_TIME,START_MIN,START_MAX,END_MIN,END_MAX,UNPERFORMED_COST,"
                  "UNPERFORMED_SETUP_TIME,UNPERFORMED_SETUP_COST",
                  "MODE|TYPES,int,int,int,int,float,int,int,int,int,int,float,int,int"))
    lines.extend(f"MODE,{j.id},0,0,1,{j.execution_cost:.1f},{j.processing},{j.release},"
                 f"{horizon - j.processing},{j.release + j.processing},{j.hard_deadline},"
                 f"{j.rejection_cost:.1f},0,0" for j in jobs)
    lines.append("")
    return name, horizon, "\n".join(lines)


def main() -> None:
    import sys
    OUT.mkdir(exist_ok=True)
    selected = [a for a in sys.argv[1:] if a in DOMAINS] or list(DOMAINS)
    for domain_key in selected:
        for k, (size_tag, n) in enumerate(SIZES):
            seed = 9100 + 17 * list(DOMAINS).index(domain_key) + k
            name, horizon, text = render(domain_key, size_tag, n, seed)
            (OUT / f"{name}.csv").write_text(text, encoding="utf-8")
            print(f"{name}: {n} jobs, horizon {horizon}, seed {seed}")


if __name__ == "__main__":
    main()
