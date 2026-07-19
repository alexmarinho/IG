import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const sample = JSON.parse(await readFile(path.join(root, 'google-sheets/generated/sample-data.json'), 'utf8'));
const csv = await readFile(path.join(root, 'masclib', `${sample.instance}.csv`), 'utf8');
const wasm = await readFile(path.join(
  root,
  'engine/target/wasm32-unknown-unknown/release/ig_core.wasm',
));

async function appsScriptContext({ writer = false } = {}) {
  const documentProperties = new Map();
  let uuidCounter = 0;
  const Utilities = {
    computeHmacSha256Signature: (value, key) => [...createHmac('sha256', key).update(value).digest()],
    base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((value) => value & 255)).toString('base64url'),
    getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
  };
  const PropertiesService = {
    getDocumentProperties: () => ({
      getProperty: (key) => documentProperties.get(key) || null,
      setProperty: (key, value) => { documentProperties.set(key, value); },
    }),
  };
  const LockService = {
    getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
  };
  const context = vm.createContext({
    console, Number, Math, Set, Array, Object, String, Boolean, Date,
    Error, TypeError, RangeError, Uint8Array, Uint32Array, WebAssembly,
    Utilities, PropertiesService, LockService,
  });
  for (const filename of ['Model.gs', 'Engine.gs', ...(writer ? ['Writer.gs'] : [])]) {
    const source = await readFile(path.join(root, 'google-sheets/apps-script', filename), 'utf8');
    vm.runInContext(source, context, { filename });
  }
  context.IG_PAYLOAD = { wasmBytes: wasm.length };
  context.IG_unpackCatalog_ = () => ({
    [sample.instance]: {
      csv,
      metadata: {
        jobs: sample.instanceModel.jobs.length,
        bestKnown: sample.referenceBest,
        dataset: 'MaScLib',
        family: 'setup',
      },
    },
  });
  return context;
}

test('public-master sample is a reproducible equal-budget experiment', () => {
  assert.equal(sample.instance, 'STC_NCOS_32');
  assert.equal(sample.runs.length, 10);
  assert.equal(new Set(sample.runs.map((run) => run.seed)).size, sample.runs.length);
  assert.equal(sample.bestRun.bestCost, 24048);
  assert.equal(sample.referenceBest, 24068);
  assert.ok(sample.bestRun.bestCost < sample.referenceBest, 'sample should beat, not relabel, the historical reference');
  assert.ok(Object.values(sample.bestRun.evaluation.breakdown).every((value) => value > 0));
  assert.ok(sample.bestRun.evaluation.rejected.length > 0);

  for (const run of sample.runs) {
    assert.equal(run.iterations, sample.iterationBudget);
    assert.equal(run.order.length + run.evaluation.rejected.length, sample.instanceModel.jobs.length);
    assert.equal(new Set(run.order).size, run.order.length);
    assert.equal(run.evaluation.breakdown.total, run.bestCost);
    assert.equal(
      run.evaluation.breakdown.setup
        + run.evaluation.breakdown.execution
        + run.evaluation.breakdown.tardiness
        + run.evaluation.breakdown.rejection,
      run.bestCost,
    );
    for (let index = 1; index < run.checkpoints.length; index += 1) {
      assert.ok(run.checkpoints[index].iteration > run.checkpoints[index - 1].iteration);
      assert.ok(run.checkpoints[index].evaluations >= run.checkpoints[index - 1].evaluations);
      assert.ok(run.checkpoints[index].bestCost <= run.checkpoints[index - 1].bestCost);
    }
  }
});

test('Apps Script independent evaluator closes the canonical objective', async () => {
  const context = await appsScriptContext();
  assert.equal(context.IG_DEFAULT_INSTANCE, sample.instance);
  const instance = context.IG_parseInstance_(csv, sample.instance);
  const evaluated = context.IG_evaluateOrder_(instance, sample.bestRun.order);
  assert.equal(evaluated.breakdown.total, sample.bestRun.bestCost);
  assert.equal(evaluated.scheduledCount + evaluated.rejectedCount, sample.instanceModel.jobs.length);
  assert.ok(evaluated.rows.every((row) => row.feasible));
});

