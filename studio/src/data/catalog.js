/**
 * Fixed instance and scenario metadata for IG Studio.
 *
 * This module deliberately contains no parser, generated workload, or mutable
 * application state. Scenario lenses preserve the same single-machine model;
 * manufacturing benchmarks and fixed seeded domain workloads remain distinct
 * data sources. The engine is the source of every result shown by the UI.
 */

import { PRINT_DOMAIN_ROWS, print3dScenario } from "./print3d-scenario.js";
import { EXTRA_DOMAIN_ROWS, extraScenariosA } from "./extra-scenarios-a.js";
import { extraScenariosB, EXTRA_TIME_SCALES } from "./extra-scenarios-b.js";
export const SUPPORTED_LOCALES = Object.freeze(["en", "pt-BR"]);

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const MASC_ROWS = [
  ["NCOS_01", 8, 800],
  ["NCOS_01a", 8, 800],
  ["NCOS_02", 10, 2570],
  ["NCOS_02a", 10, 1210],
  ["NCOS_03", 10, 6460],
  ["NCOS_03a", 10, 1690],
  ["NCOS_04", 10, 1011],
  ["NCOS_04a", 10, 1008],
  ["NCOS_05", 15, 1500],
  ["NCOS_05a", 15, 1500],
  ["NCOS_11", 20, 2022],
  ["NCOS_11a", 20, 2006],
  ["NCOS_12", 24, 6844],
  ["NCOS_12a", 24, 4270],
  ["NCOS_13", 24, 3912],
  ["NCOS_13a", 24, 3441],
  ["NCOS_14", 25, 6990],
  ["NCOS_14a", 25, 3195],
  ["NCOS_15", 30, 3052],
  ["NCOS_15a", 30, 3035],
  ["NCOS_31", 75, 9510],
  ["NCOS_31a", 75, 8715],
  ["NCOS_32", 75, 17310],
  ["NCOS_32a", 75, 14720],
  ["NCOS_41", 90, 13484],
  ["NCOS_41a", 90, 10539],
  ["NCOS_51", 200, 36170],
  ["NCOS_51a", 200, 36170],
  ["NCOS_61", 500, 1269365],
  ["NCOS_61a", 500, 1485232],
  ["STC_NCOS_01", 8, 700],
  ["STC_NCOS_01a", 8, 610],
  ["STC_NCOS_15", 30, 17611],
  ["STC_NCOS_15a", 30, 5584],
  ["STC_NCOS_31", 75, 6615],
  ["STC_NCOS_31a", 75, 7590],
  ["STC_NCOS_32", 75, 24068],
  ["STC_NCOS_32a", 75, 16798],
  ["STC_NCOS_41", 90, 43201],
  ["STC_NCOS_41a", 90, 18579],
  ["STC_NCOS_51", 200, 139675],
  ["STC_NCOS_51a", 200, 148230],
  ["STC_NCOS_61", 500, 1495045],
  ["STC_NCOS_61a", 500, 1814605],
];

const GPU_ROWS = [
  ["GPU_CALM_40", 40, "calm"],
  ["GPU_RUSH_60", 60, "rush"],
  ["GPU_HEAVY_120", 120, "heavy"],
];




const DOMAIN_ROWS = [
  ["KITCHEN_SERVICE_60", 60, "kitchen", "planned-and-late-orders"],
  ["KITCHEN_SERVICE_120", 120, "kitchen", "busy-service"],
  ["KITCHEN_SERVICE_240", 240, "kitchen", "high-volume-service"],
  ["SURGERY_BLOCK_40", 40, "surgery", "five-day-block"],
  ["SURGERY_BLOCK_90", 90, "surgery", "ten-day-horizon"],
  ["SURGERY_BLOCK_180", 180, "surgery", "extended-horizon"],
  ...PRINT_DOMAIN_ROWS,
  ...EXTRA_DOMAIN_ROWS,
];

const mascInstances = MASC_ROWS.map(([id, jobCount, referenceBest]) => ({
  id,
  jobCount,
  referenceBest,
  sourcePath: `masclib/${id}.csv`,
  dataset: "masclib",
  sourceKind: "historical-benchmark",
  hasSequenceDependentSetups: id.startsWith("STC_"),
}));

