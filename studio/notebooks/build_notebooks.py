#!/usr/bin/env python3
"""Build the synchronized English and Brazilian Portuguese research notebooks.

The notebooks deliberately share every code cell. Only the prose and the
LANG constant differ, which keeps the executed evidence identical while
allowing each edition to read naturally.
"""
from __future__ import annotations

import json
from pathlib import Path
from textwrap import dedent


HERE = Path(__file__).resolve().parent
PUBLIC_COMMIT = "v2.0.0"


def lines(text: str) -> list[str]:
    text = dedent(text).strip("\n")
    chunks = text.splitlines(keepends=True)
    if chunks and not chunks[-1].endswith("\n"):
        chunks[-1] += "\n"
    return chunks


def markdown(cell_id: str, text: str) -> dict:
    return {
        "cell_type": "markdown",
        "id": cell_id,
        "metadata": {},
        "source": lines(text),
    }


SETUP_GUARD = """
if not globals().get('IG_NOTEBOOK_READY', False):
    raise RuntimeError(
        'Run the “Initialize environment and protocol” cell first / '
        'Execute primeiro a célula “Inicializar ambiente e protocolo”.'
    )
"""


def code(cell_id: str, text: str, lang: str, *, requires_setup: bool = True) -> dict:
    if requires_setup:
        text = f"{SETUP_GUARD}\n\n{text}"
    return {
        "cell_type": "code",
        "execution_count": None,
        "id": cell_id,
        "metadata": {},
        "outputs": [],
        "source": lines(text.replace("__LANG__", lang)),
    }