test('Apps Script parser mirrors canonical missing-due and setup-state semantics', async () => {
  const context = await appsScriptContext();
  const tiny = [
    'MODEL|NAMES,NAME',
    'MODEL,tiny',
    'RESOURCE|NAMES,RESOURCE_ID,INITIAL_SETUP_STATE',
    'RESOURCE,1,2',
    'ACTIVITY|NAMES,ACTIVITY_ID,SETUP_STATE',
    'ACTIVITY,7,1',
    'MODE|NAMES,ACTIVITY_ID,MODE_COST,PROCESSING_TIME,START_MIN,END_MAX,UNPERFORMED_COST',
    'MODE,7,3.5,5,0,20,9',
    'SETUP_MATRIX|NAMES,FROM_STATE,TO_STATE,SETUP_TIME,SETUP_COST',
    'SETUP_MATRIX,2,1,4,1.5',
  ].join('\n');
  const instance = context.IG_parseInstance_(tiny, 'tiny');
  assert.equal(instance.jobs[0].due, 20);
  assert.equal(instance.jobs[0].weightDeci, 0);
  assert.equal(instance.stateCount, 3);
  const evaluated = context.IG_evaluateOrder_(instance, [0]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(evaluated.breakdown)),
    { setup: 1.5, execution: 3.5, tardiness: 0, rejection: 0, total: 5 },
  );
  assert.throws(() => context.IG_evaluateOrder_(instance, [0, 0]), /Duplicate/);
});

test('catalog derives missing job metadata so bundled GPU cases remain runnable', async () => {
  const context = await appsScriptContext();
  const gpuName = 'GPU_CALM_40';
  const gpuCsv = await readFile(path.join(root, 'masclib-gpu', `${gpuName}.csv`), 'utf8');
  const gpuItem = { csv: gpuCsv, metadata: { jobs: null, bestKnown: null, family: 'gpu' } };
  assert.equal(context.IG_catalogJobCount_(gpuItem, gpuName), 40);
  context.IG_unpackCatalog_ = () => ({ [gpuName]: gpuItem });
  const normalized = context.IG_normalizeConfig_({ instance: gpuName, d: 40, seed: 1 });
  assert.equal(normalized.d, 40);
});

test('every bundled instance independently reprices a canonical WASM solution', async () => {
  const context = await appsScriptContext();
  const loaded = await WebAssembly.instantiate(wasm, {});
  const api = loaded.instance.exports;
  const files = [];
  for (const directory of ['masclib', 'masclib-gpu']) {
    for (const filename of (await readdir(path.join(root, directory))).filter((name) => name.endsWith('.csv')).sort()) {
      files.push([directory, filename]);
    }
  }
  assert.equal(files.length, 47);

  for (const [directory, filename] of files) {
    const source = await readFile(path.join(root, directory, filename), 'utf8');
    const model = context.IG_parseInstance_(source, path.basename(filename, '.csv'));
    const encoded = new TextEncoder().encode(source);
    const pointer = api.wasm_alloc(encoded.length);
    new Uint8Array(api.memory.buffer, pointer, encoded.length).set(encoded);
    const instanceId = api.inst_load(pointer, encoded.length);
    assert.ok(instanceId >= 0, `${filename}: canonical parser rejected the bundle`);
    assert.equal(Number(api.inst_n(instanceId)), model.jobs.length, `${filename}: parser job count`);
    const runId = api.run_new(instanceId, Math.min(2, Math.max(1, model.jobs.length)), 0, 0, 1);
    const orderLength = Number(api.run_best_len(runId));
    const orderPointer = api.wasm_alloc(orderLength * Uint32Array.BYTES_PER_ELEMENT);
    api.run_best_write(runId, orderPointer);
    const order = Array.from(new Uint32Array(api.memory.buffer, orderPointer, orderLength));
    const evaluation = context.IG_evaluateOrder_(model, order);
    assert.equal(evaluation.breakdown.total, Number(api.run_best_cost(runId)), `${filename}: objective`);
    assert.ok(evaluation.rows.every((row) => row.feasible), `${filename}: hard deadline`);
    api.runs_clear();
  }
});