const gpuInstances = GPU_ROWS.map(([id, jobCount, workload]) => ({
  id,
  jobCount,
  referenceBest: null,
  sourcePath: `masclib-gpu/${id}.csv`,
  dataset: "gpu",
  sourceKind: "seeded-domain-workload",
  hasSequenceDependentSetups: true,
  workload,
}));

const domainInstances = DOMAIN_ROWS.map(([id, jobCount, domain, workload]) => ({
  id,
  jobCount,
  referenceBest: null,
  sourcePath: `masclib-domains/${id}.csv`,
  dataset: domain,
  sourceKind: "seeded-domain-workload",
  hasSequenceDependentSetups: true,
  workload,
}));

/** All 44 MaScLib benchmarks and 36 fixed seeded domain workloads across 12 domains. */
export const INSTANCE_CATALOG = deepFreeze([...mascInstances, ...gpuInstances, ...domainInstances]);

export const INSTANCE_BY_ID = deepFreeze(
  Object.fromEntries(INSTANCE_CATALOG.map((instance) => [instance.id, instance])),
);

const factoryMappings = mascInstances.map(({ id }) => ({ instanceId: id }));

const aiMappings = [
  {
    instanceId: "GPU_CALM_40",
    runDefaults: { singleBudget: 150_000, comparisonBudget: 15_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Calm queue", note: "Forty requests at low load; model-affinity batching is easy to see." },
      "pt-BR": { label: "Fila tranquila", note: "Quarenta requests em baixa carga; o agrupamento por modelo fica fácil de ver." },
    },
  },
  {
    instanceId: "GPU_RUSH_60",
    runDefaults: { singleBudget: 150_000, comparisonBudget: 10_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Rush hour", note: "Bursty arrivals make local service compete with paid cloud overflow." },
      "pt-BR": { label: "Hora de pico", note: "Chegadas em rajadas fazem o serviço local competir com o uso pago da nuvem." },
    },
  },
  {
    instanceId: "GPU_HEAVY_120",
    runDefaults: { singleBudget: 25_000, comparisonBudget: 2_500, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Heavy mixed load", note: "A longer horizon with more large-model traffic." },
      "pt-BR": { label: "Carga mista intensa", note: "Um horizonte maior com mais tráfego de modelos grandes." },
    },
  },
];

const kitchenMappings = [
  {
    instanceId: "KITCHEN_SERVICE_60",
    runDefaults: { singleBudget: 100_000, comparisonBudget: 10_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Sixty-dish service snapshot", note: "Planned work and fixed last-minute order waves share six station states." },
      "pt-BR": { label: "Retrato de serviço com 60 pratos", note: "Trabalho planejado e ondas fixas de pedidos de última hora compartilham seis estados da estação." },
    },
  },
  {
    instanceId: "KITCHEN_SERVICE_120",
    runDefaults: { singleBudget: 30_000, comparisonBudget: 3_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Busy 120-dish service", note: "A denser fixed snapshot makes timing, cleanup and recovery decisions compete." },
      "pt-BR": { label: "Serviço intenso com 120 pratos", note: "Um retrato fixo mais denso faz tempo, limpeza e recuperação competirem." },
    },
  },
  {
    instanceId: "KITCHEN_SERVICE_240",
    runDefaults: { singleBudget: 10_000, comparisonBudget: 1_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "High-volume 240-dish horizon", note: "A stress case with more late-order waves and asymmetric station resets." },
      "pt-BR": { label: "Horizonte de alto volume com 240 pratos", note: "Um caso de estresse com mais ondas tardias e resets assimétricos da estação." },
    },
  },
];