PROSE = {
    "en": {
        "title": """
            # Iterated Greedy, from exact proof to large-instance evidence

            [![Open English notebook in Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/alexmarinho/IG/blob/master/studio/notebooks/iterated-greedy-experiments.ipynb)
            [Português](https://colab.research.google.com/github/alexmarinho/IG/blob/master/studio/notebooks/iterated-greedy-experiments-pt-br.ipynb)

            A single machine must decide **which jobs to perform, in what order, and which jobs to reject**. Release times, hard deadlines, tardiness costs, rejection costs, and sequence-dependent tool changes interact. Testing every possible plan becomes impossible quickly, so Iterated Greedy (IG) uses controlled randomness to remove a small part of a feasible plan, rebuild it, and retain useful discoveries.

            This notebook runs the repository's real Python engine on real MaScLib instances. It builds an evidence ladder instead of presenting one fortunate run:

            1. **Small · 8 jobs:** enumerate all 109,601 partial schedules and prove the optimum for this model instance.
            2. **Medium · 30 jobs:** measure reliability, tail risk, convergence, and restart strategies across independent seeds.
            3. **Large · 75 jobs:** test whether the same search still creates value when the unconstrained plan space is about $10^{110}$.
            4. **Historical arena · 44 instances:** place the live runs beside the published 2015 comparison, while keeping their protocols strictly separate.

            **Two reading depths.** Each section opens with the decision question and a numerical conclusion. Expand the methodology notes when audit detail matters. A standard CPU runtime is sufficient; no GPU, upload, or Google Drive mount is required.

            > Every displayed result is computed when the cells run. The notebook ships without cached outputs. “Published reference” means the value recorded in the 2015 benchmark; only the 8-job result is called an optimum, because it is exhaustively verified here.
        """,
        "model": """
            ## 1. What is being optimized?

            For performed order $\\pi$ and rejected set $\\Omega$, the engine minimizes

            $$f(\\pi,\\Omega)=C_{setup}+C_{mode}+C_{tardiness}+C_{rejection}.$$

            A useful physical translation is one CNC work center. A job is a production order; its family is the required fixture/tool state; a family change consumes setup time and cost; lateness incurs a priority-weighted charge; leaving an order off this machine incurs its explicit rejection cost. This is a repeatable scheduling model, not a claim that the benchmark files are factory telemetry.

            One IG iteration removes $d$ scheduled jobs, reinserts each at the least-cost feasible position (or leaves it rejected), optionally exchanges performed and rejected jobs, and continues the walk. Randomness proposes where to search; the deterministic objective decides what is better.

            <details>
            <summary>Experimental contract</summary>

            - Fixed `max_iters` budgets make seeded trajectories deterministic for a fixed engine and Python random-stream implementation.
            - Runs never stop early at the published reference.
            - Equal outer iterations do not imply equal candidate-evaluation cost; evaluation counts are always reported.
            - Seed dispersion and bootstrap intervals are conditional on the documented instance, configuration, budget, runtime, and seed design. They are not optimality guarantees.
            - Live Python runs, transparent priority rules, and historical 2015 results are three different evidence sources and are never presented as one hardware-neutral race.
            </details>
        """,
        "setup": """
            ## 2. Reproducible environment and protocol

            Run the next cell once. It is the notebook's complete bootstrap: from an empty Colab runtime it checks out an immutable public engine revision, installs or verifies every runtime dependency, loads the bundled instances and benchmark, and defines the shared analysis functions. In a repository clone it uses that checkout. If the runtime restarts, run this one cell again before resuming any section; every later cell now checks that initialization explicitly. The final manifest records source hashes, versions, seeds, budgets, and a deterministic result fingerprint.
        """,
        "landscape": """
            ## 3. Three cases, one mathematical model

            **Question:** what changes when the number of jobs grows but release dates, deadlines, rejection, and sequence-dependent setups remain part of the same decision?

            The horizontal position below is the base-10 exponent of the number of ordered performed subsets before feasibility constraints:

            $$\\sum_{k=0}^{n}P(n,k)=\\lfloor e\\,n!\\rfloor.$$

            This is not the number of solutions the algorithm evaluates; it shows why exhaustive search stops being a viable strategy after the small case.
        """,
        "small": """
            ## 4. Small case — can the answer be verified exactly?

            **Question:** does IG merely look plausible, or does it reach the true optimum when exhaustive verification is still possible?

            The first cell enumerates every ordered performed subset, including the empty plan and every possible rejected set. The second runs 30 seeded IG searches and five transparent priority-insertion rules. This separates a correctness check from a stochastic performance claim.

            <details>
            <summary>What the priority rules do</summary>

            EDD, shortest processing time, release order, rejection-density, and least-slack determine only the order in which jobs are considered. Each considered job is still tested in every current insertion position and inserted only when the complete objective decreases; otherwise it remains rejected. These are strong, auditable one-pass baselines—not the external algorithms from the historical study.
            </details>
        """,
        "medium": """
            ## 5. Medium case — is one successful seed representative?

            **Question:** how much does the full IG loop improve its own construction, how variable are independent runs, and when do restarts help?

            All 30 seeds receive 200 outer iterations. For every seed, the notebook records three paired stages: direct construction, construction plus performed/rejected exchange, and full IG. It then examines convergence and compares one longer run with several shorter independent runs under the same total iteration budget.

            <details>
            <summary>How to read the statistics</summary>

            Q1–Q3 and sample standard deviation describe the observed seed outcomes. Mean and median intervals use a seed-level percentile bootstrap. Hit-rate intervals use Wilson's binomial interval, which behaves better near 0% and 100% with 30 trials. The fixed-total-budget portfolio experiment is exploratory: restarts repeat initialization, so candidate evaluations—not iterations alone—decide the actual compute difference.
            </details>
        """,
        "large": """
            ## 6. Large case — does the search still create value at $10^{110}$ possibilities?

            **Question:** with 75 jobs and sequence-dependent setups, does IG materially improve the feasible plan it starts from, and how often does a finite budget reach the published reference?

            Thirty independent seeds receive 500 outer iterations. This is large enough to expose both substantial improvement and residual stochastic risk while remaining practical in a standard Colab CPU session. It is not a claim about the 200- and 500-job limits of the full benchmark suite.
        """,
        "history": """
            ## 7. Historical arena — how did IG compare with other methods?

            **Question:** across the published 44-instance benchmark, where was IG genuinely strong and where was it not?

            The repository's `benchmark.json` stores mean (minimum–maximum) relative error over five historical runs per cell. The 2015 protocol gave the heuristics $n\\times30$ seconds per run; the IG implementation ran in VBA on an i7 2.3 GHz, the literature heuristics in C++ on an i7 2.93 GHz, and MILP received one hour. Therefore this section compares recorded **solution quality**, not current runtime, and it is not mixed with the live Python experiments above.

            Error is relative to the published reference; lower is better. NCOS contains 30 instances without setup transitions. STC contains 14 instances with setup time and cost.
        """,
        "sensitivity": """
            ## 8. What should be analyzed next?

            **Question:** is the medium-case conclusion robust to a wider destruction, restart-from-incumbent behavior, or removal of the exchange pass?

            This paired diagnostic reuses 20 baseline seeds, changes one design choice at a time, and adds a longer `d=2` control so `d=2` and `d=8` can be read at nearly matched evaluation counts. It can identify a promising hypothesis—especially tail-risk reduction—but it is not configuration selection for unseen instances.
        """,
        "audit": """
            ## 9. Audit one returned schedule

            The best medium-case run is useful only if its objective can be reconstructed. The next cell verifies that every job is performed or rejected exactly once, recomputes ASAP timing, checks every hard deadline, and closes setup + mode + tardiness + rejection to the engine's returned objective in integer tenths.

            The schedule figure shows the physical consequence of the order: hatched intervals are tool/setup changes; colored intervals are processing; downward markers are due dates. The decomposition underneath explains why a visually longer plan can still be cheaper once rejection and tardiness are included.
        """,
        "conclusion": """
            ## 10. Conclusions and research boundary

            The next cell writes the numerical conclusion from the executed evidence, so it cannot drift away from the results. The short reading is for a first-time visitor; the research reading states the qualification and the next defensible experiment.

            <details>
            <summary>What this notebook does not establish</summary>

            Three live cases do not represent all 44 instances. A published reference is not automatically a proven optimum. Equal iteration budgets are not equal runtime or equal candidate-evaluation budgets. The historical competitor results were not rerun in this Python environment. Post-hoc removal of the two difficult 200-job STC cases diagnoses concentration of error; it does not create a new benchmark score.

            The two 200-job STC cases are the important boundary: they account for most of historical IG's setup-case error. The current pinned Python implementation uses fixed destruction size and does not reproduce the adaptive destruction ramp documented elsewhere in the repository. Testing adaptive destruction under held-out instances and matched compute is therefore the next experiment—not a result claimed here.
            </details>
        """,
        "future": """
            ## 11. Future work — what belongs in the next repository?

            The evidence above freezes a clear baseline. The canonical repository should preserve the original objective and IG walk, while evaluator arithmetic, packaging, Rust/Python parity, and batch execution may become faster here only when trajectory and pricing tests remain unchanged. A separate research repository should host new search policies and mathematical models. Its link should be added here only after its first variant has a reproducible benchmark and a held-out result.

            Some hypotheses already have exploratory implementations in this repository and must become **baselines**, not be announced again as new ideas: the adaptive destruction ramp has both positive and negative cases; the GPU fleet is currently launch-overhead-bound; and the first learned destroy operators did not generalize on fresh seeds. These [engineering results](https://github.com/alexmarinho/IG/blob/master/RESULTS.md) motivate the roadmap but are outside this notebook's executed protocol.

            | Priority | Hypothesis | Evidence required before adoption |
            |---|---|---|
            | **P0 · external credibility** | Run canonical and adaptive IG on the modern OAS/Sparrow suite before adding complexity. | Declared train/validation/test families; fixed-time and fixed-evaluation runs; paired seeds, anytime curves, time-to-target, tail quantiles, exact bounds on small cases, and current published baselines. |
            | **P1 · reactive operator portfolio** | Retain random removal and add stochastic block, related-family, costly-edge, tardiness, and rejection-aware operators; adapt selection by improvement per unit time. | Ablations against random and adaptive-$d$ IG, tuned tabu/ALNS, fresh instance families, and a minimum-exploration rule. No deterministic top-$d$ shortcut. |
            | **P2 · hybrid exact repair** | Optimize only a destroyed set plus selected rejected jobs with dynamic programming, CP, MILP, or a decision diagram while IG controls global diversification. | Bounds on small/medium cases, improvement per millisecond, and evidence that solver overhead is repaid on difficult setup instances. |
            | **P3 · multi-machine and rolling horizon** | Generalize the absorbed-shift evaluator to one chain per machine, then add frozen prefixes and rescheduling penalties. | Independent assignment/setup tests, open multi-machine OAS benchmarks, rolling-arrival replay, and comparisons with exact small-window solutions. |
            | **P4 · parallel search** | Start with CPU multi-start; then run exact-semantics replicas on GPU with fused candidate pricing and minimal host synchronization. | Crossover against one optimized Rust CPU core; time-to-target, diversity, energy, and final CPU repricing—not GPU utilization. |
            | **P5 · learned and LLM-assisted discovery** | Use a contextual bandit or LLM to propose operator programs, features, adversarial instances, and ablations; never let it score schedules. | Sandboxed code, nested splits, multiple fresh seeds, distribution-shift tests, simple baselines, and a registered failure criterion. |

            <details>
            <summary>Where an evolved method could be genuinely competitive</summary>

            | Application | Direct mapping to this model | What a deployable model must add |
            |---|---|---|
            | **Make-to-order CNC, printing, coating, or calendering** | job = order; setup = tool, fixture, color, or temperature transition; rejection = decline/outsource/defer; tardiness = contractual delivery loss. | Parallel/non-identical machines, tool and operator availability, maintenance, material constraints, and rolling arrivals. This is the closest first validation domain. |
            | **Semiconductor test operations** | job = lot/test program; setup = tester, probe, or temperature transition; rejection = defer or outsource; tardiness = delivery or downstream-flow penalty. | Eligible testers, precedence/re-entrant flow, batching, maintenance, multiple stations, and uncertain durations. |
            | **Scarce multi-model AI inference** | job = request or request group; setup = model load/swap; rejection = route to a paid cloud/provider tier; tardiness = SLO penalty. | Online arrivals, batching, GPU memory, preemption, quality-aware routing, and multi-GPU placement. The strongest opportunity is rolling-horizon admission on a small heterogeneous fleet—not replacement of token-level serving schedulers. |
            | **Elective and emergency operating rooms** | job = procedure; setup = room/equipment/cleaning transition; rejection = postpone or cancel an elective case; tardiness = clinically weighted waiting. | Multiple rooms, surgeons, anesthetists, beds, uncertain duration, emergency priority, and safety constraints. It must remain clinician-facing decision support. |
            | **Central or automated kitchen production** | job = dish/preparation batch; setup = cleaning, allergen, temperature, or tool transition; rejection = refund/substitute/outsource; tardiness = promised ready time. | Recipe precedence, heterogeneous appliances and people, shared tools, batching, synchronized completion, perishability, and hard food-safety constraints. This is defensible for logged central/robotic kitchens; ordinary restaurant ticketing remains an educational analogy. |
            </details>

            <details>
            <summary>GPU and LLM boundary</summary>

            A free Colab user may request a GPU, but availability, model, and quotas are dynamic. Selecting a GPU does not accelerate this notebook's ordinary Python lists and loops. A useful GPU edition would therefore be a separately labelled **replica-fleet experiment**, not a hidden switch that changes the scientific protocol. Its first milestone is not “GPU used”; it is “faster time-to-target than the optimized Rust CPU baseline while preserving or explicitly documenting search semantics.”

            LLMs are most defensible outside the scoring loop: generating candidate operators, finding counterexample instances, translating operational constraints into a draft model, and explaining engine-verified trade-offs. Every proposed schedule and numerical claim must still be recomputed by the deterministic evaluator.
            </details>

            **Method anchors:** [original IG](https://doi.org/10.1016/j.ejor.2005.12.009) · [Sparrow/OAS benchmark](https://doi.org/10.1016/j.cie.2019.106102) and [open data](https://doi.org/10.4121/uuid:c3623076-a1ac-4103-ad31-3068a28312f9) · [ALNS](https://doi.org/10.1287/trsc.1050.0135) · [LLM-guided program search](https://doi.org/10.1038/s41586-023-06924-6) · [Colab limits](https://research.google.com/colaboratory/faq.html#resource-limits).

            **Application anchors:** [make-to-order OAS](https://doi.org/10.1016/j.ijpe.2010.02.002) and [CNC tool switching](https://doi.org/10.1016/j.cie.2021.107813) · [semiconductor final test](https://doi.org/10.1016/j.cor.2021.105619) · [multi-model queues](https://arxiv.org/abs/2407.00047) · [operating-room rescheduling](https://doi.org/10.1016/j.dss.2012.08.002) · [automated kitchens](https://doi.org/10.1016/j.cor.2023.106387).
        """,
        "manifest": """
            ## 12. Reproducibility manifest

            The manifest includes the immutable engine revision, runtime versions, input hashes, exact seed lists, scenario budgets, statistical definitions, and a hash of all deterministic solver outputs. Elapsed time and the execution timestamp are recorded as context but excluded from the deterministic fingerprint.
        """,
    },
    "pt": {
        "title": """
            # Iterated Greedy: da prova exata à evidência em instâncias grandes

            [![Abrir notebook em português no Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/alexmarinho/IG/blob/master/studio/notebooks/iterated-greedy-experiments-pt-br.ipynb)
            [English](https://colab.research.google.com/github/alexmarinho/IG/blob/master/studio/notebooks/iterated-greedy-experiments.ipynb)

            Uma única máquina precisa decidir **quais tarefas executar, em que ordem e quais rejeitar**. Tempos de liberação, prazos rígidos, custos de atraso e rejeição e trocas de ferramenta dependentes da sequência interagem. Testar todos os planos possíveis rapidamente se torna inviável; o Iterated Greedy (IG) usa aleatoriedade controlada para retirar uma pequena parte de um plano viável, reconstruí-lo e preservar descobertas úteis.

            Este notebook executa o engine Python real do repositório sobre instâncias MaScLib reais. Em vez de exibir uma execução favorável, ele constrói uma escada de evidências:

            1. **Pequeno · 8 tarefas:** enumera as 109.601 sequências parciais e prova o ótimo desta instância no modelo.
            2. **Médio · 30 tarefas:** mede confiabilidade, risco de cauda, convergência e estratégias de reinício em sementes independentes.
            3. **Grande · 75 tarefas:** verifica se a busca continua criando valor quando o espaço irrestrito tem cerca de $10^{110}$ planos.
            4. **Arena histórica · 44 instâncias:** posiciona as execuções ao vivo diante da comparação publicada em 2015, mantendo os protocolos rigorosamente separados.

            **Duas profundidades de leitura.** Cada seção começa pela pergunta de decisão e termina em uma conclusão numérica. Abra as notas metodológicas quando precisar auditar os detalhes. Uma CPU padrão é suficiente; não é necessário usar GPU, enviar arquivos ou montar o Google Drive.

            > Todos os resultados exibidos são calculados quando as células rodam. O arquivo é distribuído sem outputs em cache. “Referência publicada” é o valor registrado no benchmark de 2015; apenas o resultado com 8 tarefas é chamado de ótimo, pois ele é verificado exaustivamente aqui.
        """,
        "model": """
            ## 1. O que está sendo otimizado?

            Para a ordem executada $\\pi$ e o conjunto rejeitado $\\Omega$, o engine minimiza

            $$f(\\pi,\\Omega)=C_{setup}+C_{modo}+C_{atraso}+C_{rejeição}.$$

            Uma tradução física útil é um centro de usinagem CNC. Cada tarefa é uma ordem de produção; sua família identifica a ferramenta ou fixação necessária; mudar de família consome tempo e custo de setup; o atraso gera uma cobrança ponderada pela prioridade; deixar uma ordem fora desta máquina gera seu custo explícito de rejeição. Este é um modelo repetível de scheduling, não uma afirmação de que os arquivos do benchmark são telemetria de fábrica.

            Uma iteração do IG remove $d$ tarefas, reinsere cada uma na posição viável de menor custo (ou a mantém rejeitada), opcionalmente troca tarefas executadas e rejeitadas e continua a busca. A aleatoriedade propõe onde procurar; o objetivo determinístico decide o que é melhor.

            <details>
            <summary>Contrato experimental</summary>

            - Orçamentos fixos em `max_iters` tornam as trajetórias determinísticas para uma semente, engine e implementação do fluxo pseudoaleatório do Python.
            - As execuções não param antecipadamente ao alcançar a referência publicada.
            - O mesmo número de iterações externas não implica o mesmo número de avaliações candidatas; ambos são informados.
            - Dispersão entre sementes e intervalos bootstrap são condicionais à instância, configuração, orçamento, runtime e desenho de sementes documentados. Não são garantias de otimalidade.
            - Execuções Python atuais, regras transparentes de prioridade e resultados históricos de 2015 são três fontes de evidência diferentes e nunca formam uma única corrida neutra em hardware.
            </details>
        """,
        "setup": """
            ## 2. Ambiente e protocolo reproduzíveis

            Execute a próxima célula uma vez. Ela é a inicialização completa do notebook: partindo de um runtime vazio do Colab, baixa uma revisão pública imutável do engine, instala ou verifica todas as dependências de execução, carrega as instâncias e o benchmark incluídos e define as funções compartilhadas de análise. Em um clone do repositório, ela usa esse checkout. Se o runtime reiniciar, execute novamente apenas essa célula antes de retomar qualquer seção; todas as células posteriores agora verificam explicitamente a inicialização. O manifesto final registra hashes das fontes, versões, sementes, orçamentos e uma impressão digital determinística dos resultados.
        """,
        "landscape": """
            ## 3. Três casos, o mesmo modelo matemático

            **Pergunta:** o que muda quando o número de tarefas cresce, mantendo tempos de liberação, prazos, rejeição e setups dependentes da sequência na mesma decisão?

            A posição horizontal abaixo é o expoente em base 10 da quantidade de subconjuntos executados e ordenados antes das restrições de viabilidade:

            $$\\sum_{k=0}^{n}P(n,k)=\\lfloor e\\,n!\\rfloor.$$

            Não é a quantidade de soluções avaliadas pelo algoritmo; mostra por que a busca exaustiva deixa de ser uma estratégia possível depois do caso pequeno.
        """,
        "small": """
            ## 4. Caso pequeno — é possível verificar a resposta exatamente?

            **Pergunta:** o IG apenas parece plausível ou alcança o ótimo real quando a verificação exaustiva ainda é possível?

            A primeira célula enumera todo subconjunto executado e ordenado, incluindo o plano vazio e todas as combinações de rejeição. A segunda executa 30 buscas IG e cinco regras transparentes de inserção por prioridade. Assim, o teste de correção fica separado da afirmação sobre desempenho estocástico.

            <details>
            <summary>O que fazem as regras de prioridade</summary>

            EDD, menor processamento, ordem de liberação, densidade de rejeição e menor folga definem apenas a ordem em que as tarefas são consideradas. Cada tarefa ainda é testada em todas as posições atuais e inserida somente quando reduz o objetivo completo; caso contrário, permanece rejeitada. São baselines fortes, auditáveis e de uma única passagem — não os algoritmos externos do estudo histórico.
            </details>
        """,
        "medium": """
            ## 5. Caso médio — uma semente bem-sucedida é representativa?

            **Pergunta:** quanto o ciclo completo do IG melhora sua própria construção, qual é a variação entre execuções independentes e quando reinícios ajudam?

            Todas as 30 sementes recebem 200 iterações externas. Para cada uma, o notebook registra três estágios pareados: construção direta, construção mais troca entre executadas/rejeitadas e IG completo. Depois, examina a convergência e compara uma execução longa com várias execuções curtas sob o mesmo orçamento total de iterações.

            <details>
            <summary>Como ler as estatísticas</summary>

            Q1–Q3 e o desvio-padrão amostral descrevem os resultados observados. Os intervalos de média e mediana usam bootstrap por semente. O intervalo da taxa de acerto usa Wilson, que se comporta melhor perto de 0% e 100% com 30 tentativas. O experimento de portfólio com orçamento total fixo é exploratório: reinícios repetem a inicialização, portanto avaliações candidatas — e não apenas iterações — determinam a diferença real de esforço.
            </details>
        """,
        "large": """
            ## 6. Caso grande — a busca ainda cria valor em $10^{110}$ possibilidades?

            **Pergunta:** com 75 tarefas e setups dependentes da sequência, o IG melhora materialmente o plano viável inicial e com que frequência um orçamento finito alcança a referência publicada?

            Trinta sementes independentes recebem 500 iterações externas. O caso é grande o suficiente para expor melhoria substancial e risco estocástico residual, mas ainda é prático em uma CPU padrão do Colab. Ele não representa os limites de 200 e 500 tarefas da suíte completa.
        """,
        "history": """
            ## 7. Arena histórica — como o IG se comparou com outros métodos?

            **Pergunta:** nas 44 instâncias publicadas, onde o IG foi de fato forte e onde não foi?

            O `benchmark.json` guarda erro relativo médio (mínimo–máximo) em cinco execuções históricas por célula. O protocolo de 2015 deu às heurísticas $n\\times30$ segundos por execução; o IG rodou em VBA em um i7 2,3 GHz, as heurísticas da literatura em C++ em um i7 2,93 GHz e o MILP recebeu uma hora. Portanto esta seção compara **qualidade de solução** registrada, não runtime atual, e não é misturada aos experimentos Python acima.

            O erro é relativo à referência publicada; menor é melhor. NCOS contém 30 instâncias sem transições de setup. STC contém 14 instâncias com tempo e custo de setup.
        """,
        "sensitivity": """
            ## 8. Qual deve ser a próxima análise?

            **Pergunta:** a conclusão do caso médio resiste a uma destruição mais ampla, ao reinício a partir da melhor solução ou à remoção da etapa de troca?

            Este diagnóstico pareado reutiliza 20 sementes do baseline, altera uma decisão por vez e inclui um controle `d=2` mais longo para que `d=2` e `d=8` sejam lidos com contagens de avaliações quase iguais. Pode indicar uma hipótese promissora — especialmente redução do risco de cauda —, mas não seleciona uma configuração para instâncias não observadas.
        """,
        "audit": """
            ## 9. Auditoria de uma programação retornada

            A melhor execução do caso médio só é útil se seu objetivo puder ser reconstruído. A próxima célula verifica que cada tarefa foi executada ou rejeitada exatamente uma vez, recalcula os tempos ASAP, valida todos os prazos rígidos e fecha setup + modo + atraso + rejeição contra o objetivo retornado pelo engine, em décimos inteiros.

            A figura mostra a consequência física da ordem: intervalos hachurados são trocas de ferramenta/setup; intervalos coloridos são processamento; marcadores voltados para baixo são datas de entrega. A decomposição abaixo explica por que um plano visualmente mais longo ainda pode ser mais barato quando rejeição e atraso entram na conta.
        """,
        "conclusion": """
            ## 10. Conclusões e fronteira de pesquisa

            A próxima célula escreve a conclusão numérica diretamente da evidência executada, evitando que o texto se afaste dos resultados. A leitura curta atende quem está conhecendo o problema; a leitura de pesquisa registra as qualificações e o próximo experimento defensável.

            <details>
            <summary>O que este notebook não estabelece</summary>

            Três casos atuais não representam todas as 44 instâncias. Uma referência publicada não é automaticamente um ótimo provado. Orçamentos iguais em iterações não significam runtime ou avaliações candidatas iguais. Os métodos concorrentes históricos não foram reexecutados neste ambiente Python. Retirar, após observar os dados, os dois casos STC difíceis com 200 tarefas diagnostica a concentração do erro; não cria um novo placar.

            Os dois casos STC com 200 tarefas são a fronteira importante: concentram a maior parte do erro histórico do IG em setups. A implementação Python fixada aqui usa destruição de tamanho constante e não reproduz a rampa adaptativa documentada em outra parte do repositório. Testar destruição adaptativa em instâncias reservadas e com esforço computacional pareado é, portanto, o próximo experimento — não um resultado alegado aqui.
            </details>
        """,
        "future": """
            ## 11. Trabalhos futuros — o que pertence ao próximo repositório?

            A evidência acima fixa um baseline claro. O repositório canônico deve preservar o objetivo e a caminhada original do IG; aritmética do avaliador, empacotamento, paridade Rust/Python e execução em lote só podem ficar mais rápidos aqui se testes de trajetória e precificação permanecerem idênticos. Um repositório de pesquisa separado deve receber novas políticas de busca e modelos matemáticos. Seu link só deve entrar aqui depois que a primeira variante tiver benchmark reproduzível e resultado em instâncias reservadas.

            Algumas hipóteses já têm implementações exploratórias neste repositório e devem virar **baselines**, não ser anunciadas novamente como ideias inéditas: a rampa adaptativa de destruição tem casos positivos e negativos; a frota GPU ainda é limitada pelo overhead de launches; e os primeiros operadores aprendidos não generalizaram em sementes novas. Esses [resultados de engenharia](https://github.com/alexmarinho/IG/blob/master/RESULTS.md) motivam o roteiro, mas estão fora do protocolo executado por este notebook.

            | Prioridade | Hipótese | Evidência exigida antes de adotar |
            |---|---|---|
            | **P0 · credibilidade externa** | Executar o IG canônico e adaptativo na suíte moderna OAS/Sparrow antes de aumentar a complexidade. | Famílias declaradas de treino/validação/teste; tempo e avaliações fixos; sementes pareadas, curvas anytime, tempo até o alvo, quantis de cauda, bounds exatos em casos pequenos e baselines publicados atuais. |
            | **P1 · portfólio reativo de operadores** | Preservar remoção aleatória e acrescentar operadores estocásticos de bloco, família relacionada, aresta cara, atraso e admissão; adaptar a seleção por melhoria por unidade de tempo. | Ablações contra IG aleatório e $d$ adaptativo, tabu/ALNS ajustados, famílias novas e exploração mínima. Sem atalho determinístico top-$d$. |
            | **P2 · reparo exato híbrido** | Otimizar apenas um conjunto destruído mais tarefas rejeitadas selecionadas com programação dinâmica, CP, MILP ou diagrama de decisão, enquanto o IG controla a diversificação global. | Limites nos casos pequenos/médios, melhoria por milissegundo e evidência de que o overhead do solver se paga nas instâncias difíceis de setup. |
            | **P3 · múltiplas máquinas e horizonte móvel** | Generalizar o avaliador com absorção para uma cadeia por máquina; depois adicionar prefixos congelados e penalidades de reprogramação. | Testes independentes de atribuição/setup, benchmarks OAS abertos com múltiplas máquinas, replay de chegadas e comparação com soluções exatas em janelas pequenas. |
            | **P4 · busca paralela** | Começar com multi-start em CPU; depois executar réplicas com semântica exata em GPU, precificação fundida e sincronização mínima com o host. | Crossover contra um único core Rust otimizado; tempo até o alvo, diversidade, energia e reprecificação final em CPU — não utilização da GPU. |
            | **P5 · descoberta aprendida e assistida por LLM** | Usar bandit contextual ou LLM para propor programas de operadores, features, instâncias adversariais e ablações; nunca para precificar programações. | Código isolado, splits aninhados, várias sementes novas, testes de mudança de distribuição, baselines simples e critério de falha registrado. |

            <details>
            <summary>Onde um método evoluído poderia ser realmente competitivo</summary>

            | Aplicação | Mapeamento direto para este modelo | O que um modelo implantável precisa acrescentar |
            |---|---|---|
            | **CNC sob encomenda, impressão, pintura ou calandragem** | tarefa = ordem; setup = troca de ferramenta, fixação, cor ou temperatura; rejeição = recusar, terceirizar ou adiar; atraso = perda contratual. | Máquinas paralelas/não idênticas, disponibilidade de ferramentas e operadores, manutenção, materiais e chegadas contínuas. É o domínio mais próximo para a primeira validação. |
            | **Testes de semicondutores** | tarefa = lote/programa de teste; setup = mudança de testador, probe ou temperatura; rejeição = adiar ou terceirizar; atraso = entrega ou penalidade no fluxo seguinte. | Testadores elegíveis, precedência/fluxo reentrante, lotes, manutenção, múltiplas estações e durações incertas. |
            | **Inferência de IA com poucos recursos e vários modelos** | tarefa = requisição ou grupo; setup = carregar/trocar modelo; rejeição = rotear para uma camada paga na nuvem; atraso = penalidade de SLO. | Chegadas online, batching, memória de GPU, preempção, roteamento sensível à qualidade e múltiplas GPUs. A melhor oportunidade é admissão em horizonte móvel numa frota pequena e heterogênea — não substituir escalonadores token a token. |
            | **Salas cirúrgicas eletivas e de emergência** | tarefa = procedimento; setup = transição de sala/equipamento/limpeza; rejeição = adiar ou cancelar caso eletivo; atraso = espera ponderada clinicamente. | Múltiplas salas, cirurgiões, anestesistas, leitos, duração incerta, prioridade de emergência e restrições de segurança. Deve continuar sendo apoio à decisão clínica. |
            | **Produção em cozinha central ou automatizada** | tarefa = prato/lote de preparo; setup = limpeza, alergênico, temperatura ou ferramenta; rejeição = reembolsar, substituir ou terceirizar; atraso = horário prometido. | Precedência de receitas, equipamentos e pessoas heterogêneos, ferramentas compartilhadas, batching, conclusão sincronizada, perecibilidade e segurança alimentar como restrição rígida. É defensável em cozinhas centrais/robóticas com logs; tickets comuns de restaurante continuam sendo analogia didática. |
            </details>

            <details>
            <summary>Fronteira de GPU e LLM</summary>

            Um usuário gratuito do Colab pode solicitar GPU, mas disponibilidade, modelo e cotas são dinâmicos. Selecionar GPU não acelera as listas e loops Python comuns deste notebook. Uma edição útil em GPU deve ser, portanto, um **experimento de frota de réplicas** explicitamente separado, e não um botão escondido que altera o protocolo científico. Seu primeiro marco não é “usou GPU”; é “chegou ao alvo mais rápido que o baseline Rust otimizado, preservando ou documentando claramente a semântica da busca”.

            LLMs são mais defensáveis fora do loop de precificação: gerar operadores candidatos, encontrar instâncias de contraexemplo, traduzir restrições operacionais para um modelo preliminar e explicar compromissos verificados pelo engine. Toda programação proposta e toda afirmação numérica ainda precisam ser recalculadas pelo avaliador determinístico.
            </details>

            **Âncoras de método:** [IG original](https://doi.org/10.1016/j.ejor.2005.12.009) · [benchmark OAS/Sparrow](https://doi.org/10.1016/j.cie.2019.106102) e [dados abertos](https://doi.org/10.4121/uuid:c3623076-a1ac-4103-ad31-3068a28312f9) · [ALNS](https://doi.org/10.1287/trsc.1050.0135) · [busca de programas guiada por LLM](https://doi.org/10.1038/s41586-023-06924-6) · [limites do Colab](https://research.google.com/colaboratory/faq.html#resource-limits).

            **Âncoras de aplicação:** [OAS sob encomenda](https://doi.org/10.1016/j.ijpe.2010.02.002) e [troca de ferramentas CNC](https://doi.org/10.1016/j.cie.2021.107813) · [testes finais de semicondutores](https://doi.org/10.1016/j.cor.2021.105619) · [filas com múltiplos modelos](https://arxiv.org/abs/2407.00047) · [reprogramação de salas cirúrgicas](https://doi.org/10.1016/j.dss.2012.08.002) · [cozinhas automatizadas](https://doi.org/10.1016/j.cor.2023.106387).
        """,
        "manifest": """
            ## 12. Manifesto de reprodutibilidade

            O manifesto inclui a revisão imutável do engine, versões do runtime, hashes das entradas, listas exatas de sementes, orçamentos dos cenários, definições estatísticas e um hash de todos os outputs determinísticos do solver. Tempo decorrido e timestamp são contexto e ficam fora da impressão digital determinística.
        """,
    },
}


