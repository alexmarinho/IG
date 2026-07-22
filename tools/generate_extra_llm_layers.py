#!/usr/bin/env python3
"""Generate .llm.json semantic layers for the eight extra scenario domains.

Deterministic, stdlib-only. Same schema as generate_llm_layers.py outputs
(instance, source, domain, summary, reading, parts, models, jobs).
Reads CSVs from masclib-domains and writes next to this script.
"""
import csv, json, os, statistics
from collections import defaultdict

CSV_DIR = "/mnt/agents/work/repo/masclib-domains"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Per-domain semantics: labels come from tools/gen_extra_scenarios.py registry.
DOMAINS = {
 "coffee": dict(
   families=["filter-light","espresso-medium","dark-blend","decaf","micro-lot","natural-experimental"],
   fam_attr="roast_profile", machine="one drum coffee roaster (capacity 1), starting from an idle/clean state",
   setup="temperature ramp plus chamber sweep between profiles; decaf requires a deep clean-out for flavor carryover, micro-lots get a careful slow start",
   rejection="co-roaster contract price", money="cents of USD (1 unit = $0.01)",
   classes={3.0:"same-week-wholesale",5.0:"subscription-ship",7.0:"cafe-standing-order"},
   class_targets={2880:"same-week-wholesale",1440:"subscription-ship",720:"cafe-standing-order"},
   day_text=lambda d: f"{round(d):g} 12-hour roast day{'s' if round(d) != 1 else ''}",
   job_noun="roast batches", horizon_days=lambda h: h/720),
 "bakery": dict(
   families=["baguette","sourdough","brioche","cake","pizza","cookie"],
   fam_attr="product_line", machine="one deck oven (capacity 1), starting cold",
   setup="temperature change with steam reset; cooling down to high-heat lines takes longer than heating up (asymmetric), butter lines guard against aroma carryover",
   rejection="buying from an external supplier to keep the shelf stocked", money="cents of USD (1 unit = $0.01)",
   classes={8.0:"counter-opening",5.0:"morning-peak",2.0:"wholesale-route"},
   job_noun="bake batches", horizon_days=lambda h: h/1440),
 "dental": dict(
   families=["zirconia","pmma-provisional","wax-pattern","titanium-abutment","emax-ceramic","peek-framework"],
   fam_attr="material", machine="one CAD/CAM milling machine (capacity 1), starting clean",
   setup="burr and blank change with calibration; titanium demands a switch to cooled tooling plus a full flush afterwards, ceramics get fine calibration",
   rejection="external milling center price", money="cents of USD (1 unit = $0.01)",
   classes={8.0:"chairside-same-day",4.0:"next-appointment",1.5:"lab-standing-order"},
   job_noun="milled restorations", horizon_days=lambda h: h/1440),
 "laser": dict(
   families=["steel-1mm","steel-3mm","aluminium-2mm","acrylic-5mm","wood-mdf-3mm","brass-1mm"],
   fam_attr="material_thickness", machine="one fiber laser cutter (capacity 1), starting idle",
   setup="assist-gas change (O2 to N2 for shiny metals), lens/focus check for brass, deep clean after organics, parameter load per material",
   rejection="outsourced waterjet cutting price", money="cents of USD (1 unit = $0.01)",
   classes={7.0:"hot-job",3.0:"fab-order",1.0:"stock-nesting"},
   job_noun="cut nests", horizon_days=lambda h: h/1440),
 "laundry": dict(
   families=["hotel-white","hotel-color","restaurant-grease","healthcare-barrier","delicate","spa-towel"],
   fam_attr="linen_class", machine="one tunnel washer line (capacity 1), starting clean",
   setup="chemical flush between classes; heavy sanitation after healthcare barrier linen, degrease rinse after restaurant loads",
   rejection="diverting the batch to a sister plant", money="cents of USD (1 unit = $0.01)",
   classes={5.0:"route-am",3.0:"route-pm",1.0:"contract-weekly"},
   job_noun="wash batches", horizon_days=lambda h: h/1440),
 "studio": dict(
   families=["solo-interview","duo-table","video-youtube","audiobook-vo","livestream","branded-set"],
   fam_attr="set_config", machine="one recording studio room (capacity 1), starting from a neutral set",
   setup="set and lighting change; branded sets take the longest to build and strike, livestream rigs get an extra line check",
   rejection="renting an external studio for the session", money="cents of USD (1 unit = $0.01)",
   classes={6.0:"publish-today",3.0:"weekly-slot",1.2:"season-batch"},
   job_noun="recording sessions", horizon_days=lambda h: h/1440),
 "lab": dict(
   families=["hematology","biochemistry","immunology","coagulation","toxicology","microbiology"],
   fam_attr="assay_panel", machine="one clinical chemistry analyzer (capacity 1), starting clean",
   setup="reagent change with calibration and wash; decontamination after toxicology, biological-safety flush after microbiology",
   rejection="send-out to a reference laboratory (numeric modeled option, not a clinical recommendation)",
   money="modeled cost units", classes={9.0:"stat",4.0:"same-day-report",1.5:"routine-panel"},
   job_noun="sample batches", horizon_days=lambda h: h/1440),
 "brewery": dict(
   families=["pilsner","ipa","stout","sour","wheat","lager"],
   fam_attr="beer_style", machine="one brew house (capacity 1), starting clean",
   setup="CIP cleaning plus hop/yeast prep between styles; extra sanitation after sour batches to avoid cross-contamination, dry-hop prep before IPA",
   rejection="contract (gypsy) brewing price", money="cents of USD (1 unit = $0.01)",
   classes={6.0:"tank-window-critical",2.5:"release-scheduled",1.0:"contract-seasonal"},
   class_targets={720:"tank-window-critical",2880:"release-scheduled",7200:"contract-seasonal"},
   job_noun="brew batches", horizon_days=lambda h: h/1440),
}

