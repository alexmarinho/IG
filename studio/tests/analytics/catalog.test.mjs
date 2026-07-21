import test from "node:test";
import assert from "node:assert/strict";

import {
  INSTANCE_BY_ID,
  INSTANCE_CATALOG,
  SCENARIO_CATALOG,
  SUPPORTED_LOCALES,
  getInstance,
  getLocalizedScenario,
  getScenario,
  listScenarioInstances,
  normalizeLocale,
} from "../../src/data/catalog.js";

const REMOVED_SCENARIO_IDS = ["ai", "kitchen", "surgery", "bakery", "dental", "laser", "laundry", "studio", "lab"];
const VOCABULARY_KEYS = [
  "resource", "job", "family", "processingTime", "releaseTime", "dueDate",
  "hardDeadline", "setupTime", "setupCost", "executionCost", "tardinessWeight", "rejectionCost",
];

function shapeOf(value) {
  if (Array.isArray(value)) {
    return { type: "array", length: value.length, items: value.map(shapeOf) };
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, shapeOf(value[key])]),
    );
  }
  return typeof value;
}

test("catalog contains the complete fixed bundled inventory", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["en", "pt-BR"]);
  assert.equal(INSTANCE_CATALOG.length, 62);
  assert.equal(INSTANCE_CATALOG.filter(({ dataset }) => dataset === "masclib").length, 44);
  assert.equal(INSTANCE_CATALOG.filter(({ dataset }) => dataset === "gpu").length, 3);
  for (const dataset of ["kitchen", "surgery", "print3d", "coffee", "brewery"]) {
    assert.equal(INSTANCE_CATALOG.filter((entry) => entry.dataset === dataset).length, 3, dataset);
  }
  assert.equal(Object.keys(INSTANCE_BY_ID).length, INSTANCE_CATALOG.length);
  assert.equal(getInstance("STC_NCOS_31").referenceBest, 6615);
  assert.equal(getInstance("GPU_RUSH_60").jobCount, 60);
  assert.equal(getInstance("missing"), null);
});

test("four lenses have valid, fixed mappings and recommended defaults", () => {
  assert.deepEqual(
    SCENARIO_CATALOG.map(({ id }) => id),
    ["factory", "print3d", "coffee", "brewery"],
  );
  for (const id of REMOVED_SCENARIO_IDS) assert.equal(getScenario(id), null, `${id} must stay removed`);

  for (const scenario of SCENARIO_CATALOG) {
    const mappedIds = scenario.instanceMappings.map(({ instanceId }) => instanceId);
    assert.equal(new Set(mappedIds).size, mappedIds.length, `${scenario.id} duplicates a mapping`);
    assert.ok(mappedIds.includes(scenario.recommendedDefaultInstance));
    for (const id of mappedIds) assert.ok(INSTANCE_BY_ID[id], `${scenario.id} maps unknown ${id}`);
  }

  // Every mapped instance is reachable through exactly one scenario lens.
  const mappedTotal = SCENARIO_CATALOG.reduce((total, scenario) => total + scenario.instanceMappings.length, 0);
  assert.equal(mappedTotal, 53);

  assert.equal(getScenario("factory").instanceMappings.length, 44);
  assert.deepEqual(
    getScenario("print3d").instanceMappings.map(({ instanceId }) => instanceId),
    ["3DPRINT_FARM_45", "3DPRINT_FARM_90", "3DPRINT_FARM_180"],
  );
  assert.deepEqual(
    getScenario("coffee").instanceMappings.map(({ instanceId }) => instanceId),
    ["COFFEE_S_45", "COFFEE_M_90", "COFFEE_L_180"],
  );
  assert.deepEqual(
    getScenario("brewery").instanceMappings.map(({ instanceId }) => instanceId),
    ["BREWERY_S_45", "BREWERY_M_90", "BREWERY_L_180"],
  );
});