const surgeryMappings = [
  {
    instanceId: "SURGERY_BLOCK_40",
    runDefaults: { singleBudget: 400_000, comparisonBudget: 40_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Forty-case five-day block", note: "A fixed planning horizon with seven room layouts and patient-team readiness times." },
      "pt-BR": { label: "Bloco de cinco dias com 40 casos", note: "Um horizonte fixo com sete layouts da sala e instantes de prontidão de paciente e equipe." },
    },
  },
  {
    instanceId: "SURGERY_BLOCK_90",
    runDefaults: { singleBudget: 75_000, comparisonBudget: 7_500, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Ninety-case ten-day horizon", note: "A medium synthetic case with asymmetric specialty reconfiguration and outside capacity." },
      "pt-BR": { label: "Horizonte de dez dias com 90 casos", note: "Um caso sintético médio com reconfiguração assimétrica por especialidade e capacidade externa." },
    },
  },
  {
    instanceId: "SURGERY_BLOCK_180",
    runDefaults: { singleBudget: 20_000, comparisonBudget: 2_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Extended 180-case horizon", note: "A large stress case for room sequencing, modeled targets and transfers." },
      "pt-BR": { label: "Horizonte estendido com 180 casos", note: "Um grande caso de estresse para sequência da sala, metas modeladas e transferências." },
    },
  },
];