test('embedded Rust WebAssembly reproduces the public-master seed', async () => {
  const loaded = await WebAssembly.instantiate(wasm, {});
  const api = loaded.instance.exports;
  const encoded = new TextEncoder().encode(csv);
  const pointer = api.wasm_alloc(encoded.length);
  new Uint8Array(api.memory.buffer, pointer, encoded.length).set(encoded);
  const instanceId = api.inst_load(pointer, encoded.length);
  const runId = api.run_new(instanceId, 2, 0, 1, sample.bestRun.seed);
  api.run_step(runId, sample.iterationBudget);
  assert.equal(Number(api.run_best_cost(runId)), sample.bestRun.bestCost);
  assert.equal(Number(api.run_evals(runId)), sample.bestRun.evaluations);
});

test('commit trust boundary canonicalizes a compact result and rejects tampering', async () => {
  const context = await appsScriptContext({ writer: true });
  const sign = (run) => context.IG_signRunResult_(run);
  const trusted = context.IG_trustResult_(sign(structuredClone(sample.bestRun)));
  assert.equal(trusted.instance, sample.instance);
  assert.equal(trusted.bestCost, sample.bestRun.bestCost);
  assert.equal(trusted.metadata.referenceCost, sample.referenceBest);
  assert.equal(trusted.metadata.bestKnown, undefined);
  assert.equal(trusted.seed, trusted.config.seed);
  assert.equal(trusted.iterations, trusted.config.iterationBudget);
  assert.ok(trusted.evaluation.rows.every((row) => row.feasible));

  const duplicate = sign(structuredClone(sample.bestRun));
  duplicate.order.push(duplicate.order[0]);
  assert.throws(() => context.IG_trustResult_(duplicate), /round-trip integrity/i);
  assert.throws(() => context.IG_trustResult_(sign(duplicate)), /duplicate/i);

  const seedMismatch = structuredClone(sample.bestRun);
  seedMismatch.seed += 1;
  assert.throws(() => context.IG_trustResult_(sign(seedMismatch)), /seed and configuration disagree/i);

  const risingCheckpoint = structuredClone(sample.bestRun);
  risingCheckpoint.checkpoints[1].bestCost = risingCheckpoint.checkpoints[0].bestCost + 1;
  assert.throws(() => context.IG_trustResult_(sign(risingCheckpoint)), /must never increase/i);

  const setup = context.IG_setupRows_(trusted);
  const states = trusted.instanceModel.stateCount;
  assert.equal(setup.rows.length, states);
  assert.equal(setup.headers.length, states * 2 + 3);
  assert.equal(setup.headers[states + 2], 'from_to_cost');
  assert.deepEqual(setup.rows.map((row) => Number(row[0])), Array.from({ length: states }, (_, index) => index));
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.IG_stateRows_(trusted).map((row) => row[0]))),
    [
      'job_count', 'family_count', 'horizon', 'gantt_bins', 'gantt_jobs',
      'engine_scale', 'wasm_bytes', 'sample_environment', 'instance_initial_state',
    ],
  );
});

