/**
 * Fixed instance and scenario metadata for IG Studio.
 *
 * This module deliberately contains no parser, generated workload, or mutable
 * application state. Scenario lenses preserve the same single-machine model;
 * manufacturing benchmarks and fixed seeded domain workloads remain distinct
 * data sources. The engine is the source of every result shown by the UI.
 */

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


/* ---- 3D print farm scenario (seeds committed, see masclib-domains) ---- */
const PRINT_DOMAIN_ROWS = [
  ["3DPRINT_FARM_45", 45, "print3d", "four-day-order-book"],
  ["3DPRINT_FARM_90", 90, "print3d", "eight-day-order-book"],
  ["3DPRINT_FARM_180", 180, "print3d", "sixteen-day-order-book"],
];

const print3dMappings = [
  {
    instanceId: "3DPRINT_FARM_45",
    runDefaults: { singleBudget: 150_000, comparisonBudget: 15_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Four-day order book", note: "Forty-five orders across six filament profiles; nozzle swaps for abrasive jobs are the visible trade-off." },
      "pt-BR": { label: "Carteira de quatro dias", note: "Quarenta e cinco pedidos em seis perfis de filamento; a troca de nozzle para peças abrasivas é o trade-off visível." },
    },
  },
  {
    instanceId: "3DPRINT_FARM_90",
    runDefaults: { singleBudget: 80_000, comparisonBudget: 8_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Eight-day order book", note: "A denser queue where batching by filament competes with promised ship dates." },
      "pt-BR": { label: "Carteira de oito dias", note: "Uma fila mais densa em que o agrupamento por filamento compete com as datas de envio prometidas." },
    },
  },
  {
    instanceId: "3DPRINT_FARM_180",
    runDefaults: { singleBudget: 45_000, comparisonBudget: 4_500, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Sixteen-day reference horizon", note: "The 30-second reference case: outsourcing and purge-heavy sequences fight for every hour of the printer." },
      "pt-BR": { label: "Horizonte de referência de dezesseis dias", note: "O caso de referência de 30 segundos: outsourcing e sequências com muita purga disputam cada hora da impressora." },
    },
  },
];

const print3dScenario = {
  id: "print3d",
  visual: { assetKey: "print3d", objectPosition: "50% 50%" },
  recommendedDefaultInstance: "3DPRINT_FARM_90",
  instanceMappings: print3dMappings,
  datasetRelationship: "native-seeded-domain-workload",
  content: {
    en: {
      name: "3D print farm",
      visualAlt: "A single FDM printer surrounded by spools of PLA, PETG, TPU, ASA, carbon-fiber nylon and silk PLA, with finished parts on a shelf.",
      visualCaption: "One printer · every filament profile means a different swap, purge, or even nozzle change.",
      shortDescription: "Single-printer order sequencing with filament swaps, late shipment and outsourcing.",
      description: "One FDM printer runs a small farm's order book. Orders are approved at different times, every part has a promised ship date, and changing filament profile costs a swap and a purge — abrasive carbon-fiber jobs also demand a hardened-nozzle change. Orders that no longer fit can be sent to a partner farm at a price.",
      decisions: [
        "Selection of approved orders for the printer.",
        "Print order and the resulting filament and nozzle swaps.",
        "Comparison between a late local print and a partner-farm price.",
      ],
      vocabulary: {
        resource: "FDM printer",
        job: "print order",
        family: "filament and profile family",
        processingTime: "print time",
        releaseTime: "order-approval time",
        dueDate: "promised ship time",
        hardDeadline: "horizon cutoff",
        setupTime: "filament swap and purge time",
        setupCost: "swap cost (purged filament + downtime)",
        executionCost: "print cost (filament + energy + wear)",
        tardinessWeight: "late-shipment penalty per minute",
        rejectionCost: "partner-farm outsourcing price",
      },
      objective: {
        summary: "Minimize swap and purge costs, print costs, late-shipment penalties, and outsourced orders.",
        terms: {
          setup: "filament swaps",
          execution: "printing",
          tardiness: "late shipment",
          rejection: "outsourcing",
        },
      },
      simplifications: [
        "The model schedules one printer with capacity one.",
        "Each order prints in one fixed profile; multi-part plating and print failures are outside this model.",
        "Slicing time, post-processing, and shipping logistics are not modeled.",
      ],
      disclosure: "The three bundled print-farm instances are reproducible seeded workloads created for this scheduling interpretation; they are not orders from a real business.",
    },
    "pt-BR": {
      name: "Fazenda de impressão 3D",
      visualAlt: "Uma impressora FDM cercada por rolos de PLA, PETG, TPU, ASA, náilon com fibra de carbono e PLA silk, com peças prontas em uma prateleira.",
      visualCaption: "Uma impressora · cada perfil de filamento exige outra troca, purga ou até troca de nozzle.",
      shortDescription: "Sequenciamento de pedidos em uma impressora com trocas de filamento, atraso de envio e outsourcing.",
      description: "Uma impressora FDM toca a carteira de pedidos de uma pequena fazenda de impressão. Pedidos são aprovados em instantes diferentes, cada peça tem um envio prometido, e mudar o perfil de filamento custa troca e purga — jobs abrasivos de fibra de carbono ainda exigem troca para nozzle endurecido. Pedidos que não cabem mais podem ir para uma farm parceira por um preço.",
      decisions: [
        "Seleção dos pedidos aprovados para a impressora.",
        "Ordem de impressão e as trocas de filamento e nozzle resultantes.",
        "Comparação entre impressão local atrasada e o preço da farm parceira.",
      ],
      vocabulary: {
        resource: "impressora FDM",
        job: "pedido de peça",
        family: "família de filamento e perfil",
        processingTime: "tempo de impressão",
        releaseTime: "aprovação do pedido",
        dueDate: "envio prometido",
        hardDeadline: "corte do horizonte",
        setupTime: "tempo de troca e purga de filamento",
        setupCost: "custo de troca (purga + parada)",
        executionCost: "custo de impressão (filamento + energia + desgaste)",
        tardinessWeight: "multa de envio atrasado por minuto",
        rejectionCost: "preço de outsourcing na farm parceira",
      },
      objective: {
        summary: "Minimizar custos de troca e purga, custos de impressão, multas de atraso e pedidos terceirizados.",
        terms: {
          setup: "trocas de filamento",
          execution: "impressão",
          tardiness: "envio atrasado",
          rejection: "outsourcing",
        },
      },
      simplifications: [
        "O modelo programa uma impressora de capacidade unitária.",
        "Cada pedido imprime em um perfil fixo; arranjo de várias peças na mesa e falhas de impressão ficam fora do modelo.",
        "Fatiamento, pós-processamento e logística de envio não são modelados.",
      ],
      disclosure: "As três instâncias de fazenda de impressão são cargas reproduzíveis geradas com seeds para esta interpretação de scheduling; não são pedidos de um negócio real.",
    },
  },
};

