import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPLORER_COLUMNS,
  NEW_SCENARIO_IDS,
  SCENARIO_ORDER,
  TIER_META,
  deltaChips,
  formatDayTime,
  formatTimeSpan,
  humanizeMinutes,
  miniBarsSvg,
  orderCode,
  orderedScenarioIds,
  sortJobs,
  tierOf,
} from "../../src/levels.js";
import { SCENARIO_CATALOG, SCENARIO_TIME_SCALES } from "../../src/data/catalog.js";
import { INSTANCE_STATS } from "../../src/generated/instance-stats.js";

test("level order is fixed and every catalog scenario is covered", () => {
  assert.deepEqual(SCENARIO_ORDER, ["factory", "print3d", "coffee", "brewery"]);
  assert.equal(SCENARIO_ORDER.length, 4);
  assert.deepEqual(NEW_SCENARIO_IDS, ["print3d", "coffee", "brewery"]);
  for (const id of NEW_SCENARIO_IDS) assert.ok(SCENARIO_ORDER.includes(id), id);
  const ordered = orderedScenarioIds(SCENARIO_CATALOG.map(({ id }) => id));
  assert.deepEqual(ordered, [...SCENARIO_ORDER]);
});

test("orderedScenarioIds never drops catalog entries unknown to the fixed order", () => {
  assert.deepEqual(orderedScenarioIds(["mystery", "coffee", "factory"]), ["factory", "coffee", "mystery"]);
});

test("every scenario has precomputed stats for its default instance", () => {
  for (const scenario of SCENARIO_CATALOG) {
    const stats = INSTANCE_STATS[scenario.recommendedDefaultInstance];
    assert.ok(stats, scenario.id);
    assert.equal(Array.isArray(stats.procBins), true, scenario.id);
    assert.equal(stats.procBins.length, 8, scenario.id);
    assert.ok(stats.n > 0 && stats.families > 0 && stats.horizon > 0, scenario.id);
  }
});

test("tierOf reads S/M/L from the name and falls back to job count", () => {
  assert.equal(tierOf("COFFEE_S_45", 45), "S");
  assert.equal(tierOf("DENTAL_M_90", 90), "M");
  assert.equal(tierOf("BREWERY_L_180", 180), "L");
  assert.equal(tierOf("3DPRINT_FARM_45", 45), "S");
  assert.equal(tierOf("3DPRINT_FARM_180", 180), "L");
  assert.equal(tierOf("NCOS_01", 8), "S");
  assert.equal(tierOf("NCOS_61", 500), "L");
  assert.equal(tierOf("KITCHEN_SERVICE_120", 120), "M");
  assert.equal(tierOf("GPU_HEAVY_120", 120), "M");
  assert.deepEqual(Object.keys(TIER_META), ["S", "M", "L"]);
});

test("formatTimeSpan humanizes minutes, hours and days", () => {
  const dayLabel = { one: "dia", many: "dias" };
  assert.equal(formatTimeSpan(45, { dayLabel }), "45 min");
  assert.equal(formatTimeSpan(570, { dayLabel }), "9h 30m");
  assert.equal(formatTimeSpan(120, { dayLabel }), "2h");
  assert.equal(formatTimeSpan(8288, { dayLabel }), "6 dias");
  assert.equal(formatTimeSpan(2880, { dayLabel }), "2 dias");
  assert.equal(formatTimeSpan(Number.NaN, { dayLabel }), "—");
  const numbered = formatTimeSpan(1_495_045, {
    dayLabel: { one: "day", many: "days" },
    formatNumber: (value) => new Intl.NumberFormat("en").format(value),
  });
  assert.equal(numbered, "1,038 days");
});

test("formatTimeSpan honors per-scenario day lengths", () => {
  for (const scale of Object.values(SCENARIO_TIME_SCALES)) {
    assert.equal(scale.unit, "minute");
    assert.ok(scale.dayLength >= 1);
    assert.equal(typeof scale.dayLabel, "string");
  }
  const span = formatTimeSpan(3 * 1440, {
    dayLength: SCENARIO_TIME_SCALES.coffee.dayLength,
    dayLabel: { one: "day", many: "days" },
  });
  assert.equal(span, "6 days"); // 4320 min = six 12-hour roasting days
});

test("miniBarsSvg renders eight inline bars without canvas", () => {
  const svg = miniBarsSvg([1, 4, 0, 0, 0, 0, 1, 2], { label: "Processing time" });
  assert.match(svg, /^<svg class="mini-bars"/);
  assert.equal((svg.match(/<rect /g) || []).length, 8);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="Processing time"/);
  assert.equal((svg.match(/class="is-empty"/g) || []).length, 4);
  assert.match(miniBarsSvg([1, 2], {}), /aria-hidden="true"/);
});

