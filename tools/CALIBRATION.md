# Calibração de budgets (medida no engine real)

Benchmark do engine WASM em Node via `studio/bench.mjs` (`node bench.mjs INST:BUDGET RUNS`).
Política de tiers: **⚡ ~3s** (S/45 jobs) · **🔥 ~15s** (M/90 jobs, carro-chefe) · **🏔️ ~30s** (L/180, referência).

## Cenários de negócio (instâncias regeneradas em 2026-07-21: tamanhos em camadas + jitter de peso)

| Instância | n | Janela | ms/iter | Budget single | Tempo alvo |
|---|---|---|---|---|---|
| 3DPRINT_FARM_45 | 45 | 5.760 min (4 dias) | 0,0489 | 60.000 | ~2,9s ⚡ |
| 3DPRINT_FARM_90 | 90 | 11.520 min (8 dias) | 0,249 | 60.000 | ~15,0s 🔥 |
| 3DPRINT_FARM_180 | 180 | 23.040 min (16 dias) | 0,876 | 34.000 | ~29,8s 🏔️ |
| COFFEE_S_45 | 45 | 1.440 min (2 dias de 12h) | 0,0195 | 150.000 | ~2,9s ⚡ |
| COFFEE_M_90 | 90 | 2.880 min (4 dias de 12h) | 0,0232 | 640.000 | ~14,9s 🔥 |
| COFFEE_L_180 | 180 | 5.760 min (8 dias de 12h) | 0,0483 | 620.000 | ~30,0s 🏔️ |
| BREWERY_S_45 | 45 | 15.840 min (11 dias) | 0,027 | 110.000 | ~3,0s ⚡ |
| BREWERY_M_90 | 90 | 31.680 min (22 dias) | 0,184 | 80.000 | ~14,7s 🔥 |
| BREWERY_L_180 | 180 | 63.360 min (44 dias) | 0,702 | 43.000 | ~30,2s 🏔️ |

comparisonBudget = single ÷ 10, comparisonRuns = 10, d = 2 (como antes).

## Factory (MaScLib, original — mantido da rodada anterior)

- NCOS_31/51 e STC pequenas: budgets originais (sub-segundo a poucos segundos).
- NCOS_61 / STC_NCOS_61 (500 jobs): 650 iterações com rótulo honesto "escala extrema — qualidade limitada pelo tempo" (~30s).

## Notas de dados

- Geradores: `tools/gen_print3d_instances.py` (seeds 8101/8127/8151), `tools/gen_extra_scenarios.py coffee brewery` (seeds 9100+k / 9219+k).
- Mudanças desta rodada: tempos de processamento em camadas (45% pequenos / 40% médios / 15% grandes),
  multa por atraso com jitter ±20–30% em torno da âncora da classe (jobs auditáveis parecem negociações reais),
  torra com dia de 12h e alvo de carga 100% (horizonte S/M/L = 2/4/8 dias).
- `instance-stats.js` usa a **janela real** (`max START_MAX+proc`) — datas de entrega podem passar da janela.
