#!/usr/bin/env node
/**
 * Rank bundled MaScLib cases by the analytical richness of real IG results.
 *
 * This is a read-only release aid for choosing a public-master example. It
 * always reprices the returned order with the independent Studio evaluator.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSchedule, parseMasclib } from '../../studio/src/data/instance.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const iterations = Number(process.env.IG_AUDIT_ITERATIONS || 2500);
const seedCount = Number(process.env.IG_AUDIT_SEEDS || 3);
const wasm = await readFile(path.join(
  root,
  'engine/target/wasm32-unknown-unknown/release/ig_core.wasm',
));
const loaded = await WebAssembly.instantiate(wasm, {});
const api = loaded.instance.exports;
const filter = process.env.IG_AUDIT_FILTER || '';
const names = (await readdir(path.join(root, 'masclib')))
  .filter((name) => name.endsWith('.csv'))
  .map((name) => name.slice(0, -4))
  .filter((name) => !filter || name.includes(filter))
  .sort();

function readOrder(runId) {
  const length = Number(api.run_best_len(runId));
  const pointer = api.wasm_alloc(length * Uint32Array.BYTES_PER_ELEMENT);
  api.run_best_write(runId, pointer);
  return Array.from(new Uint32Array(api.memory.buffer, pointer, length));
}

const rows = [];
for (const name of names) {
  const csv = await readFile(path.join(root, 'masclib', `${name}.csv`), 'utf8');
  const encoded = new TextEncoder().encode(csv);
  const pointer = api.wasm_alloc(encoded.length);
  new Uint8Array(api.memory.buffer, pointer, encoded.length).set(encoded);
  const instanceId = Number(api.inst_load(pointer, encoded.length));
  const model = parseMasclib(csv, name);
  let best = null;
  for (let seed = 1; seed <= seedCount; seed += 1) {
    api.runs_clear();
    const d = model.jobs.length >= 500 ? 50 : 2;
    const permute = model.jobs.length < 500 ? 1 : 0;
    const runId = Number(api.run_new(instanceId, d, 0, permute, seed));
    api.run_step(runId, iterations);
    const reported = Number(api.run_best_cost(runId));
    const evaluation = evaluateSchedule(model, readOrder(runId));
    if (Math.abs(reported - evaluation.breakdown.total) > 1e-7) {
      throw new Error(`${name}, seed ${seed}: independent evaluator mismatch.`);
    }
    if (!best || reported < best.bestCost) best = { seed, bestCost: reported, evaluation };
  }
  const nonZeroComponents = ['setup', 'execution', 'tardiness', 'rejection']
    .filter((key) => best.evaluation.breakdown[key] > 0).length;
  rows.push({
    instance: name,
    jobs: model.jobs.length,
    families: model.familyIds.length,
    seed: best.seed,
    cost: best.bestCost,
    scheduled: best.evaluation.rows.length,
    rejected: best.evaluation.rejected.length,
    nonZeroComponents,
    ...best.evaluation.breakdown,
  });
}

rows.sort((left, right) => (
  right.nonZeroComponents - left.nonZeroComponents
  || Number(right.rejected > 0) - Number(left.rejected > 0)
  || right.jobs - left.jobs
  || left.instance.localeCompare(right.instance)
));
console.table(rows);