/* ---- Eight additional seeded domain scenarios ---- */
const EXTRA_DOMAIN_ROWS = [
  ["COFFEE_S_45", 45, "coffee", "two-day-roast-plan"],
  ["COFFEE_M_90", 90, "coffee", "three-day-roast-plan"],
  ["COFFEE_L_180", 180, "coffee", "five-day-roast-plan"],
  ["BAKERY_S_45", 45, "bakery", "two-day-bake-plan"],
  ["BAKERY_M_90", 90, "bakery", "three-day-bake-plan"],
  ["BAKERY_L_180", 180, "bakery", "six-day-bake-plan"],
  ["DENTAL_S_45", 45, "dental", "two-day-case-load"],
  ["DENTAL_M_90", 90, "dental", "four-day-case-load"],
  ["DENTAL_L_180", 180, "dental", "eight-day-case-load"],
  ["LASER_S_45", 45, "laser", "two-day-cutting-queue"],
  ["LASER_M_90", 90, "laser", "three-day-cutting-queue"],
  ["LASER_L_180", 180, "laser", "five-day-cutting-queue"],
  ["LAUNDRY_S_45", 45, "laundry", "two-day-route-plan"],
  ["LAUNDRY_M_90", 90, "laundry", "four-day-route-plan"],
  ["LAUNDRY_L_180", 180, "laundry", "eight-day-route-plan"],
  ["STUDIO_S_45", 45, "studio", "four-day-booking-calendar"],
  ["STUDIO_M_90", 90, "studio", "seven-day-booking-calendar"],
  ["STUDIO_L_180", 180, "studio", "thirteen-day-booking-calendar"],
  ["LAB_S_45", 45, "lab", "two-day-sample-load"],
  ["LAB_M_90", 90, "lab", "three-day-sample-load"],
  ["LAB_L_180", 180, "lab", "six-day-sample-load"],
  ["BREWERY_S_45", 45, "brewery", "eleven-day-brew-schedule"],
  ["BREWERY_M_90", 90, "brewery", "twenty-three-day-brew-schedule"],
  ["BREWERY_L_180", 180, "brewery", "forty-five-day-brew-schedule"],
];

const coffeeMappings = [
  {
    instanceId: "COFFEE_S_45",
    runDefaults: { singleBudget: 350_000, comparisonBudget: 35_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Two-day roast plan", note: "Quick ~3s run: forty-five batches across six roast profiles; the deep clean around decaf is the visible trade-off." },
      "pt-BR": { label: "Plano de torra de dois dias", note: "Rodada rápida de ~3 s: quarenta e cinco lotes em seis perfis de torra; a limpeza profunda em torno do descafeinado é o trade-off visível." },
    },
  },
  {
    instanceId: "COFFEE_M_90",
    runDefaults: { singleBudget: 880_000, comparisonBudget: 88_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Three-day roast plan", note: "Full ~15s run: subscription ship dates compete with batching by profile." },
      "pt-BR": { label: "Plano de torra de três dias", note: "Rodada completa de ~15 s: as datas de envio da assinatura competem com o agrupamento por perfil." },
    },
  },
  {
    instanceId: "COFFEE_L_180",
    runDefaults: { singleBudget: 680_000, comparisonBudget: 68_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Five-day roast plan", note: "Reference ~30s run: wholesale weeks, subscriptions and standing cafe orders fight for every hour of the drum." },
      "pt-BR": { label: "Plano de torra de cinco dias", note: "Rodada de referência de ~30 s: atacado semanal, assinaturas e pedidos fixos de cafeteria disputam cada hora do tambor." },
    },
  },
];

const coffeeScenario = {
  id: "coffee",
  visual: { assetKey: "coffee", objectPosition: "50% 50%" },
  recommendedDefaultInstance: "COFFEE_M_90",
  instanceMappings: coffeeMappings,
  datasetRelationship: "native-seeded-domain-workload",
  content: {
    en: {
      name: "Coffee roastery",
      visualAlt: "A single drum roaster with green-coffee sacks for six profiles — filter light, espresso medium, dark blend, decaf, micro-lot and natural experimental — and roasted batches cooling on a tray.",
      visualCaption: "One drum · every profile means a temperature adjustment, and decaf demands a deep clean.",
      shortDescription: "Single-roaster batch sequencing with profile changeovers, late shipment and co-roasting.",
      description: "One drum roaster runs a small roastery's order book. Batches are confirmed at different times, every lot has a promised ship window, and changing profile or origin costs a temperature adjustment and a clean-out — decaf also demands a deep clean because of flavor carryover. Batches that no longer fit can go to a co-roaster at a price.",
      decisions: [
        "Selection of confirmed batches for the drum.",
        "Roast order and the resulting profile changes and clean-outs.",
        "Comparison between a late local roast and the co-roaster price.",
      ],
      vocabulary: {
        resource: "drum roaster",
        job: "roast batch",
        family: "roast profile and origin family",
        processingTime: "roast time",
        releaseTime: "order confirmation and green-bean staging time",
        dueDate: "promised ship window",
        hardDeadline: "horizon cutoff",
        setupTime: "temperature adjustment and clean-out time",
        setupCost: "changeover cost (downtime + energy)",
        executionCost: "roast cost (energy + drum time)",
        tardinessWeight: "late-shipment penalty per minute",
        rejectionCost: "co-roaster price",
      },
      objective: {
        summary: "Minimize changeover and roast costs, late-shipment penalties, and co-roasted batches.",
        terms: {
          setup: "profile changeovers",
          execution: "roasting",
          tardiness: "late shipment",
          rejection: "co-roaster outsourcing",
        },
      },
      simplifications: [
        "The model schedules one drum roaster with capacity one; cooling trays, grinders, and packaging are outside this model.",
        "Each batch roasts in one fixed profile; profile development, cupping, and green-bean inventory are not modeled.",
        "The co-roaster is one numeric outside option; no specific partner contract is chosen.",
      ],
      disclosure: "The three bundled roastery instances are reproducible seeded workloads created for this scheduling interpretation; they are not orders from a real roastery.",
    },
    "pt-BR": {
      name: "Torrefação de café",
      visualAlt: "Um único tambor de torra com sacos de café verde para seis perfis — claro para filtrado, médio para espresso, blend escuro, descafeinado, micro-lote e natural experimental — e lotes torrados resfriando em uma bandeja.",
      visualCaption: "Um tambor · cada perfil exige ajuste de temperatura, e o descafeinado pede limpeza profunda.",
      shortDescription: "Sequenciamento de lotes em um torrador com trocas de perfil, atraso de envio e co-roasting.",
      description: "Um tambor de torra toca a carteira de pedidos de uma pequena torrefação. Lotes são confirmados em instantes diferentes, cada lote tem uma janela de envio prometida, e mudar de perfil ou origem custa ajuste de temperatura e limpeza — o descafeinado ainda exige limpeza profunda por carryover de sabor. Lotes que não cabem mais podem ir para um co-roaster por um preço.",
      decisions: [
        "Seleção dos lotes confirmados para o tambor.",
        "Ordem de torra e as trocas de perfil e limpezas resultantes.",
        "Comparação entre torra local atrasada e o preço do co-roaster.",
      ],
      vocabulary: {
        resource: "tambor de torra",
        job: "lote de torra",
        family: "família de perfil de torra e origem",
        processingTime: "tempo de torra",
        releaseTime: "confirmação do pedido e preparo do café verde",
        dueDate: "janela de envio prometida",
        hardDeadline: "corte do horizonte",
        setupTime: "tempo de ajuste de temperatura e limpeza",
        setupCost: "custo de troca (parada + energia)",
        executionCost: "custo de torra (energia + tempo de tambor)",
        tardinessWeight: "multa de envio atrasado por minuto",
        rejectionCost: "preço do co-roaster",
      },
      objective: {
        summary: "Minimizar custos de troca e torra, multas de atraso e lotes enviados ao co-roaster.",
        terms: {
          setup: "trocas de perfil",
          execution: "torra",
          tardiness: "envio atrasado",
          rejection: "co-roaster",
        },
      },
      simplifications: [
        "O modelo programa um tambor de torra de capacidade unitária; bandejas de resfriamento, moagem e empacotamento ficam fora do modelo.",
        "Cada lote torra em um perfil fixo; desenvolvimento de perfil, cupping e estoque de café verde não são modelados.",
        "O co-roaster é uma alternativa externa numérica; nenhum contrato específico é escolhido.",
      ],
      disclosure: "As três instâncias de torrefação incluídas são cargas reproduzíveis geradas com seeds para esta interpretação de scheduling; não são pedidos de uma torrefação real.",
    },
  },
};