const scenarios = [
  {
    id: "factory",
    visual: { assetKey: "factory", objectPosition: "50% 51%" },
    recommendedDefaultInstance: "STC_NCOS_31",
    instanceMappings: factoryMappings,
    datasetRelationship: "native-benchmark-domain",
    content: {
      en: {
        name: "CNC factory",
        visualAlt: "A single dark-blue CNC machining center surrounded by wood, aluminium, brass and steel parts with their distinct tools and fixtures.",
        visualCaption: "One machining center · different part families require different tools and fixtures.",
        shortDescription: "Single-machine part sequencing with changeovers, delivery delay and outsourcing.",
        description: "One CNC receives parts from several product families. Material becomes available at different times, every order has a promised date, and changing family may require another tool, fixture, or program.",
        decisions: [
          "Selection of released parts for local machining.",
          "Processing order of the selected parts.",
          "Comparison between late local production and a qualified supplier.",
        ],
        vocabulary: {
          resource: "CNC machining center",
          job: "part order",
          family: "tool and fixture family",
          processingTime: "machining time",
          releaseTime: "material-ready time",
          dueDate: "promised delivery time",
          hardDeadline: "latest feasible completion",
          setupTime: "tool, fixture, and program change time",
          setupCost: "changeover cost",
          executionCost: "machining cost",
          tardinessWeight: "late-delivery penalty rate",
          rejectionCost: "qualified-supplier cost",
        },
        objective: {
          summary: "Minimize changeover cost, machining cost, late-delivery penalties, and qualified-supplier cost.",
          terms: {
            setup: "tool and fixture changes",
            execution: "machining",
            tardiness: "delivery delay",
            rejection: "supplier outsourcing",
          },
        },
        simplifications: [
          "The model schedules one capacity-one machine.",
          "Each order uses one fixed processing mode and one setup family.",
          "Quality, maintenance, operators, and material quantities are outside this model.",
        ],
        disclosure: "These are published MaScLib manufacturing benchmark instances, not live production data. The lens preserves their original single-machine variables and values.",
      },
      "pt-BR": {
        name: "Fábrica CNC",
        visualAlt: "Um único centro de usinagem CNC azul-escuro cercado por peças de madeira, alumínio, latão e aço com ferramentas e fixações distintas.",
        visualCaption: "Um centro de usinagem · famílias diferentes exigem ferramentas e fixações diferentes.",
        shortDescription: "Sequenciamento de peças em máquina única com trocas, atraso de entrega e terceirização.",
        description: "Uma CNC recebe peças de várias famílias. O material fica disponível em instantes diferentes, cada pedido tem uma entrega prometida e mudar de família pode exigir outra ferramenta, fixação ou programa.",
        decisions: [
          "Seleção das peças liberadas para usinagem local.",
          "Ordem de produção das peças selecionadas.",
          "Comparação entre produção local atrasada e fornecedor qualificado.",
        ],
        vocabulary: {
          resource: "centro de usinagem CNC",
          job: "pedido de peça",
          family: "família de ferramenta e fixação",
          processingTime: "tempo de usinagem",
          releaseTime: "liberação do material",
          dueDate: "entrega prometida",
          hardDeadline: "conclusão máxima viável",
          setupTime: "tempo de troca de ferramenta, fixação e programa",
          setupCost: "custo de troca",
          executionCost: "custo de usinagem",
          tardinessWeight: "multa por unidade de atraso",
          rejectionCost: "custo do fornecedor qualificado",
        },
        objective: {
          summary: "Minimizar custos de troca e usinagem, multas de atraso e custo do fornecedor qualificado.",
          terms: {
            setup: "trocas de ferramenta e fixação",
            execution: "usinagem",
            tardiness: "atraso de entrega",
            rejection: "terceirização",
          },
        },
        simplifications: [
          "O modelo programa uma máquina de capacidade unitária.",
          "Cada pedido usa um modo de processamento e uma família de setup fixos.",
          "Qualidade, manutenção, operadores e quantidades de material ficam fora do modelo.",
        ],
        disclosure: "Estas são instâncias públicas do benchmark industrial MaScLib, não dados de produção em tempo real. A lente preserva variáveis e valores originais do modelo de máquina única.",
      },
    },
  },
  {
    id: "ai",
    visual: { assetKey: "ai", objectPosition: "50% 50%" },
    recommendedDefaultInstance: "GPU_RUSH_60",
    instanceMappings: aiMappings,
    datasetRelationship: "native-seeded-domain-workload",
    content: {
      en: {
        name: "AI server",
        visualAlt: "One local multi-GPU server with four distinct model-family cartridges and a separate external cloud gateway.",
        visualCaption: "One local GPU resource · changing model families can require another load and cache state.",
        shortDescription: "Single-GPU request sequencing with model swaps, SLO delay and cloud overflow.",
        description: "Requests for several models share one GPU. A different model may need to be loaded before service, and a request that no longer fits locally can be routed to a paid cloud endpoint.",
        decisions: [
          "Selection of requests for the local GPU.",
          "Request order and resulting model swaps.",
          "Comparison between delayed local execution and paid cloud overflow.",
        ],
        vocabulary: {
          resource: "local GPU",
          job: "inference request or micro-batch",
          family: "model and cache family",
          processingTime: "inference time",
          releaseTime: "request arrival",
          dueDate: "SLO target",
          hardDeadline: "latest feasible local completion",
          setupTime: "model load or swap time",
          setupCost: "GPU capacity spent swapping",
          executionCost: "local inference cost",
          tardinessWeight: "SLO penalty rate",
          rejectionCost: "paid cloud endpoint cost",
        },
        objective: {
          summary: "Minimize model-swap cost, local execution cost, SLO penalties, and paid cloud overflow.",
          terms: {
            setup: "model swaps",
            execution: "local inference",
            tardiness: "SLO delay",
            rejection: "cloud overflow",
          },
        },
        simplifications: [
          "One GPU serves one scheduled request or micro-batch at a time.",
          "Each request has one model family and a fixed local processing time.",
          "Continuous batching, memory fragmentation, token-level preemption, and quality routing are outside this model.",
        ],
        disclosure: "The three bundled GPU instances are reproducible seeded workloads created for this scheduling interpretation; they are not traces from a production service.",
      },
      "pt-BR": {
        name: "Servidor de IA",
        visualAlt: "Um servidor local com múltiplas GPUs, quatro cartuchos de famílias de modelo e um gateway externo separado para a nuvem.",
        visualCaption: "Um recurso local de GPU · mudar a família do modelo pode exigir outra carga e estado de cache.",
        shortDescription: "Sequenciamento de requests em uma GPU com trocas de modelo, atraso de SLO e uso da nuvem.",
        description: "Requests para vários modelos compartilham uma GPU. Um modelo diferente pode precisar ser carregado antes do atendimento, e um request que já não cabe localmente pode seguir para um endpoint pago na nuvem.",
        decisions: [
          "Seleção dos requests para a GPU local.",
          "Ordem dos requests e trocas de modelo resultantes.",
          "Comparação entre execução local atrasada e uso pago da nuvem.",
        ],
        vocabulary: {
          resource: "GPU local",
          job: "request de inferência ou microbatch",
          family: "família de modelo e cache",
          processingTime: "tempo de inferência",
          releaseTime: "chegada do request",
          dueDate: "meta de SLO",
          hardDeadline: "conclusão local máxima viável",
          setupTime: "tempo de carga ou troca de modelo",
          setupCost: "capacidade de GPU consumida na troca",
          executionCost: "custo de inferência local",
          tardinessWeight: "penalidade de SLO por unidade de atraso",
          rejectionCost: "custo do endpoint pago na nuvem",
        },
        objective: {
          summary: "Minimizar custos de troca de modelo e execução local, penalidades de SLO e uso pago da nuvem.",
          terms: {
            setup: "trocas de modelo",
            execution: "inferência local",
            tardiness: "atraso de SLO",
            rejection: "excesso na nuvem",
          },
        },
        simplifications: [
          "Uma GPU atende um request programado ou microbatch por vez.",
          "Cada request possui uma família de modelo e um tempo local fixo.",
          "Batching contínuo, fragmentação de memória, preempção por token e roteamento por qualidade ficam fora do modelo.",
        ],
        disclosure: "As três instâncias de GPU incluídas são cargas reproduzíveis geradas com seeds para esta interpretação de scheduling; não são traces de um serviço em produção.",
      },
    },
  },
  {
    id: "kitchen",
    visual: { assetKey: "kitchen", objectPosition: "50% 52%" },
    recommendedDefaultInstance: "KITCHEN_SERVICE_120",
    instanceMappings: kitchenMappings,
    datasetRelationship: "native-seeded-domain-workload",
    content: {
      en: {
        name: "Restaurant kitchen",
        visualAlt: "One adaptable professional cooking station with distinct equipment for fish, steak, soup, salad and dessert, plus blank planned and last-minute order tickets.",
        visualCaption: "One modeled cooking station · dishes require different tools, temperatures and reset work.",
        shortDescription: "Replanning of a fixed service snapshot with station changes, delay and recovery.",
        description: "At one replanning moment, reservations, pre-orders, and the last-minute orders known so far form a fixed snapshot. Dishes become available at different times and compete for one modeled cooking resource, so the remaining sequence must be repaired without discarding the whole plan.",
        decisions: [
          "Selection of dishes for the modeled cooking sequence.",
          "Reordering after known last-minute orders enter the planning snapshot.",
          "Comparison between late service and a modeled recovery action.",
        ],
        vocabulary: {
          resource: "modeled cooking station",
          job: "dish order",
          family: "station setup or preparation family",
          processingTime: "preparation and cooking time",
          releaseTime: "time the order becomes available",
          dueDate: "acceptable service time",
          hardDeadline: "latest feasible service time",
          setupTime: "station reset and re-preparation time",
          setupCost: "station change cost",
          executionCost: "dish preparation cost",
          tardinessWeight: "late-service consequence per time unit",
          rejectionCost: "substitution, discount, or cancellation recovery cost",
        },
        objective: {
          summary: "Minimize station-change and preparation costs, late-service consequences, and service-recovery cost.",
          terms: {
            setup: "station changes",
            execution: "dish preparation",
            tardiness: "late service",
            rejection: "service recovery",
          },
        },
        simplifications: [
          "The lens collapses a kitchen to one capacity-one resource.",
          "Recipes, parallel stations, cooks, ingredients, course synchronization, and live arrivals after this fixed snapshot are not modeled.",
          "Recovery cost is one numeric outside option; the engine does not choose a specific customer-service action.",
        ],
        disclosure: "The three fixed workloads are reproducible synthetic restaurant-planning snapshots generated with committed seeds. They are not operational restaurant data; every displayed result is still computed by the same single-machine engine.",
      },
      "pt-BR": {
        name: "Cozinha de restaurante",
        visualAlt: "Uma estação profissional de cocção com equipamentos distintos para peixe, carne, sopa, salada e sobremesa, além de tickets em branco planejados e de última hora.",
        visualCaption: "Uma estação de cocção modelada · pratos exigem ferramentas, temperaturas e resets diferentes.",
        shortDescription: "Replanejamento de um retrato fixo do serviço com trocas de estação, atraso e recuperação.",
        description: "Em um instante de replanejamento, reservas, pré-pedidos e os pedidos de última hora conhecidos até ali formam um retrato fixo. Pratos ficam disponíveis em momentos diferentes e disputam um recurso de cocção modelado; a sequência restante precisa ser reparada sem descartar o plano inteiro.",
        decisions: [
          "Seleção dos pratos para a sequência de cocção modelada.",
          "Reordenação após a entrada dos pedidos de última hora conhecidos no retrato do planejamento.",
          "Comparação entre serviço atrasado e uma ação de recuperação modelada.",
        ],
        vocabulary: {
          resource: "estação de cocção modelada",
          job: "pedido de prato",
          family: "família de estação ou preparo",
          processingTime: "tempo de preparo e cocção",
          releaseTime: "instante em que o pedido fica disponível",
          dueDate: "tempo aceitável de serviço",
          hardDeadline: "horário máximo viável de serviço",
          setupTime: "tempo de reset e novo preparo da estação",
          setupCost: "custo de troca da estação",
          executionCost: "custo de preparo do prato",
          tardinessWeight: "consequência por unidade de atraso",
          rejectionCost: "custo de substituição, desconto ou cancelamento",
        },
        objective: {
          summary: "Minimizar custos de troca e preparo, consequências de atraso e custo de recuperação do serviço.",
          terms: {
            setup: "trocas de estação",
            execution: "preparo do prato",
            tardiness: "serviço atrasado",
            rejection: "recuperação do serviço",
          },
        },
        simplifications: [
          "A lente reduz a cozinha a um recurso de capacidade unitária.",
          "Receitas, estações paralelas, cozinheiros, ingredientes, sincronização de cursos e chegadas ao vivo após este retrato fixo não são modelados.",
          "O custo de recuperação é uma alternativa externa numérica; o engine não escolhe uma ação específica com o cliente.",
        ],
        disclosure: "As três cargas fixas são retratos sintéticos e reproduzíveis de planejamento de restaurante, gerados com seeds versionadas. Não são dados operacionais; cada resultado exibido continua sendo calculado pelo mesmo engine de máquina única.",
      },
    },
  },
  {
    id: "surgery",
    visual: { assetKey: "surgery", objectPosition: "50% 50%" },
    recommendedDefaultInstance: "SURGERY_BLOCK_90",
    instanceMappings: surgeryMappings,
    datasetRelationship: "native-seeded-domain-workload",
    content: {
      en: {
        name: "Surgery center",
        visualAlt: "One modeled operating room with four specialty setup carts for neurological, thoracic, cardiac and orthopedic procedures.",
        visualCaption: "One modeled room · each specialty needs a different instrument and room setup.",
        shortDescription: "Single-room case sequencing with room setup, modeled delay and transfer.",
        description: "Cases share one modeled operating room. Patients and teams become ready at different times, specialty changes reconfigure the room, and a case that cannot fit may require an outside transfer.",
        decisions: [
          "Selection of ready cases for the modeled room.",
          "Procedure order for the selected cases.",
          "Comparison between modeled delay and outside transfer.",
        ],
        vocabulary: {
          resource: "modeled operating room",
          job: "surgery case",
          family: "specialty and room-layout family",
          processingTime: "procedure time",
          releaseTime: "patient-and-team ready time",
          dueDate: "modeled clinical target",
          hardDeadline: "latest feasible completion",
          setupTime: "room and instrument reconfiguration time",
          setupCost: "specialty-change cost",
          executionCost: "procedure execution cost",
          tardinessWeight: "modeled consequence beyond the target",
          rejectionCost: "outside transfer cost",
        },
        objective: {
          summary: "Minimize specialty-change and procedure costs, modeled delay consequences, and outside-transfer cost.",
          terms: {
            setup: "room reconfiguration",
            execution: "procedure",
            tardiness: "delay beyond target",
            rejection: "outside transfer",
          },
        },
        simplifications: [
          "The lens represents one capacity-one operating room, not an entire hospital.",
          "Clinical precedence, emergencies, staffing, beds, equipment conflicts, and medical risk are not modeled.",
          "A transfer is a numeric outside option, never a clinical recommendation.",
        ],
        disclosure: "The three fixed workloads are reproducible synthetic operating-room planning horizons generated with committed seeds. They are not hospital or patient data and must not guide care; every displayed result is computed by the same single-machine engine.",
      },
      "pt-BR": {
        name: "Centro cirúrgico",
        visualAlt: "Uma sala cirúrgica modelada com quatro carrinhos de preparo para procedimentos neurológicos, torácicos, cardíacos e ortopédicos.",
        visualCaption: "Uma sala modelada · cada especialidade exige outro instrumental e preparo da sala.",
        shortDescription: "Sequenciamento de casos em uma sala com preparo, atraso modelado e transferência.",
        description: "Casos compartilham uma sala cirúrgica modelada. Pacientes e equipes ficam prontos em instantes diferentes, trocas de especialidade reconfiguram a sala e um caso que não cabe pode exigir transferência externa.",
        decisions: [
          "Seleção dos casos prontos para a sala modelada.",
          "Ordem dos procedimentos selecionados.",
          "Comparação entre atraso modelado e transferência externa.",
        ],
        vocabulary: {
          resource: "sala cirúrgica modelada",
          job: "caso cirúrgico",
          family: "família de especialidade e layout da sala",
          processingTime: "tempo do procedimento",
          releaseTime: "instante em que paciente e equipe estão prontos",
          dueDate: "meta clínica modelada",
          hardDeadline: "conclusão máxima viável",
          setupTime: "tempo de reconfiguração da sala e instrumental",
          setupCost: "custo de troca de especialidade",
          executionCost: "custo de execução do procedimento",
          tardinessWeight: "consequência modelada além da meta",
          rejectionCost: "custo de transferência externa",
        },
        objective: {
          summary: "Minimizar custos de troca de especialidade e procedimento, consequências modeladas de atraso e custo de transferência.",
          terms: {
            setup: "reconfiguração da sala",
            execution: "procedimento",
            tardiness: "atraso além da meta",
            rejection: "transferência externa",
          },
        },
        simplifications: [
          "A lente representa uma sala de capacidade unitária, não um hospital inteiro.",
          "Precedência clínica, emergências, equipes, leitos, conflitos de equipamentos e risco médico não são modelados.",
          "A transferência é uma alternativa externa numérica, nunca uma recomendação clínica.",
        ],
        disclosure: "As três cargas fixas são horizontes sintéticos e reproduzíveis de planejamento de sala, gerados com seeds versionadas. Não são dados hospitalares nem de pacientes e não devem orientar cuidados; cada resultado exibido é calculado pelo mesmo engine de máquina única.",
      },
    },
  },
  print3dScenario,
  ...extraScenariosA,
  ...extraScenariosB,
];

