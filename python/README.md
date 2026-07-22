# ig_scheduler — Python reference implementation

This one-file implementation carries the 2015 algorithm forward with zero runtime dependencies, no `deepcopy`, and the incremental evaluation proposed as future work in the original study. It has the same validated objective semantics as the [Rust engine](../engine/), while the untouched 2017 implementation remains under [`legacy/`](../legacy/).

```bash
# install (zero runtime dependencies, Python >= 3.10) — ships the ig-solve CLI
pip install git+https://github.com/alexmarinho/IG
ig-solve masclib/NCOS_31.csv --seconds 5

# or run straight from a checkout — adds the benchmark validation harness
python ig_scheduler.py solve ../masclib/NCOS_31.csv --seconds 5
python ig_scheduler.py validate ../masclib ../benchmark.json --seconds 2
```

As a library:

```python
from ig_scheduler import Instance, solve

inst = Instance.parse("masclib/NCOS_31.csv")
r = solve(inst, seconds=5.0, d=2)
print(r.best_cost, len(r.order), "performed,", len(r.rejected), "rejected")
```

Typical measured speed is **~150–330k candidate evaluations/s** (CPython 3.12+, single core). It is suitable for reading, prototyping and batch experiments; the Rust implementation is the preferred engine for long or performance-sensitive runs. It also parses and solves the [GPU/LLM instances](../masclib-gpu/) unchanged.