const bakeryMappings = [
  {
    instanceId: "BAKERY_S_45",
    runDefaults: { singleBudget: 550_000, comparisonBudget: 55_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Two-day bake plan", note: "Quick ~3s run: forty-five loads across six lines; the cool-down from cake temperature to high-heat bakes is the visible trade-off." },
      "pt-BR": { label: "Plano de forno de dois dias", note: "Rodada rápida de ~3 s: quarenta e cinco fornadas em seis linhas; o resfriamento do forno entre bolos e assados de alta temperatura é o trade-off visível." },
    },
  },
  {
    instanceId: "BAKERY_M_90",
    runDefaults: { singleBudget: 190_000, comparisonBudget: 19_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Three-day bake plan", note: "Full ~15s run: counter-opening deadlines compete with batching by temperature." },
      "pt-BR": { label: "Plano de forno de três dias", note: "Rodada completa de ~15 s: os horários de abertura do balcão competem com o agrupamento por temperatura." },
    },
  },
  {
    instanceId: "BAKERY_L_180",
    runDefaults: { singleBudget: 52_000, comparisonBudget: 5_200, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Six-day bake plan", note: "Reference ~30s run: morning peaks and wholesale routes fight for every degree-hour of the deck." },
      "pt-BR": { label: "Plano de forno de seis dias", note: "Rodada de referência de ~30 s: picos da manhã e rotas de atacado disputam cada hora do forno." },
    },
  },
];

const bakeryScenario = {
  id: "bakery",
  visual: { assetKey: "bakery", objectPosition: "50% 50%" },
  recommendedDefaultInstance: "BAKERY_M_90",
  instanceMappings: bakeryMappings,
  datasetRelationship: "native-seeded-domain-workload",
  content: {
    en: {
      name: "Bakery deck oven",
      visualAlt: "A single industrial deck oven with trays of baguettes, sourdough loaves, brioche, cakes, pizzas and cookies waiting to bake, and the shop counter about to open.",
      visualCaption: "One deck oven · each line wants its own temperature and steam, and cooling down takes longer than heating up.",
      shortDescription: "Single-oven bake sequencing with temperature changes, morning peak and supplier backup.",
      description: "One industrial deck oven bakes the shop's product lines. Doughs are ready at different times, every line has a promised counter or route time, and changing temperature costs a wait — cooling the deck down takes longer than heating it up, and steam is readjusted per line. Loads that no longer fit can be bought from a supplier so the shelf never goes empty.",
      decisions: [
        "Selection of ready loads for the oven.",
        "Bake order and the resulting temperature transitions.",
        "Comparison between a late bake and a supplier purchase.",
      ],
      vocabulary: {
        resource: "deck oven",
        job: "bake load",
        family: "product line (temperature and steam program)",
        processingTime: "bake time",
        releaseTime: "dough-ready time",
        dueDate: "promised counter or route time",
        hardDeadline: "latest feasible bake",
        setupTime: "temperature and steam change time (cooling is slower than heating)",
        setupCost: "changeover cost (idle oven + energy)",
        executionCost: "bake cost (energy + oven time)",
        tardinessWeight: "empty-shelf penalty per minute",
        rejectionCost: "supplier purchase price",
      },
      objective: {
        summary: "Minimize temperature-change and bake costs, empty-shelf penalties, and supplier purchases.",
        terms: {
          setup: "temperature changes",
          execution: "baking",
          tardiness: "late shelf stocking",
          rejection: "supplier purchase",
        },
      },
      simplifications: [
        "The model schedules one deck oven with capacity one; proofers, mixers, and the sales counter are outside this model.",
        "Each load bakes in one fixed temperature-and-steam program; recipes and dough inventory are not modeled.",
        "The supplier is one numeric outside option that keeps the shelf stocked; no specific purchase contract is chosen.",
      ],
      disclosure: "The three bundled bakery instances are reproducible seeded workloads created for this scheduling interpretation; they are not orders from a real bakery.",
    },
    "pt-BR": {
      name: "Forno de padaria",
      visualAlt: "Um único forno deck industrial com assadeiras de baguetes, pães de fermentação natural, brioches, bolos, pizzas e biscoitos esperando a fornada, e o balcão prestes a abrir.",
      visualCaption: "Um forno deck · cada linha quer sua temperatura e seu vapor, e esfriar demora mais que aquecer.",
      shortDescription: "Sequenciamento de fornadas em um forno com trocas de temperatura, pico da manhã e fornecedor de reserva.",
      description: "Um forno deck industrial assa as linhas de produto da loja. As massas ficam prontas em instantes diferentes, cada linha tem um horário prometido de balcão ou rota, e mudar a temperatura custa espera — esfriar o lastro demora mais que aquecer, e o vapor é reajustado por linha. Fornadas que não cabem mais podem ser compradas de um fornecedor para a prateleira não ficar vazia.",
      decisions: [
        "Seleção das fornadas prontas para o forno.",
        "Ordem de produção e as transições de temperatura resultantes.",
        "Comparação entre fornada atrasada e compra do fornecedor.",
      ],
      vocabulary: {
        resource: "forno deck",
        job: "fornada",
        family: "linha de produto (programa de temperatura e vapor)",
        processingTime: "tempo de forno",
        releaseTime: "instante em que a massa está pronta",
        dueDate: "horário prometido de balcão ou rota",
        hardDeadline: "última fornada viável",
        setupTime: "tempo de troca de temperatura e vapor (esfriar é mais lento que aquecer)",
        setupCost: "custo de troca (forno parado + energia)",
        executionCost: "custo de fornada (energia + tempo de forno)",
        tardinessWeight: "multa de prateleira vazia por minuto",
        rejectionCost: "preço de compra do fornecedor",
      },
      objective: {
        summary: "Minimizar custos de troca de temperatura e fornada, multas de prateleira vazia e compras do fornecedor.",
        terms: {
          setup: "trocas de temperatura",
          execution: "fornadas",
          tardiness: "atraso de reposição",
          rejection: "compra do fornecedor",
        },
      },
      simplifications: [
        "O modelo programa um forno deck de capacidade unitária; câmaras de fermentação, batedeiras e o balcão ficam fora do modelo.",
        "Cada fornada assa em um programa fixo de temperatura e vapor; receitas e estoque de massas não são modelados.",
        "O fornecedor é uma alternativa externa numérica que mantém a prateleira cheia; nenhum contrato específico é escolhido.",
      ],
      disclosure: "As três instâncias de padaria incluídas são cargas reproduzíveis geradas com seeds para esta interpretação de scheduling; não são pedidos de uma padaria real.",
    },
  },
};

const dentalMappings = [
  {
    instanceId: "DENTAL_S_45",
    runDefaults: { singleBudget: 330_000, comparisonBudget: 33_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Two-day case load", note: "Quick ~3s run: forty-five cases across six materials; the titanium tooling swap is the visible trade-off." },
      "pt-BR": { label: "Carteira de dois dias", note: "Rodada rápida de ~3 s: quarenta e cinco casos em seis materiais; a troca de ferramental para titânio é o trade-off visível." },
    },
  },
  {
    instanceId: "DENTAL_M_90",
    runDefaults: { singleBudget: 450_000, comparisonBudget: 45_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Four-day case load", note: "Full ~15s run: chairside same-day cases compete with batching by material." },
      "pt-BR": { label: "Carteira de quatro dias", note: "Rodada completa de ~15 s: casos de mesmo dia do consultório competem com o agrupamento por material." },
    },
  },
  {
    instanceId: "DENTAL_L_180",
    runDefaults: { singleBudget: 420_000, comparisonBudget: 42_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Eight-day case load", note: "Reference ~30s run: appointment dates and external milling prices fight for every hour of the machine." },
      "pt-BR": { label: "Carteira de oito dias", note: "Rodada de referência de ~30 s: datas de consulta e preços de fresagem externa disputam cada hora da máquina." },
    },
  },
];

