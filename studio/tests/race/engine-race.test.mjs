import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { evaluateSchedule, parseMasclib } from "../../src/data/instance.js";
import { createRaceEvaluator } from "../../src/race/evaluate.js";
import { applyRaceSnapshot, createEngineRacers, RACE_ROSTER } from "../../src/race/engine-race.js";
import { createSpaceBuilder, layoutSpace, nearestLeaf, spacePlan, spaceY } from "../../src/race/space.js";
import { IG_ENGINE_PAYLOAD } from "../../src/generated/engine-payload.js";
import { IGEngineClient } from "../../src/engine/index.js";
import { LoopbackWorker } from "../engine/harness.mjs";

const rawCatalog = JSON.parse(gunzipSync(Buffer.from(IG_ENGINE_PAYLOAD.catalogGzipBase64, "base64")));
const CLOSURE_TOLERANCE = 0.051;

/** A client whose worker holds one instance, ready to race. */
async function connect(instanceId) {
  const client = new IGEngineClient({ worker: new LoopbackWorker() });
  await client.init({
    wasm: IG_ENGINE_PAYLOAD.wasmBase64,
    catalog: { [instanceId]: rawCatalog[instanceId] },
  });
  await client.selectInstance(instanceId);
  return client;
}

/**
 * Drive a whole race through the real worker protocol, exactly as the page's
 * pump does: one slice in flight, round-robin inside the worker, until every
 * method reports itself done.
 */
async function runRace(instanceId, seed, budget, { slice = 4_096, wantOrders = false } = {}) {
  const instance = parseMasclib(rawCatalog[instanceId].csv, instanceId);
  const evaluator = createRaceEvaluator(instance);
  const client = await connect(instanceId);
  const race = { evaluator, racers: createEngineRacers(evaluator.n), budget, maxEvals: 0, wallClockValid: true };
  const created = await client.raceNew({ seed, budget, d: 2, accept: "current", permute: true });
  assert.equal(created.methods, 6, "the engine must build all six racers");
  let guard = 100_000;
  let slices = 0;
  for (;;) {
    const reply = await client.raceSlice({ slice, wantOrders });
    slices += 1;
    if (applyRaceSnapshot(race, reply)) break;
    assert.ok(guard-- > 0, "race must terminate");
  }
  return { instance, evaluator, race, racers: race.racers, client, slices };
}

/** What a racer is, stripped to the parts a replay must reproduce exactly. */
const ledger = (racer) => [racer.id, racer.evals, racer.bestCost, racer.hist.map((h) => [h.e, h.c])];

test("all six racers finish with a feasible, closure-exact best schedule", async () => {
  const { instance, evaluator, racers, client } = await runRace("STC_NCOS_31", 16, 40_000, { wantOrders: true });
  assert.deepEqual(racers.map((r) => r.id), ["ig", "greedy", "descent", "tabu", "tabudiv", "ama"]);
  for (const r of racers) {
    assert.ok(Number.isFinite(r.bestCost), `${r.id} must find a finite best cost`);
    assert.ok(r.evals > 0, `${r.id} must consume evaluations`);
    assert.ok(r.hist.length > 0, `${r.id} must record improvement history`);
    for (let i = 1; i < r.hist.length; i++) {
      assert.ok(r.hist[i].c < r.hist[i - 1].c, `${r.id} history must be strictly improving`);
      assert.ok(r.hist[i].e >= r.hist[i - 1].e, `${r.id} history evaluations must be monotone`);
    }
    assert.equal(r.hist.at(-1).c, r.bestCost, `${r.id} last trace point must be the reported best`);
    assert.ok(r.bestSol, `${r.id} must snapshot its best solution`);
    assert.equal(
      r.bestSol.order.length + r.bestSol.rejected.length,
      evaluator.n,
      `${r.id} best solution must partition every job`,
    );
    // A cost the Rust engine reports has to survive re-evaluation by the
    // independent JS objective. That is the whole claim of the port.
    const engineOrder = evaluator.toEngineOrder(r.bestSol.order);
    const display = evaluateSchedule(instance, engineOrder);
    assert.ok(display.rows.every((row) => row.feasible), `${r.id} best schedule must be feasible`);
    const delta = Math.abs(display.breakdown.total - r.bestCost);
    assert.ok(delta <= CLOSURE_TOLERANCE, `${r.id}: race ${r.bestCost} vs display ${display.breakdown.total} (Δ ${delta})`);
    // view() always exposes a live solution for the space projection
    const view = r.view();
    assert.ok(view.sol && Array.isArray(view.sol.order), `${r.id} view()`);
  }
  // A constructive never iterates: greedy is done after one construction pass.
  assert.ok(racers.find((r) => r.id === "greedy").done, "greedy finishes after construction");
  await client.dispose();
});

test("the race is deterministic for a fixed seed", async () => {
  const a = await runRace("NCOS_02", 7, 20_000);
  const b = await runRace("NCOS_02", 7, 20_000);
  const c = await runRace("NCOS_02", 8, 20_000);
  assert.deepEqual(a.racers.map(ledger), b.racers.map(ledger), "same seed must replay exactly");
  assert.notDeepEqual(a.racers.map(ledger), c.racers.map(ledger), "a different seed must be a different race");
  await Promise.all([a.client.dispose(), b.client.dispose(), c.client.dispose()]);
});

