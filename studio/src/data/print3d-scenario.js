/**
 * 3D print farm scenario (seeds committed, see masclib-domains).
 *
 * Data-only module split from catalog.js to keep each source file small and
 * reviewable. Pure literals — no imports, no engine logic. Consumed by
 * catalog.js, which composes the public INSTANCE/SCENARIO catalogs.
 *
 * Content contract v2: every locale carries `vocabulary` (12 keys) plus
 * `vocabularyUnits`, `vocabularyHelp` and `familyNames` (ordered by CSV
 * SETUP_STATE 0..5). The top-level `orderId` maps job index n to the
 * human-facing order code `${prefix}${offset + n}`.
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
    runDefaults: { singleBudget: 60_000, comparisonBudget: 6_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Four-day order book", note: "A packed production week: forty-five orders across six filament profiles — a quick ~3s run to feel the swaps, purges and the hardened-nozzle change." },
      "pt-BR": { label: "Carteira de quatro dias", note: "Uma semana cheia de produção: quarenta e cinco pedidos em seis materiais — rodada rápida de ~3 s para sentir as trocas de filamento, as purgas e a troca de nozzle." },
    },
  },
  {
    instanceId: "3DPRINT_FARM_90",
    runDefaults: { singleBudget: 60_000, comparisonBudget: 6_000, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Eight-day order book", note: "The owner's real book: about ninety orders where batching by filament fights promised ship dates — the full ~15s run." },
      "pt-BR": { label: "Carteira de oito dias", note: "A carteira real do dono: cerca de noventa pedidos em que agrupar por filamento briga com as datas prometidas — rodada completa de ~15 s." },
    },
  },
  {
    instanceId: "3DPRINT_FARM_180",
    runDefaults: { singleBudget: 34_000, comparisonBudget: 3_400, comparisonRuns: 10, d: 2 },
    content: {
      en: { label: "Two-week peak horizon", note: "A peak month compressed into one hundred eighty orders — the ~30s reference run, where outsourcing and purge-heavy sequences fight for every hour of the printer." },
      "pt-BR": { label: "Horizonte de pico de duas semanas", note: "O mês de pico comprimido em cento e oitenta pedidos — a rodada de referência de ~30 s, em que terceirização e sequências de muita purga disputam cada hora da impressora." },
    },
  },
];

export const print3dScenario = {
  id: "print3d",
  visual: { assetKey: "print3d", objectPosition: "50% 50%" },
  orderId: { prefix: "ORD-", offset: 1001 },
  recommendedDefaultInstance: "3DPRINT_FARM_90",
  instanceMappings: print3dMappings,
  datasetRelationship: "native-seeded-domain-workload",
  content: {
    en: {
      name: "3D print farm",
      visualAlt: "A single FDM printer surrounded by spools of PLA, PETG, TPU, ASA, carbon-fiber nylon and silk PLA, with finished parts on a shelf.",
      visualCaption: "One printer · every filament profile means a different swap, purge, or even nozzle change.",
      shortDescription: "Single-printer order sequencing with filament swaps, late shipment and outsourcing.",
      description: "You inherited a one-printer FDM print farm together with its book of about ninety part orders. Every material is a spool swap with a purge — and abrasive PA-CF also eats brass nozzles, so it forces the hardened nozzle on the way in and back out. Orders arrive approved on different days, each with a promised ship date and a late penalty, and the rush customers pay the steepest ones. Whatever does not fit the week goes to the partner farm — at a price.",
      decisions: [
        "Which orders to accept for this week's printer — and which to pass to the partner farm.",
        "In what order to print: when a filament swap is worth it and when a one-day delay beats the purge.",
        "Where to fit the PA-CF jobs without stalling the queue behind a nozzle change.",
        "When outsourcing beats paying the late-delivery penalty.",
      ],
      vocabulary: {
        resource: "FDM printer",
        job: "print order",
        family: "filament and profile family",
        processingTime: "print time",
        releaseTime: "order approved on",
        dueDate: "promised delivery",
        hardDeadline: "hard cutoff (lose the customer)",
        setupTime: "material swap (setup)",
        setupCost: "setup cost",
        executionCost: "print cost",
        tardinessWeight: "late-delivery penalty",
        rejectionCost: "outsourcing price",
      },
      vocabularyUnits: {
        resource: "",
        job: "",
        family: "",
        processingTime: "h",
        releaseTime: "dia",
        dueDate: "dia",
        hardDeadline: "dia",
        setupTime: "min",
        setupCost: "R$",
        executionCost: "R$",
        tardinessWeight: "R$/dia",
        rejectionCost: "R$",
      },
      vocabularyHelp: {
        resource: "Your single FDM printer: every part crosses this bed, one at a time. It is the business bottleneck — every decision this week competes for the same hours.",
        job: "A part order from your shop: sliced file, fixed material, waiting customer. In the app each order carries its own code (ORD-1001, ORD-1002, …).",
        family: "The order's material group: PLA, PETG, TPU, ASA, PA-CF or silk PLA. Printing two orders of the same family back to back avoids a spool swap and a purge.",
        processingTime: "Hours of bed time the order occupies. It comes from the slicer: spare parts finish in under 1 h, while centerpiece parts run past 5 h.",
        releaseTime: "The day the customer confirmed payment and file. Before that, the order cannot go on the bed.",
        dueDate: "The date you promised the customer. Shipping by it protects your reputation; missing it triggers the late penalty.",
        hardDeadline: "The real limit: the promise plus some slack, never past the end of the horizon. Past the promise you pay a penalty; past the limit the order is a certain loss and the customer walks.",
        setupTime: "Idle minutes to change material: unload the spool, purge the old filament and, for PA-CF, swap the nozzle. Time in which the printer earns nothing.",
        setupCost: "What the swap costs in money: purged filament plus your idle labor. Long swaps — like the hardened-nozzle round trip for PA-CF — cost the most.",
        executionCost: "The cost of printing the order: filament, energy and machine wear, proportional to the profile's print minutes.",
        tardinessWeight: "How much each day of delay burns from your cash on this order — rush customers charge the most. The file stores the value per minute; the app already shows it per day.",
        rejectionCost: "What it costs to send this order to the partner farm to print for you. The optimizer compares that price with printing late and paying the penalty.",
      },
      familyNames: [
        { key: "pla", name: "PLA", blurb: "The cheap everyday workhorse: in and out of the nozzle with no drama." },
        { key: "petg", name: "PETG", blurb: "Tough functional parts for brackets and enclosures; swaps at the normal rate." },
        { key: "tpu", name: "TPU", blurb: "The flexible filament leaves residue in the hotend — the next purge runs ~6 minutes longer." },
        { key: "asa", name: "ASA", blurb: "For parts that live in sun and rain; a routine swap with no nozzle drama." },
        { key: "pa-cf", name: "PA-CF (carbon nylon)", blurb: "Abrasive: eats brass nozzles — needs the hardened nozzle, +18 min on the way in and +8 on the way back." },
        { key: "pla-silk", name: "Silk PLA", blurb: "Mirror finish for display pieces; demands a careful color purge, ~5 extra minutes." },
      ],
      objective: {
        summary: "Maximize the week's margin: print as many orders as possible on time while spending the least on material swaps, penalties and outsourcing. The model minimizes total cost — every real saved is profit preserved.",
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
      shortDescription: "Sequenciamento de pedidos em uma impressora com trocas de filamento, atraso de envio e terceirização.",
      description: "Você herdou uma fazenda de impressão com uma única impressora FDM e uma carteira de cerca de noventa pedidos de peças. Cada material é uma troca de rolo com purga — e o PA-CF, abrasivo, ainda come nozzle de latão, exigindo o nozzle endurecido na ida e na volta. Os pedidos chegam aprovados em dias diferentes, cada um com data prometida e multa de atraso, e os clientes relâmpago cobram as multas mais altas. O que não couber na semana vai para a farm parceira — por um preço.",
      decisions: [
        "Quais pedidos aceitar para imprimir nesta semana — e quais passar para a farm parceira.",
        "Em que ordem imprimir: quando vale trocar de filamento e quando vale atrasar um dia para evitar a purga.",
        "Onde encaixar os pedidos de PA-CF sem travar a fila com a troca de nozzle.",
        "Quando terceirizar sai mais barato que pagar a multa de atraso.",
      ],
      vocabulary: {
        resource: "impressora FDM",
        job: "pedido de peça",
        family: "família de filamento e perfil",
        processingTime: "tempo de impressão",
        releaseTime: "pedido aprovado em",
        dueDate: "entrega prometida",
        hardDeadline: "entrega limite (perde o cliente)",
        setupTime: "troca de material (setup)",
        setupCost: "custo de setup",
        executionCost: "custo de impressão",
        tardinessWeight: "multa por atraso",
        rejectionCost: "preço de terceirizar",
      },
      vocabularyUnits: {
        resource: "",
        job: "",
        family: "",
        processingTime: "h",
        releaseTime: "dia",
        dueDate: "dia",
        hardDeadline: "dia",
        setupTime: "min",
        setupCost: "R$",
        executionCost: "R$",
        tardinessWeight: "R$/dia",
        rejectionCost: "R$",
      },
      vocabularyHelp: {
        resource: "Sua única impressora FDM: todas as peças passam por essa mesa, uma de cada vez. É o gargalo do negócio — cada decisão da semana disputa as mesmas horas.",
        job: "Um pedido de peça da sua loja: arquivo fatiado, material definido e cliente esperando. No app, cada pedido aparece com código próprio (ORD-1001, ORD-1002, …).",
        family: "O grupo de material do pedido: PLA, PETG, TPU, ASA, PA-CF ou PLA silk. Imprimir dois pedidos da mesma família em sequência evita troca de rolo e purga.",
        processingTime: "Horas de mesa que o pedido ocupa a impressora. Vem do fatiamento: peças de reposição saem em menos de 1 h; peças-centro passam de 5 h.",
        releaseTime: "O dia em que o cliente confirmou o pagamento e o arquivo. Antes disso o pedido não pode entrar na mesa.",
        dueDate: "A data que você prometeu ao cliente. Entregar até ela mantém a reputação; passar dela dispara a multa por atraso.",
        hardDeadline: "O limite real: a promessa mais uma folga, sem passar do fim do horizonte. Depois da entrega prometida você paga multa; depois do limite, o pedido vira prejuízo certo e o cliente vai embora.",
        setupTime: "Minutos parados para trocar de material: tirar o rolo, purgar o filamento antigo e, no caso do PA-CF, trocar o nozzle. É tempo em que a impressora não fatura.",
        setupCost: "O que a troca custa em dinheiro: filamento purgado mais a sua mão de obra parada. Trocas longas — como a ida e a volta do nozzle endurecido para o PA-CF — são as mais caras.",
        executionCost: "Custo de imprimir o pedido: filamento gasto, energia e desgaste da máquina, proporcional aos minutos de impressão do perfil.",
        tardinessWeight: "Quanto cada dia de atraso desse pedido queima do seu caixa — cliente relâmpago cobra mais caro. No arquivo o valor vem por minuto; o app já mostra convertido por dia.",
        rejectionCost: "Quanto custa mandar esse pedido para a farm parceira imprimir por você. O otimizador compara esse preço com imprimir atrasado e pagar multa.",
      },
      familyNames: [
        { key: "pla", name: "PLA", blurb: "O coringa barato do dia a dia: entra e sai do nozzle sem drama." },
        { key: "petg", name: "PETG", blurb: "Peças funcionais e resistentes para suportes e carcaças; troca na faixa normal." },
        { key: "tpu", name: "TPU", blurb: "O flexível deixa resíduo no hotend — a purga seguinte demora ~6 min a mais." },
        { key: "asa", name: "ASA", blurb: "Para peças que vão ao sol e à chuva; troca de rotina, sem drama de nozzle." },
        { key: "pa-cf", name: "PA-CF (náilon carbono)", blurb: "Abrasivo: come nozzle de latão — exige o nozzle endurecido, +18 min na ida e +8 na volta." },
        { key: "pla-silk", name: "PLA silk", blurb: "Acabamento espelhado para peças de vitrine; exige purga de cor caprichada, ~5 min a mais." },
      ],
      objective: {
        summary: "Maximizar a margem da semana: imprimir o máximo de pedidos no prazo, gastando o mínimo em trocas de material, multas e terceirizações. O modelo minimiza o custo total — cada real poupado é lucro preservado.",
        terms: {
          setup: "trocas de filamento",
          execution: "impressão",
          tardiness: "envio atrasado",
          rejection: "terceirização",
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