const dentalScenario = {
  id: "dental",
  visual: { assetKey: "dental", objectPosition: "50% 50%" },
  recommendedDefaultInstance: "DENTAL_M_90",
  instanceMappings: dentalMappings,
  datasetRelationship: "native-seeded-domain-workload",
  content: {
    en: {
      name: "Dental milling lab",
      visualAlt: "A single CAD/CAM milling machine with blocks of zirconia, PMMA, wax, titanium, glass ceramic and PEEK on a rack, and milled crowns and frameworks on a tray.",
      visualCaption: "One milling machine · every material means other blanks and burs, and titanium demands cooled tooling plus a flush.",
      shortDescription: "Single-machine case milling with material changeovers, patient appointments and external milling.",
      description: "One CAD/CAM milling machine runs the prosthetics lab's case load. Scans arrive at different times, every case has a patient appointment, and changing material costs new blanks, burs and coolant — titanium abutments also demand cooled tooling and a full flush afterwards. Cases that no longer fit can go to an external milling center at a price.",
      decisions: [
        "Selection of arrived cases for the milling machine.",
        "Milling order and the resulting material and tooling changes.",
        "Comparison between a late case and the external milling center.",
      ],
      vocabulary: {
        resource: "CAD/CAM milling machine",
        job: "milling case",
        family: "material family",
        processingTime: "milling time",
        releaseTime: "case check-in time (scan and design ready)",
        dueDate: "patient appointment time",
        hardDeadline: "latest feasible delivery",
        setupTime: "blank, bur and coolant change time",
        setupCost: "changeover cost (idle machine + tooling wear)",
        executionCost: "milling cost (blank + bur wear + machine time)",
        tardinessWeight: "missed-appointment penalty per minute",
        rejectionCost: "external milling center price",
      },
      objective: {
        summary: "Minimize material-change and milling costs, missed-appointment penalties, and externally milled cases.",
        terms: {
          setup: "material changeovers",
          execution: "milling",
          tardiness: "appointment delay",
          rejection: "external milling",
        },
      },
      simplifications: [
        "The model schedules one milling machine with capacity one; scanners, sintering furnaces, and finishing benches are outside this model.",
        "Each case mills from one material with a fixed strategy; design work and remakes are not modeled.",
        "The external milling center is one numeric outside option; no specific partner is chosen.",
      ],
      disclosure: "The three bundled dental-lab instances are reproducible seeded workloads created for this scheduling interpretation; they are not cases from a real laboratory.",
    },
    "pt-BR": {
      name: "Laboratório de próteses dentárias",
      visualAlt: "Uma única fresadora CAD/CAM com blocos de zircônia, PMMA, cera, titânio, cerâmica vítrea e PEEK em um rack, e coroas e estruturas fresadas em uma bandeja.",
      visualCaption: "Uma fresadora · cada material exige outros blanks e fresas, e o titânio pede ferramental refrigerado mais flush.",
      shortDescription: "Fresagem de casos em máquina única com trocas de material, consultas de pacientes e fresagem externa.",
      description: "Uma fresadora CAD/CAM toca a carteira de casos do laboratório de próteses. Os escaneamentos chegam em instantes diferentes, cada caso tem uma consulta do paciente, e mudar de material custa novos blanks, fresas e refrigeração — pilares de titânio ainda exigem ferramental refrigerado e um flush completo depois. Casos que não cabem mais podem ir para um centro de fresagem externo por um preço.",
      decisions: [
        "Seleção dos casos recebidos para a fresadora.",
        "Ordem de fresagem e as trocas de material e ferramental resultantes.",
        "Comparação entre caso atrasado e o centro de fresagem externo.",
      ],
      vocabulary: {
        resource: "fresadora CAD/CAM",
        job: "caso de fresagem",
        family: "família de material",
        processingTime: "tempo de fresagem",
        releaseTime: "recebimento do caso (escaneamento e desenho prontos)",
        dueDate: "consulta do paciente",
        hardDeadline: "entrega máxima viável",
        setupTime: "tempo de troca de blank, fresa e refrigeração",
        setupCost: "custo de troca (máquina parada + desgaste de ferramental)",
        executionCost: "custo de fresagem (blank + desgaste de fresa + tempo de máquina)",
        tardinessWeight: "multa de consulta perdida por minuto",
        rejectionCost: "preço do centro de fresagem externo",
      },
      objective: {
        summary: "Minimizar custos de troca de material e fresagem, multas de consulta perdida e casos fresados externamente.",
        terms: {
          setup: "trocas de material",
          execution: "fresagem",
          tardiness: "atraso para a consulta",
          rejection: "fresagem externa",
        },
      },
      simplifications: [
        "O modelo programa uma fresadora de capacidade unitária; scanners, fornos de sinterização e bancadas de acabamento ficam fora do modelo.",
        "Cada caso é fresado em um material com estratégia fixa; desenho e retrabalhos não são modelados.",
        "O centro de fresagem externo é uma alternativa externa numérica; nenhum parceiro específico é escolhido.",
      ],
      disclosure: "As três instâncias de laboratório de próteses incluídas são cargas reproduzíveis geradas com seeds para esta interpretação de scheduling; não são casos de um laboratório real.",
    },
  },
};

const laserMappings = [
  {
    instanceId: "LASER_S_45",
    runDefaults: { singleBudget: 550_000, comparisonBudget: 55_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Two-day cutting queue", note: "Quick ~3s run: forty-five jobs across six material families; the O2-to-N2 gas swap for bright metals is the visible trade-off." },
      "pt-BR": { label: "Fila de corte de dois dias", note: "Rodada rápida de ~3 s: quarenta e cinco jobs em seis famílias de material; a troca de gás O2 para N2 nos metais brilhantes é o trade-off visível." },
    },
  },
  {
    instanceId: "LASER_M_90",
    runDefaults: { singleBudget: 740_000, comparisonBudget: 74_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Three-day cutting queue", note: "Full ~15s run: hot jobs compete with batching by material and gas." },
      "pt-BR": { label: "Fila de corte de três dias", note: "Rodada completa de ~15 s: jobs urgentes competem com o agrupamento por material e gás." },
    },
  },
  {
    instanceId: "LASER_L_180",
    runDefaults: { singleBudget: 750_000, comparisonBudget: 75_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Five-day cutting queue", note: "Reference ~30s run: hot jobs, fabrication orders and stock nesting fight for every hour of the table." },
      "pt-BR": { label: "Fila de corte de cinco dias", note: "Rodada de referência de ~30 s: jobs urgentes, pedidos de fabricação e cortes para estoque disputam cada hora da mesa." },
    },
  },
];

