import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WorkerHarness } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const wasm = await readFile(path.join(root, 'engine', 'target', 'wasm32-unknown-unknown', 'release', 'ig_core.wasm'));
const instanceNames = ['NCOS_01', 'NCOS_02', 'NCOS_31'];
const catalog = Object.fromEntries(await Promise.all(instanceNames.map(async (name) => [
  name,
  {
    csv: await readFile(path.join(root, 'masclib', `${name}.csv`), 'utf8'),
    metadata: { family: 'test', jobs: name === 'NCOS_01' ? 8 : undefined },
  },
])));

async function initializedHarness(instance = 'NCOS_01') {
  const harness = new WorkerHarness();
  const init = await harness.command('init', { wasm, catalog });
  assert.equal(init.ok, true, init.error && init.error.message);
  assert.equal(init.result.catalog.length, instanceNames.length);
  const selected = await harness.command('select-instance', { name: instance });
  assert.equal(selected.ok, true, selected.error && selected.error.message);
  return harness;
}

test('single run honors its exact budget and only transfers orders on improvements/completion', async () => {
  const harness = await initializedHarness();
  const configured = await harness.command('configure', {
    d: 2,
    accept: 'current',
    permute: true,
    seed: 7,
    iterationBudget: 25,
    checkpointEvery: 5,
    batchSize: 3,
    progressIntervalMs: 0,
  });
  assert.equal(configured.ok, true);

  const after = harness.messages.length;
  const started = await harness.command('start');
  assert.equal(started.ok, true);
  const completion = await harness.waitForEvent('run-complete', () => true, { after });
  const result = completion.message.result;

  assert.equal(result.seed, 7);
  assert.equal(result.iterations, 25);
  assert.ok(result.evaluations > 0);
  assert.ok(result.order instanceof Uint32Array);
  assert.deepEqual(result.checkpoints.map((point) => point.iteration), [0, 5, 10, 15, 20, 25]);
  assert.equal(completion.transfer.length, 1);
  assert.equal(completion.transfer[0], result.order.buffer);
  assert.equal(new Set(result.order).size, result.order.length);

  const progress = harness.messages
    .slice(after, completion.index)
    .map((entry) => entry.message)
    .filter((message) => message.type === 'event' && message.event === 'progress');
  assert.ok(progress.length >= 1);
  for (const message of progress) {
    if (message.progress.order) assert.equal(message.progress.improved, true);
    if (!message.progress.improved) assert.equal(message.progress.order, undefined);
  }
});

test('wall-clock progress is throttled independently from deterministic checkpoints', async () => {
  let time = 0;
  const harness = new WorkerHarness({
    now: () => time,
    schedule: (callback) => setImmediate(() => {
      time += 1;
      callback();
    }),
  });
  assert.equal((await harness.command('init', { wasm, catalog })).ok, true);
  assert.equal((await harness.command('select-instance', { name: 'NCOS_01' })).ok, true);
  assert.equal((await harness.command('configure', {
    seed: 1,
    iterationBudget: 50,
    checkpointEvery: 1,
    batchSize: 1,
    progressIntervalMs: 10,
  })).ok, true);
  const after = harness.messages.length;
  assert.equal((await harness.command('start')).ok, true);
  const completion = await harness.waitForEvent('run-complete', () => true, { after });
  const progress = harness.messages
    .slice(after, completion.index)
    .map((entry) => entry.message)
    .filter((message) => message.type === 'event' && message.event === 'progress');
  assert.ok(progress.length >= 5);
  assert.ok(progress.length <= 6, `expected throttled progress, received ${progress.length} events`);
  assert.equal(completion.transfer.length, 1);
});

