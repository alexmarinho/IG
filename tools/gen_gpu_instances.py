#!/usr/bin/env python3
"""Gera instâncias GPU/LLM no formato MaScLib — o problema da monografia
renomeado para 2026: uma GPU servindo vários modelos.

Mapeamento (OAS → fila de inferência):
  família            → modelo (carregar o modelo = setup; mesmo modelo = 0)
  setup time/cost    → tempo de load do modelo / GPU-segundos gastos no load
  job                → request (ou micro-lote) de inferência
  release date       → chegada do request na fila
  processing time    → tempo de inferência
  due date + w       → SLO da classe (interativo/padrão/batch) + multa por s de atraso
  custo de rejeição  → preço de mandar o request para a API de nuvem
  mode cost          → custo marginal de rodar local (energia/desgaste)

Unidades: tempo em segundos; dinheiro em "créditos" (1 crédito ≈ $0,0001),
com granularidade 0,1 — compatível com os pesos fracionários do MaScLib.

Uso: python tools/gen_gpu_instances.py   (escreve em masclib-gpu/)
"""
from __future__ import annotations

import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "masclib-gpu"

# modelos: (nome, load_s, classe de tamanho)
MODELS = [
    ("qwen-7b", 8, "s"),
    ("llama-8b", 9, "s"),
    ("mistral-24b", 22, "m"),
    ("qwen-32b", 30, "m"),
    ("sdxl-img", 15, "s"),
]
GPU_CREDIT_PER_S = 0.5  # custo marginal local (energia + desgaste + oportunidade)

# classes de SLO: (nome, prazo s, multa créditos/s de atraso, share)
SLO = [("interactive", 25, 6.0, 0.45), ("standard", 120, 1.5, 0.40), ("batch", 900, 0.2, 0.15)]

# preço na nuvem por classe de tamanho do modelo (créditos por request)
CLOUD = {"s": (30, 90), "m": (140, 420)}


def gen(name: str, n: int, seed: int, burst: bool, horizon: int) -> str:
    rng = random.Random(seed)
    nm = len(MODELS)
    cold = nm  # estado inicial: GPU vazia

    def pick_slo():
        r, acc = rng.random(), 0.0
        for s in SLO:
            acc += s[3]
            if r <= acc:
                return s
        return SLO[-1]

    jobs = []
    t = 0.0
    for i in range(n):
        if burst and rng.random() < 0.25:
            t += rng.uniform(20, 90)   # vale entre rajadas
        else:
            t += rng.expovariate(n / (horizon * 0.55))
        fam = rng.choices(range(nm), weights=[30, 25, 18, 12, 15])[0]
        size = MODELS[fam][2]
        p = round(rng.uniform(2, 9) if size == "s" else rng.uniform(8, 28))
        slo_name, slo_s, w, _ = pick_slo()
        rel = round(t)
        cloud = round(rng.uniform(*CLOUD[size]))
        jobs.append(dict(id=i, fam=fam, p=max(1, p), rel=rel,
                         due=rel + slo_s, w=w, rej=cloud,
                         mode=round(p * GPU_CREDIT_PER_S, 1), slo=slo_name))

    L = []
    L.append("ILOG_CSV_FORMAT,1.0\n")
    L.append("ILOG_DATA_SCHEMA,MASC,1.0\n")
    L.append("MODEL|NAMES,NAME,START_MIN")
    L.append("MODEL|TYPES,string,int")
    L.append(f"MODEL,{name},0\n")
    L.append("RESOURCE|NAMES,RESOURCE_ID,SETUP_MATRIX_ID,INITIAL_SETUP_STATE,CAPACITY,START_MIN")
    L.append("RESOURCE|TYPES,int,int,int,int,int")
    L.append(f"RESOURCE,0,0,{cold},1,0\n")
    L.append("ACTIVITY|NAMES,ACTIVITY_ID,SETUP_STATE,PERFORMED_STATUS")
    L.append("ACTIVITY|TYPES,int,int,string")
    for j in jobs:
        L.append(f"ACTIVITY,{j['id']},{j['fam']},PerformedOrUnperformed")
    L.append("")
    L.append("SETUP_MATRIX|NAMES,SETUP_MATRIX_ID,FROM_STATE,TO_STATE,SETUP_TIME,SETUP_COST")
    L.append("SETUP_MATRIX|TYPES,int,int,int,int,float")
    for f in range(nm + 1):  # inclui o estado frio
        for g in range(nm):
            if f == g:
                st = 0
            else:
                st = MODELS[g][1] + (0 if f == cold else 2)  # evict + load
            L.append(f"SETUP_MATRIX,0,{f},{g},{st},{round(st * GPU_CREDIT_PER_S, 1)}")
    L.append("")
    L.append("DUE_DATE|NAMES,ACTIVITY_ID,DUE_TIME,TYPE,EARLINESS_VARIABLE_COST,TARDINESS_VARIABLE_COST")
    L.append("DUE_DATE|TYPES,int,int,string,float,float")
    for j in jobs:
        L.append(f"DUE_DATE,{j['id']},{j['due']},End,0,{j['w']}")
    L.append("")
    L.append("MODE|NAMES,ACTIVITY_ID,MODE_ID,RESOURCE_ID,REQUIRED_CAPACITY,MODE_COST,"
             "PROCESSING_TIME,START_MIN,START_MAX,END_MIN,END_MAX,UNPERFORMED_COST,"
             "UNPERFORMED_SETUP_TIME,UNPERFORMED_SETUP_COST")
    L.append("MODE|TYPES,int,int,int,int,float,int,int,int,int,int,float,int,int")
    for j in jobs:
        L.append(f"MODE,{j['id']},0,0,1,{j['mode']},{j['p']},{j['rel']},"
                 f"{horizon - j['p']},{j['rel'] + j['p']},{horizon},{j['rej']},0,0")
    L.append("")
    return "\n".join(L)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    specs = [
        ("GPU_CALM_40", 40, 11, False, 1800),
        ("GPU_RUSH_60", 60, 22, True, 1500),
        ("GPU_HEAVY_120", 120, 33, False, 3600),
    ]
    for name, n, seed, burst, horizon in specs:
        (OUT / f"{name}.csv").write_text(gen(name, n, seed, burst, horizon))
        print(f"{name}: {n} requests, horizonte {horizon}s")


if __name__ == "__main__":
    main()
