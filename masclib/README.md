# MaScLib instances

The 44 benchmark instances used in the thesis, from the **Manufacturing Scheduling Library** (Nuijten, Bousonville, Focacci, Godard & Le Pape, 2003) — ILOG CSV format (`ILOG_DATA_SCHEMA,MASC,1.0`). Naming:

- `NCOS_*` — **no setups** at all (Table 4.1 of the thesis, "desconsiderando setup");
- `STC_NCOS_*` — sequence-dependent **setup times and costs** between job families (Table 4.2, "considerando setup");
- the `a` suffix is a second variant of the same size; the number encodes the size tier (01 = 8 jobs … 61 = 500 jobs).

## File format

Each file is a set of sections; every section has a `SECTION|NAMES,...` header row describing its columns, followed by `SECTION,...` data rows. The ones that matter:

| Section | Columns (relevant) | Meaning |
|---|---|---|
| `MODEL` | NAME, START_MIN | instance name, schedule start |
| `RESOURCE` | RESOURCE_ID, CAPACITY | the single machine (capacity 1) |
| `ACTIVITY` | ACTIVITY_ID, SETUP_STATE, PERFORMED_STATUS | one row per job; `SETUP_STATE` = the job's family (STC files only); `PerformedOrUnperformed` = the job may be rejected |
| `SETUP_MATRIX` | FROM_STATE, TO_STATE, SETUP_TIME, SETUP_COST | family×family setup matrix (STC files only; e.g. 9 families → 81 rows) |
| `DUE_DATE` | ACTIVITY_ID, DUE_TIME, TARDINESS_VARIABLE_COST | due date and the linear tardiness penalty per time unit |
| `MODE` | MODE_COST, PROCESSING_TIME, START_MIN, START_MAX, END_MIN, END_MAX, UNPERFORMED_COST | processing time, release date (`START_MIN`), execution window, and the **rejection cost** (`UNPERFORMED_COST`) |

Reference parsers: [`engine/src/instance.rs`](../engine/src/instance.rs), [`python/ig_scheduler.py`](../python/ig_scheduler.py) — and the historical [`legacy/load.py`](../legacy/load.py).

Best-known objective values per instance (and the 2015 results of 8 methods) are in [`../benchmark.json`](../benchmark.json).