const laserScenario = {
  id: "laser",
  visual: { assetKey: "laser", objectPosition: "50% 50%" },
  recommendedDefaultInstance: "LASER_M_90",
  instanceMappings: laserMappings,
  datasetRelationship: "native-seeded-domain-workload",
  content: {
    en: {
      name: "Fiber laser cutting",
      visualAlt: "A single fiber laser cutting machine with stacked sheets of 1 and 3 mm steel, aluminium, acrylic, MDF and brass, and finished cut parts on a sorting table.",
      visualCaption: "One laser · bright metals swap O2 for N2, organics leave residue, and brass wants its own lens check.",
      shortDescription: "Single-machine cutting with gas and lens changes, hot jobs and waterjet overflow.",
      description: "One fiber laser runs the shop's cutting queue. Sheets are staged at different times, every job has a promised fabrication slot, and changing material family costs gas, lens and parameter changes — bright metals want nitrogen instead of oxygen, organics demand a deep clean afterwards, and brass demands a lens check. Jobs that no longer fit can be cut on an outsourced waterjet at a price.",
      decisions: [
        "Selection of staged jobs for the laser table.",
        "Cutting order and the resulting gas, lens and cleaning changes.",
        "Comparison between a late cut and the waterjet price.",
      ],
      vocabulary: {
        resource: "fiber laser cutting machine",
        job: "cutting job",
        family: "material and thickness family",
        processingTime: "cutting time",
        releaseTime: "sheet-staging time",
        dueDate: "promised fabrication slot",
        hardDeadline: "latest feasible completion",
        setupTime: "gas, lens and parameter change time",
        setupCost: "changeover cost (gas purge + downtime)",
        executionCost: "cutting cost (gas + energy + consumables)",
        tardinessWeight: "late-job penalty per minute",
        rejectionCost: "outsourced waterjet price",
      },
      objective: {
        summary: "Minimize changeover and cutting costs, late-job penalties, and waterjet-outsourced work.",
        terms: {
          setup: "gas and lens changes",
          execution: "cutting",
          tardiness: "late delivery",
          rejection: "waterjet outsourcing",
        },
      },
      simplifications: [
        "The model schedules one laser with capacity one; part nesting, material inventory, and bending or welding are outside this model.",
        "Each job cuts one material and thickness with a fixed parameter set; cut-quality grading and remakes are not modeled.",
        "The waterjet is one numeric outside option; no specific subcontractor is chosen.",
      ],
      disclosure: "The three bundled laser-cutting instances are reproducible seeded workloads created for this scheduling interpretation; they are not jobs from a real shop.",
    },
    "pt-BR": {
      name: "Corte a laser de fibra",
      visualAlt: "Uma única máquina de corte a laser de fibra com pilhas de chapas de aço de 1 e 3 mm, alumínio, acrílico, MDF e latão, e peças cortadas em uma mesa de separação.",
      visualCaption: "Um laser · metais brilhantes trocam O2 por N2, orgânicos deixam resíduo, e o latão pede checagem da lente.",
      shortDescription: "Corte em máquina única com trocas de gás e lente, jobs urgentes e overflow no jato d'água.",
      description: "Um laser de fibra toca a fila de corte da oficina. As chapas são preparadas em instantes diferentes, cada job tem um slot de fabricação prometido, e mudar a família de material custa troca de gás, lente e parâmetros — metais brilhantes pedem nitrogênio no lugar de oxigênio, orgânicos exigem limpeza profunda depois, e o latão exige checagem da lente. Jobs que não cabem mais podem ser cortados em um jato d'água terceirizado por um preço.",
      decisions: [
        "Seleção dos jobs preparados para a mesa do laser.",
        "Ordem de corte e as trocas de gás, lente e limpeza resultantes.",
        "Comparação entre corte atrasado e o preço do jato d'água.",
      ],
      vocabulary: {
        resource: "máquina de corte a laser de fibra",
        job: "job de corte",
        family: "família de material e espessura",
        processingTime: "tempo de corte",
        releaseTime: "preparo da chapa",
        dueDate: "slot de fabricação prometido",
        hardDeadline: "conclusão máxima viável",
        setupTime: "tempo de troca de gás, lente e parâmetros",
        setupCost: "custo de troca (purga de gás + parada)",
        executionCost: "custo de corte (gás + energia + consumíveis)",
        tardinessWeight: "multa de job atrasado por minuto",
        rejectionCost: "preço do jato d'água terceirizado",
      },
      objective: {
        summary: "Minimizar custos de troca e corte, multas de atraso e trabalho terceirizado no jato d'água.",
        terms: {
          setup: "trocas de gás e lente",
          execution: "corte",
          tardiness: "entrega atrasada",
          rejection: "jato d'água",
        },
      },
      simplifications: [
        "O modelo programa um laser de capacidade unitária; arranjo das peças na chapa, estoque de material e dobra ou solda ficam fora do modelo.",
        "Cada job corta um material e espessura com conjunto fixo de parâmetros; classificação de qualidade de corte e retrabalhos não são modelados.",
        "O jato d'água é uma alternativa externa numérica; nenhum subcontratado específico é escolhido.",
      ],
      disclosure: "As três instâncias de corte a laser incluídas são cargas reproduzíveis geradas com seeds para esta interpretação de scheduling; não são jobs de uma oficina real.",
    },
  },
};

const laundryMappings = [
  {
    instanceId: "LAUNDRY_S_45",
    runDefaults: { singleBudget: 375_000, comparisonBudget: 37_500, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Two-day route plan", note: "Quick ~3s run: forty-five lots across six linen classes; the sanitization flush after healthcare is the visible trade-off." },
      "pt-BR": { label: "Plano de rotas de dois dias", note: "Rodada rápida de ~3 s: quarenta e cinco lotes em seis classes de roupa; o flush de sanitização após a saúde é o trade-off visível." },
    },
  },
  {
    instanceId: "LAUNDRY_M_90",
    runDefaults: { singleBudget: 485_000, comparisonBudget: 48_500, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Four-day route plan", note: "Full ~15s run: morning route windows compete with batching by linen class." },
      "pt-BR": { label: "Plano de rotas de quatro dias", note: "Rodada completa de ~15 s: as janelas da rota da manhã competem com o agrupamento por classe de roupa." },
    },
  },
  {
    instanceId: "LAUNDRY_L_180",
    runDefaults: { singleBudget: 136_000, comparisonBudget: 13_600, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Eight-day route plan", note: "Reference ~30s run: route windows and sister-plant prices fight for every hour of the tunnel." },
      "pt-BR": { label: "Plano de rotas de oito dias", note: "Rodada de referência de ~30 s: janelas de rota e preços da planta irmã disputam cada hora do túnel." },
    },
  },
];