export const SCENARIO_CATALOG = deepFreeze(scenarios);

export const SCENARIO_BY_ID = deepFreeze(
  Object.fromEntries(SCENARIO_CATALOG.map((scenario) => [scenario.id, scenario])),
);

/** Per-scenario time scale for humanized horizons (unit, minutes per day, pt-BR day label). */
export const SCENARIO_TIME_SCALES = deepFreeze({ ...EXTRA_TIME_SCALES });

/** Accept the page's legacy `pt` value while keeping `pt-BR` canonical. */
export function normalizeLocale(locale) {
  return locale === "pt" || locale === "pt-BR" ? "pt-BR" : "en";
}

export function getInstance(instanceId) {
  return INSTANCE_BY_ID[instanceId] ?? null;
}

export function getScenario(scenarioId) {
  return SCENARIO_BY_ID[scenarioId] ?? null;
}

/** Return one localized, immutable scenario view for direct UI consumption. */
export function getLocalizedScenario(scenarioId, locale = "en") {
  const scenario = getScenario(scenarioId);
  if (!scenario) return null;
  const resolvedLocale = normalizeLocale(locale);
  return deepFreeze({
    id: scenario.id,
    visual: scenario.visual,
    locale: resolvedLocale,
    recommendedDefaultInstance: scenario.recommendedDefaultInstance,
    datasetRelationship: scenario.datasetRelationship,
    ...scenario.content[resolvedLocale],
  });
}

/**
 * Resolve a scenario's fixed mappings without changing the underlying
 * instance metadata.  Illustrative labels are localized when present.
 */
export function listScenarioInstances(scenarioId, locale = "en") {
  const scenario = getScenario(scenarioId);
  if (!scenario) return [];
  const resolvedLocale = normalizeLocale(locale);
  return scenario.instanceMappings.map((mapping) => ({
    ...INSTANCE_BY_ID[mapping.instanceId],
    interpretation: mapping.content?.[resolvedLocale] ?? null,
    runDefaults: mapping.runDefaults ?? null,
    recommended: mapping.instanceId === scenario.recommendedDefaultInstance,
  }));
}
