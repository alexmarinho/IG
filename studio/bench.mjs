// Benchmark driver: measures real solve time per instance × iteration budget.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IGEngineClient } from './src/engine/index.js';
import { IG_ENGINE_PAYLOAD } from './src/generated/engine-payload.js';
import { LoopbackWorker } from './tests/engine/harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasm = Buffer.from(IG_ENGINE_PAYLOAD.wasmBase64, 'base64');

// args: bench.mjs "INSTANCE:budget,INSTANCE:budget" [runs]
const spec = process.argv[2] || 'NCOS_01:1000';
const runsPer = Number(process.argv[3] || 2);

const jobs = spec.split(',').map((s) => {
  const [id, budget] = s.split(':');
  return { id, budget: Number(budget) };
});

async function loadCsv(id) {
  const dirs = ['masclib', 'masclib-gpu', 'masclib-domains'];
  for (const dir of dirs) {
    try { return await readFile(path.join(root, dir, `${id}.csv`), 'utf8'); } catch {}
  }
  throw new Error(`csv not found: ${id}`);
}

const catalog = {};
for (const { id } of jobs) catalog[id] = { csv: await loadCsv(id), metadata: {} };

const worker = new LoopbackWorker();
const client = new IGEngineClient({ worker });
await client.init({ wasm, catalog });

console.log('instance,n,budget,run,ms,best_cost,evaluations');
for (const { id, budget } of jobs) {
  const sel = await client.selectInstance(id);
  const n = sel.instance.n;
  for (let r = 0; r < runsPer; r++) {
    await client.configure({ seed: 1 + r, iterationBudget: budget, checkpointEvery: Math.max(1, Math.floor(budget / 40)), progressIntervalMs: 10000 });
    const t0 = performance.now();
    const completed = await client.runSingle();
    const ms = performance.now() - t0;
    console.log(`${id},${n},${budget},${r + 1},${ms.toFixed(1)},${completed.result.bestCost},${completed.result.evaluations}`);
  }
}
await client.dispose();
