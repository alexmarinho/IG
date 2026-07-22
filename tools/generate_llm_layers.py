#!/usr/bin/env python3
"""Generate .llm.json semantic layers for the masclib-domains scenario CSVs.

Deterministic, standard-library only. Reads the ILOG/MASC CSVs from
/mnt/agents/work/repo/masclib-domains and writes one <INSTANCE>.llm.json per
instance next to this script. See TEMPLATE.md for the schema and all
derivation rules. Re-run after any CSV regeneration.
"""

import csv
import json
import os
import statistics
from collections import Counter, defaultdict

CSV_DIR = "/mnt/agents/work/repo/masclib-domains"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# Fixed domain vocabulary (see TEMPLATE.md "Family naming rules")
# ---------------------------------------------------------------------------

# Kitchen / surgery family names are assigned once, by job frequency in the
# smallest instance of the domain (ties broken by lower state id); the same
# map is then reused for every size so families keep stable names.
KITCHEN_NAME_ORDER = ["fish", "steak", "soup", "salad", "dessert", "vegan"]
KITCHEN_REFERENCE = "KITCHEN_SERVICE_60"
SURGERY_NAME_ORDER = ["neurological", "thoracic", "cardiac", "orthopedic",
                      "vascular", "ent", "general"]
SURGERY_REFERENCE = "SURGERY_BLOCK_40"

# 3D-print family order is fixed by the canonical generator itself.
PRINT_FAMILY_NAMES = {0: "PLA", 1: "PETG", 2: "TPU", 3: "ASA",
                      4: "PA-CF", 5: "PLA-silk"}

KITCHEN_COURSE = {"fish": "main", "steak": "main", "soup": "starter",
                  "salad": "starter", "dessert": "dessert", "vegan": "main"}
KITCHEN_STATION = {
    "fish": "plancha and poaching station",
    "steak": "high-heat grill and cast-iron station",
    "soup": "stockpot range and blending station",
    "salad": "cold prep and assembly station",
    "dessert": "oven and pastry-plating station",
    "vegan": "dedicated plant-based station",
}
SURGERY_LAYOUT = {
    "neurological": "microscope and neuro-navigation layout",
    "thoracic": "thoracoscopy and lateral-access layout",
    "cardiac": "bypass-machine and sternal-access layout",
    "orthopedic": "traction table and power-instrument layout",
    "vascular": "C-arm fluoroscopy and endovascular layout",
    "ent": "head-and-neck microsurgery layout",
    "general": "general laparoscopy layout",
}
PRINT_NOMINAL_HORIZON = {"3DPRINT_FARM_45": 5760, "3DPRINT_FARM_90": 11520,
                         "3DPRINT_FARM_180": 23040}

# Exact-weight service classes in the regenerated 3D-print CSVs.
PRINT_SERVICE_CLASS = {6.0: "same-day", 2.5: "express", 0.6: "standard"}


# ---------------------------------------------------------------------------
# CSV parsing (ILOG CSV 1.0 / MASC schema)
# ---------------------------------------------------------------------------

def parse_csv(path):
    sections = defaultdict(list)
    with open(path, newline="") as fh:
        for row in csv.reader(fh):
            if not row or not row[0] or row[0].endswith("|NAMES") \
                    or row[0].endswith("|TYPES") \
                    or row[0] in ("ILOG_CSV_FORMAT", "ILOG_DATA_SCHEMA"):
                continue
            sections[row[0]].append(row[1:])
    family = {int(a[0]): int(a[1]) for a in sections["ACTIVITY"]}
    mode = {}
    for m in sections["MODE"]:
        mode[int(m[0])] = {
            "exec_cost": float(m[4]), "proc": int(m[5]),
            "release": int(m[6]), "deadline": int(m[9]),
            "rejection": float(m[10]),
        }
    due = {int(d[0]): {"due": int(d[1]), "weight": float(d[4])}
           for d in sections["DUE_DATE"]}
    setup = {(int(r[1]), int(r[2])): (int(r[3]), float(r[4]))
             for r in sections["SETUP_MATRIX"]}
    initial_state = int(sections["RESOURCE"][0][2])
    return family, mode, due, setup, initial_state


# ---------------------------------------------------------------------------
# Derivation rules (deterministic — see TEMPLATE.md)
# ---------------------------------------------------------------------------

