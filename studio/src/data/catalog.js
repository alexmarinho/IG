/**
 * Fixed instance and scenario metadata for IG Studio.
 *
 * This module deliberately contains no parser, generated workload, or mutable
 * application state. Scenario lenses preserve the same single-machine model;
 * manufacturing benchmarks and fixed seeded domain workloads remain distinct
 * data sources. The engine is the source of every result shown by the UI.
 */

import { PRINT_DOMAIN_ROWS, print3dScenario } from "./print3d-scenario.js";
import { BUSINESS_DOMAIN_ROWS, businessScenarios } from "./business-scenarios.js";
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
  ...BUSINESS_DOMAIN_ROWS,
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

/** All 44 MaScLib benchmarks and 18 fixed seeded domain workloads across 6 domains. */
export const INSTANCE_CATALOG = deepFreeze([...mascInstances, ...gpuInstances, ...domainInstances]);

export const INSTANCE_BY_ID = deepFreeze(
  Object.fromEntries(INSTANCE_CATALOG.map((instance) => [instance.id, instance])),
);

const factoryMappings = mascInstances.map(({ id }) => ({ instanceId: id }));

const factoryScenario = {
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
      vocabularyUnits: {
        resource: "",
        job: "",
        family: "",
        processingTime: "min",
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
        resource: "The benchmark's CNC machining center: one machine, one part at a time. Every MaScLib instance shares this single-machine model.",
        job: "A part order from the benchmark, with tool family, machining time and promised date set in the original file.",
        family: "The part's tool-and-fixture group. In STC instances, changing family costs a sequence-dependent setup that comes from the paper's original matrix.",
        processingTime: "Machine minutes the part occupies — a fixed value per order, as recorded in the instance file.",
        releaseTime: "When the part's material becomes available, in horizon days. Before that, the part cannot enter the machine.",
        dueDate: "The order's promised delivery. Producing past it accrues the proportional late penalty.",
        hardDeadline: "The latest feasible completion: the promise plus some slack, bounded by the horizon end. Beyond it the order is not worth producing.",
        setupTime: "Idle machine minutes to swap tool, fixture and program between families. In STC instances it depends on the from-to pair; classic NCOS instances have no setups.",
        setupCost: "The changeover cost in the benchmark's R$: machine downtime plus preparation.",
        executionCost: "The cost of machining the part in the benchmark's R$, proportional to machine time.",
        tardinessWeight: "The benchmark penalty per day of late delivery. The file stores the value per time unit; the app shows it per day (1440-minute day).",
        rejectionCost: "The cost of passing the part to a qualified supplier, in the instance's R$. The optimizer compares it with producing late.",
      },
      familyNames: [
        { key: "family-1", name: "Family 1", blurb: "Setup family 1 of the benchmark — changeover costs come from the instance's original matrix." },
        { key: "family-2", name: "Family 2", blurb: "Setup family 2 of the benchmark — different instances bring different family counts." },
        { key: "family-3", name: "Family 3", blurb: "Setup family 3 of the benchmark — in STC instances the swap depends on the previous family." },
        { key: "family-4", name: "Family 4", blurb: "Setup family 4 of the benchmark — names and counts are synthetic, from the paper's generator." },
        { key: "family-5", name: "Family 5", blurb: "Setup family 5 of the benchmark — values exist to compare algorithms, not to describe a real factory." },
        { key: "family-6", name: "Family 6", blurb: "Setup family 6 of the benchmark — some instances reach ten setup families." },
      ],
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
      vocabularyUnits: {
        resource: "",
        job: "",
        family: "",
        processingTime: "min",
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
        resource: "O centro de usinagem CNC do benchmark: uma máquina, uma peça por vez. Todas as instâncias MaScLib compartilham esse modelo de máquina única.",
        job: "Um pedido de peça do benchmark, com família de ferramenta, tempo de usinagem e data prometida definidos no arquivo original.",
        family: "O grupo de ferramenta e fixação da peça. Nas instâncias STC, trocar de família custa um setup dependente da sequência, vindo da matriz original do artigo.",
        processingTime: "Minutos de máquina que a peça ocupa — um valor fixo por pedido, registrado no arquivo da instância.",
        releaseTime: "Quando o material da peça fica disponível, em dias do horizonte. Antes disso a peça não pode entrar na máquina.",
        dueDate: "A entrega prometida do pedido. Produzir além dela acumula a multa proporcional ao atraso.",
        hardDeadline: "A conclusão máxima viável: a promessa mais uma folga, limitada ao fim do horizonte. Além dela o pedido não compensa produzir.",
        setupTime: "Minutos de máquina parada para trocar ferramenta, fixação e programa entre famílias. Nas instâncias STC depende do par origem-destino; nas NCOS clássicas não há setup.",
        setupCost: "O custo da troca de configuração em R$ do benchmark: máquina parada mais preparação.",
        executionCost: "O custo de usinar a peça em R$ do benchmark, proporcional ao tempo de máquina.",
        tardinessWeight: "A multa do benchmark por dia de atraso na entrega. No arquivo o valor vem por unidade de tempo; o app mostra por dia (dia de 1440 min).",
        rejectionCost: "O custo de passar a peça para um fornecedor qualificado, em R$ da instância. O otimizador compara com produzir atrasado.",
      },
      familyNames: [
        { key: "family-1", name: "Família 1", blurb: "Família de setup 1 do benchmark — os custos de troca vêm da matriz original da instância." },
        { key: "family-2", name: "Família 2", blurb: "Família de setup 2 do benchmark — instâncias diferentes trazem contagens diferentes de famílias." },
        { key: "family-3", name: "Família 3", blurb: "Família de setup 3 do benchmark — nas instâncias STC, a troca depende da família anterior." },
        { key: "family-4", name: "Família 4", blurb: "Família de setup 4 do benchmark — nomes e quantidades são sintéticos, do gerador do artigo." },
        { key: "family-5", name: "Família 5", blurb: "Família de setup 5 do benchmark — os valores servem para comparar algoritmos, não descrevem uma fábrica real." },
        { key: "family-6", name: "Família 6", blurb: "Família de setup 6 do benchmark — algumas instâncias chegam a dez famílias de setup." },
      ],
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
};

const scenarios = [factoryScenario, print3dScenario, ...businessScenarios];

export const SCENARIO_CATALOG = deepFreeze(scenarios);

export const SCENARIO_BY_ID = deepFreeze(
  Object.fromEntries(SCENARIO_CATALOG.map((scenario) => [scenario.id, scenario])),
);

/** Per-scenario time scale for humanized horizons (unit, minutes per day, pt-BR day label). */
export const SCENARIO_TIME_SCALES = deepFreeze({
  factory: { unit: "minute", dayLength: 1440, dayLabel: "dia de produção" },
  print3d: { unit: "minute", dayLength: 1440, dayLabel: "dia de impressão" },
  coffee: { unit: "minute", dayLength: 720, dayLabel: "dia de torra" },
  brewery: { unit: "minute", dayLength: 1440, dayLabel: "dia de brassagem" },
});

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