test("the slice size is an animation detail, not an input", async () => {
  // The pump adapts its slice toward one round per frame. That is only sound
  // because a racer carries unspent credit across slices, so the ledger, the
  // trace and the final sequence cannot depend on how the budget was handed
  // out. Asserted here at the JS boundary, where the adaptation lives.
  const fine = await runRace("NCOS_02", 21, 20_000, { slice: 64 });
  const coarse = await runRace("NCOS_02", 21, 20_000, { slice: 50_000_000 });
  assert.deepEqual(fine.racers.map(ledger), coarse.racers.map(ledger));
  assert.ok(coarse.slices < fine.slices, "a bigger slice must mean fewer round trips");
  await Promise.all([fine.client.dispose(), coarse.client.dispose()]);
});

test("the roster maps display order onto the engine's method numbering", () => {
  assert.deepEqual(RACE_ROSTER.map((entry) => entry.id), ["ig", "greedy", "descent", "tabu", "tabudiv", "ama"]);
  // `m` is the index engine/src/race/mod.rs gives the method, and the only
  // number that crosses to wasm. Reordering the display must not renumber it.
  assert.deepEqual(RACE_ROSTER.map((entry) => entry.m), [5, 0, 1, 2, 3, 4]);
  assert.equal(new Set(RACE_ROSTER.map((entry) => entry.m)).size, 6);
});

test("a live race owns the worker, and says so", async () => {
  const client = await connect("NCOS_02");
  await client.raceNew({ seed: 3, budget: 20_000, d: 2, accept: "current", permute: true });
  // The wall-clock column may only be shown when nothing else touched this
  // thread between two race_step calls, so a solve is refused, not queued.
  await assert.rejects(() => client.configure({ seed: 1, iterationBudget: 100 }), /RACE_ACTIVE|race/i);
  await assert.rejects(() => client.start(), /RACE_ACTIVE|race/i);
  const reply = await client.raceSlice({ slice: 1_024 });
  assert.ok(reply.methods.every((method) => method.ms >= 0), "every method reports wall clock");
  const cleared = await client.raceClear();
  assert.equal(cleared.cleared, true);
  // Refusals are counted: the page hides the time column if this is not zero.
  assert.equal(cleared.intrusions, 2, "a refused solve command is still a foreign command");
  // With the race gone the worker takes solve commands again.
  await client.configure({ seed: 1, iterationBudget: 100, checkpointEvery: 10 });
  await client.dispose();
});

test("a clean race reports no intrusions", async () => {
  const { race, client } = await runRace("NCOS_02", 11, 15_000);
  assert.equal(race.wallClockValid, true, "nothing else may share the worker during a race");
  await client.dispose();
});

test("order blocks are only paid for when the page asks for them", async () => {
  const client = await connect("NCOS_02");
  await client.raceNew({ seed: 5, budget: 20_000, d: 2, accept: "current", permute: true });
  const quiet = await client.raceSlice({ slice: 4_096, wantOrders: false });
  assert.ok(quiet.orders.every((order) => order === null), "no incumbent blocks without wantOrders");
  const loud = await client.raceSlice({ slice: 4_096, wantOrders: true });
  assert.ok(loud.orders.some((order) => order && order.length), "wantOrders delivers incumbents");
  // Best orders always travel on the slice where they changed, because the
  // changed flag is cleared by the very snapshot that reveals it.
  assert.ok(
    [quiet, loud].some((reply) => reply.best.some((order) => order && order.length)),
    "improvements deliver their best sequence",
  );
  await client.dispose();
});

test("a 500-job race still progresses without the solution-space tree", async () => {
  const id = "NCOS_61"; // 500 jobs: spacePlan() returns null, so wantOrders is off
  assert.equal(spacePlan(500), null);
  const client = await connect(id);
  const instance = parseMasclib(rawCatalog[id].csv, id);
  const evaluator = createRaceEvaluator(instance);
  const race = { evaluator, racers: createEngineRacers(evaluator.n), budget: 400_000, maxEvals: 0 };
  await client.raceNew({ seed: 9, budget: race.budget, d: 50, accept: "current", permute: false });
  for (let slice = 0; slice < 60; slice += 1) {
    const reply = await client.raceSlice({ slice: 20_000, wantOrders: false });
    if (applyRaceSnapshot(race, reply)) break;
  }
  for (const methodId of ["descent", "ig"]) {
    const racer = race.racers.find((entry) => entry.id === methodId);
    assert.ok(Number.isFinite(racer.bestCost), `${methodId} reaches a finite cost on 500 jobs`);
  }
  await client.dispose();
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

test("the sampled tree and the raced costs share one y axis", async () => {
  // The tree's leaves are priced by the JS evaluator and the racers by Rust.
  // spaceY() maps both onto the same axis, so a divergence would silently draw
  // the fireflies at the wrong height. This is the check that catches it.
  const { evaluator, racers, client } = await runRace("NCOS_02", 4, 20_000, { wantOrders: true });
  for (const racer of racers) {
    const rust = racer.bestCost;
    const js = evaluator.costOnly(racer.bestSol.order, racer.bestSol.rejected);
    assert.ok(
      Math.abs(js - rust) <= CLOSURE_TOLERANCE,
      `${racer.id}: sampler prices ${js}, engine reports ${rust}`,
    );
  }
  await client.dispose();
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