const laundryScenario = {
  id: "laundry",
  visual: { assetKey: "laundry", objectPosition: "50% 50%" },
  recommendedDefaultInstance: "LAUNDRY_M_90",
  instanceMappings: laundryMappings,
  datasetRelationship: "native-seeded-domain-workload",
  content: {
    en: {
      name: "Industrial laundry",
      visualAlt: "A single tunnel washing line with sorted carts of white and colored hotel linen, greasy restaurant textiles, healthcare barrier linen, delicate items and spa towels.",
      visualCaption: "One tunnel line · each linen class wants its own chemistry, and healthcare loads demand heavy sanitization.",
      shortDescription: "Single-line wash sequencing with chemical flushes, route windows and sister-plant diversion.",
      description: "One tunnel washer line runs the plant's linen flow. Carts arrive at different times, every lot has a delivery-route window, and changing linen class costs a chemical flush and a new wash formula — healthcare barrier linen demands heavy sanitization before anything else runs. Lots that no longer fit can be diverted to the sister plant at a price.",
      decisions: [
        "Selection of arrived lots for the tunnel line.",
        "Wash order and the resulting chemical flushes.",
        "Comparison between a missed route and diverting to the sister plant.",
      ],
      vocabulary: {
        resource: "tunnel washer line",
        job: "laundry lot",
        family: "linen class",
        processingTime: "wash-cycle time",
        releaseTime: "cart arrival and sorting time",
        dueDate: "delivery-route window",
        hardDeadline: "latest feasible route departure",
        setupTime: "chemical flush and formula change time",
        setupCost: "changeover cost (water, chemicals, energy)",
        executionCost: "wash cost (water, chemicals, energy per minute)",
        tardinessWeight: "missed-route penalty per minute",
        rejectionCost: "sister-plant diversion price",
      },
      objective: {
        summary: "Minimize flush and wash costs, missed-route penalties, and diverted lots.",
        terms: {
          setup: "chemical flushes",
          execution: "washing",
          tardiness: "missed route",
          rejection: "sister-plant diversion",
        },
      },
      simplifications: [
        "The model schedules one tunnel line with capacity one; dryers, ironers, and folding are outside this model.",
        "Each lot washes in one fixed formula; stain rewash and quality inspection are not modeled.",
        "The sister plant is one numeric outside option; no specific logistics contract is chosen.",
      ],
      disclosure: "The three bundled laundry instances are reproducible seeded workloads created for this scheduling interpretation; they are not lots from a real plant.",
    },
    "pt-BR": {
      name: "Lavanderia industrial",
      visualAlt: "Uma única linha de lavagem em túnel com carrinhos triados de roupa de hotel branca e colorida, têxteis engordurados de restaurante, roupa barreira da saúde, itens delicados e toalhas de spa.",
      visualCaption: "Uma linha túnel · cada classe de roupa pede sua química, e a roupa da saúde exige sanitização pesada.",
      shortDescription: "Sequenciamento de lavagem em linha única com flushes químicos, janelas de rota e desvio para a planta irmã.",
      description: "Uma linha de lavagem em túnel toca o fluxo de roupa da planta. Os carrinhos chegam em instantes diferentes, cada lote tem uma janela de rota de entrega, e mudar a classe de roupa custa um flush químico e uma nova fórmula de lavagem — a roupa barreira da saúde exige sanitização pesada antes de qualquer outra carga. Lotes que não cabem mais podem ser desviados para a planta irmã por um preço.",
      decisions: [
        "Seleção dos lotes recebidos para a linha túnel.",
        "Ordem de lavagem e os flushes químicos resultantes.",
        "Comparação entre rota perdida e desvio para a planta irmã.",
      ],
      vocabulary: {
        resource: "linha de lavagem em túnel",
        job: "lote de roupa",
        family: "classe de roupa",
        processingTime: "tempo de ciclo de lavagem",
        releaseTime: "chegada e triagem do carrinho",
        dueDate: "janela da rota de entrega",
        hardDeadline: "última saída de rota viável",
        setupTime: "tempo de flush químico e troca de fórmula",
        setupCost: "custo de troca (água, químicos, energia)",
        executionCost: "custo de lavagem (água, químicos, energia por minuto)",
        tardinessWeight: "multa de rota perdida por minuto",
        rejectionCost: "preço do desvio para a planta irmã",
      },
      objective: {
        summary: "Minimizar custos de flush e lavagem, multas de rota perdida e lotes desviados.",
        terms: {
          setup: "flushes químicos",
          execution: "lavagem",
          tardiness: "rota perdida",
          rejection: "desvio para a planta irmã",
        },
      },
      simplifications: [
        "O modelo programa uma linha túnel de capacidade unitária; secadoras, calandras e dobra ficam fora do modelo.",
        "Cada lote lava em uma fórmula fixa; relavagem de manchas e inspeção de qualidade não são modelados.",
        "A planta irmã é uma alternativa externa numérica; nenhum contrato logístico específico é escolhido.",
      ],
      disclosure: "As três instâncias de lavanderia incluídas são cargas reproduzíveis geradas com seeds para esta interpretação de scheduling; não são lotes de uma planta real.",
    },
  },
};

const studioMappings = [
  {
    instanceId: "STUDIO_S_45",
    runDefaults: { singleBudget: 480_000, comparisonBudget: 48_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Four-day booking calendar", note: "Quick ~3s run: forty-five sessions across six set configurations; branded builds are the visible trade-off." },
      "pt-BR": { label: "Agenda de quatro dias", note: "Rodada rápida de ~3 s: quarenta e cinco sessões em seis configurações de set; as montagens de branded são o trade-off visível." },
    },
  },
  {
    instanceId: "STUDIO_M_90",
    runDefaults: { singleBudget: 300_000, comparisonBudget: 30_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Seven-day booking calendar", note: "Full ~15s run: publish-today sessions compete with batching by set." },
      "pt-BR": { label: "Agenda de sete dias", note: "Rodada completa de ~15 s: sessões que publicam hoje competem com o agrupamento por set." },
    },
  },
  {
    instanceId: "STUDIO_L_180",
    runDefaults: { singleBudget: 36_000, comparisonBudget: 3_600, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Thirteen-day booking calendar", note: "Reference ~30s run: weekly slots and season batches fight for every hour of the room." },
      "pt-BR": { label: "Agenda de treze dias", note: "Rodada de referência de ~30 s: slots semanais e lotes de temporada disputam cada hora da sala." },
    },
  },
];

const studioScenario = {
  id: "studio",
  visual: { assetKey: "studio", objectPosition: "50% 50%" },
  recommendedDefaultInstance: "STUDIO_M_90",
  instanceMappings: studioMappings,
  datasetRelationship: "native-seeded-domain-workload",
  content: {
    en: {
      name: "Podcast & video studio",
      visualAlt: "A single studio room with a solo interview armchair, a duo table, a YouTube backdrop with softboxes, an audiobook vocal booth, livestream gear and a branded set under construction.",
      visualCaption: "One room · every format wants its own set and lighting, and branded sets take the longest to build and strike.",
      shortDescription: "Single-room session scheduling with set changeovers, publish dates and external rental.",
      description: "One studio room carries the production slate. Guests and crews are called at different times, every episode has a publish date, and changing format costs a set and lighting changeover — branded sets take the longest to build and strike. Sessions that no longer fit can be booked in an external studio at a price.",
      decisions: [
        "Selection of confirmed sessions for the room.",
        "Recording order and the resulting set changeovers.",
        "Comparison between a delayed episode and the external studio rental.",
      ],
      vocabulary: {
        resource: "studio room",
        job: "recording session",
        family: "set and lighting configuration",
        processingTime: "session time",
        releaseTime: "guest and crew call time",
        dueDate: "publish date",
        hardDeadline: "latest feasible session end",
        setupTime: "set and lighting changeover time",
        setupCost: "changeover cost (crew time + idle room)",
        executionCost: "session cost (room, crew, energy)",
        tardinessWeight: "publish-delay penalty per minute",
        rejectionCost: "external studio rental price",
      },
      objective: {
        summary: "Minimize set-change and session costs, publish-delay penalties, and external rentals.",
        terms: {
          setup: "set changeovers",
          execution: "recording",
          tardiness: "publish delay",
          rejection: "external studio rental",
        },
      },
      simplifications: [
        "The model schedules one studio room with capacity one; editing, post-production, and distribution are outside this model.",
        "Each session uses one fixed set configuration; retakes and live overruns are not modeled.",
        "The external studio is one numeric outside option; no specific venue is chosen.",
      ],
      disclosure: "The three bundled studio instances are reproducible seeded workloads created for this scheduling interpretation; they are not bookings from a real studio.",
    },
    "pt-BR": {
      name: "Estúdio de podcast e vídeo",
      visualAlt: "Uma única sala de estúdio com poltrona de entrevista solo, mesa dupla, cenário de YouTube com softboxes, cabine de voz para audiolivro, equipamento de livestream e um set branded em montagem.",
      visualCaption: "Uma sala · cada formato quer seu set e sua iluminação, e sets branded são os mais demorados para montar e desmontar.",
      shortDescription: "Agendamento de sessões em sala única com trocas de set, datas de publicação e aluguel externo.",
      description: "Uma sala de estúdio carrega a pauta de produção. Convidados e equipes são chamados em instantes diferentes, cada episódio tem uma data de publicação, e mudar de formato custa uma troca de set e iluminação — sets branded são os mais demorados para montar e desmontar. Sessões que não cabem mais podem ser marcadas em um estúdio externo por um preço.",
      decisions: [
        "Seleção das sessões confirmadas para a sala.",
        "Ordem de gravação e as trocas de set resultantes.",
        "Comparação entre episódio atrasado e o aluguel do estúdio externo.",
      ],
      vocabulary: {
        resource: "sala de estúdio",
        job: "sessão de gravação",
        family: "configuração de set e iluminação",
        processingTime: "tempo de sessão",
        releaseTime: "chamada de convidados e equipe",
        dueDate: "data de publicação",
        hardDeadline: "término máximo viável da sessão",
        setupTime: "tempo de troca de set e iluminação",
        setupCost: "custo de troca (tempo de equipe + sala parada)",
        executionCost: "custo de sessão (sala, equipe, energia)",
        tardinessWeight: "multa de atraso de publicação por minuto",
        rejectionCost: "preço do aluguel de estúdio externo",
      },
      objective: {
        summary: "Minimizar custos de troca de set e sessão, multas de atraso de publicação e aluguéis externos.",
        terms: {
          setup: "trocas de set",
          execution: "gravação",
          tardiness: "atraso de publicação",
          rejection: "aluguel de estúdio externo",
        },
      },
      simplifications: [
        "O modelo programa uma sala de estúdio de capacidade unitária; edição, pós-produção e distribuição ficam fora do modelo.",
        "Cada sessão usa uma configuração fixa de set; refilmagens e estouros de live não são modelados.",
        "O estúdio externo é uma alternativa externa numérica; nenhum espaço específico é escolhido.",
      ],
      disclosure: "As três instâncias de estúdio incluídas são cargas reproduzíveis geradas com seeds para esta interpretação de scheduling; não são agendamentos de um estúdio real.",
    },
  },
};