test('writer restores full audit-formula coverage after every batch', async () => {
  const context = await appsScriptContext({ writer: true });
  function sheet(rows, columns) {
    const calls = [];
    return {
      calls,
      getMaxRows: () => rows,
      getMaxColumns: () => columns,
      insertRowsAfter: (after, count) => { assert.equal(after, rows); rows += count; },
      insertColumnsAfter: (after, count) => { assert.equal(after, columns); columns += count; },
      getRange: (a1) => ({
        clearContent: () => { calls.push(['clear', a1]); },
        setValues: (values) => { calls.push(['values', a1, values]); },
        setValue: (value) => { calls.push(['value', a1, value]); },
        setFormulaR1C1: (formula) => { calls.push(['formula', a1, formula]); },
      }),
      size: () => [rows, columns],
    };
  }
  const sheets = {
    _RUNS: sheet(20, 11),
    _CHECKPOINTS: sheet(20, 9),
    _SCHEDULE: sheet(20, 19),
  };
  context.IG_sheet_ = (name) => sheets[name];
  context.IG_refreshAuditFormulas_();
  assert.deepEqual(sheets._RUNS.size(), [101, 13]);
  assert.deepEqual(sheets._CHECKPOINTS.size(), [152, 10]);
  assert.deepEqual(sheets._SCHEDULE.size(), [601, 20]);
  assert.ok(sheets._RUNS.calls.some((call) => call[0] === 'formula' && call[1] === 'L2:L101'));
  assert.ok(sheets._RUNS.calls.some((call) => call[0] === 'formula' && call[1] === 'M2:M101'));
  assert.ok(sheets._CHECKPOINTS.calls.some((call) => call[0] === 'formula' && call[1] === 'J2:J151'));
  assert.ok(sheets._SCHEDULE.calls.some((call) => call[0] === 'formula' && call[1] === 'T2:T601'));
});

test('experiment contract requires equal algorithms and unique seeds before writing', async () => {
  const context = await appsScriptContext({ writer: true });
  const first = context.IG_signRunResult_(structuredClone(sample.runs[0]));
  const duplicateSeed = context.IG_signRunResult_(structuredClone(sample.runs[0]));
  assert.throws(
    () => context.IG_commitExperiment_({ runs: [first, duplicateSeed] }),
    /seeds must be unique/i,
  );

  const changedAlgorithm = structuredClone(sample.runs[1]);
  changedAlgorithm.config.accept = changedAlgorithm.config.accept === 'current' ? 'best' : 'current';
  const signedChangedAlgorithm = context.IG_signRunResult_(changedAlgorithm);
  assert.throws(
    () => context.IG_commitExperiment_({ runs: [first, signedChangedAlgorithm] }),
    /same algorithm configuration/i,
  );
});

test('Apps Script manifest stays V8 and current-document only', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'google-sheets/apps-script/appsscript.json'), 'utf8'));
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.deepEqual(manifest.oauthScopes.sort(), [
    'https://www.googleapis.com/auth/script.container.ui',
    'https://www.googleapis.com/auth/spreadsheets.currentonly',
  ]);
  const code = await readFile(path.join(root, 'google-sheets/apps-script/Code.gs'), 'utf8');
  assert.match(code, /@OnlyCurrentDoc/);
  assert.match(code, /function installIgButtons\(\)/);

  const serverFunctions = [];
  for (const filename of ['Model.gs', 'Engine.gs', 'Writer.gs', 'Code.gs']) {
    const source = await readFile(path.join(root, 'google-sheets/apps-script', filename), 'utf8');
    serverFunctions.push(...[...source.matchAll(/^(?:async )?function\s+([A-Za-z0-9_]+)/gm)].map((match) => match[1]));
  }
  assert.deepEqual(serverFunctions.filter((name) => !name.endsWith('_')).sort(), [
    'igCommitExperiment', 'igCommitSingle', 'igComputeRun', 'igGetBootstrap', 'igSetLanguage',
    'installIgButtons', 'onOpen', 'setIgLanguageEnglish', 'setIgLanguagePortuguese',
    'showIgAbout', 'showIgSidebar', 'verifyIgEngine',
  ]);
  assert.doesNotMatch(code, /Reset generated results/);

  const model = await readFile(path.join(root, 'google-sheets/apps-script/Model.gs'), 'utf8');
  const engine = await readFile(path.join(root, 'google-sheets/apps-script/Engine.gs'), 'utf8');
  const writer = await readFile(path.join(root, 'google-sheets/apps-script/Writer.gs'), 'utf8');
  const sidebar = await readFile(path.join(root, 'google-sheets/apps-script/Sidebar.html'), 'utf8');
  assert.match(model, /IG_MAX_ITERATIONS = 100000/);
  assert.match(engine, /IG_MAX_ITERATIONS/);
  assert.match(sidebar, /max="100000"/);
  assert.match(sidebar, /tempo limite do Apps Script/);
  assert.match(code, /Abrir painel de controle/);
  assert.match(code, /setIgLanguagePortuguese/);
  assert.match(code, /addSubMenu\(languageMenu\)/);
  assert.match(writer, /IG_VIEW_SHEET_NAMES/);
  assert.match(writer, /setSpreadsheetLocale\(language === 'pt-BR' \? 'pt_BR' : 'en_US'\)/);
  assert.match(writer, /Melhor objetivo nas execuções com mesmo orçamento/);
});