test('pause, resume, and reset control a live run without changing its budget', async () => {
  const harness = await initializedHarness('NCOS_31');
  const configured = await harness.command('configure', {
    seed: 3,
    d: 2,
    iterationBudget: 500,
    checkpointEvery: 25,
    batchSize: 1,
    progressIntervalMs: 0,
  });
  assert.equal(configured.ok, true);

  const afterStart = harness.messages.length;
  assert.equal((await harness.command('start')).ok, true);
  const firstStep = await harness.waitForEvent(
    'progress',
    (message) => message.progress.iterations > 0,
    { after: afterStart },
  );
  assert.equal((await harness.command('pause')).ok, true);
  const paused = await harness.command('state');
  assert.equal(paused.result.status, 'paused');

  const pausedMessageCount = harness.messages.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  const progressedWhilePaused = harness.messages.slice(pausedMessageCount).some((entry) => (
    entry.message.type === 'event'
      && entry.message.event === 'progress'
      && entry.message.progress.iterations > firstStep.message.progress.iterations
  ));
  assert.equal(progressedWhilePaused, false);

  const resumeAt = harness.messages.length;
  assert.equal((await harness.command('resume')).ok, true);
  const completion = await harness.waitForEvent('run-complete', () => true, { after: resumeAt });
  assert.equal(completion.message.result.iterations, 500);
  assert.equal((await harness.command('reset')).result.state.status, 'configured');
});

test('multi-run comparison is repeatable and returns aligned aggregate checkpoints', async () => {
  const harness = await initializedHarness('NCOS_02');
  assert.equal((await harness.command('configure', {
    d: 2,
    accept: 'best',
    permute: true,
    iterationBudget: 100,
    checkpointEvery: 20,
  })).ok, true);

  async function compare() {
    const after = harness.messages.length;
    const accepted = await harness.command('compare', {
      seeds: [3, 7, 11],
      iterationBudget: 30,
      checkpointEvery: 10,
      batchSize: 7,
      progressIntervalMs: 10_000,
    });
    assert.equal(accepted.ok, true, accepted.error && accepted.error.message);
    return harness.waitForEvent('comparison-complete', () => true, { after });
  }

  const firstEnvelope = await compare();
  const first = firstEnvelope.message.result;
  assert.deepEqual(first.seeds, [3, 7, 11]);
  assert.equal(first.runs.length, 3);
  assert.equal(first.aggregate.length, 4);
  assert.deepEqual(first.aggregate.map((point) => point.iteration), [0, 10, 20, 30]);
  assert.ok(first.aggregate.every((point) => point.samples === 3));
  assert.equal(firstEnvelope.transfer.length, 3);
  for (const [index, run] of first.runs.entries()) {
    assert.equal(run.seed, first.seeds[index]);
    assert.equal(run.bestCost, run.cost);
    assert.equal(run.iters, run.iterations);
    assert.equal(run.evals, run.evaluations);
    assert.equal(run.iterations, 30);
    assert.ok(run.evaluations > 0);
    assert.ok(run.order instanceof Uint32Array);
    assert.deepEqual(run.checkpoints.map((point) => point.iteration), [0, 10, 20, 30]);
    assert.ok(run.checkpoints.every((point) => (
      point.checkpoint === point.iteration && point.bestCost === point.cost
    )));
    assert.equal(firstEnvelope.transfer[index], run.order.buffer);
  }

  const signature = (result) => result.runs.map((run) => ({
    seed: run.seed,
    cost: run.cost,
    iterations: run.iterations,
    evaluations: run.evaluations,
    order: [...run.order],
    checkpoints: run.checkpoints,
  }));
  const expected = signature(first);
  assert.equal((await harness.command('reset')).ok, true);
  const second = (await compare()).message.result;
  assert.deepEqual(signature(second), expected);
  assert.deepEqual(second.aggregate, first.aggregate);
});

test('catalog selection is fixed and invalid commands fail with typed protocol errors', async () => {
  const harness = new WorkerHarness();
  assert.equal((await harness.command('init', { wasm, catalog })).ok, true);
  const unknown = await harness.command('select-instance', { name: 'NOT_IN_CATALOG' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'UNKNOWN_INSTANCE');
  const start = await harness.command('start');
  assert.equal(start.ok, false);
  assert.equal(start.error.code, 'NOT_CONFIGURED');
});