IMPORTS = r"""
from __future__ import annotations

import hashlib
import html
import itertools
import json
import math
import os
import platform
import random
import re
import statistics
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

LANG = '__LANG__'
REPOSITORY_URL = 'https://github.com/alexmarinho/IG.git'
REPOSITORY_REF = '__PUBLIC_COMMIT__'
COLAB_ROOT = Path('/content/IG')
IN_COLAB = bool(os.environ.get('COLAB_RELEASE_TAG'))
if not IN_COLAB:
    try:
        import google.colab  # type: ignore[import-not-found]  # noqa: F401
    except ImportError:
        pass
    else:
        IN_COLAB = True


def tr(en: str, pt: str) -> str:
    return en if LANG == 'en' else pt


def find_repo_root(start: Path) -> Path:
    for candidate in (start.resolve(), *start.resolve().parents):
        if (candidate / 'python' / 'ig_scheduler.py').is_file() and (candidate / 'benchmark.json').is_file():
            return candidate
    raise FileNotFoundError(tr('No IG checkout found.', 'Nenhum checkout do IG foi encontrado.'))


def checkout_public_snapshot(destination: Path, revision: str) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    if not (destination / '.git').is_dir():
        subprocess.run(['git', 'init', '--quiet', str(destination)], check=True)
        subprocess.run(['git', '-C', str(destination), 'remote', 'add', 'origin', REPOSITORY_URL], check=True)
    subprocess.run(['git', '-C', str(destination), 'fetch', '--quiet', '--depth', '1', 'origin', revision], check=True)
    subprocess.run(['git', '-C', str(destination), 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], check=True)
    return destination


try:
    ROOT = find_repo_root(Path.cwd())
    SOURCE_MODE = tr('local repository checkout', 'checkout local do repositório')
except FileNotFoundError:
    if not IN_COLAB:
        raise FileNotFoundError(
            tr('Run from an IG clone or open the public notebook in Colab.',
               'Execute a partir de um clone do IG ou abra o notebook público no Colab.')
        )
    ROOT = checkout_public_snapshot(COLAB_ROOT, REPOSITORY_REF)
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--quiet', '--no-deps', str(ROOT)], check=True)
    SOURCE_MODE = tr('Colab · immutable public snapshot', 'Colab · snapshot público imutável')

try:
    import matplotlib
    import matplotlib.pyplot as plt
except ModuleNotFoundError:
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--quiet', 'matplotlib>=3.8,<4'], check=True)
    import matplotlib
    import matplotlib.pyplot as plt

from matplotlib.lines import Line2D
from matplotlib.patches import Patch

from IPython.display import HTML, Markdown, display

sys.path.insert(0, str(ROOT / 'python'))
import ig_scheduler
from ig_scheduler import Instance, Result, State, solve

SOURCE_COMMIT = subprocess.run(
    ['git', 'rev-parse', 'HEAD'], cwd=ROOT, check=True, capture_output=True, text=True
).stdout.strip()
if IN_COLAB:
    FETCHED_COMMIT = subprocess.run(
        ['git', 'rev-parse', 'FETCH_HEAD'], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()
    if SOURCE_COMMIT != FETCHED_COMMIT:
        raise AssertionError('Colab source checkout does not match the fetched release')

PALETTE = {
    'ink': '#17233c', 'muted': '#687386', 'blue': '#3167c6', 'cyan': '#35a7b7',
    'green': '#27866f', 'orange': '#d77924', 'red': '#bd4b54', 'light': '#d9e1ec',
}
plt.rcParams.update({
    'figure.dpi': 125, 'savefig.dpi': 160, 'font.size': 10,
    'axes.titlesize': 12, 'axes.titleweight': 'bold', 'axes.titlelocation': 'left',
    'axes.labelsize': 10, 'axes.spines.top': False, 'axes.spines.right': False,
    'axes.edgecolor': PALETTE['muted'], 'axes.labelcolor': PALETTE['ink'],
    'xtick.color': PALETTE['muted'], 'ytick.color': PALETTE['muted'],
    'text.color': PALETTE['ink'], 'legend.frameon': False,
})


def num(value: float, digits: int = 2) -> str:
    rendered = f'{float(value):,.{digits}f}'
    if LANG == 'pt':
        rendered = rendered.replace(',', '`').replace('.', ',').replace('`', '.')
    return rendered


def pct(value: float, digits: int = 2, sign: bool = False) -> str:
    prefix = '+' if sign and value > 0 else ''
    return f'{prefix}{num(value, digits)}%'


def display_table(rows, *, caption: str | None = None, columns=None) -> None:
    rows = list(rows)
    if not rows:
        display(Markdown(tr('_No rows._', '_Nenhuma linha._')))
        return
    columns = list(columns or rows[0].keys())
    out = ['<table style="border-collapse:collapse;width:100%;font-size:0.92rem">']
    if caption:
        out.append(f'<caption style="text-align:left;font-weight:600;padding:0 0 0.5rem">{html.escape(caption)}</caption>')
    out.append('<thead><tr>')
    out.extend(f'<th style="text-align:left;border-bottom:2px solid #9aa6b8;padding:0.38rem">{html.escape(str(column))}</th>' for column in columns)
    out.append('</tr></thead><tbody>')
    for row in rows:
        out.append('<tr>')
        for column in columns:
            value = row.get(column, '')
            align = 'right' if isinstance(value, (int, float)) else 'left'
            out.append(f'<td style="text-align:{align};border-bottom:1px solid #d9e1ec;padding:0.38rem">{html.escape(str(value))}</td>')
        out.append('</tr>')
    out.append('</tbody></table>')
    display(HTML(''.join(out)))


print(tr('Source', 'Fonte') + f': {SOURCE_MODE}')
print(f'Repository: {ROOT} @ {SOURCE_COMMIT[:12]}')
print(f'Engine: ig_scheduler {ig_scheduler.__version__} ({Path(ig_scheduler.__file__).resolve()})')
print(f'Python: {platform.python_version()} · Matplotlib: {matplotlib.__version__}')
""".replace("__PUBLIC_COMMIT__", PUBLIC_COMMIT)