test("EN and PT-BR scenario content have structural parity (contract v2)", () => {
  for (const scenario of SCENARIO_CATALOG) {
    assert.deepEqual(
      shapeOf(scenario.content.en),
      shapeOf(scenario.content["pt-BR"]),
      `${scenario.id} locale shape differs`,
    );
    assert.ok(scenario.content.en.decisions.length >= 3, `${scenario.id} decisions`);
    assert.equal(scenario.content.en.simplifications.length, 3);
    for (const locale of ["en", "pt-BR"]) {
      const content = scenario.content[locale];
      assert.deepEqual(Object.keys(content.vocabulary).sort(), [...VOCABULARY_KEYS].sort(), `${scenario.id} ${locale} vocabulary`);
      assert.deepEqual(Object.keys(content.vocabularyUnits).sort(), [...VOCABULARY_KEYS].sort(), `${scenario.id} ${locale} units`);
      assert.deepEqual(Object.keys(content.vocabularyHelp).sort(), [...VOCABULARY_KEYS].sort(), `${scenario.id} ${locale} help`);
      for (const key of VOCABULARY_KEYS) {
        assert.equal(typeof content.vocabularyUnits[key], "string", `${scenario.id} ${locale} unit ${key}`);
        assert.ok(content.vocabularyHelp[key].length > 12, `${scenario.id} ${locale} help ${key}`);
      }
      assert.equal(content.familyNames.length, 6, `${scenario.id} ${locale} familyNames`);
      for (const family of content.familyNames) {
        assert.ok(family.key && family.name && family.blurb, `${scenario.id} ${locale} family entry`);
      }
    }
    assert.deepEqual(
      Object.keys(scenario.content.en.objective.terms).sort(),
      ["execution", "rejection", "setup", "tardiness"],
    );
  }
});

test("order-id specs exist for the domain lenses and stay absent for the factory", () => {
  assert.equal(getScenario("factory").orderId, undefined);
  assert.deepEqual(getScenario("print3d").orderId, { prefix: "ORD-", offset: 1001 });
  assert.deepEqual(getScenario("coffee").orderId, { prefix: "PED-", offset: 2401 });
  assert.deepEqual(getScenario("brewery").orderId, { prefix: "LOTE-", offset: 101 });
});

test("scenario lenses state their data relationship honestly in both languages", () => {
  const factory = getScenario("factory");
  assert.equal(factory.datasetRelationship, "native-benchmark-domain");
  assert.match(factory.content.en.disclosure, /MaScLib manufacturing benchmark/i);
  assert.match(factory.content.en.disclosure, /not live production data/i);
  assert.match(factory.content["pt-BR"].disclosure, /benchmark industrial MaScLib/i);
  assert.match(factory.content["pt-BR"].disclosure, /não dados de produção em tempo real/i);

  const seeded = [
    ["print3d", /not orders from a real business/i, /não são pedidos de um negócio real/i],
    ["coffee", /not orders from a real roastery/i, /não são pedidos de uma torrefação real/i],
    ["brewery", /not batches from a real brewery/i, /não são bateladas de uma cervejaria real/i],
  ];
  for (const [id, enPattern, ptPattern] of seeded) {
    const scenario = getScenario(id);
    assert.equal(scenario.datasetRelationship, "native-seeded-domain-workload", id);
    assert.match(scenario.content.en.disclosure, /reproducible seeded workloads/i, id);
    assert.match(scenario.content.en.disclosure, enPattern, id);
    assert.match(scenario.content["pt-BR"].disclosure, /cargas reproduzíveis geradas com seeds/i, id);
    assert.match(scenario.content["pt-BR"].disclosure, ptPattern, id);
  }
});

test("localized selectors preserve mappings and support the legacy pt locale", () => {
  assert.equal(normalizeLocale("pt"), "pt-BR");
  assert.equal(normalizeLocale("pt-BR"), "pt-BR");
  assert.equal(normalizeLocale("fr"), "en");

  const coffee = getLocalizedScenario("coffee", "pt");
  assert.equal(coffee.locale, "pt-BR");
  assert.equal(coffee.name, "Torrefação de café");
  assert.ok(Object.isFrozen(coffee));

  const instances = listScenarioInstances("coffee", "pt-BR");
  assert.equal(instances.length, 3);
  assert.equal(instances.filter(({ recommended }) => recommended).length, 1);
  assert.equal(instances[0].interpretation.label, "Plano de torra de dois dias");
  assert.equal(instances[1].runDefaults.singleBudget, 640_000);
  assert.deepEqual(listScenarioInstances("missing"), []);
  assert.equal(getLocalizedScenario("missing"), null);
});