def freq_name_map(counts, name_order):
    """Assign names by descending job count, ties by lower state id."""
    order = sorted(counts, key=lambda s: (-counts[s], s))
    return {state: name_order[i] for i, state in enumerate(order)}


def priority_class(weight):
    if weight >= 4.0:
        return "high"
    if weight >= 2.0:
        return "standard"
    return "low"


def service_class(weight):
    if weight in PRINT_SERVICE_CLASS:
        return PRINT_SERVICE_CLASS[weight]
    # Fallback band rule, only used if a future CSV adds new weights.
    if weight >= 4.0:
        return "same-day"
    if weight >= 2.0:
        return "express"
    return "standard"


def part_classes(jobs):
    """Tertiles of rejection_cost (ties broken by id):
    lowest third -> prototype, middle third -> production, top third -> spare."""
    ordered = sorted(jobs, key=lambda j: (j["rejection_cost"], j["id"]))
    n = len(ordered)
    labels = ["prototype", "production", "spare"]
    out = {}
    for rank, job in enumerate(ordered):
        out[job["id"]] = labels[min(2, (3 * rank) // n)]
    return out


def lateness_sentence(jobs, noun_singular, noun_plural, due_term, late_term,
                      fam_states=None, setup=None):
    """Second summary sentence. Structurally late = due < release + processing
    (cannot finish on time even if started at release, ignoring setups)."""
    slacks = [j["due_min"] - (j["release_min"] + j["processing_min"])
              for j in jobs]
    late = sum(1 for s in slacks if s < 0)
    if late:
        pct = round(100 * late / len(jobs))
        return (f"{pct}% of the {noun_plural} would miss their {due_term} "
                f"even if started the moment they are released, so some "
                f"{late_term} is unavoidable.")
    median = statistics.median(slacks)
    if fam_states is not None and setup is not None and median < 120:
        times = [setup[(f, t)][0] for f in fam_states for t in fam_states
                 if f != t]
        return (f"No {noun_singular} is structurally late — median slack "
                f"between the earliest possible finish and the {due_term} is "
                f"{median:g} minutes, against setup times of {min(times)}-"
                f"{max(times)} minutes — so sequencing, not the clock, "
                f"decides which {noun_plural} end up late.")
    return (f"No {noun_singular} is structurally late: every one could "
            f"still meet its {due_term} if started the moment it is "
            f"released.")


def mean_setup_in(state, family_states, setup):
    times = [setup[(f, state)][0] for f in family_states if f != state]
    costs = [setup[(f, state)][1] for f in family_states if f != state]
    return round(statistics.mean(times), 1), round(statistics.mean(costs), 1)


# ---------------------------------------------------------------------------
# Domain-specific builders
# ---------------------------------------------------------------------------

def build_kitchen(name, family, mode, due, setup, initial_state):
    counts = Counter(family.values())
    fmap = kitchen_family_map  # canonical, derived from KITCHEN_SERVICE_60
    jobs = []
    for i in sorted(family):
        m, d = mode[i], due[i]
        fam_name = fmap[family[i]]
        jobs.append({
            "id": i,
            "family": fam_name,
            "course": KITCHEN_COURSE[fam_name],
            "release_min": m["release"],
            "processing_min": m["proc"],
            "due_min": d["due"],
            "deadline_min": m["deadline"],
            "tardiness_weight": d["weight"],
            "exec_cost": m["exec_cost"],
            "rejection_cost": m["rejection"],
        })
    models = {}
    fam_states = sorted(counts)
    for state in fam_states:
        fam_name = fmap[state]
        t, c = mean_setup_in(state, fam_states, setup)
        models[str(state)] = {
            "family": fam_name,
            "course": KITCHEN_COURSE[fam_name],
            "station": KITCHEN_STATION[fam_name],
            "jobs": counts[state],
            "avg_reset_min_from_other_families": t,
            "avg_reset_cost_from_other_families": c,
        }
    horizon = max(j["deadline_min"] for j in jobs)
    sent2 = lateness_sentence(jobs, "order", "orders",
                              "acceptable service time",
                              "late-service consequence",
                              fam_states=fam_states, setup=setup)
    ratio = round(statistics.mean(j["rejection_cost"] / j["exec_cost"] for j in jobs), 1)
    hours = round(horizon / 60, 1)
    summary = (
        f"A {len(jobs)}-dish service snapshot for one modeled cooking station, "
        f"spread across {len(models)} station families over a {horizon}-minute "
        f"({hours}-hour) horizon. {sent2} Modeled "
        f"service-recovery outside options average {ratio}x the dish's own "
        f"preparation cost."
    )
    return {
        "instance": name,
        "source": f"masclib-domains/{name}.csv",
        "domain": "kitchen",
        "summary": summary,
        "reading": {
            "machine": "one modeled cooking station (capacity 1)",
            "time_unit": "minutes",
            "money_unit": "tenths of USD (1.0 unit ≈ $0.10)",
            "setup": "station reset/re-preparation between dish families "
                     "(cleaning, preheating, tool swap) — time and cost from "
                     "the setup matrix",
            "rejection": "service-recovery outside option (substitution, "
                         "discount or cancellation) — not a specific customer "
                         "action",
            "note": "numbers are identical to the source CSV — only the "
                    "semantics layer is new; all values are synthetic and "
                    "reproducible from committed seeds, not operational "
                    "restaurant data",
        },
        "dishes": len(jobs),
        "models": models,
        "jobs": jobs,
    }


def build_surgery(name, family, mode, due, setup, initial_state):
    counts = Counter(family.values())
    fmap = surgery_family_map  # canonical, derived from SURGERY_BLOCK_40
    jobs = []
    for i in sorted(family):
        m, d = mode[i], due[i]
        jobs.append({
            "id": i,
            "family": fmap[family[i]],
            "priority_class": priority_class(d["weight"]),
            "ready_day": m["release"] // 720 + 1,
            "release_min": m["release"],
            "processing_min": m["proc"],
            "due_min": d["due"],
            "deadline_min": m["deadline"],
            "tardiness_weight": d["weight"],
            "exec_cost": m["exec_cost"],
            "rejection_cost": m["rejection"],
        })
    models = {}
    fam_states = sorted(counts)
    for state in fam_states:
        fam_name = fmap[state]
        t, c = mean_setup_in(state, fam_states, setup)
        models[str(state)] = {
            "specialty": fam_name,
            "room_layout": SURGERY_LAYOUT[fam_name],
            "jobs": counts[state],
            "avg_reconfiguration_min_from_other_specialties": t,
            "avg_reconfiguration_cost_from_other_specialties": c,
        }
    horizon = max(j["deadline_min"] for j in jobs)
    days = horizon // 720
    sent2 = lateness_sentence(jobs, "case", "cases",
                              "modeled clinical target",
                              "modeled delay consequence")
    ratio = round(statistics.mean(j["rejection_cost"] / j["exec_cost"] for j in jobs), 1)
    summary = (
        f"A {len(jobs)}-case planning block for one modeled operating room, "
        f"spanning {len(models)} specialty layouts over {horizon:,} minutes "
        f"({days} operating days of 12 hours). {sent2} Modeled "
        f"outside-capacity transfers average {ratio}x the procedure execution "
        f"cost."
    )
    return {
        "instance": name,
        "source": f"masclib-domains/{name}.csv",
        "domain": "surgery",
        "summary": summary,
        "reading": {
            "machine": "one modeled operating room (capacity 1)",
            "time_unit": "minutes",
            "money_unit": "modeled cost units (synthetic, no currency mapping)",
            "setup": "room and instrument reconfiguration between specialty "
                     "layouts — time and cost from the setup matrix",
            "rejection": "outside-capacity transfer — a numeric modeling "
                         "option, never a clinical recommendation",
            "note": "numbers are identical to the source CSV — only the "
                    "semantics layer is new; all values are synthetic and "
                    "reproducible from committed seeds, not hospital or "
                    "patient data, and must not guide care",
        },
        "cases": len(jobs),
        "models": models,
        "jobs": jobs,
    }


def build_print(name, family, mode, due, setup, initial_state):
    counts = Counter(family.values())
    fmap = PRINT_FAMILY_NAMES
    pclass = part_classes([
        {"id": i, "rejection_cost": mode[i]["rejection"]} for i in family])
    jobs = []
    for i in sorted(family):
        m, d = mode[i], due[i]
        jobs.append({
            "id": i,
            "family": fmap[family[i]],
            "service_class": service_class(d["weight"]),
            "part_class": pclass[i],
            "release_min": m["release"],
            "processing_min": m["proc"],
            "due_min": d["due"],
            "deadline_min": m["deadline"],
            "tardiness_weight": d["weight"],
            "exec_cost": m["exec_cost"],
            "rejection_cost": m["rejection"],
        })
    models = {}
    fam_states = sorted(counts)
    for state in fam_states:
        fam_name = fmap[state]
        t, c = mean_setup_in(state, fam_states, setup)
        abrasive = fam_name == "PA-CF"
        entry = {
            "material": fam_name,
            "nozzle": "hardened-steel (abrasive-rated)" if abrasive
                      else "standard brass",
            "requires_nozzle_swap": abrasive,
            "jobs": counts[state],
            "avg_changeover_min_from_other_materials": t,
            "avg_changeover_cost_from_other_materials": c,
        }
        if (initial_state, state) in setup:
            entry["changeover_from_clean_min"] = setup[(initial_state, state)][0]
        models[str(state)] = entry
    nominal = PRINT_NOMINAL_HORIZON[name]
    days = nominal // 1440
    latest = max(j["deadline_min"] for j in jobs)
    horizon_txt = f"a queue horizon of {nominal:,} minutes ({days} days " \
                  "around the clock"
    horizon_txt += ")" if latest == nominal else \
        f"; latest job deadline at minute {latest:,})"
    sent2 = lateness_sentence(jobs, "part", "parts", "due time",
                              "late-delivery penalty")
    ratio = round(statistics.mean(j["rejection_cost"] / j["exec_cost"] for j in jobs), 1)
    summary = (
        f"A {len(jobs)}-part queue for one FDM printer, spanning {len(models)} "
        f"filament materials over {horizon_txt}. {sent2} "
        f"Outsourced partner-farm prints average {ratio}x the in-house print "
        f"cost."
    )
    return {
        "instance": name,
        "source": f"masclib-domains/{name}.csv",
        "domain": "3dprint",
        "summary": summary,
        "reading": {
            "machine": "one FDM 3D printer (capacity 1), starting from a "
                       "clean/empty state",
            "time_unit": "minutes",
            "money_unit": "cents of USD (1 unit = $0.01)",
            "setup": "filament unload/purge/load between materials, plus a "
                     "hardened-nozzle swap when switching to the abrasive "
                     "PA-CF family (visible as the largest setup-matrix "
                     "column)",
            "rejection": "outsourced partner-farm print",
            "note": "numbers are identical to the source CSV — only the "
                    "semantics layer is new; all values are synthetic and "
                    "reproducible from committed seeds, not production "
                    "records",
        },
        "parts": len(jobs),
        "models": models,
        "jobs": jobs,
    }


# ---------------------------------------------------------------------------
# Canonical family maps + main
# ---------------------------------------------------------------------------

_kf, _, _, _, _ = parse_csv(os.path.join(CSV_DIR, KITCHEN_REFERENCE + ".csv"))
kitchen_family_map = freq_name_map(Counter(_kf.values()), KITCHEN_NAME_ORDER)
_sf, _, _, _, _ = parse_csv(os.path.join(CSV_DIR, SURGERY_REFERENCE + ".csv"))
surgery_family_map = freq_name_map(Counter(_sf.values()), SURGERY_NAME_ORDER)

BUILDERS = {"KITCHEN_SERVICE": build_kitchen,
            "SURGERY_BLOCK": build_surgery,
            "3DPRINT_FARM": build_print}

INSTANCES = ["KITCHEN_SERVICE_60", "KITCHEN_SERVICE_120", "KITCHEN_SERVICE_240",
             "SURGERY_BLOCK_40", "SURGERY_BLOCK_90", "SURGERY_BLOCK_180",
             "3DPRINT_FARM_45", "3DPRINT_FARM_90", "3DPRINT_FARM_180"]


def main():
    print("kitchen family map:", kitchen_family_map)
    print("surgery family map:", surgery_family_map)
    for name in INSTANCES:
        parsed = parse_csv(os.path.join(CSV_DIR, name + ".csv"))
        prefix = name.rsplit("_", 1)[0]
        doc = BUILDERS[prefix](name, *parsed)
        out = os.path.join(OUT_DIR, name + ".llm.json")
        with open(out, "w") as fh:
            json.dump(doc, fh, indent=1, ensure_ascii=False)
            fh.write("\n")
        print(f"wrote {out}: {len(doc['jobs'])} jobs, "
              f"{len(doc['models'])} families")


if __name__ == "__main__":
    main()
