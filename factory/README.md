# factory — the LLM heuristic factory

An LLM writes and evolves the metaheuristic's own destroy operator, scored by the fast engines. This is where the repo's name turns doubly true: the algorithm *schedules LLM inference*, and an LLM *designs the algorithm*.

The approach follows FunSearch / EoH / ReEvo and the 2026 IG-DOE result (LLM-evolved destroy operators beating the state of the art on flow shop): an LLM proposes a candidate operator, a fast harness scores it on real instances, evolution keeps the winners.

## The evolvable slot

Each Iterated Greedy iteration removes `d` scheduled jobs so greedy repair can rebuild a cheaper schedule — *which* jobs you disturb is the whole game. A candidate is a function scoring one scheduled job (higher = more likely removed) over these features:

`late`, `slack`, `proc`, `setup_credits`, `reject_credits`, `position`, `weight`

The harness ([`harness.py`](harness.py)) removes the top-`d` scorers, runs the IG for a fixed iteration budget on a **train split** of MaScLib instances, and returns the mean relative gap to the best-known values. A **held-out test split** measures generalization. Random destruction is the baseline every candidate must beat — and a naive hand-written heuristic scores *worse* than random, so there is real work to do.

## Run it

**Offline (no API key, runs in CI):** a built-in mutation backend over a feature basis proves the loop and evolves a real operator.

```bash
python factory/evolve.py --backend local --gens 8 --pop 12
```

**With an LLM (free-form Python operators):** any OpenAI-compatible endpoint; DeepSeek by default.

```bash
cp .env.example .env        # then put your key in .env
set -a; . ./.env; set +a
python factory/evolve.py --backend llm --gens 6 --pop 8
```

The script passes `os.environ` straight through to the endpoint and never stores your key; `.env` is gitignored.

## Results

See [RESULTS.md → the LLM heuristic factory](../RESULTS.md#the-llm-heuristic-factory) for the evolved operators, their train/test gaps vs. the random baseline, and the honest read on when an evolved destroy helps.

## Extending

- **Change the slot:** evolve the repair scoring or the acceptance criterion instead — same harness shape, swap what `destroy_fn`/`solve` receives.
- **Score with the GPU fleet:** [`gpu/`](../gpu/) is the natural scorer when a campaign needs thousands of candidate evaluations per generation.
- **Bring a stronger LLM:** point `OPENAI_BASE_URL`/`OPENAI_MODEL` at a local model on your GPU (vLLM/Ollama) or a frontier API — the loop is identical.

Cost note: the academically-reproducible tier (EoH/ReEvo) reaches useful operators in ~1,000 LLM samples; at DeepSeek pricing a campaign is a few dollars. The binding constraint is evaluator wall-clock, not tokens — which is exactly why the fast engines exist.
