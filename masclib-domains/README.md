# Native scenario workloads

This directory contains fifteen fixed, deterministic MaScLib instances created
for the scenario lenses in IG Studio and on the published page: a restaurant
kitchen, a surgery center, a coffee roastery, a craft brewery and a 3D print
farm. They use the same single-capacity resource, sequence-dependent setup,
tardiness, execution, and rejection objective solved by the original IG engine.

## Kitchen and surgery

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

## Coffee roastery, craft brewery and 3D print farm

| Instance | Jobs | Families | Modeled horizon |
|---|---:|---:|---:|
| `COFFEE_S_45` | 45 roast batches | 6 roast profiles | 1,440 min |
| `COFFEE_M_90` | 90 roast batches | 6 roast profiles | 2,880 min |
| `COFFEE_L_180` | 180 roast batches | 6 roast profiles | 5,760 min |
| `BREWERY_S_45` | 45 brews | 6 beer styles | 15,840 min |
| `BREWERY_M_90` | 90 brews | 6 beer styles | 31,680 min |
| `BREWERY_L_180` | 180 brews | 6 beer styles | 63,360 min |
| `3DPRINT_FARM_45` | 45 print orders | 6 filament states | 5,760 min |
| `3DPRINT_FARM_90` | 90 print orders | 6 filament states | 11,520 min |
| `3DPRINT_FARM_180` | 180 print orders | 6 filament states | 23,040 min |

The roastery switches between roast profiles, where changeovers dominate. The
brewery has the longest single changeover, a cleaning cycle between styles. The
print farm swaps filament and nozzle, and is loaded beyond its capacity on
purpose, so refusing work (sending it to a partner farm) is part of every good
schedule.

## Provenance

All values are synthetic and reproducible from committed seeds. They are not
restaurant, hospital, patient, roastery, brewery or production records and must
not be used for operational or clinical decisions. Regenerate the
exact CSV files with only the Python standard library:

```sh
python3 tools/gen_domain_instances.py                 # kitchen and surgery
python3 tools/gen_extra_scenarios.py coffee brewery   # roastery and brewery
python3 tools/gen_print3d_instances.py                # 3D print farm
```

`gen_extra_scenarios.py` also registers six more domains (bakery, dental milling
lab, laser cutting, industrial laundry, podcast and video studio, clinical
testing lab) whose CSVs are not committed. Run it with
no arguments only if you mean to add them.

The generated CSVs remain ordinary MaScLib 1.0 files and can be parsed by the
Rust engine, the Python package, and the browser WASM engine without a special
runtime path.