test('engine verification reports through the bound sheet without requiring a UI modal', async () => {
  const source = await readFile(path.join(root, 'google-sheets/apps-script/Code.gs'), 'utf8');
  const toasts = [];
  const context = vm.createContext({
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        toast: (message, title, seconds) => { toasts.push({ message, title, seconds }); },
      }),
      getUi: () => { throw new Error('getUi must not be called by verifyIgEngine'); },
    },
  });
  vm.runInContext(source, context, { filename: 'Code.gs' });
  context.IG_currentLanguage_ = () => 'en';
  context.IG_computeRun_ = async () => ({ bestCost: 321, evaluations: 45 });

  const receipt = await context.verifyIgEngine();
  assert.deepEqual(JSON.parse(JSON.stringify(receipt)), {
    verified: true,
    cost: 321,
    evaluations: 45,
    message: 'Rust WebAssembly loaded successfully. Independent objective check closed at 321 after 45 candidate evaluations.',
    notification: 'toast',
  });
  assert.deepEqual(toasts, [{
    title: 'Engine verified',
    message: receipt.message,
    seconds: 8,
  }]);
});

test('language refresh completes when an editor execution has no container UI', async () => {
  const source = await readFile(path.join(root, 'google-sheets/apps-script/Code.gs'), 'utf8');
  const context = vm.createContext({
    console: { warn: () => {} },
    SpreadsheetApp: {
      getUi: () => { throw new Error('No container UI in direct editor execution'); },
    },
  });
  vm.runInContext(source, context, { filename: 'Code.gs' });
  assert.equal(context.IG_addMenu_('pt-BR'), false);
});

test('workbook story preserves experiment semantics', async () => {
  const builder = await readFile(path.join(root, 'google-sheets/scripts/build-workbook.mjs'), 'utf8');
  assert.match(builder, /Accepted ↔ rejected pass/);
  assert.match(builder, /Tests swaps after each rebuild/);
  assert.doesNotMatch(builder, /Randomizes reconstruction order/);
  assert.match(builder, /B2<2/);
  assert.match(builder, /needs ≥2 runs/);
  assert.match(builder, /function localized\(en, pt\)/);
  assert.match(builder, /const VISIBLE = \[\s*'START',\s*'DASHBOARD',\s*'SCHEDULE'/);
  assert.match(builder, /Only one language is visible at a time|_CONFIG/);
});

test('Apps Script and sidebar sources parse as JavaScript', async () => {
  const gsFiles = ['Model.gs', 'Engine.gs', 'Writer.gs', 'Code.gs'];
  for (const filename of gsFiles) {
    const source = await readFile(path.join(root, 'google-sheets/apps-script', filename), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename }));
  }
  const html = await readFile(path.join(root, 'google-sheets/apps-script/Sidebar.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][1], { filename: 'Sidebar.inline.js' }));
});
