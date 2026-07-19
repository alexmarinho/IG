# Native scenario workloads

This directory contains six fixed, deterministic MaScLib instances created for
the restaurant-kitchen and surgery-center lenses in IG Studio. They use the
same single-capacity resource, sequence-dependent setup, tardiness, execution,
and rejection objective solved by the original IG engine.

| Instance | Jobs | Families | Modeled horizon |
|---|---:|---:|---:|
| `KITCHEN_SERVICE_60` | 60 dishes | 6 station states | 360 min |
| `KITCHEN_SERVICE_120` | 120 dishes | 6 station states | 720 min |
| `KITCHEN_SERVICE_240` | 240 dishes | 6 station states | 1,320 min |
| `SURGERY_BLOCK_40` | 40 cases | 7 room layouts | 3,600 min |
| `SURGERY_BLOCK_90` | 90 cases | 7 room layouts | 7,200 min |
| `SURGERY_BLOCK_180` | 180 cases | 7 room layouts | 14,400 min |

Kitchen release times combine planned work with fixed last-minute order waves.
The asymmetric setup matrix represents cleaning, preheating, and station
re-preparation. Rejection cost is a generic service-recovery outside option;
it does not prescribe a particular action for a customer.

Surgery readiness times place cases in daily planning blocks. The asymmetric
setup matrix represents room and instrument reconfiguration between specialty
layouts. Rejection cost represents an outside-capacity transfer in the model;
it is not a clinical recommendation.

All values are synthetic and reproducible from committed seeds. They are not
restaurant, hospital, patient, or production records and must not be used for
operational or clinical decisions.

Regenerate the exact CSV files with only the Python standard library:

```sh
python3 tools/gen_domain_instances.py
```

The generated CSVs remain ordinary MaScLib 1.0 files and can be parsed by the
Rust engine, the Python package, and the browser WASM engine without a special
runtime path.