test("deltaChips compares two stat lines with signed, neutral chips", () => {
  const current = INSTANCE_STATS["3DPRINT_FARM_180"];
  const previous = INSTANCE_STATS["SURGERY_BLOCK_90"];
  const chips = deltaChips(current, previous, {
    formatNumber: (value) => new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value),
    formatSpan: (minutes) => formatTimeSpan(minutes, { dayLabel: { one: "day", many: "days" } }),
    jobsLabel: "jobs",
    familiesLabel: "families",
    pointsSuffix: "pp",
  });
  assert.deepEqual(chips.map(({ key }) => key), ["n", "families", "horizon", "setupMean", "rejRatio", "loadRatio", "tightPct"]);
  const byKey = Object.fromEntries(chips.map((chip) => [chip.key, chip]));
  assert.equal(byKey.n.text, `+${current.n - previous.n} jobs`);
  assert.equal(byKey.n.direction, "up");
  assert.equal(byKey.families.text, "−1 families");
  assert.equal(byKey.families.direction, "down");
  assert.equal(byKey.horizon.text, "+11 days"); // 23 040 − 7 200 min over 1440-min days
  assert.equal(byKey.setupMean.text, "−21 min");
  assert.equal(byKey.setupMean.direction, "down");
  assert.match(byKey.rejRatio.text, /×$/);
  assert.match(byKey.loadRatio.text, /%$/);
  assert.match(byKey.tightPct.text, / pp$/);
});

test("deltaChips reports flat chips and rejects missing inputs", () => {
  const stats = INSTANCE_STATS["COFFEE_M_90"];
  const chips = deltaChips(stats, { ...stats });
  assert.ok(chips.every((chip) => chip.direction === "flat"));
  assert.equal(chips[0].text, "±0 jobs");
  assert.deepEqual(deltaChips(null, stats), []);
  assert.deepEqual(deltaChips(stats, null), []);
});

test("orderCode maps domain ids through the order spec and keeps factory J labels", () => {
  assert.equal(orderCode({ prefix: "ORD-", offset: 1001 }, 0), "ORD-1001");
  assert.equal(orderCode({ prefix: "ORD-", offset: 1001 }, 43), "ORD-1044");
  assert.equal(orderCode({ prefix: "LOTE-", offset: 101 }, 4), "LOTE-105");
  assert.equal(orderCode(undefined, 0), "J01");
  assert.equal(orderCode(null, 6), "J07");
  assert.equal(orderCode({}, 12), "J13");
});

test("sortJobs orders by each explorer column with stable id tiebreaks", () => {
  const jobs = [
    { id: 0, family: 1, processingTime: 30, releaseTime: 10, due: 50, hardDeadline: 90, weight: 2, processingCost: 5, rejectionCost: 40 },
    { id: 1, family: 0, processingTime: 30, releaseTime: 0, due: 40, hardDeadline: Number.POSITIVE_INFINITY, weight: 1, processingCost: 8, rejectionCost: 20 },
    { id: 2, family: 1, processingTime: 10, releaseTime: 10, due: 40, hardDeadline: 80, weight: 3, processingCost: 5, rejectionCost: 60 },
  ];
  assert.deepEqual(sortJobs(jobs, "job").map(({ id }) => id), [0, 1, 2]);
  assert.deepEqual(sortJobs(jobs, "job", "desc").map(({ id }) => id), [2, 1, 0]);
  assert.deepEqual(sortJobs(jobs, "processingTime").map(({ id }) => id), [2, 0, 1]); // 10, then 30/30 by id
  assert.deepEqual(sortJobs(jobs, "dueDate").map(({ id }) => id), [1, 2, 0]); // 40/40 by id, then 50
  assert.deepEqual(sortJobs(jobs, "dueDate", "desc").map(({ id }) => id), [0, 1, 2]);
  // Missing hard deadlines sink to the bottom in both directions.
  assert.deepEqual(sortJobs(jobs, "hardDeadline").map(({ id }) => id), [2, 0, 1]);
  assert.deepEqual(sortJobs(jobs, "hardDeadline", "desc").map(({ id }) => id), [0, 2, 1]);
  assert.deepEqual(sortJobs(jobs, "family").map(({ id }) => id), [1, 0, 2]);
  assert.deepEqual(sortJobs(jobs, "tardinessWeight", "desc").map(({ id }) => id), [2, 0, 1]);
  assert.deepEqual(sortJobs(jobs, "executionCost", "desc").map(({ id }) => id), [1, 0, 2]);
  assert.deepEqual(sortJobs(jobs, "rejectionCost").map(({ id }) => id), [1, 0, 2]);
  assert.deepEqual(sortJobs(jobs, "unknown-column").map(({ id }) => id), [0, 1, 2]);
  assert.equal(EXPLORER_COLUMNS.length, 9);
});

test("formatDayTime renders the scenario calendar as day plus clock", () => {
  assert.deepEqual(formatDayTime(0, { dayLength: 720, dayWord: "dia" }), { day: 1, clock: "00:00", text: "dia 1, 00:00" });
  assert.equal(formatDayTime(990, { dayLength: 720, dayWord: "dia" }).text, "dia 2, 04:30");
  assert.equal(formatDayTime(1440, { dayLength: 1440 }).text, "day 2, 00:00");
  assert.equal(formatDayTime(75, { dayLength: 1440, dayWord: "day" }).text, "day 1, 01:15");
  assert.equal(formatDayTime(Number.NaN), "—");
});

test("humanizeMinutes keeps minutes under an hour and switches to hours above", () => {
  assert.equal(humanizeMinutes(18), "18 min");
  assert.equal(humanizeMinutes(59), "59 min");
  assert.equal(humanizeMinutes(60), "1 h");
  assert.equal(humanizeMinutes(150, { formatNumber: (value) => new Intl.NumberFormat("pt-BR").format(value) }), "2,5 h");
  assert.equal(humanizeMinutes(166), "2.8 h");
  assert.equal(humanizeMinutes(Number.NaN), "—");
});
