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
  assert.equal(INSTANCE_CATALOG.length, 53);
  assert.equal(INSTANCE_CATALOG.filter(({ dataset }) => dataset === "masclib").length, 44);
  assert.equal(INSTANCE_CATALOG.filter(({ dataset }) => dataset === "gpu").length, 3);
  assert.equal(INSTANCE_CATALOG.filter(({ dataset }) => dataset === "kitchen").length, 3);
  assert.equal(INSTANCE_CATALOG.filter(({ dataset }) => dataset === "surgery").length, 3);
  assert.equal(Object.keys(INSTANCE_BY_ID).length, INSTANCE_CATALOG.length);
  assert.equal(getInstance("STC_NCOS_31").referenceBest, 6615);
  assert.equal(getInstance("GPU_RUSH_60").jobCount, 60);
  assert.equal(getInstance("missing"), null);
});

test("all four lenses have valid, fixed mappings and recommended defaults", () => {
  assert.deepEqual(
    SCENARIO_CATALOG.map(({ id }) => id),
    ["factory", "ai", "kitchen", "surgery"],
  );

  for (const scenario of SCENARIO_CATALOG) {
    const mappedIds = scenario.instanceMappings.map(({ instanceId }) => instanceId);
    assert.equal(new Set(mappedIds).size, mappedIds.length, `${scenario.id} duplicates a mapping`);
    assert.ok(mappedIds.includes(scenario.recommendedDefaultInstance));
    for (const id of mappedIds) assert.ok(INSTANCE_BY_ID[id], `${scenario.id} maps unknown ${id}`);
  }

  assert.equal(getScenario("factory").instanceMappings.length, 44);
  assert.deepEqual(
    getScenario("ai").instanceMappings.map(({ instanceId }) => instanceId),
    ["GPU_CALM_40", "GPU_RUSH_60", "GPU_HEAVY_120"],
  );
  assert.deepEqual(
    getScenario("kitchen").instanceMappings.map(({ instanceId }) => instanceId),
    ["KITCHEN_SERVICE_60", "KITCHEN_SERVICE_120", "KITCHEN_SERVICE_240"],
  );
  assert.deepEqual(
    getScenario("surgery").instanceMappings.map(({ instanceId }) => instanceId),
    ["SURGERY_BLOCK_40", "SURGERY_BLOCK_90", "SURGERY_BLOCK_180"],
  );
});

test("EN and PT-BR scenario content have structural parity", () => {
  for (const scenario of SCENARIO_CATALOG) {
    assert.deepEqual(
      shapeOf(scenario.content.en),
      shapeOf(scenario.content["pt-BR"]),
      `${scenario.id} locale shape differs`,
    );
    assert.equal(scenario.content.en.decisions.length, 3);
    assert.equal(scenario.content.en.simplifications.length, 3);
    assert.deepEqual(
      Object.keys(scenario.content.en.vocabulary).sort(),
      Object.keys(scenario.content["pt-BR"].vocabulary).sort(),
    );
    assert.deepEqual(
      Object.keys(scenario.content.en.objective.terms).sort(),
      ["execution", "rejection", "setup", "tardiness"],
    );
  }
});

test("seeded domain lenses state their data relationship honestly in both languages", () => {
  for (const id of ["kitchen", "surgery"]) {
    const scenario = getScenario(id);
    assert.equal(scenario.datasetRelationship, "native-seeded-domain-workload");
    assert.match(scenario.content.en.disclosure, /reproducible synthetic/i);
    assert.match(scenario.content.en.disclosure, /not .* data/i);
    assert.match(scenario.content.en.disclosure, /same single-machine engine/i);
    assert.match(scenario.content["pt-BR"].disclosure, /sintéticos e reproduzíveis/i);
    assert.match(scenario.content["pt-BR"].disclosure, /Não são dados/i);
    assert.match(scenario.content["pt-BR"].disclosure, /mesmo engine de máquina única/i);
  }
});

test("localized selectors preserve mappings and support the legacy pt locale", () => {
  assert.equal(normalizeLocale("pt"), "pt-BR");
  assert.equal(normalizeLocale("pt-BR"), "pt-BR");
  assert.equal(normalizeLocale("fr"), "en");

  const kitchen = getLocalizedScenario("kitchen", "pt");
  assert.equal(kitchen.locale, "pt-BR");
  assert.equal(kitchen.name, "Cozinha de restaurante");
  assert.ok(Object.isFrozen(kitchen));

  const instances = listScenarioInstances("kitchen", "pt-BR");
  assert.equal(instances.length, 3);
  assert.equal(instances.filter(({ recommended }) => recommended).length, 1);
  assert.equal(instances[0].interpretation.label, "Retrato de serviço com 60 pratos");
  assert.equal(instances[1].runDefaults.singleBudget, 30_000);
  assert.deepEqual(listScenarioInstances("missing"), []);
  assert.equal(getLocalizedScenario("missing"), null);
});