const labMappings = [
  {
    instanceId: "LAB_S_45",
    runDefaults: { singleBudget: 550_000, comparisonBudget: 55_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Two-day sample load", note: "Quick ~3s run: forty-five batches across six assay panels; decontamination after toxicology is the visible trade-off." },
      "pt-BR": { label: "Carga de dois dias", note: "Rodada rápida de ~3 s: quarenta e cinco lotes em seis painéis de ensaios; a descontaminação após toxicologia é o trade-off visível." },
    },
  },
  {
    instanceId: "LAB_M_90",
    runDefaults: { singleBudget: 815_000, comparisonBudget: 81_500, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Three-day sample load", note: "Full ~15s run: STAT windows compete with batching by assay panel." },
      "pt-BR": { label: "Carga de três dias", note: "Rodada completa de ~15 s: janelas STAT competem com o agrupamento por painel de ensaios." },
    },
  },
  {
    instanceId: "LAB_L_180",
    runDefaults: { singleBudget: 350_000, comparisonBudget: 35_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Six-day sample load", note: "Reference ~30s run: STAT, same-day and routine work fight for every hour of the analyzer." },
      "pt-BR": { label: "Carga de seis dias", note: "Rodada de referência de ~30 s: trabalho STAT, no mesmo dia e de rotina disputa cada hora do analisador." },
    },
  },
];

const labScenario = {
  id: "lab",
  visual: { assetKey: "lab", objectPosition: "50% 50%" },
  recommendedDefaultInstance: "LAB_M_90",
  instanceMappings: labMappings,
  datasetRelationship: "native-seeded-domain-workload",
  content: {
    en: {
      name: "Clinical testing lab",
      visualAlt: "A single clinical chemistry analyzer with reagent racks for hematology, biochemistry, immunology, coagulation, toxicology and microbiology panels, and sample tubes in check-in trays.",
      visualCaption: "One analyzer · each panel wants its own reagents and calibration, and toxicology demands decontamination.",
      shortDescription: "Single-analyzer batch sequencing with reagent changes, modeled report targets and send-outs.",
      description: "One chemistry analyzer runs the lab's sample flow. Batches are checked in at different times, every batch has a modeled report target, and changing assay panel costs reagent changes, calibration and wash cycles — toxicology panels demand full decontamination afterwards. Batches that no longer fit can be sent to a reference laboratory at a price.",
      decisions: [
        "Selection of checked-in batches for the analyzer.",
        "Run order and the resulting reagent changes and washes.",
        "Comparison between a modeled delay and the reference-laboratory send-out.",
      ],
      vocabulary: {
        resource: "clinical chemistry analyzer",
        job: "sample batch",
        family: "assay panel family",
        processingTime: "analysis time",
        releaseTime: "sample check-in time",
        dueDate: "modeled report target",
        hardDeadline: "latest feasible completion",
        setupTime: "reagent change, calibration and wash time",
        setupCost: "changeover cost (reagents + calibration consumables + downtime)",
        executionCost: "analysis cost (reagents + consumables)",
        tardinessWeight: "modeled penalty per minute beyond the report target",
        rejectionCost: "reference-laboratory send-out price",
      },
      objective: {
        summary: "Minimize reagent-change and analysis costs, modeled report delays, and reference-laboratory send-outs.",
        terms: {
          setup: "reagent changes and calibrations",
          execution: "analysis",
          tardiness: "report delay (modeled)",
          rejection: "reference-lab send-out",
        },
      },
      simplifications: [
        "The lens represents one capacity-one analyzer, not an entire laboratory.",
        "Clinical priority, sample stability, quality-control failures, and staffing are not modeled.",
        "A send-out is a numeric outside option, never a clinical recommendation.",
      ],
      disclosure: "The three fixed workloads are reproducible synthetic analyzer-planning horizons generated with committed seeds. They are not laboratory or patient data and must not guide clinical decisions; the reference laboratory is a numeric outside option, and every displayed result is computed by the same single-machine engine.",
    },
    "pt-BR": {
      name: "Laboratório de análises clínicas",
      visualAlt: "Um único analisador de química clínica com racks de reagentes para painéis de hematologia, bioquímica, imunologia, coagulação, toxicologia e microbiologia, e tubos de amostra em bandejas de registro.",
      visualCaption: "Um analisador · cada painel pede seus reagentes e calibração, e toxicologia exige descontaminação.",
      shortDescription: "Sequenciamento de lotes em um analisador com trocas de reagente, metas de laudo modeladas e envios externos.",
      description: "Um analisador de química clínica toca o fluxo de amostras do laboratório. Lotes são registrados em instantes diferentes, cada lote tem uma meta de laudo modelada, e mudar de painel de ensaios custa troca de reagente, calibração e ciclos de lavagem — painéis de toxicologia exigem descontaminação completa depois. Lotes que não cabem mais podem ser enviados a um laboratório de referência por um preço.",
      decisions: [
        "Seleção dos lotes registrados para o analisador.",
        "Ordem de processamento e as trocas de reagente e lavagens resultantes.",
        "Comparação entre atraso modelado e o envio ao laboratório de referência.",
      ],
      vocabulary: {
        resource: "analisador de química clínica",
        job: "lote de amostras",
        family: "família de painel de ensaios",
        processingTime: "tempo de análise",
        releaseTime: "registro da amostra",
        dueDate: "meta de laudo modelada",
        hardDeadline: "conclusão máxima viável",
        setupTime: "tempo de troca de reagente, calibração e lavagem",
        setupCost: "custo de troca (reagentes + consumíveis de calibração + parada)",
        executionCost: "custo de análise (reagentes + consumíveis)",
        tardinessWeight: "consequência modelada por minuto além da meta de laudo",
        rejectionCost: "preço de envio ao laboratório de referência",
      },
      objective: {
        summary: "Minimizar custos de troca de reagente e análise, atrasos de laudo modelados e envios ao laboratório de referência.",
        terms: {
          setup: "trocas de reagente e calibrações",
          execution: "análise",
          tardiness: "atraso de laudo (modelado)",
          rejection: "envio ao laboratório de referência",
        },
      },
      simplifications: [
        "A lente representa um analisador de capacidade unitária, não um laboratório inteiro.",
        "Prioridade clínica, estabilidade da amostra, falhas de controle de qualidade e equipes não são modelados.",
        "O envio externo é uma alternativa numérica, nunca uma recomendação clínica.",
      ],
      disclosure: "As três cargas fixas são horizontes sintéticos e reproduzíveis de planejamento do analisador, gerados com seeds versionadas. Não são dados laboratoriais nem de pacientes e não devem orientar decisões clínicas; o laboratório de referência é uma alternativa externa numérica, e cada resultado exibido é calculado pelo mesmo engine de máquina única.",
    },
  },
};