PROTOCOL = r"""
META_SEED = 20_150_718
SEED_COUNT = 30
SEEDS = tuple(random.Random(META_SEED).sample(range(2**32), SEED_COUNT))
BOOTSTRAP_SEED = 91_240_731
BOOTSTRAP_REPLICATES = 5_000

SCENARIOS = {
    'small': {'name': 'STC_NCOS_01', 'iterations': 10, 'd': 2, 'seeds': SEEDS},
    'medium': {'name': 'STC_NCOS_15', 'iterations': 200, 'd': 2, 'seeds': SEEDS},
    'large': {'name': 'STC_NCOS_31', 'iterations': 500, 'd': 2, 'seeds': SEEDS},
}
PORTFOLIO_TOTAL_ITERATIONS = 200
PORTFOLIO_SHAPES = ((1, 200), (4, 50), (10, 20))
PORTFOLIO_REPLICATES = 20
SENSITIVITY_SEEDS = SEEDS[:20]
SENSITIVITY_ITERATIONS = 200

if len(SEEDS) != len(set(SEEDS)) or any(not 0 <= seed < 2**32 for seed in SEEDS):
    raise ValueError('seed design must contain unique unsigned 32-bit values')
if any(runs * iterations != PORTFOLIO_TOTAL_ITERATIONS for runs, iterations in PORTFOLIO_SHAPES):
    raise ValueError('portfolio shapes must have the same total outer-iteration budget')

benchmark = json.loads((ROOT / 'benchmark.json').read_text(encoding='utf-8'))
instances = {}
for key, spec in SCENARIOS.items():
    path = ROOT / 'masclib' / f"{spec['name']}.csv"
    inst = Instance.parse(path)
    reference = float(benchmark[spec['name']][1])
    instances[key] = {'instance': inst, 'path': path, 'reference': reference, **spec}

print(tr('Seed sample', 'Amostra de sementes') + f': {len(SEEDS)} · meta-seed {META_SEED}')
for key, spec in instances.items():
    print(f"{key:>6} · {spec['name']:<12} · n={spec['instance'].n:>2} · "
          f"{spec['iterations']:>3} " + tr('iterations', 'iterações') + f" · d={spec['d']}")
"""


HELPERS = r"""
def percentile(values, q: float) -> float:
    ordered = sorted(float(value) for value in values)
    if not ordered or not 0 <= q <= 1:
        raise ValueError('percentile requires values and q in [0, 1]')
    position = (len(ordered) - 1) * q
    lower, upper = math.floor(position), math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def describe(values) -> dict[str, float | int]:
    sample = [float(value) for value in values]
    if not sample:
        raise ValueError('describe requires at least one value')
    return {
        'n': len(sample), 'min': min(sample), 'q1': percentile(sample, 0.25),
        'median': statistics.median(sample), 'mean': statistics.fmean(sample),
        'q3': percentile(sample, 0.75), 'max': max(sample),
        'sample_std': statistics.stdev(sample) if len(sample) > 1 else math.nan,
    }


def bootstrap_ci(values, statistic, *, seed=BOOTSTRAP_SEED, replicates=BOOTSTRAP_REPLICATES):
    sample = tuple(float(value) for value in values)
    if not sample:
        raise ValueError('bootstrap requires at least one value')
    rng = random.Random(seed)
    estimates = [statistic(rng.choices(sample, k=len(sample))) for _ in range(replicates)]
    return percentile(estimates, 0.025), percentile(estimates, 0.975)


def wilson_interval(successes: int, trials: int, z: float = 1.959963984540054):
    if not 0 <= successes <= trials or trials <= 0:
        raise ValueError('invalid binomial counts')
    p = successes / trials
    denominator = 1 + z * z / trials
    center = (p + z * z / (2 * trials)) / denominator
    half = z * math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / denominator
    return center - half, center + half


def gap_percent(cost: float, reference: float) -> float:
    return 100 * (cost - reference) / reference


def log10_partial_schedule_count(n: int) -> float:
    terms = [math.lgamma(n + 1) - math.lgamma(n - performed + 1) for performed in range(n + 1)]
    pivot = max(terms)
    return (pivot + math.log(sum(math.exp(term - pivot) for term in terms))) / math.log(10)


@dataclass(frozen=True)
class CostDecomposition:
    rows: tuple[dict, ...]
    rejected: tuple[int, ...]
    setup_deci: int
    mode_deci: int
    tardiness_deci: int
    rejection_deci: int

    @property
    def total_deci(self) -> int:
        return self.setup_deci + self.mode_deci + self.tardiness_deci + self.rejection_deci


def decompose_order(inst: Instance, order, rejected) -> CostDecomposition:
    order, rejected = list(order), tuple(rejected)
    if sorted(order + list(rejected)) != list(range(inst.n)):
        raise ValueError('performed and rejected jobs must partition the instance')
    rows = []
    time_now, family = 0, inst.init_state
    setup_total = mode_total = tardiness_total = 0
    for position, jid in enumerate(order):
        job = inst.jobs[jid]
        setup_time = inst.setup_t[family][job.fam]
        setup_start = max(time_now, job.rel - setup_time)
        process_start = setup_start + setup_time
        finish = process_start + job.p
        if finish > job.end_max:
            raise ValueError(f'job {jid} misses its hard completion deadline')
        setup_cost = inst.setup_c[family][job.fam]
        tardiness = max(0, finish - job.due)
        tardiness_cost = tardiness * job.w
        rows.append({
            'position': position, 'job': jid, 'family_before': family, 'family_after': job.fam,
            'setup_start': setup_start, 'process_start': process_start, 'finish': finish,
            'due': job.due, 'deadline': job.end_max, 'tardiness': tardiness,
            'setup_cost': setup_cost / 10, 'mode_cost': job.mode / 10,
            'tardiness_cost': tardiness_cost / 10,
        })
        setup_total += setup_cost
        mode_total += job.mode
        tardiness_total += tardiness_cost
        time_now, family = finish, job.fam
    rejection_total = sum(inst.jobs[jid].rej for jid in rejected)
    return CostDecomposition(tuple(rows), rejected, setup_total, mode_total, tardiness_total, rejection_total)


def validate_result(inst: Instance, result: Result) -> CostDecomposition:
    audit = decompose_order(inst, result.order, result.rejected)
    if audit.total_deci != round(result.best_cost * 10):
        raise AssertionError('objective decomposition does not close')
    return audit


def run_stages(spec: dict):
    inst = spec['instance']
    records = []
    for seed in spec['seeds']:
        construction = solve(inst, max_iters=0, seed=seed, d=spec['d'], accept='current', permute=False, target=None)
        exchange = solve(inst, max_iters=0, seed=seed, d=spec['d'], accept='current', permute=True, target=None)
        ig = solve(inst, max_iters=spec['iterations'], seed=seed, d=spec['d'], accept='current', permute=True, target=None)
        if ig.iterations != spec['iterations'] or exchange.best_cost != ig.log[0][1]:
            raise AssertionError('stage instrumentation does not align')
        for result in (construction, exchange, ig):
            validate_result(inst, result)
        records.append({'seed': seed, 'construction': construction, 'exchange': exchange, 'ig': ig})
    return records


def priority_insertion(inst: Instance, key):
    state = State(inst)
    state.rebuild()
    evaluations = 0
    for jid in sorted(range(inst.n), key=lambda job_id: (key(inst.jobs[job_id]), job_id)):
        best_pos, best_cost = -1, state.total()
        for position in range(len(state.order) + 1):
            evaluations += 1
            cost = state.try_insert(jid, position)
            if cost is not None and cost < best_cost:
                best_pos, best_cost = position, cost
        if best_pos >= 0:
            state.insert(jid, best_pos)
    result = Result(state.total() / 10, state.order[:], state.rejected(), 0, evaluations, 0.0, [(0, state.total() / 10)])
    validate_result(inst, result)
    return result


PRIORITY_RULES = {
    'EDD': lambda job: job.due,
    'SPT': lambda job: job.p,
    tr('release', 'liberação'): lambda job: job.rel,
    tr('rejection density', 'densidade de rejeição'): lambda job: -(job.rej / max(job.p, 1)),
    tr('least slack', 'menor folga'): lambda job: job.due - job.rel - job.p,
}


def checkpoint_cost(log, checkpoint: int) -> float:
    return [cost for iteration, cost in log if iteration <= checkpoint][-1]


def stage_summary(records, reference: float):
    result = []
    for stage_index, stage in enumerate(('construction', 'exchange', 'ig')):
        costs = [record[stage].best_cost for record in records]
        stats = describe(costs)
        hits = sum(cost <= reference for cost in costs)
        hit_low, hit_high = wilson_interval(hits, len(costs))
        result.append({
            'stage': stage, 'costs': costs, 'stats': stats, 'hits': hits,
            'hit_interval': (hit_low, hit_high),
            'mean_interval': bootstrap_ci(costs, statistics.fmean, seed=BOOTSTRAP_SEED + 10 * stage_index),
            'median_interval': bootstrap_ci(costs, statistics.median, seed=BOOTSTRAP_SEED + 10 * stage_index + 1),
            'evaluations': statistics.fmean(record[stage].evaluations for record in records),
        })
    return result


def plot_paired_stages(records, reference: float, title: str):
    labels = [tr('direct construction', 'construção direta'), tr('+ exchange', '+ troca'), 'IG']
    keys = ('construction', 'exchange', 'ig')
    fig, axis = plt.subplots(figsize=(9.4, 4.8), constrained_layout=True)
    all_gaps = []
    for record in records:
        gaps = [gap_percent(record[key].best_cost, reference) for key in keys]
        all_gaps.extend(gaps)
        axis.plot(range(3), gaps, color=PALETTE['light'], linewidth=0.9, alpha=0.75)
        axis.scatter(range(3), gaps, color=PALETTE['muted'], s=16, alpha=0.55)
    medians = [statistics.median(gap_percent(record[key].best_cost, reference) for record in records) for key in keys]
    axis.plot(range(3), medians, color=PALETTE['blue'], marker='D', linewidth=2.6, markersize=6, label=tr('seed median', 'mediana das sementes'))
    for x, value in enumerate(medians):
        axis.annotate(pct(value, 2, sign=True), (x, value), xytext=(0, 9), textcoords='offset points', ha='center', fontweight='bold')
    axis.axhline(0, color=PALETTE['ink'], linestyle='--', linewidth=1.1)
    axis.set_xticks(range(3), labels)
    axis.set_yscale('symlog', linthresh=0.05)
    axis.set_ylim(min(-0.02, min(all_gaps) * 1.25), max(all_gaps) * 1.25)
    axis.set(title=title, ylabel=tr('gap to published reference (%) · symmetric-log scale', 'gap para a referência publicada (%) · escala log-simétrica'))
    axis.grid(axis='y', alpha=0.18)
    axis.legend(loc='upper right')
    plt.show()


def historical_value(raw):
    if isinstance(raw, (int, float)):
        return {'mean': float(raw), 'min': float(raw), 'max': float(raw)}
    if str(raw).lower().startswith('no'):
        return None
    normalized = str(raw).replace(',', '.')
    match = re.fullmatch(r'\s*(-?\d+(?:\.\d+)?)\s*(?:\(\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*\))?\s*', normalized)
    if not match:
        raise ValueError(f'cannot parse historical value: {raw!r}')
    mean = float(match.group(1))
    return {'mean': mean, 'min': float(match.group(2) or mean), 'max': float(match.group(3) or mean)}
"""


INITIALIZE = "\n\n".join((
    '#@title Initialize environment and protocol · Inicializar ambiente e protocolo { display-mode: "form" }',
    IMPORTS,
    PROTOCOL,
    HELPERS,
    r"""
IG_NOTEBOOK_READY = True
print(tr(
    'Initialization complete · every analysis section is ready.',
    'Inicialização concluída · todas as seções de análise estão prontas.',
))
""",
))


LANDSCAPE = r"""
scenario_rows = []
for key, spec in instances.items():
    inst = spec['instance']
    exponent = log10_partial_schedule_count(inst.n)
    scenario_rows.append({
        tr('case', 'caso'): tr({'small': 'small', 'medium': 'medium', 'large': 'large'}[key],
                               {'small': 'pequeno', 'medium': 'médio', 'large': 'grande'}[key]),
        tr('instance', 'instância'): spec['name'],
        tr('jobs', 'tarefas'): inst.n,
        tr('setup states', 'estados de setup'): inst.n_states,
        tr('published reference', 'referência publicada'): num(spec['reference'], 0),
        tr('IG budget', 'orçamento IG'): f"{len(spec['seeds'])} × {spec['iterations']}",
        tr('unconstrained plans', 'planos irrestritos'): f"≈10^{exponent:.1f}".replace('.', ',' if LANG == 'pt' else '.'),
    })
display_table(scenario_rows, caption=tr('Evidence ladder and predeclared budgets', 'Escada de evidências e orçamentos pré-declarados'))

fig, axis = plt.subplots(figsize=(9.4, 3.4), constrained_layout=True)
keys = list(instances)
exponents = [log10_partial_schedule_count(instances[key]['instance'].n) for key in keys]
labels = [tr('small', 'pequeno'), tr('medium', 'médio'), tr('large', 'grande')]
colors = [PALETTE['green'], PALETTE['cyan'], PALETTE['blue']]
axis.hlines(range(3), 0, exponents, color=colors, linewidth=5, alpha=0.22)
axis.scatter(exponents, range(3), color=colors, s=70, zorder=3)
for y, key, exponent in zip(range(3), keys, exponents):
    n = instances[key]['instance'].n
    axis.annotate(f'n={n} · ≈10^{exponent:.1f}', (exponent, y), xytext=(8, 0), textcoords='offset points', va='center', fontweight='bold')
axis.set_yticks(range(3), labels)
axis.set_xlim(left=0)
axis.set(title=tr('Combinatorial growth before timing constraints', 'Crescimento combinatório antes das restrições de tempo'),
         xlabel=tr('base-10 exponent of ordered performed subsets', 'expoente em base 10 dos subconjuntos executados e ordenados'))
axis.grid(axis='x', alpha=0.18)
plt.show()
"""


