import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSchedule, parseMasclib } from "../../src/data/instance.js";
import { createRaceEvaluator, solFeatures } from "../../src/race/evaluate.js";
import { IG_ENGINE_PAYLOAD } from "../../src/generated/engine-payload.js";
import { IGEngineClient } from "../../src/engine/index.js";
import { LoopbackWorker } from "../engine/harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const rawCatalog = JSON.parse(gunzipSync(Buffer.from(IG_ENGINE_PAYLOAD.catalogGzipBase64, "base64")));

/** Same closure tolerance the app asserts between engine and JS objective. */
const CLOSURE_TOLERANCE = 0.051;

const SAMPLE = [
  "NCOS_01", // tiny benchmark, integer weights
  "STC_NCOS_31", // default instance, sequence-dependent setups
  "GPU_CALM_40", // fractional tardiness weights
  "KITCHEN_SERVICE_60", // tight hard deadlines
  "SURGERY_BLOCK_40", // domain workload
  "NCOS_61", // 500 jobs
];

function greedyOrder(evaluator, rng) {
  const order = [];
  const rejected = evaluator.jobs.map((job) => job.id);
  const pend = rejected.slice();
  for (let i = pend.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1));
    [pend[i], pend[k]] = [pend[k], pend[i]];
  }
  for (const id of pend) {
    const base = evaluator.costOnly(order, rejected);
    const r2 = rejected.filter((job) => job !== id);
    let best = { cost: base, pos: -1 };
    for (let p = 0; p <= order.length; p++) {
      order.splice(p, 0, id);
      const c = evaluator.costOnly(order, r2);
      if (c < best.cost) best = { cost: c, pos: p };
      order.splice(p, 1);
    }
    if (best.pos >= 0) {
      order.splice(best.pos, 0, id);
      rejected.splice(rejected.indexOf(id), 1);
    }
  }
  return { order, rejected };
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test("race evaluator matches evaluateSchedule on the same schedules", () => {
  for (const id of SAMPLE) {
    const instance = parseMasclib(rawCatalog[id].csv, id);
    const evaluator = createRaceEvaluator(instance);
    const rng = lcg(0xC0FFEE + id.length);
    for (let trial = 0; trial < 4; trial++) {
      const { order, rejected } = greedyOrder(evaluator, rng);
      const engineOrder = evaluator.toEngineOrder(order);
      const reference = evaluateSchedule(instance, engineOrder);
      assert.ok(reference.rows.every((row) => row.feasible), `${id} trial ${trial}: greedy order must stay feasible`);
      assert.equal(reference.rejected.length, rejected.length, `${id}: rejected partition size`);
      const race = evaluator.costOnly(order, rejected);
      assert.ok(Number.isFinite(race), `${id} trial ${trial}: feasible order must have finite cost`);
      const delta = Math.abs(race - reference.breakdown.total);
      assert.ok(
        delta <= CLOSURE_TOLERANCE,
        `${id} trial ${trial}: race ${race} vs display ${reference.breakdown.total} (Δ ${delta})`,
      );
    }
  }
});

test("race evaluator rejects hard-deadline violations like the engine", () => {
  const id = "KITCHEN_SERVICE_60";
  const instance = parseMasclib(rawCatalog[id].csv, id);
  const evaluator = createRaceEvaluator(instance);
  const reversed = instance.jobs.map((job) => job.id).reverse();
  const display = evaluateSchedule(instance, reversed);
  assert.ok(display.rows.some((row) => !row.feasible), "fixture order must be infeasible");
  const internal = evaluator.toInternalOrder(reversed);
  assert.equal(
    evaluator.costOnly(internal, []),
    Number.POSITIVE_INFINITY,
    "infeasible schedule must cost +∞ in the race",
  );
});

test("race evaluator keeps every job of an all-rejected solution", () => {
  for (const id of ["NCOS_01", "GPU_CALM_40"]) {
    const instance = parseMasclib(rawCatalog[id].csv, id);
    const evaluator = createRaceEvaluator(instance);
    const rejected = evaluator.jobs.map((job) => job.id);
    const display = evaluateSchedule(instance, []);
    assert.ok(Math.abs(evaluator.costOnly([], rejected) - display.breakdown.total) <= CLOSURE_TOLERANCE, id);
  }
});

test("race evaluator closes against a real WASM engine run", async () => {
  const id = "NCOS_01";
  const wasm = await readFile(path.join(root, "engine", "target", "wasm32-unknown-unknown", "release", "ig_core.wasm"));
  const client = new IGEngineClient({ worker: new LoopbackWorker() });
  await client.init({ wasm, catalog: { [id]: rawCatalog[id] } });
  await client.selectInstance(id);
  await client.configure({ seed: 13, iterationBudget: 200, checkpointEvery: 20, d: 2, accept: "current", permute: true });
  const { result } = await client.runSingle();
  const instance = parseMasclib(rawCatalog[id].csv, id);
  const evaluator = createRaceEvaluator(instance);
  const internal = evaluator.toInternalOrder(result.order);
  const rejected = evaluator.jobs.map((job) => job.id).filter((job) => !internal.includes(job));
  const race = evaluator.costOnly(internal, rejected);
  assert.ok(
    Math.abs(race - result.bestCost) <= CLOSURE_TOLERANCE,
    `race ${race} vs engine ${result.bestCost}`,
  );
  await client.dispose();
});

test("order id mapping round-trips between race and catalog ids", () => {
  const instance = parseMasclib(rawCatalog["STC_NCOS_31"].csv, "STC_NCOS_31");
  const evaluator = createRaceEvaluator(instance);
  const internal = evaluator.jobs.map((job) => job.id).slice(3, 40);
  assert.deepEqual(evaluator.toInternalOrder(evaluator.toEngineOrder(internal)), internal);
  assert.throws(() => evaluator.toInternalOrder([987654]), RangeError);
});

test("solution feature vector maps positions into [0, 1) with a rejected sentinel", () => {
  const vec = solFeatures(5, { order: [2, 4], rejected: [0, 1, 3] });
  assert.equal(vec[2], 0);
  assert.equal(vec[4], 0.5);
  assert.equal(vec[0], 1.25);
  assert.equal(vec[1], 1.25);
  assert.equal(vec[3], 1.25);
});
