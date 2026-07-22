# IG research notebooks

[![Open English notebook in Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/alexmarinho/IG/blob/master/studio/notebooks/iterated-greedy-experiments.ipynb)
[![Abrir notebook em português no Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/alexmarinho/IG/blob/master/studio/notebooks/iterated-greedy-experiments-pt-br.ipynb)

The two notebooks are complete, synchronized editions of the same executable
study:

- `iterated-greedy-experiments.ipynb` — English.
- `iterated-greedy-experiments-pt-br.ipynb` — Brazilian Portuguese.

Both use the repository's real Python engine, MaScLib instances, and historical
`benchmark.json` data. They contain no cached solver outputs or prerecorded
conclusions.

## What the study establishes

The notebook follows an evidence ladder:

1. It exhaustively enumerates all 109,601 ordered performed subsets of the
   8-job `STC_NCOS_01` instance, proves objective 700 is optimal for that
   instance, and checks whether seeded IG runs reproduce it.
2. It uses `STC_NCOS_15` (30 jobs) to measure paired improvement,
   seed-to-seed dispersion, convergence, tail risk, and one-long-run versus
   multiple-restart portfolios under a fixed total iteration budget.
3. It uses `STC_NCOS_31` (75 jobs, about 10^110 unconstrained plans) to test
   whether the same search creates value at a materially larger scale.
4. It analyzes the historical 44-instance arena separately, including
   coverage, mean relative error, and paired win/tie/loss counts. The notebook
   never presents the historical implementations and current Python runs as a
   hardware-neutral head-to-head experiment.
5. It performs a paired medium-case sensitivity diagnostic, audits one returned
   schedule term by term, and emits a complete reproducibility manifest.
6. It closes with a bilingual Future Work boundary: execution improvements that
   preserve the canonical IG stay here; external OAS benchmarking, reactive
   operator portfolios, hybrid repair, multi-machine models, GPU research, and
   LLM-assisted discovery require a separate research protocol and repository.

Each main section begins with the practical question and ends with a conclusion
computed from the live numbers. Methodological qualifications are available in
expandable notes so the primary path stays concise.

## Run online

Open either badge, connect a standard Colab CPU runtime, and choose **Runtime →
Run all**. The first code cell is a complete, restart-safe initialization: it
checks out the pinned source, installs or verifies the local package and plotting
dependency, loads the protocol, and defines every shared analysis function. Run
that cell again after a runtime reset before resuming an individual section.
Every later cell checks this condition and reports that instruction directly,
rather than failing with an undefined helper. No repository clone, local Python
setup, Google Drive mount, GPU, or uploaded data is required.

Colab may offer a free GPU subject to changing availability and quotas, but
selecting it does not accelerate this notebook's ordinary Python solver. The
Future Work section explains what a separately labelled, batched replica-fleet
experiment would need to prove before GPU results could be compared fairly.

The initialization cell starts from an empty runtime, checks out the immutable
public engine revision recorded in the notebook, runs `python -m pip install`
for the zero-dependency engine package, installs Matplotlib only when the runtime
does not already provide it, loads the bundled inputs, and prints the exact
source commit. GitHub is the canonical notebook source; Colab is the disposable
execution environment. Readers should save changes to their own Drive or GitHub
copy.

The complete default study intentionally executes 30 independent seeds in the
small, medium, and large cases plus portfolio and sensitivity experiments.
Runtime depends on the CPU assigned by Colab; candidate-evaluation counts, not
local seconds, are the reproducible compute context used in quality analysis.

## Run locally

From a repository clone:

```bash
python3 -m venv .venv-notebook
source .venv-notebook/bin/activate       # Windows: .venv-notebook\Scripts\activate
python -m pip install "jupyterlab>=4,<5" "matplotlib>=3.8,<4"
jupyter lab studio/notebooks/iterated-greedy-experiments.ipynb
```

Run all cells in order. Local execution imports `python/ig_scheduler.py` from
that checkout. The final manifest records the active commit and whether the
tree is dirty.

## Rebuild and translation parity

`build_notebooks.py` is the canonical notebook source. It generates both files
and verifies that their cell IDs and code cells are identical after normalizing
the `LANG` constant:

```bash
python3 studio/notebooks/build_notebooks.py
```

Only Markdown prose and localized output labels differ. A Colab `?hl=pt-BR`
parameter is not used as a substitute for a translated notebook.

## Experimental contract

- Seeded `max_iters` runs are deterministic for a fixed engine and Python
  random-stream implementation. Runs never stop early at the published
  reference.
- The 30 seed IDs are sampled without replacement from the 32-bit space using a
  recorded meta-seed.
- Quartiles use linear interpolation over `n - 1` intervals; standard deviation
  uses `n - 1`. Mean and median intervals use seed-level percentile bootstrap.
  Hit-rate intervals use the Wilson score interval.
- Equal outer iterations do not imply equal candidate evaluations. Every live
  comparison reports evaluation counts, and elapsed time is local context only.
- “Published reference” means the value stored in the 2015 benchmark. Only the
  small case is called optimal because the notebook verifies it exhaustively.
- Historical cells are mean (minimum–maximum) relative error over five runs
  under their original protocol. Those ranges are not confidence intervals.
- The deterministic result fingerprint excludes elapsed seconds and timestamps.

The notebooks write no files during execution. Their final cell prints the
manifest and result fingerprint inside the session.