SMALL_EXACT = r"""
def evaluate_partial_order(inst: Instance, order):
    time_now, family, performed_cost, selected_rejection = 0, inst.init_state, 0, 0
    for jid in order:
        job = inst.jobs[jid]
        setup_time = inst.setup_t[family][job.fam]
        finish = max(time_now, job.rel - setup_time) + setup_time + job.p
        if finish > job.end_max:
            return None
        performed_cost += inst.setup_c[family][job.fam] + job.mode + max(0, finish - job.due) * job.w
        selected_rejection += job.rej
        time_now, family = finish, job.fam
    return performed_cost + sum(job.rej for job in inst.jobs) - selected_rejection


def enumerate_exact(inst: Instance):
    if inst.n > 9:
        raise ValueError('exhaustive verifier is intentionally restricted to tiny instances')
    best_cost = math.inf
    best_order = ()
    best_count = feasible = examined = 0
    started = time.perf_counter()
    for performed in range(inst.n + 1):
        for order in itertools.permutations(range(inst.n), performed):
            examined += 1
            cost = evaluate_partial_order(inst, order)
            if cost is None:
                continue
            feasible += 1
            if cost < best_cost:
                best_cost, best_order, best_count = cost, order, 1
            elif cost == best_cost:
                best_count += 1
    elapsed = time.perf_counter() - started
    rejected = tuple(jid for jid in range(inst.n) if jid not in set(best_order))
    return {
        'cost': best_cost / 10, 'order': best_order, 'rejected': rejected,
        'examined': examined, 'feasible': feasible, 'best_count': best_count, 'elapsed': elapsed,
    }


small_spec = instances['small']
small_exact = enumerate_exact(small_spec['instance'])
expected_count = sum(math.perm(small_spec['instance'].n, k) for k in range(small_spec['instance'].n + 1))
assert small_exact['examined'] == expected_count == 109_601
assert small_exact['cost'] == small_spec['reference']

display_table([{
    tr('enumerated partial schedules', 'sequências parciais enumeradas'): num(small_exact['examined'], 0),
    tr('feasible under hard deadlines', 'viáveis sob prazos rígidos'): num(small_exact['feasible'], 0),
    tr('exact optimum', 'ótimo exato'): num(small_exact['cost'], 0),
    tr('optimal schedules', 'sequências ótimas'): small_exact['best_count'],
    tr('one optimal order', 'uma ordem ótima'): ' → '.join(f'J{jid}' for jid in small_exact['order']),
    tr('rejected jobs', 'tarefas rejeitadas'): ', '.join(f'J{jid}' for jid in small_exact['rejected']),
}], caption=tr('Exhaustive verification of STC_NCOS_01', 'Verificação exaustiva de STC_NCOS_01'))
print(tr('Enumeration time is local performance context only:', 'O tempo de enumeração é apenas contexto local de desempenho:'),
      f"{small_exact['elapsed']:.4f}s")
"""


SMALL_RESULTS = r"""
small_records = run_stages(small_spec)
small_priority = {
    name: priority_insertion(small_spec['instance'], rule)
    for name, rule in PRIORITY_RULES.items()
}
small_summary = stage_summary(small_records, small_spec['reference'])
small_ig = next(row for row in small_summary if row['stage'] == 'ig')
small_hits = small_ig['hits']
assert min(result.best_cost for result in small_priority.values()) >= small_exact['cost']
assert all(record['ig'].best_cost >= small_exact['cost'] for record in small_records)

small_rows = [
    {
        tr('method', 'método'): tr('priority rule · ', 'regra de prioridade · ') + name,
        tr('objective', 'objetivo'): num(result.best_cost, 0),
        tr('gap to exact optimum', 'gap para o ótimo exato'): pct(gap_percent(result.best_cost, small_exact['cost']), 2, sign=True),
        tr('candidate evaluations', 'avaliações candidatas'): result.evaluations,
    }
    for name, result in small_priority.items()
]
small_rows.extend([
    {
        tr('method', 'método'): tr('IG · seed median', 'IG · mediana das sementes'),
        tr('objective', 'objetivo'): num(small_ig['stats']['median'], 0),
        tr('gap to exact optimum', 'gap para o ótimo exato'): pct(gap_percent(small_ig['stats']['median'], small_exact['cost']), 2, sign=True),
        tr('candidate evaluations', 'avaliações candidatas'): num(small_ig['evaluations'], 0),
    },
    {
        tr('method', 'método'): tr('IG · exact hits', 'IG · acertos exatos'),
        tr('objective', 'objetivo'): f'{small_hits}/{len(small_records)}',
        tr('gap to exact optimum', 'gap para o ótimo exato'): pct(0, 2),
        tr('candidate evaluations', 'avaliações candidatas'): '—',
    },
])
display_table(small_rows, caption=tr('Exact benchmark versus transparent live baselines', 'Benchmark exato versus baselines transparentes executados agora'))

labels = list(small_priority) + [tr('IG median', 'mediana IG')]
values = [result.best_cost for result in small_priority.values()] + [small_ig['stats']['median']]
fig, axis = plt.subplots(figsize=(9.4, 4.0), constrained_layout=True)
axis.scatter(values[:-1], range(len(values) - 1), color=PALETTE['muted'], s=52, label=tr('priority rule', 'regra de prioridade'))
axis.scatter([values[-1]], [len(values) - 1], color=PALETTE['blue'], marker='D', s=65, label='IG')
axis.axvline(small_exact['cost'], color=PALETTE['green'], linestyle='--', linewidth=1.5, label=tr('exact optimum', 'ótimo exato'))
for y, value in enumerate(values):
    axis.annotate(num(value, 0), (value, y), xytext=(7, 0), textcoords='offset points', va='center')
axis.set_yticks(range(len(labels)), labels)
axis.set(title=tr('Small case · every displayed solution is evaluated by the same objective', 'Caso pequeno · toda solução usa o mesmo objetivo'),
         xlabel=tr('objective (lower is better)', 'objetivo (menor é melhor)'))
axis.grid(axis='x', alpha=0.18)
axis.legend(loc='lower center', bbox_to_anchor=(0.5, -0.34), ncols=3)
plt.show()

display(Markdown(tr(
    f"**Result.** Exhaustive enumeration proves objective **{num(small_exact['cost'], 0)}**. "
    f"IG reached it in **{small_hits}/{len(small_records)} seeds** under only {small_spec['iterations']} iterations; "
    f"the best transparent rule also reached the optimum, so the claim is reliability—not superiority over every rule.",
    f"**Resultado.** A enumeração exaustiva prova o objetivo **{num(small_exact['cost'], 0)}**. "
    f"O IG o alcançou em **{small_hits}/{len(small_records)} sementes** com apenas {small_spec['iterations']} iterações; "
    f"a melhor regra transparente também chegou ao ótimo, portanto a conclusão é confiabilidade — não superioridade sobre toda regra."
)))
"""


MEDIUM_RUNS = r"""
medium_spec = instances['medium']
medium_records = run_stages(medium_spec)
medium_priority = {
    name: priority_insertion(medium_spec['instance'], rule)
    for name, rule in PRIORITY_RULES.items()
}
medium_stage_summary = stage_summary(medium_records, medium_spec['reference'])

stage_labels = {
    'construction': tr('direct construction', 'construção direta'),
    'exchange': tr('construction + exchange', 'construção + troca'),
    'ig': 'IG',
}
medium_table = []
for row in medium_stage_summary:
    stats, low_high = row['stats'], row['hit_interval']
    medium_table.append({
        tr('stage', 'estágio'): stage_labels[row['stage']],
        tr('mean [95% CI]', 'média [IC 95%]'): f"{num(stats['mean'], 2)} [{num(row['mean_interval'][0], 2)}, {num(row['mean_interval'][1], 2)}]",
        tr('median [95% CI]', 'mediana [IC 95%]'): f"{num(stats['median'], 2)} [{num(row['median_interval'][0], 2)}, {num(row['median_interval'][1], 2)}]",
        'Q1–Q3': f"{num(stats['q1'], 2)}–{num(stats['q3'], 2)}",
        tr('minimum–maximum', 'mínimo–máximo'): f"{num(stats['min'], 0)}–{num(stats['max'], 0)}",
        tr('reference hits', 'acertos da referência'): f"{row['hits']}/{stats['n']} [{pct(100*low_high[0],1)}–{pct(100*low_high[1],1)}]",
        tr('mean evaluations', 'avaliações médias'): num(row['evaluations'], 0),
    })
display_table(medium_table, caption=tr('Paired stages across the same 30 seeds', 'Estágios pareados nas mesmas 30 sementes'))

priority_rows = [{
    tr('priority rule', 'regra de prioridade'): name,
    tr('objective', 'objetivo'): num(result.best_cost, 0),
    tr('gap to reference', 'gap para a referência'): pct(gap_percent(result.best_cost, medium_spec['reference']), 2, sign=True),
    tr('evaluations', 'avaliações'): result.evaluations,
} for name, result in medium_priority.items()]
display_table(priority_rows, caption=tr('Transparent one-pass baselines executed in this runtime', 'Baselines transparentes de uma passagem executados neste runtime'))

plot_paired_stages(
    medium_records, medium_spec['reference'],
    tr('Medium case · what each layer adds for the same seed', 'Caso médio · o que cada camada acrescenta para a mesma semente'),
)

medium_initial = [record['exchange'].best_cost for record in medium_records]
medium_final = [record['ig'].best_cost for record in medium_records]
mean_paired_reduction = statistics.fmean(
    100 * (before - after) / before for before, after in zip(medium_initial, medium_final)
)
medium_ig_summary = next(row for row in medium_stage_summary if row['stage'] == 'ig')
best_priority_medium = min(result.best_cost for result in medium_priority.values())
display(Markdown(tr(
    f"**Result.** IG reduced the post-exchange starting plan by **{pct(mean_paired_reduction, 2)} per seed on average**. "
    f"Its median objective was **{num(medium_ig_summary['stats']['median'], 0)}**, and it hit the published reference in "
    f"**{medium_ig_summary['hits']}/{len(medium_records)} runs**. The IG median was "
    f"**{pct(100*(best_priority_medium-medium_ig_summary['stats']['median'])/best_priority_medium, 2)} lower** than the best transparent priority rule.",
    f"**Resultado.** O IG reduziu o plano inicial após a troca em **{pct(mean_paired_reduction, 2)} por semente, em média**. "
    f"Sua mediana foi **{num(medium_ig_summary['stats']['median'], 0)}** e a referência publicada foi alcançada em "
    f"**{medium_ig_summary['hits']}/{len(medium_records)} execuções**. A mediana do IG ficou "
    f"**{pct(100*(best_priority_medium-medium_ig_summary['stats']['median'])/best_priority_medium, 2)} abaixo** da melhor regra transparente."
)))
"""


MEDIUM_CONVERGENCE = r"""
checkpoints = (0, 10, 25, 50, 100, 150, medium_spec['iterations'])
checkpoint_values = {
    checkpoint: [checkpoint_cost(record['ig'].log, checkpoint) for record in medium_records]
    for checkpoint in checkpoints
}
fig, axis = plt.subplots(figsize=(9.4, 4.6), constrained_layout=True)
for record in medium_records:
    log = record['ig'].log
    xs = [iteration for iteration, _ in log]
    ys = [gap_percent(cost, medium_spec['reference']) for _, cost in log]
    if xs[-1] < medium_spec['iterations']:
        xs.append(medium_spec['iterations'])
        ys.append(ys[-1])
    axis.step(xs, ys, where='post', color=PALETTE['light'], alpha=0.48, linewidth=0.8)
medians = [statistics.median(gap_percent(cost, medium_spec['reference']) for cost in checkpoint_values[c]) for c in checkpoints]
q1 = [percentile([gap_percent(cost, medium_spec['reference']) for cost in checkpoint_values[c]], 0.25) for c in checkpoints]
q3 = [percentile([gap_percent(cost, medium_spec['reference']) for cost in checkpoint_values[c]], 0.75) for c in checkpoints]
axis.fill_between(checkpoints, q1, q3, step='post', color=PALETTE['blue'], alpha=0.16, label='Q1–Q3')
axis.step(checkpoints, medians, where='post', color=PALETTE['blue'], linewidth=2.6, label=tr('seed median', 'mediana das sementes'))
axis.axhline(0, color=PALETTE['ink'], linestyle='--', linewidth=1.1, label=tr('published reference', 'referência publicada'))
axis.annotate(pct(medians[-1], 3, sign=True), (checkpoints[-1], medians[-1]), xytext=(-7, 9), textcoords='offset points', ha='right', fontweight='bold')
axis.set_yscale('symlog', linthresh=0.01)
all_convergence_gaps = [
    gap_percent(cost, medium_spec['reference'])
    for record in medium_records for _, cost in record['ig'].log
]
axis.set_ylim(min(-0.02, min(all_convergence_gaps) * 1.25), max(all_convergence_gaps) * 1.20)
axis.set(title=tr('Medium case · convergence across 30 independent seeds', 'Caso médio · convergência em 30 sementes independentes'),
         xlabel=tr('completed IG iterations', 'iterações IG concluídas'),
         ylabel=tr('incumbent gap to reference (%) · symmetric-log scale', 'gap da melhor solução (%) · escala log-simétrica'))
axis.grid(axis='y', alpha=0.18)
axis.legend()
plt.show()
"""