const breweryMappings = [
  {
    instanceId: "BREWERY_S_45",
    runDefaults: { singleBudget: 115_000, comparisonBudget: 11_500, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Eleven-day brew schedule", note: "Quick ~3s run: forty-five batches across six styles; extra sanitization after sours is the visible trade-off." },
      "pt-BR": { label: "Cronograma de onze dias", note: "Rodada rápida de ~3 s: quarenta e cinco bateladas em seis estilos; a sanitização extra após as sours é o trade-off visível." },
    },
  },
  {
    instanceId: "BREWERY_M_90",
    runDefaults: { singleBudget: 90_000, comparisonBudget: 9_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Twenty-three-day brew schedule", note: "Full ~15s run: fermenter windows compete with batching by style." },
      "pt-BR": { label: "Cronograma de vinte e três dias", note: "Rodada completa de ~15 s: as janelas de fermentador competem com o agrupamento por estilo." },
    },
  },
  {
    instanceId: "BREWERY_L_180",
    runDefaults: { singleBudget: 42_000, comparisonBudget: 4_200, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Forty-five-day brew schedule", note: "Reference ~30s run: tank windows, scheduled releases and seasonal contracts fight for every hour of the brewhouse." },
      "pt-BR": { label: "Cronograma de quarenta e cinco dias", note: "Rodada de referência de ~30 s: janelas de tanque, lançamentos programados e contratos sazonais disputam cada hora da sala de brassagem." },
    },
  },
];

const breweryScenario = {
  id: "brewery",
  visual: { assetKey: "brewery", objectPosition: "50% 50%" },
  recommendedDefaultInstance: "BREWERY_M_90",
  instanceMappings: breweryMappings,
  datasetRelationship: "native-seeded-domain-workload",
  content: {
    en: {
      name: "Craft brewery",
      visualAlt: "A single brewhouse with mash tun, kettle and fermenters, surrounded by malt sacks and recipe boards for pilsner, IPA, stout, sour, wheat and lager.",
      visualCaption: "One brewhouse · every style wants its own CIP, and sours demand extra sanitization.",
      shortDescription: "Single-brewhouse batch sequencing with CIP, fermenter windows and contract brewing.",
      description: "One brewhouse carries the brewery's production plan. Batches are staged at different times, every brew has a fermenter availability window, and changing style costs a CIP and a fresh preparation — sour beers demand extra sanitization because of cross-contamination risk. Batches that no longer fit can be contract-brewed at a partner brewery at a price.",
      decisions: [
        "Selection of staged batches for the brewhouse.",
        "Brew order and the resulting CIP and sanitization work.",
        "Comparison between a missed fermenter window and the contract-brewing price.",
      ],
      vocabulary: {
        resource: "brewhouse",
        job: "brew batch",
        family: "beer style family",
        processingTime: "brew-day time",
        releaseTime: "ingredient and water staging time",
        dueDate: "fermenter availability window",
        hardDeadline: "latest feasible knockout",
        setupTime: "CIP and preparation time",
        setupCost: "changeover cost (CIP chemicals, water, idle time)",
        executionCost: "brew cost (malt, hops, energy)",
        tardinessWeight: "blocked-fermenter penalty per minute",
        rejectionCost: "contract-brewing price",
      },
      objective: {
        summary: "Minimize CIP and brew costs, blocked-fermenter penalties, and contract-brewed batches.",
        terms: {
          setup: "CIP and sanitization",
          execution: "brewing",
          tardiness: "missed fermenter window",
          rejection: "contract brewing",
        },
      },
      simplifications: [
        "The model schedules one brewhouse with capacity one; fermentation, cellaring, and packaging are outside this model.",
        "Each batch brews in one fixed style recipe; recipe development and quality control are not modeled.",
        "Contract brewing is one numeric outside option; no specific partner brewery is chosen.",
      ],
      disclosure: "The three bundled brewery instances are reproducible seeded workloads created for this scheduling interpretation; they are not batches from a real brewery.",
    },
    "pt-BR": {
      name: "Cervejaria artesanal",
      visualAlt: "Uma única sala de brassagem com tina de mostura, panela de fervura e fermentadores, cercada por sacos de malte e pranchetas de receita para pilsner, IPA, stout, sour, wheat e lager.",
      visualCaption: "Uma sala de brassagem · cada estilo pede seu CIP, e as sours exigem sanitização extra.",
      shortDescription: "Sequenciamento de bateladas em uma sala de brassagem com CIP, janelas de fermentador e brassagem terceirizada.",
      description: "Uma sala de brassagem carrega o plano de produção da cervejaria. As bateladas são preparadas em instantes diferentes, cada brassagem tem uma janela de disponibilidade do fermentador, e mudar de estilo custa um CIP e um novo preparo — cervejas sour exigem sanitização extra pelo risco de contaminação cruzada. Bateladas que não cabem mais podem ser brassadas em uma cervejaria parceira por um preço.",
      decisions: [
        "Seleção das bateladas preparadas para a sala de brassagem.",
        "Ordem de brassagem e os CIPs e sanitizações resultantes.",
        "Comparação entre janela de fermentador perdida e o preço da brassagem terceirizada.",
      ],
      vocabulary: {
        resource: "sala de brassagem",
        job: "batelada",
        family: "família de estilo",
        processingTime: "tempo de brassagem",
        releaseTime: "preparo de insumos e água",
        dueDate: "janela de disponibilidade do fermentador",
        hardDeadline: "última fervura viável",
        setupTime: "tempo de CIP e preparo",
        setupCost: "custo de troca (químicos de CIP, água, tempo parado)",
        executionCost: "custo de brassagem (malte, lúpulo, energia)",
        tardinessWeight: "multa de fermentador bloqueado por minuto",
        rejectionCost: "preço da brassagem terceirizada",
      },
      objective: {
        summary: "Minimizar custos de CIP e brassagem, multas de fermentador bloqueado e bateladas terceirizadas.",
        terms: {
          setup: "CIP e sanitização",
          execution: "brassagem",
          tardiness: "janela de fermentador perdida",
          rejection: "brassagem terceirizada",
        },
      },
      simplifications: [
        "O modelo programa uma sala de brassagem de capacidade unitária; fermentação, maturação e envase ficam fora do modelo.",
        "Cada batelada segue uma receita fixa de estilo; desenvolvimento de receita e controle de qualidade não são modelados.",
        "A brassagem terceirizada é uma alternativa externa numérica; nenhuma cervejaria parceira específica é escolhida.",
      ],
      disclosure: "As três instâncias de cervejaria incluídas são cargas reproduzíveis geradas com seeds para esta interpretação de scheduling; não são bateladas de uma cervejaria real.",
    },
  },
};

const extraScenarios = [
  coffeeScenario,
  bakeryScenario,
  dentalScenario,
  laserScenario,
  laundryScenario,
  studioScenario,
  labScenario,
  breweryScenario,
];

const EXTRA_TIME_SCALES = {
  coffee: { unit: "minute", dayLength: 1440, dayLabel: "dia de torra" },
  bakery: { unit: "minute", dayLength: 1440, dayLabel: "dia de produção" },
  dental: { unit: "minute", dayLength: 1440, dayLabel: "dia de laboratório" },
  laser: { unit: "minute", dayLength: 1440, dayLabel: "dia de corte" },
  laundry: { unit: "minute", dayLength: 1440, dayLabel: "dia de rotas" },
  studio: { unit: "minute", dayLength: 1440, dayLabel: "dia de agenda" },
  lab: { unit: "minute", dayLength: 1440, dayLabel: "dia de análises" },
  brewery: { unit: "minute", dayLength: 1440, dayLabel: "dia" },
};


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
  ...extraScenarios,
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
