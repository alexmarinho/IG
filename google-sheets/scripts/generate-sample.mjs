#!/usr/bin/env node
/** Generate the deterministic, real dashboard example for the public master. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMasclib, evaluateSchedule } from '../../studio/src/data/instance.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const output = process.env.IG_SHEETS_OUTPUT
  ? path.resolve(process.env.IG_SHEETS_OUTPUT)
  : path.join(root, 'google-sheets', 'generated', 'sample-data.json');
const instanceName = process.env.IG_SHEETS_INSTANCE || 'STC_NCOS_32';
const iterationBudget = Number(process.env.IG_SHEETS_ITERATIONS || 2500);
const runCount = Number(process.env.IG_SHEETS_RUNS || 10);
const checkpointCount = 40;
const d = 2;
const accept = 'current';
const permute = true;

const wasm = await readFile(path.join(
  root,
  'engine',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'ig_core.wasm',
));
const csv = await readFile(path.join(root, 'masclib', `${instanceName}.csv`), 'utf8');
const benchmark = JSON.parse(await readFile(path.join(root, 'benchmark.json'), 'utf8'));
const loaded = await WebAssembly.instantiate(wasm, {});
const api = loaded.instance.exports;

const csvBytes = new TextEncoder().encode(csv);
const csvPointer = api.wasm_alloc(csvBytes.length);
new Uint8Array(api.memory.buffer, csvPointer, csvBytes.length).set(csvBytes);
const instanceId = api.inst_load(csvPointer, csvBytes.length);
if (instanceId < 0) throw new Error(`WASM engine rejected ${instanceName}.`);

const model = parseMasclib(csv, instanceName);
const checkpointEvery = Math.max(1, Math.ceil(iterationBudget / checkpointCount));
const runs = [];

function snapshot(runId) {
  return {
    iteration: Number(api.run_iters(runId)),
    evaluations: Number(api.run_evals(runId)),
    bestCost: Number(api.run_best_cost(runId)),
  };
}

function readOrder(runId) {
  const length = Number(api.run_best_len(runId));
  const pointer = api.wasm_alloc(length * Uint32Array.BYTES_PER_ELEMENT);
  api.run_best_write(runId, pointer);
  return Array.from(new Uint32Array(api.memory.buffer, pointer, length));
}

for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
  api.runs_clear();
  const seed = runIndex + 1;
  const startedAt = performance.now();
  const runId = api.run_new(instanceId, d, accept === 'best' ? 1 : 0, permute ? 1 : 0, seed);
  const checkpoints = [snapshot(runId)];
  let lastImprovementIteration = 0;
  for (let iteration = 1; iteration <= iterationBudget; iteration += 1) {
    const improved = Boolean(api.run_step(runId, 1));
    if (improved) lastImprovementIteration = iteration;
    if (iteration % checkpointEvery === 0 || iteration === iterationBudget) {
      checkpoints.push(snapshot(runId));
    }
  }
  const elapsedMs = performance.now() - startedAt;
  const final = snapshot(runId);
  const order = readOrder(runId);
  const evaluation = evaluateSchedule(model, order);
  if (Math.abs(evaluation.breakdown.total - final.bestCost) > 1e-7) {
    throw new Error(`Independent evaluation mismatch for seed ${seed}.`);
  }
  runs.push({
    schemaVersion: 1,
    instance: instanceName,
    seed,
    config: { instance: instanceName, seed, iterationBudget, d, accept, permute, checkpointCount },
    bestCost: final.bestCost,
    iterations: final.iteration,
    evaluations: final.evaluations,
    elapsedMs,
    evaluationsPerSecond: final.evaluations / (elapsedMs / 1000),
    lastImprovementIteration,
    order,
    checkpoints,
    evaluation,
  });
  console.log(JSON.stringify({ seed, cost: final.bestCost, evaluations: final.evaluations, elapsedMs }));
}

runs.sort((left, right) => left.seed - right.seed);
const best = runs.slice().sort((left, right) => left.bestCost - right.bestCost || left.seed - right.seed)[0];
const result = {
  schemaVersion: 1,
  generatedBy: 'canonical ig_core.wasm',
  instance: instanceName,
  referenceBest: benchmark[instanceName] ? benchmark[instanceName][1] : null,
  iterationBudget,
  runCount,
  parameters: { d, accept, permute, checkpointCount },
  runs,
  bestSeed: best.seed,
  bestRun: best,
  instanceModel: {
    name: model.name,
    initialState: model.initialState,
    stateCount: model.stateCount,
    familyIds: model.familyIds,
    familyCount: model.familyCount,
    horizon: model.horizon,
    jobs: model.jobs,
    setupTime: model.setupTime,
    setupCost: model.setupCost,
  },
  engine: {
    implementation: 'Rust WebAssembly',
    wasmBytes: wasm.length,
    fixedPointScale: 10,
  },
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, instanceName, runCount, iterationBudget, bestSeed: best.seed, bestCost: best.bestCost }));
