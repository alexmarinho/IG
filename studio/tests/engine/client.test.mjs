import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  ENGINE_EVENT,
  IGEngineClient,
  IGEngineError,
  createWorkerSource,
} from '../../src/engine/index.js';
import { LoopbackWorker } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const wasm = await readFile(path.join(root, 'engine', 'target', 'wasm32-unknown-unknown', 'release', 'ig_core.wasm'));
const csv = await readFile(path.join(root, 'masclib', 'NCOS_01.csv'), 'utf8');

test('the generated Blob Worker source is standalone JavaScript', () => {
  const source = createWorkerSource();
  assert.ok(source.includes('installEngineWorker'));
  assert.equal(source.includes('import '), false);
  assert.doesNotThrow(() => new Function(source));
});

test('client drives the real worker protocol end to end', async () => {
  const worker = new LoopbackWorker();
  const client = new IGEngineClient({ worker });
  const events = [];
  client.on('*', (message) => events.push(message.event));

  const initialized = await client.init({
    wasm,
    catalog: { NCOS_01: { csv, metadata: { jobs: 8 } } },
  });
  assert.equal(initialized.catalog[0].name, 'NCOS_01');
  assert.equal((await client.selectInstance('NCOS_01')).instance.n, 8);
  await client.configure({
    seed: 9,
    iterationBudget: 12,
    checkpointEvery: 4,
    progressIntervalMs: 0,
  });
  const completed = await client.runSingle();
  assert.equal(completed.result.iterations, 12);
  assert.deepEqual(completed.result.checkpoints.map((point) => point.iteration), [0, 4, 8, 12]);
  assert.ok(events.includes(ENGINE_EVENT.PROGRESS));
  assert.ok(events.includes(ENGINE_EVENT.RUN_COMPLETE));

  await assert.rejects(
    client.selectInstance('missing'),
    (error) => error instanceof IGEngineError && error.code === 'UNKNOWN_INSTANCE',
  );
  await client.dispose();
  assert.equal(worker.terminated, true);
  await assert.rejects(client.state(), (error) => error.code === 'DISPOSED');
});