def parse(path):
    sections = defaultdict(list)
    for row in csv.reader(open(path, newline="")):
        if not row or not row[0] or "|" in row[0] or row[0].startswith("ILOG"): continue
        sections[row[0]].append(row[1:])
    fam = {int(a[0]): int(a[1]) for a in sections["ACTIVITY"]}
    due = {int(d[0]): (int(d[1]), float(d[4])) for d in sections["DUE_DATE"]}
    mode = {int(m[0]): dict(exec=float(m[4]), proc=int(m[5]), rel=int(m[6]), end=int(m[9]), rej=float(m[10]))
            for m in sections["MODE"]}
    setups = [(int(s[1]), int(s[2]), int(s[3]), float(s[4])) for s in sections["SETUP_MATRIX"]]
    return fam, due, mode, setups

def build(domain_key, instance):
    cfg = DOMAINS[domain_key]
    fam, due, mode, setups = parse(os.path.join(CSV_DIR, f"{instance}.csv"))
    n = len(fam)
    start_max = {int(m[1]): int(m[8]) for m in csv.reader(open(os.path.join(CSV_DIR, f"{instance}.csv"), newline="")) if m and m[0] == "MODE"}
    horizon = max(start_max[j] + mode[j]["proc"] for j in mode)  # nominal horizon from START_MAX+proc
    days = cfg["horizon_days"](horizon)
    models = {}
    for fid, label in enumerate(cfg["families"]):
        jobs_in = [j for j in fam if fam[j] == fid]
        inbound = [(t, c) for (p, f, t, c) in setups if f == fid and p != fid and p < len(cfg["families"])]
        clean_in = next((t for (p, f, t, c) in setups if f == fid and p == len(cfg["families"])), 0)
        models[str(fid)] = {
            cfg["fam_attr"]: label,
            "jobs": len(jobs_in),
            "avg_changeover_min_from_other_states": round(statistics.mean(t for t, _ in inbound), 1) if inbound else 0,
            "avg_changeover_cost_from_other_states": round(statistics.mean(c for _, c in inbound), 1) if inbound else 0,
            "changeover_from_clean_min": clean_in,
        }
    tight = sum(1 for j in fam if due[j][0] < mode[j]["rel"] + mode[j]["proc"])
    rej_ratio = statistics.mean(mode[j]["rej"] / mode[j]["exec"] for j in fam)
    jobs = []
    for j in sorted(fam):
        w = due[j][1]
        # Classify by the promise window (due - release), robust to the
        # per-order weight jitter baked into the generators.
        window = due[j][0] - mode[j]["rel"]
        targets = cfg.get("class_targets") or {}
        if targets:
            nearest = min(targets, key=lambda t: abs(t - window))
            service = targets[nearest]
        else:
            service = cfg["classes"].get(w, "custom")
        jobs.append({
            "id": j, "family_id": fam[j], cfg["fam_attr"]: cfg["families"][fam[j]],
            "release": mode[j]["rel"], "processing": mode[j]["proc"], "due": due[j][0],
            "deadline": mode[j]["end"], "tardiness_weight": w,
            "execution_cost": mode[j]["exec"], "rejection_cost": mode[j]["rej"],
            "service_class": service,
        })
    day_txt = cfg["day_text"](days) if "day_text" in cfg else f"{round(days):g} day{'s' if round(days) != 1 else ''} around the clock"
    if tight:
        tight_txt = (f"{round(100*tight/n)}% of jobs would miss their due time even if started the moment they are released, "
                     "so some lateness penalty is structural.")
    else:
        tight_txt = ("Every job could meet its due time if started the moment it is released, "
                     "so lateness here is a sequencing choice, not a structural constraint.")
    summary = (f"A queue of {n} {cfg['job_noun']} for {cfg['machine'].split(',')[0]}, "
               f"spanning {len(cfg['families'])} {cfg['fam_attr'].replace('_',' ')} states over a horizon of {horizon:,} minutes ({day_txt}). "
               f"{tight_txt} "
               f"Rejection (the outside option) averages {rej_ratio:.1f}x the in-house cost.")
    return {
        "instance": instance, "source": f"masclib-domains/{instance}.csv", "domain": domain_key,
        "summary": summary,
        "reading": {
            "machine": cfg["machine"], "time_unit": "minutes", "money_unit": cfg["money"],
            "setup": cfg["setup"], "rejection": cfg["rejection"],
            "note": "numbers identical to the source CSV — synthetic, reproducible from committed seeds; not production records",
        },
        "parts": n, "models": models, "jobs": jobs,
    }

def main():
    import sys
    selected = [a for a in sys.argv[1:] if a in DOMAINS] or list(DOMAINS)
    made = []
    for domain_key in selected:
        for tag, n in (("S", 45), ("M", 90), ("L", 180)):
            instance = f"{domain_key.upper()}_{tag}_{n}"
            doc = build(domain_key, instance)
            out = os.path.join(OUT_DIR, f"{instance}.llm.json")
            json.dump(doc, open(out, "w"), indent=1, ensure_ascii=False)
            made.append(instance)
    print(f"{len(made)} manifests:", *made)

if __name__ == "__main__":
    main()