PORTFOLIOS = r"""
def portfolio_experiment(inst: Instance, *, shapes, replicates: int, d: int):
    rows = []
    for replicate in range(replicates):
        seed_pool = random.Random(73_551_001 + replicate).sample(range(2**32), max(runs for runs, _ in shapes))
        for runs, iterations in shapes:
            results = [
                solve(inst, max_iters=iterations, seed=seed_pool[index], d=d, accept='current', permute=True, target=None)
                for index in range(runs)
            ]
            for result in results:
                validate_result(inst, result)
            best = min(results, key=lambda result: (result.best_cost, result.evaluations))
            rows.append({
                'replicate': replicate, 'runs': runs, 'iterations_per_run': iterations,
                'best_cost': best.best_cost, 'evaluations': sum(result.evaluations for result in results),
            })
    return rows


portfolio_rows = portfolio_experiment(
    medium_spec['instance'], shapes=PORTFOLIO_SHAPES,
    replicates=PORTFOLIO_REPLICATES, d=medium_spec['d'],
)
portfolio_summary = []
for runs, iterations in PORTFOLIO_SHAPES:
    group = [row for row in portfolio_rows if row['runs'] == runs]
    costs = [row['best_cost'] for row in group]
    hits = sum(cost <= medium_spec['reference'] for cost in costs)
    interval = wilson_interval(hits, len(costs))
    portfolio_summary.append({
        'runs': runs, 'iterations': iterations, 'costs': costs,
        'stats': describe(costs), 'hits': hits, 'hit_interval': interval,
        'evaluations': statistics.fmean(row['evaluations'] for row in group),
    })

display_table([{
    tr('portfolio', 'portfólio'): f"{row['runs']} × {row['iterations']}",
    tr('total iterations', 'iterações totais'): row['runs'] * row['iterations'],
    tr('median best', 'melhor mediano'): num(row['stats']['median'], 2),
    tr('mean best', 'melhor médio'): num(row['stats']['mean'], 2),
    tr('reference hits', 'acertos da referência'): f"{row['hits']}/{PORTFOLIO_REPLICATES}",
    tr('mean candidate evaluations', 'avaliações candidatas médias'): num(row['evaluations'], 0),
} for row in portfolio_summary], caption=tr('One long run or several restarts? Fixed total outer-iteration budget', 'Uma execução longa ou vários reinícios? Orçamento total fixo de iterações'))

fig, axis = plt.subplots(figsize=(9.4, 4.5), constrained_layout=True)
all_portfolio_gaps = []
for x, row in enumerate(portfolio_summary):
    gaps = [gap_percent(cost, medium_spec['reference']) for cost in row['costs']]
    all_portfolio_gaps.extend(gaps)
    offsets = [(-0.16 + 0.32 * i / (len(gaps) - 1)) if len(gaps) > 1 else 0 for i in range(len(gaps))]
    axis.scatter([x + offset for offset in offsets], gaps, color=PALETTE['muted'], alpha=0.48, s=24)
    median = statistics.median(gaps)
    axis.scatter([x], [median], color=PALETTE['blue'], marker='D', s=62, zorder=4)
    axis.annotate(pct(median, 3, sign=True), (x, median), xytext=(0, 9), textcoords='offset points', ha='center', fontweight='bold')
axis.axhline(0, color=PALETTE['ink'], linestyle='--', linewidth=1.1)
axis.set_xticks(range(len(portfolio_summary)), [
    f"{row['runs']} × {row['iterations']}\n≈{num(row['evaluations'], 0)} " + tr('evals', 'avaliações')
    for row in portfolio_summary
])
axis.set_yscale('symlog', linthresh=0.01)
axis.set_ylim(min(-0.02, min(all_portfolio_gaps) * 1.25), max(all_portfolio_gaps) * 1.20)
axis.set(title=tr('Fixed iteration budget · restart structure changes both risk and evaluations', 'Orçamento fixo em iterações · reinícios mudam risco e avaliações'),
         ylabel=tr('best portfolio gap to reference (%) · symmetric-log scale', 'gap do melhor do portfólio (%) · escala log-simétrica'))
axis.grid(axis='y', alpha=0.18)
plt.show()

long_portfolio = next(row for row in portfolio_summary if row['runs'] == 1)
four_portfolio = next(row for row in portfolio_summary if row['runs'] == 4)
short_portfolio = next(row for row in portfolio_summary if row['runs'] == 10)
display(Markdown(tr(
    f"**Decision reading.** **1 × 200** and **4 × 50** tied at median {num(long_portfolio['stats']['median'], 0)}. "
    f"The long run used fewer evaluations and hit the reference {long_portfolio['hits']}/{PORTFOLIO_REPLICATES} times versus {four_portfolio['hits']}/{PORTFOLIO_REPLICATES}; "
    f"four restarts cut the mean from {num(long_portfolio['stats']['mean'], 2)} to {num(four_portfolio['stats']['mean'], 2)} by avoiding the long run's bad tail. "
    f"At **10 × 20**, each search was too short: median {num(short_portfolio['stats']['median'], 0)}. There is no universal winner here; deployment must price tail risk and repeated initialization in evaluations or time.",
    f"**Leitura de decisão.** **1 × 200** e **4 × 50** empataram na mediana {num(long_portfolio['stats']['median'], 0)}. "
    f"A execução longa usou menos avaliações e acertou a referência {long_portfolio['hits']}/{PORTFOLIO_REPLICATES} vezes, contra {four_portfolio['hits']}/{PORTFOLIO_REPLICATES}; "
    f"quatro reinícios reduziram a média de {num(long_portfolio['stats']['mean'], 2)} para {num(four_portfolio['stats']['mean'], 2)} ao evitar a cauda ruim da execução longa. "
    f"Em **10 × 20**, cada busca ficou curta demais: mediana {num(short_portfolio['stats']['median'], 0)}. Não há vencedor universal; a implantação deve precificar risco de cauda e inicialização repetida em avaliações ou tempo."
)))
"""


LARGE_RESULTS = r"""
large_spec = instances['large']
large_records = run_stages(large_spec)
large_priority = {
    name: priority_insertion(large_spec['instance'], rule)
    for name, rule in PRIORITY_RULES.items()
}
large_stage_summary = stage_summary(large_records, large_spec['reference'])
large_ig_summary = next(row for row in large_stage_summary if row['stage'] == 'ig')

display_table([{
    tr('stage', 'estágio'): stage_labels[row['stage']],
    tr('mean [95% CI]', 'média [IC 95%]'): f"{num(row['stats']['mean'], 2)} [{num(row['mean_interval'][0], 2)}, {num(row['mean_interval'][1], 2)}]",
    tr('median [95% CI]', 'mediana [IC 95%]'): f"{num(row['stats']['median'], 2)} [{num(row['median_interval'][0], 2)}, {num(row['median_interval'][1], 2)}]",
    tr('median gap', 'gap mediano'): pct(gap_percent(row['stats']['median'], large_spec['reference']), 2, sign=True),
    'Q1–Q3': f"{num(row['stats']['q1'], 0)}–{num(row['stats']['q3'], 0)}",
    tr('minimum–maximum', 'mínimo–máximo'): f"{num(row['stats']['min'], 0)}–{num(row['stats']['max'], 0)}",
    tr('reference hits', 'acertos da referência'): f"{row['hits']}/{row['stats']['n']}",
    tr('mean evaluations', 'avaliações médias'): num(row['evaluations'], 0),
} for row in large_stage_summary], caption=tr('Large case · paired evidence across 30 seeds', 'Caso grande · evidência pareada em 30 sementes'))

display_table([{
    tr('priority rule', 'regra de prioridade'): name,
    tr('objective', 'objetivo'): num(result.best_cost, 0),
    tr('gap to reference', 'gap para a referência'): pct(gap_percent(result.best_cost, large_spec['reference']), 2, sign=True),
    tr('evaluations', 'avaliações'): result.evaluations,
} for name, result in large_priority.items()], caption=tr(
    'Large-case transparent one-pass baselines', 'Baselines transparentes de uma passagem no caso grande'
))

plot_paired_stages(
    large_records, large_spec['reference'],
    tr('Large case · substantial improvement, visible residual risk', 'Caso grande · melhoria substancial, risco residual visível'),
)

large_initial = [record['exchange'].best_cost for record in large_records]
large_final = [record['ig'].best_cost for record in large_records]
large_reduction = statistics.fmean(100 * (before - after) / before for before, after in zip(large_initial, large_final))
large_best_priority = min(result.best_cost for result in large_priority.values())
large_space_exponent = log10_partial_schedule_count(large_spec['instance'].n)
large_coverage_exponent = math.log10(large_ig_summary['evaluations']) - large_space_exponent + 2
display(Markdown(tr(
    f"**Result.** IG reduced the post-exchange starting objective by **{pct(large_reduction, 2)} per seed on average**. "
    f"The final median was **{num(large_ig_summary['stats']['median'], 0)}** "
    f"({pct(gap_percent(large_ig_summary['stats']['median'], large_spec['reference']), 2, sign=True)} to the published reference), "
    f"with **{large_ig_summary['hits']}/{len(large_records)} hits**. Its mean result was "
    f"**{pct(100*(large_best_priority-large_ig_summary['stats']['mean'])/large_best_priority, 2)} lower** than the best transparent priority rule. "
    f"Even if every candidate evaluation were unique, an average run could cover at most about **10^{large_coverage_exponent:.0f}%** of the unconstrained space.",
    f"**Resultado.** O IG reduziu o objetivo inicial após a troca em **{pct(large_reduction, 2)} por semente, em média**. "
    f"A mediana final foi **{num(large_ig_summary['stats']['median'], 0)}** "
    f"({pct(gap_percent(large_ig_summary['stats']['median'], large_spec['reference']), 2, sign=True)} para a referência publicada), "
    f"com **{large_ig_summary['hits']}/{len(large_records)} acertos**. Seu resultado médio ficou "
    f"**{pct(100*(large_best_priority-large_ig_summary['stats']['mean'])/large_best_priority, 2)} abaixo** da melhor regra transparente. "
    f"Mesmo supondo que cada avaliação candidata fosse inédita, uma execução média cobriria no máximo cerca de **10^{large_coverage_exponent:.0f}%** do espaço irrestrito."
)))
"""


HISTORICAL = r"""
METHOD_COLUMNS = {
    'MILP': 2, tr('Direct insertion', 'Inserção direta'): 3, 'Descent': 4,
    'Tabu': 5, 'TabuDiv': 6, 'AMA_mem': 7, 'AMA_sp': 8, 'IG': 9,
}
METHOD_LABELS = {'AMA_mem': 'AMA-Mem', 'AMA_sp': 'AMA-SP'}
def method_label(method: str) -> str:
    return METHOD_LABELS.get(method, method)

HEURISTIC_METHODS = list(METHOD_COLUMNS)[1:]
historical = {}
for instance_name, raw in benchmark.items():
    family = 'STC' if instance_name.startswith('STC_NCOS_') else 'NCOS'
    historical[instance_name] = {
        'family': family, 'jobs': raw[0], 'reference': raw[1],
        'methods': {method: historical_value(raw[index]) for method, index in METHOD_COLUMNS.items()},
    }

historical_summary = {}
for family in ('NCOS', 'STC'):
    family_rows = [row for row in historical.values() if row['family'] == family]
    historical_summary[family] = {}
    for method in METHOD_COLUMNS:
        values = [row['methods'][method]['mean'] for row in family_rows if row['methods'][method] is not None]
        historical_summary[family][method] = {
            'mean': statistics.fmean(values), 'median': statistics.median(values),
            'coverage': len(values), 'instances': len(family_rows),
            'hits': sum(value <= 0 for value in values),
        }

display_table([{
    tr('family', 'família'): family,
    tr('method', 'método'): method_label(method),
    tr('mean relative error', 'erro relativo médio'): pct(values['mean'], 3),
    tr('median', 'mediana'): pct(values['median'], 3),
    tr('coverage', 'cobertura'): f"{values['coverage']}/{values['instances']}",
    tr('reference hits', 'acertos da referência'): values['hits'],
} for family in ('NCOS', 'STC') for method, values in historical_summary[family].items()],
caption=tr('Published 2015 solution-quality summary', 'Resumo publicado de qualidade de solução em 2015'))

selected_case_rows = []
for key in ('small', 'medium', 'large'):
    instance_name = instances[key]['name']
    row = {tr('live case', 'caso executado'): instance_name}
    for method in HEURISTIC_METHODS:
        row[method_label(method)] = pct(historical[instance_name]['methods'][method]['mean'], 1)
    selected_case_rows.append(row)
display_table(selected_case_rows, caption=tr(
    'Historical mean relative error on the three live cases · ranges remain available in benchmark.json',
    'Erro relativo médio histórico nos três casos executados · amplitudes permanecem disponíveis em benchmark.json',
))

fig, axes = plt.subplots(1, 2, figsize=(11.2, 5.2), constrained_layout=True, sharex=True)
for axis, family in zip(axes, ('NCOS', 'STC')):
    methods = HEURISTIC_METHODS
    values = [historical_summary[family][method]['mean'] for method in methods]
    colors = [PALETTE['blue'] if method == 'IG' else PALETTE['muted'] for method in methods]
    markers = ['D' if method == 'IG' else 'o' for method in methods]
    for y, (method, value, color, marker) in enumerate(zip(methods, values, colors, markers)):
        axis.scatter([value], [y], color=color, marker=marker, s=58 if method == 'IG' else 38, zorder=3)
        axis.annotate(pct(value, 3), (value, y), xytext=(7, 0), textcoords='offset points', va='center', fontweight='bold' if method == 'IG' else 'normal')
    axis.axvline(0, color=PALETTE['ink'], linewidth=1)
    axis.set_yticks(range(len(methods)), [method_label(method) for method in methods])
    axis.set_xscale('symlog', linthresh=0.05)
    axis.set_title(f"{family} · {historical_summary[family]['IG']['instances']} " + tr('instances', 'instâncias'))
    axis.set_xlabel(tr('mean relative error across instances (%)', 'erro relativo médio entre instâncias (%)'))
    axis.grid(axis='x', alpha=0.18)
fig.suptitle(tr('Historical arena · IG led NCOS, but not the setup-heavy STC group', 'Arena histórica · IG liderou NCOS, mas não o grupo STC com setups'))
plt.show()
"""


