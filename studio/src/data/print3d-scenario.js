/**
 * 3D print farm scenario (seeds committed, see masclib-domains).
 *
 * Data-only module split from catalog.js to keep each source file small and
 * reviewable. Pure literals — no imports, no engine logic. Consumed by
 * catalog.js, which composes the public INSTANCE/SCENARIO catalogs.
 */

/* ---- 3D print farm scenario (seeds committed, see masclib-domains) ---- */
export const PRINT_DOMAIN_ROWS = [
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

export const print3dScenario = {
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
