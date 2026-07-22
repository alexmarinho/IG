import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { evaluateSchedule, parseMasclib } from "../../src/data/instance.js";
import { createRaceEvaluator } from "../../src/race/evaluate.js";
import { createRaceStrategies } from "../../src/race/strategies.js";
import { createSpaceBuilder, layoutSpace, nearestLeaf, spacePlan, spaceY } from "../../src/race/space.js";
import { IG_ENGINE_PAYLOAD } from "../../src/generated/engine-payload.js";

const rawCatalog = JSON.parse(gunzipSync(Buffer.from(IG_ENGINE_PAYLOAD.catalogGzipBase64, "base64")));
const CLOSURE_TOLERANCE = 0.051;

function runRace(instanceId, seed, budgetPerRacer) {
  const instance = parseMasclib(rawCatalog[instanceId].csv, instanceId);
  const evaluator = createRaceEvaluator(instance);
  const racers = createRaceStrategies({ evaluator, seed });
  let guard = 200_000;
  while (racers.some((r) => !r.done && r.evals < budgetPerRacer) && guard-- > 0) {
    for (const r of racers) {
      if (r.done || r.evals >= budgetPerRacer) continue;
      r.step(Math.min(500, budgetPerRacer - r.evals));
    }
  }
  assert.ok(guard > 0, "race must terminate");
  return { instance, evaluator, racers };
}

test("all six racers finish with a feasible, closure-exact best schedule", () => {
  const { instance, evaluator, racers } = runRace("STC_NCOS_31", 16, 40_000);
  assert.deepEqual(racers.map((r) => r.id), ["ig", "greedy", "descent", "tabu", "tabudiv", "ama"]);
  for (const r of racers) {
    assert.ok(Number.isFinite(r.bestCost), `${r.id} must find a finite best cost`);
    assert.ok(r.evals > 0, `${r.id} must consume evaluations`);
    assert.ok(r.hist.length > 0, `${r.id} must record improvement history`);
    for (let i = 1; i < r.hist.length; i++) {
      assert.ok(r.hist[i].c < r.hist[i - 1].c, `${r.id} history must be strictly improving`);
      assert.ok(r.hist[i].e >= r.hist[i - 1].e, `${r.id} history evaluations must be monotone`);
    }
    assert.ok(r.bestSol, `${r.id} must snapshot its best solution`);
    // The racer-facing best cost must close against the trusted JS evaluator.
    const engineOrder = evaluator.toEngineOrder(r.bestSol.order);
    const display = evaluateSchedule(instance, engineOrder);
    assert.ok(display.rows.every((row) => row.feasible), `${r.id} best schedule must be feasible`);
    const delta = Math.abs(display.breakdown.total - r.bestCost);
    assert.ok(delta <= CLOSURE_TOLERANCE, `${r.id}: race ${r.bestCost} vs display ${display.breakdown.total} (Δ ${delta})`);
    // view() always exposes a live solution for the space projection
    const view = r.view();
    assert.ok(view.sol && Array.isArray(view.sol.order), `${r.id} view()`);
  }
  // A constructive never iterates: greedy is done, and no method is worse than +∞.
  assert.ok(racers.find((r) => r.id === "greedy").done, "greedy finishes after construction");
});

test("the race is deterministic for a fixed seed", () => {
  const a = runRace("NCOS_02", 7, 20_000);
  const b = runRace("NCOS_02", 7, 20_000);
  assert.deepEqual(a.racers.map((r) => [r.id, r.bestCost, r.evals]), b.racers.map((r) => [r.id, r.bestCost, r.evals]));
});

test("space builder samples, clusters and projects the solution space", () => {
  const instance = parseMasclib(rawCatalog["NCOS_02"].csv, "NCOS_02");
  const evaluator = createRaceEvaluator(instance);
  const builder = createSpaceBuilder(evaluator, 42);
  assert.ok(builder.supported);
  let guard = 10_000;
  while (!builder.step() && guard-- > 0) { /* chunked sampling */ }
  assert.ok(builder.done && guard > 0);
  const plan = spacePlan(instance.n);
  assert.equal(builder.space.clusters.length, plan.seeds);
  assert.ok(builder.space.leaves.length > plan.seeds, "each cluster contributes leaves");
  const ranks = builder.space.clusters.map((cl) => cl.rank).sort((x, y) => x - y);
  assert.deepEqual(ranks, [...Array(plan.seeds).keys()]);
  const best = builder.space.bestLeaf;
  assert.ok(best && Number.isFinite(best.cost));
  assert.ok(builder.space.leaves.every((lf) => lf.cost >= best.cost), "golden leaf is the best sample");
  for (const lf of builder.space.leaves) {
    const display = evaluateSchedule(instance, evaluator.toEngineOrder(lf.order));
    assert.ok(Math.abs(display.breakdown.total - lf.cost) <= CLOSURE_TOLERANCE, "leaf cost parity");
  }
  layoutSpace(builder.space, 800, 440, 42);
  for (const lf of builder.space.leaves) {
    assert.ok(Number.isFinite(lf.x) && Number.isFinite(lf.y));
    assert.ok(lf.x >= 0 && lf.x <= 800 && lf.y >= 0 && lf.y <= 440);
  }
  const hit = nearestLeaf(builder.space, best.vec);
  assert.equal(hit, best, "a leaf's own feature vector resolves to itself");
  assert.ok(spaceY(builder.space, best.cost, 440) < spaceY(builder.space, builder.space.yHi, 440));
});

test("large instances bound the neighborhood scan per call", () => {
  const instance = parseMasclib(rawCatalog["NCOS_61"].csv, "NCOS_61"); // 500 jobs
  const evaluator = createRaceEvaluator(instance);
  const racers = createRaceStrategies({ evaluator, seed: 9 });
  const descent = racers.find((r) => r.id === "descent");
  const t0 = Date.now();
  for (let frame = 0; frame < 30; frame++) {
    if (!descent.done && descent.evals < 100_000) descent.step(15);
  }
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 4_000, `descent on 500 jobs must not block (${elapsed}ms)`);
  assert.ok(Number.isFinite(descent.bestCost), "descent still improves on huge instances");
  const ig = racers.find((r) => r.id === "ig");
  for (let frame = 0; frame < 30; frame++) {
    if (!ig.done && ig.evals < 100_000) ig.step(15);
  }
  assert.ok(Number.isFinite(ig.bestCost), "IG reaches a finite cost on 500 jobs");
});

test("space builder degrades gracefully by instance size", () => {
  assert.equal(spacePlan(500), null);
  const reduced = spacePlan(300);
  assert.ok(reduced.seeds * reduced.kids < spacePlan(60).seeds * spacePlan(60).kids);
  const instance = parseMasclib(rawCatalog["NCOS_61"].csv, "NCOS_61");
  const builder = createSpaceBuilder(createRaceEvaluator(instance), 1);
  assert.equal(builder.supported, false);
  assert.equal(builder.step(), true);
  assert.equal(builder.progress, 1);
});