HISTORICAL_PAIRWISE = r"""
pairwise = []
for method in HEURISTIC_METHODS:
    if method == 'IG':
        continue
    pairs = []
    for row in historical.values():
        ig_value = row['methods']['IG']
        other_value = row['methods'][method]
        if ig_value is not None and other_value is not None:
            pairs.append((ig_value['mean'], other_value['mean']))
    pairwise.append({
        'method': method,
        'better': sum(ig < other for ig, other in pairs),
        'tie': sum(ig == other for ig, other in pairs),
        'worse': sum(ig > other for ig, other in pairs),
        'shared': len(pairs),
    })

fig, axis = plt.subplots(figsize=(9.4, 4.7), constrained_layout=True)
y = list(range(len(pairwise)))
left = [0] * len(pairwise)
for key, color, label in (
    ('better', PALETTE['green'], tr('IG lower error', 'IG com erro menor')),
    ('tie', PALETTE['light'], tr('equal reported mean', 'média reportada igual')),
    ('worse', PALETTE['orange'], tr('IG higher error', 'IG com erro maior')),
):
    widths = [row[key] for row in pairwise]
    axis.barh(y, widths, left=left, color=color, label=label)
    for row_y, start, width in zip(y, left, widths):
        if width:
            axis.text(start + width / 2, row_y, str(width), ha='center', va='center', fontweight='bold', color=PALETTE['ink'])
    left = [start + width for start, width in zip(left, widths)]
axis.set_yticks(y, [method_label(row['method']) for row in pairwise])
axis.invert_yaxis()
axis.set_xlim(0, 44)
axis.set(title=tr('Historical pairwise count across shared instances', 'Contagem histórica pareada nas instâncias compartilhadas'),
         xlabel=tr('instances · lower mean relative error is better', 'instâncias · menor erro relativo médio é melhor'))
axis.grid(axis='x', alpha=0.16)
axis.legend(ncols=3, loc='lower center', bbox_to_anchor=(0.5, -0.28))
plt.show()

stc_ig_values = {
    name: row['methods']['IG']['mean']
    for name, row in historical.items() if row['family'] == 'STC'
}
stress_names = ('STC_NCOS_51', 'STC_NCOS_51a')
stress_share = 100 * sum(stc_ig_values[name] for name in stress_names) / sum(stc_ig_values.values())
stc_without_stress = statistics.fmean(value for name, value in stc_ig_values.items() if name not in stress_names)
ncos_ig = historical_summary['NCOS']['IG']['mean']
stc_ig = historical_summary['STC']['IG']['mean']
best_ncos = min((values['mean'], method) for method, values in historical_summary['NCOS'].items() if method != 'MILP')
best_stc = min((values['mean'], method) for method, values in historical_summary['STC'].items() if method != 'MILP')

display(Markdown(tr(
    f"**Historical reading.** IG posted the lowest mean error in NCOS: **{pct(ncos_ig, 3)}**. "
    f"In STC it reached **{pct(stc_ig, 3)}**, behind **{method_label(best_stc[1])} ({pct(best_stc[0], 3)})**. "
    f"The two 200-job cases {stress_names[0]}/{stress_names[1]} contribute **{pct(stress_share, 1)}** of IG's summed STC error; "
    f"without them the post-hoc diagnostic mean is {pct(stc_without_stress, 3)}. This localizes a weakness—it does not erase it.",
    f"**Leitura histórica.** O IG obteve o menor erro médio em NCOS: **{pct(ncos_ig, 3)}**. "
    f"Em STC, alcançou **{pct(stc_ig, 3)}**, atrás de **{method_label(best_stc[1])} ({pct(best_stc[0], 3)})**. "
    f"Os dois casos com 200 tarefas {stress_names[0]}/{stress_names[1]} concentram **{pct(stress_share, 1)}** da soma do erro STC do IG; "
    f"sem eles, a média diagnóstica post-hoc é {pct(stc_without_stress, 3)}. Isso localiza uma fraqueza — não a apaga."
)))
"""


SENSITIVITY = r"""
sensitivity_configs = (
    {'name': tr('baseline · d=2', 'baseline · d=2'), 'iterations': 200, 'd': 2, 'accept': 'current', 'permute': True},
    {'name': tr('matched evals · d=2', 'avaliações pareadas · d=2'), 'iterations': 265, 'd': 2, 'accept': 'current', 'permute': True},
    {'name': tr('wider destroy · d=8', 'destruição ampla · d=8'), 'iterations': 200, 'd': 8, 'accept': 'current', 'permute': True},
    {'name': tr('restart incumbent', 'reinicia da melhor solução'), 'iterations': 200, 'd': 2, 'accept': 'best', 'permute': True},
    {'name': tr('no exchange', 'sem troca'), 'iterations': 200, 'd': 2, 'accept': 'current', 'permute': False},
)
baseline_subset = {
    record['seed']: record['ig'] for record in medium_records if record['seed'] in SENSITIVITY_SEEDS
}
sensitivity_runs = {}
for config in sensitivity_configs:
    if config is sensitivity_configs[0]:
        sensitivity_runs[config['name']] = [
            {'seed': seed, 'result': baseline_subset[seed]} for seed in SENSITIVITY_SEEDS
        ]
        continue
    runs = []
    for seed in SENSITIVITY_SEEDS:
        result = solve(
            medium_spec['instance'], max_iters=config['iterations'], seed=seed,
            d=config['d'], accept=config['accept'], permute=config['permute'], target=None,
        )
        validate_result(medium_spec['instance'], result)
        runs.append({'seed': seed, 'result': result})
    sensitivity_runs[config['name']] = runs

baseline_by_seed = {seed: result.best_cost for seed, result in baseline_subset.items()}
baseline_mean_evals = statistics.fmean(result.evaluations for result in baseline_subset.values())
sensitivity_effects = []
for index, config in enumerate(sensitivity_configs):
    runs = sensitivity_runs[config['name']]
    differences = [run['result'].best_cost - baseline_by_seed[run['seed']] for run in runs]
    mean_delta = statistics.fmean(differences)
    interval = bootstrap_ci(differences, statistics.fmean, seed=BOOTSTRAP_SEED + 500 + index)
    mean_evaluations = statistics.fmean(run['result'].evaluations for run in runs)
    costs = [run['result'].best_cost for run in runs]
    sensitivity_effects.append({
        'name': config['name'], 'differences': differences, 'mean_delta': mean_delta,
        'interval': interval, 'evaluation_ratio': mean_evaluations / baseline_mean_evals,
        'stats': describe(costs), 'hits': sum(cost <= medium_spec['reference'] for cost in costs),
    })

display_table([{
    tr('configuration', 'configuração'): row['name'],
    tr('mean objective', 'objetivo médio'): num(row['stats']['mean'], 2),
    tr('maximum', 'máximo'): num(row['stats']['max'], 0),
    tr('reference hits', 'acertos da referência'): f"{row['hits']}/{len(SENSITIVITY_SEEDS)}",
    tr('paired mean Δ', 'Δ médio pareado'): f"{num(row['mean_delta'], 2)}",
    tr('95% bootstrap interval', 'intervalo bootstrap 95%'): f"[{num(row['interval'][0], 2)}, {num(row['interval'][1], 2)}]",
    tr('evaluations vs baseline', 'avaliações vs baseline'): f"{num(row['evaluation_ratio'], 2)}×",
} for row in sensitivity_effects], caption=tr('Medium-case sensitivity · positive Δ is worse', 'Sensibilidade no caso médio · Δ positivo é pior'))

fig, axis = plt.subplots(figsize=(9.4, 4.6), constrained_layout=True)
for y, row in enumerate(sensitivity_effects):
    offsets = [-0.15 + 0.30 * i / (len(row['differences']) - 1) for i in range(len(row['differences']))]
    axis.scatter(row['differences'], [y + offset for offset in offsets], color=PALETTE['muted'], alpha=0.38, s=21)
    low, high = row['interval']
    axis.errorbar(row['mean_delta'], y, xerr=[[row['mean_delta'] - low], [high - row['mean_delta']]],
                  fmt='D', color=PALETTE['blue'], capsize=4, markersize=5, zorder=4)
axis.axvline(0, color=PALETTE['ink'], linestyle='--', linewidth=1.1)
axis.set_yticks(range(len(sensitivity_effects)), [
    f"{row['name']} · {num(row['evaluation_ratio'], 2)}× " + tr('evals', 'avaliações')
    for row in sensitivity_effects
])
axis.invert_yaxis()
axis.set_xscale('symlog', linthresh=1)
axis.set(title=tr('Paired design effects across 20 shared seeds', 'Efeitos pareados em 20 sementes compartilhadas'),
         xlabel=tr('objective difference versus d=2 baseline · negative is better', 'diferença de objetivo contra baseline d=2 · negativo é melhor'))
axis.grid(axis='x', alpha=0.18)
plt.show()

wider = next(row for row in sensitivity_effects if 'd=8' in row['name'])
matched = next(row for row in sensitivity_effects if 'matched' in row['name'] or 'pareadas' in row['name'])
display(Markdown(tr(
    f"**Next hypothesis.** At nearly matched evaluation counts ({num(matched['evaluation_ratio'], 2)}× versus {num(wider['evaluation_ratio'], 2)}× baseline), "
    f"wider destruction changed the mean from **{num(matched['stats']['mean'], 2)}** to **{num(wider['stats']['mean'], 2)}** and the worst cost from "
    f"**{num(matched['stats']['max'], 0)}** to **{num(wider['stats']['max'], 0)}**. Hit rate alone would miss this tail-risk trade-off; "
    f"the next study should compare adaptive destruction under matched evaluations on held-out instances.",
    f"**Próxima hipótese.** Com contagens de avaliações quase pareadas ({num(matched['evaluation_ratio'], 2)}× contra {num(wider['evaluation_ratio'], 2)}× o baseline), "
    f"a destruição ampla alterou a média de **{num(matched['stats']['mean'], 2)}** para **{num(wider['stats']['mean'], 2)}** e o pior custo de "
    f"**{num(matched['stats']['max'], 0)}** para **{num(wider['stats']['max'], 0)}**. Olhar apenas a taxa de acerto esconderia esse compromisso de risco de cauda; "
    f"o próximo estudo deve comparar destruição adaptativa com avaliações pareadas em instâncias reservadas."
)))
"""


AUDIT = r"""
best_medium_record = min(medium_records, key=lambda record: (record['ig'].best_cost, record['seed']))
audited_result = best_medium_record['ig']
audit = validate_result(medium_spec['instance'], audited_result)
components = {
    tr('setup', 'setup'): audit.setup_deci / 10,
    tr('mode', 'modo'): audit.mode_deci / 10,
    tr('tardiness', 'atraso'): audit.tardiness_deci / 10,
    tr('rejection', 'rejeição'): audit.rejection_deci / 10,
}
assert abs(sum(components.values()) - audited_result.best_cost) < 1e-9

display_table([{
    tr('seed', 'semente'): best_medium_record['seed'],
    tr('objective', 'objetivo'): num(audited_result.best_cost, 0),
    tr('gap to published reference', 'gap para a referência publicada'): pct(gap_percent(audited_result.best_cost, medium_spec['reference']), 4, sign=True),
    tr('performed', 'executadas'): len(audited_result.order),
    tr('rejected', 'rejeitadas'): len(audited_result.rejected),
    tr('makespan', 'makespan'): audit.rows[-1]['finish'] if audit.rows else 0,
    tr('candidate evaluations', 'avaliações candidatas'): audited_result.evaluations,
}], caption=tr('Selected best observed medium-case run', 'Melhor execução observada selecionada no caso médio'))

display_table([{
    tr('objective component', 'componente do objetivo'): name,
    tr('cost', 'custo'): num(value, 0),
    tr('share of total', 'participação no total'): pct(100 * value / audited_result.best_cost, 1),
} for name, value in components.items()], caption=tr(
    'Term-by-term closure before plotting', 'Fechamento termo a termo antes da visualização'
))

fig, axis = plt.subplots(figsize=(10.8, 3.5), constrained_layout=True)
family_colors = plt.get_cmap('tab10')
for row in audit.rows:
    setup_duration = row['process_start'] - row['setup_start']
    process_duration = row['finish'] - row['process_start']
    if setup_duration:
        axis.broken_barh([(row['setup_start'], setup_duration)], (7, 8),
                         facecolors=PALETTE['light'], edgecolors=PALETTE['muted'], hatch='///', linewidth=0.6)
    axis.broken_barh([(row['process_start'], process_duration)], (7, 8),
                     facecolors=family_colors(row['family_after'] % 10), edgecolors='white', linewidth=0.7)
    if process_duration >= 4:
        axis.text(row['process_start'] + process_duration / 2, 11, f"J{row['job']}",
                  ha='center', va='center', fontsize=6.5, color='white', fontweight='bold', rotation=90)
axis.scatter([row['due'] for row in audit.rows], [18] * len(audit.rows),
             marker='v', s=23, color=PALETTE['ink'], alpha=0.6, label=tr('due date', 'data de entrega'))
view_max = max(row['finish'] for row in audit.rows) * 1.05
axis.set_xlim(0, view_max)
axis.set_ylim(4, 21)
axis.set_yticks([11], [tr('single CNC machine', 'máquina CNC única')])
axis.set(title=tr('Audited schedule · setup is hatched; processing color identifies tool family', 'Programação auditada · setup hachurado; a cor identifica a família'),
         xlabel=tr('time', 'tempo'))
axis.grid(axis='x', alpha=0.18)
used_families = sorted({row['family_after'] for row in audit.rows})
schedule_legend = [
    Patch(facecolor=PALETTE['light'], edgecolor=PALETTE['muted'], hatch='///', label=tr('setup time', 'tempo de setup')),
    *[Patch(facecolor=family_colors(family % 10), label=tr('family', 'família') + f' {family}') for family in used_families],
    Line2D([0], [0], marker='v', linestyle='none', color=PALETTE['ink'], label=tr('due date', 'data de entrega')),
]
axis.legend(handles=schedule_legend, loc='lower center', bbox_to_anchor=(0.5, -0.38), ncols=len(schedule_legend))
plt.show()

fig, axis = plt.subplots(figsize=(9.4, 2.7), constrained_layout=True)
left = 0
component_colors = (PALETTE['cyan'], PALETTE['blue'], PALETTE['orange'], PALETTE['red'])
component_total = sum(components.values())
for (name, value), color in zip(components.items(), component_colors):
    axis.barh([tr('objective', 'objetivo')], [value], left=left, color=color)
    if value / component_total >= 0.06:
        axis.text(left + value / 2, 0, f'{name}\n{num(value, 0)}', ha='center', va='center', fontsize=8, color='white', fontweight='bold')
    elif value > 0:
        axis.annotate(
            f'{name} · {num(value, 0)}', xy=(left + value / 2, 0.38),
            xytext=(left + value + component_total * 0.015, 0.68),
            ha='left', va='center', fontsize=8, fontweight='bold',
            arrowprops={'arrowstyle': '-', 'color': PALETTE['muted'], 'linewidth': 0.8},
        )
    left += value
axis.set_xlim(0, max(left * 1.02, 1))
axis.set_ylim(-0.65, 0.86)
axis.set(title=tr('Exact objective closure', 'Fechamento exato do objetivo'), xlabel=tr('cost units', 'unidades de custo'))
axis.grid(axis='x', alpha=0.15)
plt.show()

rejected_rows = [{
    tr('job', 'tarefa'): f'J{jid}',
    tr('family', 'família'): medium_spec['instance'].jobs[jid].fam,
    tr('release', 'liberação'): medium_spec['instance'].jobs[jid].rel,
    tr('due', 'entrega'): medium_spec['instance'].jobs[jid].due,
    tr('hard deadline', 'prazo rígido'): medium_spec['instance'].jobs[jid].end_max,
    tr('rejection cost', 'custo de rejeição'): num(medium_spec['instance'].jobs[jid].rej / 10, 0),
} for jid in audit.rejected]
display_table(rejected_rows, caption=tr('Rejected jobs charged in the audited objective', 'Tarefas rejeitadas cobradas no objetivo auditado'))
"""


CONCLUSIONS = r"""
small_rate = 100 * small_hits / len(small_records)
medium_hit_rate = 100 * medium_ig_summary['hits'] / len(medium_records)
large_hit_rate = 100 * large_ig_summary['hits'] / len(large_records)

display(Markdown(tr(
    f'''### First-time reader

- **Correctness at small scale:** all {num(small_exact['examined'], 0)} partial schedules were checked; the exact optimum is **{num(small_exact['cost'], 0)}**, reached by IG in **{pct(small_rate, 1)}** of seeded runs.
- **Reliability at medium scale:** full IG cut its post-exchange starting plan by **{pct(mean_paired_reduction, 2)} per seed on average** and reached the published reference in **{pct(medium_hit_rate, 1)}** of runs.
- **Value at large scale:** with about $10^{{{log10_partial_schedule_count(large_spec['instance'].n):.0f}}}$ unconstrained plans, IG still reduced its starting plan by **{pct(large_reduction, 2)} per seed on average**; the non-100% hit rate (**{pct(large_hit_rate, 1)}**) is why stochastic evidence needs distributions and repeated runs.
- **Comparison with others:** historically, IG had the best mean error on the 30 no-setup instances (**{pct(ncos_ig, 3)}**), but not on the 14 setup instances (**{pct(stc_ig, 3)}**). The right conclusion is “strong with a localized large-setup weakness,” not “wins everywhere.”

### Research reading

The live priority baselines show that repeated destroy/reinsert search adds value beyond one-pass ordering rules. The paired stage analysis attributes that value without mixing hardware or protocols. The fixed-budget portfolio experiment answers whether restarts are worth their repeated initialization on STC_NCOS_15. The sensitivity analysis then shows why mean, tail, hit rate, and evaluations must be read together.

The next confirmatory study should pre-register held-out STC instances, compare fixed and adaptive destruction under matched candidate-evaluation or wall-clock budgets, and use enough independent seeds to estimate tail quantiles. The 200-job STC pair is the natural stress set, but it must not also be used to tune the policy being judged.''',
    f'''### Leitura para quem está chegando

- **Correção em pequena escala:** as {num(small_exact['examined'], 0)} sequências parciais foram verificadas; o ótimo exato é **{num(small_exact['cost'], 0)}**, alcançado pelo IG em **{pct(small_rate, 1)}** das execuções.
- **Confiabilidade em escala média:** o IG completo reduziu o plano inicial após a troca em **{pct(mean_paired_reduction, 2)} por semente, em média** e chegou à referência publicada em **{pct(medium_hit_rate, 1)}** das execuções.
- **Valor em escala grande:** diante de aproximadamente $10^{{{log10_partial_schedule_count(large_spec['instance'].n):.0f}}}$ planos irrestritos, o IG ainda reduziu o plano inicial em **{pct(large_reduction, 2)} por semente, em média**; a taxa de acerto abaixo de 100% (**{pct(large_hit_rate, 1)}**) mostra por que evidência estocástica exige distribuições e repetição.
- **Comparação com outros:** historicamente, o IG teve o menor erro médio nas 30 instâncias sem setup (**{pct(ncos_ig, 3)}**), mas não nas 14 com setup (**{pct(stc_ig, 3)}**). A conclusão correta é “forte, com uma fraqueza localizada em setups grandes”, não “vence em todo lugar”.

### Leitura de pesquisa

Os baselines de prioridade executados agora mostram que a busca repetida de destruir/reinserir agrega valor além de regras de ordenação de uma passagem. A análise pareada atribui esse valor sem misturar hardware ou protocolos. O portfólio com orçamento fixo responde quando reinícios compensam a inicialização repetida em STC_NCOS_15. A sensibilidade mostra por que média, cauda, taxa de acerto e avaliações precisam ser lidas juntas.

O próximo estudo confirmatório deve pré-registrar instâncias STC reservadas, comparar destruição fixa e adaptativa sob orçamento pareado de avaliações candidatas ou tempo e usar sementes independentes suficientes para estimar quantis de cauda. O par STC com 200 tarefas é o stress test natural, mas não pode ser usado também para ajustar a política que será julgada.'''
)))
"""


MANIFEST = r"""
def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def git_value(*args: str):
    try:
        return subprocess.run(['git', *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None


def result_payload(result: Result):
    return {
        'best_cost': result.best_cost, 'order': result.order, 'rejected': result.rejected,
        'iterations': result.iterations, 'evaluations': result.evaluations, 'log': result.log,
    }


raw_results = {
    'small_exact': {key: value for key, value in small_exact.items() if key != 'elapsed'},
    'scenarios': {
        key: [{
            'seed': record['seed'],
            'construction': result_payload(record['construction']),
            'exchange': result_payload(record['exchange']),
            'ig': result_payload(record['ig']),
        } for record in records]
        for key, records in (
            ('small', small_records), ('medium', medium_records), ('large', large_records)
        )
    },
    'priority_rules': {
        key: [result_payload(result) for result in results.values()]
        for key, results in (
            ('small', small_priority), ('medium', medium_priority), ('large', large_priority)
        )
    },
    'portfolios': portfolio_rows,
    'sensitivity': [
        {
            'configuration_index': index,
            'runs': [{'seed': run['seed'], 'result': result_payload(run['result'])} for run in runs],
        }
        for index, runs in enumerate(sensitivity_runs.values())
    ],
}
raw_json = json.dumps(raw_results, sort_keys=True, separators=(',', ':'))
git_status = git_value('status', '--porcelain')
manifest = {
    'schema': 'ig-bilingual-research-notebook-manifest-v3',
    'language': LANG,
    'executed_at_utc': datetime.now(timezone.utc).isoformat(),
    'repository_commit': git_value('rev-parse', 'HEAD'),
    'repository_dirty': bool(git_status) if git_status is not None else None,
    'source_mode': SOURCE_MODE,
    'pinned_public_engine_revision': REPOSITORY_REF,
    'runtime': {
        'python': platform.python_version(), 'platform': platform.platform(),
        'ig_scheduler': ig_scheduler.__version__, 'matplotlib': matplotlib.__version__,
    },
    'source_sha256': {
        'engine': sha256_file(Path(ig_scheduler.__file__).resolve()),
        'benchmark': sha256_file(ROOT / 'benchmark.json'),
        'instances': {key: sha256_file(spec['path']) for key, spec in instances.items()},
    },
    'seed_design': {
        'space': 'unsigned 32-bit integers', 'without_replacement': True,
        'meta_seed': META_SEED, 'realized_seeds': list(SEEDS),
    },
    'scenarios': {
        key: {
            'instance': spec['name'], 'jobs': spec['instance'].n,
            'published_2015_reference': spec['reference'],
            'seeds': list(spec['seeds']), 'max_iters': spec['iterations'],
            'd': spec['d'], 'accept': 'current', 'permute': True, 'target': None,
        }
        for key, spec in instances.items()
    },
    'portfolio': {
        'instance': medium_spec['name'], 'replicates': PORTFOLIO_REPLICATES,
        'shapes': list(PORTFOLIO_SHAPES), 'total_outer_iterations': PORTFOLIO_TOTAL_ITERATIONS,
        'seed_formula': 'random.Random(73551001 + replicate).sample(uint32, max_runs)',
    },
    'sensitivity': {
        'instance': medium_spec['name'], 'seeds': list(SENSITIVITY_SEEDS),
        'baseline_max_iters': SENSITIVITY_ITERATIONS, 'configurations': list(sensitivity_configs),
    },
    'statistics': {
        'quartiles': 'linear interpolation over n - 1 intervals',
        'standard_deviation': 'sample standard deviation (n - 1)',
        'mean_and_median_uncertainty': {
            'method': 'seed-level percentile bootstrap', 'replicates': BOOTSTRAP_REPLICATES,
            'seed': BOOTSTRAP_SEED, 'interval': '95%',
        },
        'hit_rate_uncertainty': '95% Wilson score interval',
        'scope': 'conditional on documented instances, configurations, budgets, runtime random stream, and seed designs',
    },
    'historical_context': {
        'source': 'benchmark.json · 2015 study tables 4.1–4.2',
        'cells': 'mean (minimum–maximum) relative error over five runs; MILP may be a single value',
        'protocol': 'heuristics n×30 seconds; MILP one hour; different languages/hardware',
        'live_head_to_head': False,
    },
    'timing': 'elapsed seconds excluded from deterministic fingerprint',
    'deterministic_results_sha256': hashlib.sha256(raw_json.encode('utf-8')).hexdigest(),
}
print(json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False))
"""


def build(lang: str) -> dict:
    prose = PROSE[lang]
    cells = [
        markdown("title", prose["title"]),
        markdown("model", prose["model"]),
        markdown("setup", prose["setup"]),
        code("initialize", INITIALIZE, lang, requires_setup=False),
        markdown("landscape", prose["landscape"]),
        code("landscape-results", LANDSCAPE, lang),
        markdown("small", prose["small"]),
        code("small-exact", SMALL_EXACT, lang),
        code("small-results", SMALL_RESULTS, lang),
        markdown("medium", prose["medium"]),
        code("medium-results", MEDIUM_RUNS, lang),
        code("medium-convergence", MEDIUM_CONVERGENCE, lang),
        code("medium-portfolios", PORTFOLIOS, lang),
        markdown("large", prose["large"]),
        code("large-results", LARGE_RESULTS, lang),
        markdown("history", prose["history"]),
        code("historical-summary", HISTORICAL, lang),
        code("historical-pairwise", HISTORICAL_PAIRWISE, lang),
        markdown("sensitivity", prose["sensitivity"]),
        code("sensitivity-results", SENSITIVITY, lang),
        markdown("audit", prose["audit"]),
        code("objective-audit", AUDIT, lang),
        markdown("conclusion", prose["conclusion"]),
        code("executed-conclusions", CONCLUSIONS, lang),
        markdown("future-work", prose["future"]),
        markdown("manifest", prose["manifest"]),
        code("reproducibility-manifest", MANIFEST, lang),
    ]
    return {
        "cells": cells,
        "metadata": {
            "colab": {"name": "iterated-greedy-experiments.ipynb" if lang == "en" else "iterated-greedy-experiments-pt-br.ipynb", "provenance": []},
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


def main() -> None:
    outputs = {
        "en": HERE / "iterated-greedy-experiments.ipynb",
        "pt": HERE / "iterated-greedy-experiments-pt-br.ipynb",
    }
    notebooks = {lang: build(lang) for lang in outputs}
    en_cells, pt_cells = notebooks["en"]["cells"], notebooks["pt"]["cells"]
    if [(cell["id"], cell["cell_type"]) for cell in en_cells] != [
        (cell["id"], cell["cell_type"]) for cell in pt_cells
    ]:
        raise AssertionError("translated notebook cell structure drifted")
    for en_cell, pt_cell in zip(en_cells, pt_cells):
        if en_cell["cell_type"] != "code":
            continue
        en_source = "".join(en_cell["source"]).replace("LANG = 'en'", "LANG = '__LANG__'")
        pt_source = "".join(pt_cell["source"]).replace("LANG = 'pt'", "LANG = '__LANG__'")
        if en_source != pt_source:
            raise AssertionError(f"code drift between translations in {en_cell['id']}")

    code_cells = [cell for cell in en_cells if cell["cell_type"] == "code"]
    if code_cells[0]["id"] != "initialize":
        raise AssertionError("the first code cell must initialize the complete environment")
    initialize_source = "".join(code_cells[0]["source"])
    ready_position = initialize_source.rfind("IG_NOTEBOOK_READY = True")
    if ready_position < initialize_source.rfind("def historical_value"):
        raise AssertionError("the initialization sentinel must be set after setup completes")
    guard_source = dedent(SETUP_GUARD).strip()
    for cell in code_cells[1:]:
        if not "".join(cell["source"]).startswith(guard_source):
            raise AssertionError(f"analysis cell {cell['id']} is missing the setup guard")

    for lang, destination in outputs.items():
        destination.write_text(
            json.dumps(notebooks[lang], ensure_ascii=False, indent=1) + "\n",
            encoding="utf-8",
        )
        print(destination.relative_to(HERE.parent.parent), destination.stat().st_size)


if __name__ == "__main__":
    main()
