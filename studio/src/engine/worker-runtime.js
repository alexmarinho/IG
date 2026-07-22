/**
 * Install the complete IG engine runtime into a Worker-like scope.
 *
 * All helpers intentionally live inside this function. `createWorkerSource()`
 * serializes it into a Blob Worker, so the final offline HTML needs neither a
 * second URL nor a runtime dependency.
 */
export function installEngineWorker(scope, injected = {}) {
  const PROTOCOL_VERSION = 1;
  const WebAssemblyApi = injected.WebAssembly || globalThis.WebAssembly;
  const TextEncoderApi = injected.TextEncoder || globalThis.TextEncoder;
  const clock = injected.now || (() => (
    globalThis.performance && typeof globalThis.performance.now === 'function'
      ? globalThis.performance.now()
      : Date.now()
  ));
  const schedule = injected.schedule || ((fn) => setTimeout(fn, 0));
  const closeScope = injected.close || (() => {
    if (typeof scope.close === 'function') scope.close();
  });

  const REQUIRED_EXPORTS = [
    'memory', 'wasm_alloc', 'inst_load', 'inst_n', 'run_new', 'run_step',
    'run_best_cost', 'run_best_len', 'run_best_write', 'run_iters',
    'run_evals', 'runs_clear',
  ];

  let exportsApi = null;
  let catalog = new Map();
  let catalogSummary = [];
  let selected = null;
  let configured = null;
  let active = null;
  let generation = 0;
  let status = 'uninitialized';
  let disposed = false;
  let commandQueue = Promise.resolve();
  let scratchPtr = 0;
  let scratchCapacity = 0;

  class EngineProtocolError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'EngineProtocolError';
      this.code = code;
    }
  }

  function fail(code, message) {
    throw new EngineProtocolError(code, message);
  }

  function serializeError(error) {
    return {
      code: error && error.code ? error.code : 'ENGINE_ERROR',
      message: error && error.message ? error.message : String(error),
    };
  }

  function post(message, transfer = []) {
    scope.postMessage(message, transfer);
  }

  function respond(id, result) {
    post({ type: 'response', id, ok: true, result });
  }

  function reject(id, error) {
    post({ type: 'response', id, ok: false, error: serializeError(error) });
  }

  function emit(event, data = {}, transfer = []) {
    post({ type: 'event', event, ...data }, transfer);
  }

  function stateSnapshot() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      status,
      selected: selected ? { name: selected.name, n: selected.n } : null,
      configured: configured ? { ...configured } : null,
      operation: active ? {
        kind: active.kind,
        status: active.status,
        runIndex: active.kind === 'comparison' ? active.runIndex : undefined,
        runCount: active.kind === 'comparison' ? active.seeds.length : undefined,
      } : null,
    };
  }

  function setStatus(next) {
    status = next;
    emit('state', { state: stateSnapshot() });
  }

  function ensureInitialized() {
    if (!exportsApi) fail('NOT_INITIALIZED', 'Initialize the engine before using it.');
    if (disposed) fail('DISPOSED', 'The engine worker has been disposed.');
  }

  function ensureIdle() {
    if (active && (active.status === 'running' || active.status === 'paused')) {
      fail('RUN_ACTIVE', 'Pause/reset the active operation before changing the instance or configuration.');
    }
  }

  function decodeBase64(value) {
    const clean = String(value).replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    const decode = injected.atob || globalThis.atob;
    if (typeof decode !== 'function') fail('BASE64_UNAVAILABLE', 'Base64 decoding is unavailable.');
    const binary = decode(clean);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function asBytes(value) {
    if (typeof value === 'string') return decodeBase64(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    fail('BAD_WASM', 'Expected WASM bytes as base64, ArrayBuffer, or typed array.');
  }

  async function unpackCatalog(payload) {
    if (payload.catalog) return payload.catalog;
    if (!payload.catalogGzipBase64) {
      fail('BAD_CATALOG', 'An embedded instance catalog is required.');
    }
    const bytes = decodeBase64(payload.catalogGzipBase64);
    if (typeof injected.decompressCatalog === 'function') {
      return injected.decompressCatalog(bytes);
    }
    if (
      typeof globalThis.DecompressionStream !== 'function'
      || typeof globalThis.Response !== 'function'
      || typeof globalThis.Blob !== 'function'
    ) {
      fail('GZIP_UNAVAILABLE', 'This browser cannot unpack the embedded instance catalog.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    return JSON.parse(text);
  }

  function normalizeCatalog(rawCatalog) {
    const entries = [];
    if (Array.isArray(rawCatalog)) {
      for (const item of rawCatalog) {
        if (!item || typeof item !== 'object') fail('BAD_CATALOG', 'Catalog entries must be objects.');
        entries.push([item.name, item]);
      }
    } else if (rawCatalog && typeof rawCatalog === 'object') {
      entries.push(...Object.entries(rawCatalog));
    } else {
      fail('BAD_CATALOG', 'The instance catalog must be an object or array.');
    }

    const result = new Map();
    for (const [fallbackName, raw] of entries) {
      const item = typeof raw === 'string' ? { csv: raw } : raw;
      const name = String(item && item.name ? item.name : fallbackName || '').trim();
      const csv = item && typeof item.csv === 'string' ? item.csv : '';
      const metadata = item && item.metadata && typeof item.metadata === 'object'
        ? item.metadata
        : {};
      if (!name) fail('BAD_CATALOG', 'Every catalog entry needs a non-empty name.');
      if (!csv.trim()) fail('BAD_CATALOG', `Catalog entry ${name} has no CSV data.`);
      if (result.has(name)) fail('BAD_CATALOG', `Duplicate catalog entry: ${name}.`);
      result.set(name, { name, csv, metadata, instId: null, n: null });
    }
    if (!result.size) fail('BAD_CATALOG', 'The embedded catalog is empty.');
    return result;
  }

  function summarizeCatalog(items) {
    return [...items.values()]
      .map((item) => ({ ...item.metadata, name: item.name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  function validateExports(candidate) {
    for (const name of REQUIRED_EXPORTS) {
      if (!(name in candidate)) fail('BAD_WASM_ABI', `Missing WASM export: ${name}.`);
    }
  }

  function loadCatalogInstance(name) {
    const item = catalog.get(name);
    if (!item) fail('UNKNOWN_INSTANCE', `Unknown catalog instance: ${name}.`);
    if (item.instId == null) {
      const encoded = new TextEncoderApi().encode(item.csv);
      const ptr = exportsApi.wasm_alloc(encoded.length);
      new Uint8Array(exportsApi.memory.buffer).set(encoded, ptr);
      const instId = exportsApi.inst_load(ptr, encoded.length);
      if (instId < 0) fail('INSTANCE_PARSE_FAILED', `The Rust engine could not parse ${name}.`);
      item.instId = instId;
      item.n = Number(exportsApi.inst_n(instId));
    }
    return item;
  }

  function integer(value, name, minimum, maximum, fallback) {
    const candidate = value == null ? fallback : Number(value);
    if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
      fail('BAD_CONFIG', `${name} must be an integer from ${minimum} to ${maximum}.`);
    }
    return candidate;
  }

  function normalizeConfig(raw = {}) {
    if (!selected) fail('NO_INSTANCE', 'Select a catalog instance before configuring a run.');
    const iterationBudget = integer(raw.iterationBudget, 'iterationBudget', 1, 1_000_000_000, 2_000);
    const defaultCheckpoint = Math.max(1, Math.ceil(iterationBudget / 50));
    const checkpointEvery = Math.min(
      iterationBudget,
      integer(raw.checkpointEvery, 'checkpointEvery', 1, iterationBudget, defaultCheckpoint),
    );
    const defaultBatch = selected.n >= 500 ? 1 : selected.n >= 200 ? 4 : selected.n >= 100 ? 12 : selected.n >= 50 ? 32 : 64;
    const acceptRaw = raw.accept == null ? 'current' : raw.accept;
    const accept = acceptRaw === 1 || acceptRaw === 'best' ? 'best'
      : acceptRaw === 0 || acceptRaw === 'current' ? 'current'
        : null;
    if (!accept) fail('BAD_CONFIG', 'accept must be "current" or "best".');
    return {
      d: integer(raw.d, 'd', 1, Math.max(1, selected.n), selected.n >= 500 ? 50 : 2),
      accept,
      permute: raw.permute == null ? selected.n < 500 : Boolean(raw.permute),
      seed: integer(raw.seed, 'seed', 0, 0xffff_ffff, 1),
      iterationBudget,
      checkpointEvery,
      batchSize: integer(raw.batchSize, 'batchSize', 1, 1_000_000, defaultBatch),
      progressIntervalMs: integer(raw.progressIntervalMs, 'progressIntervalMs', 0, 10_000, 100),
      targetChunkMs: integer(raw.targetChunkMs, 'targetChunkMs', 1, 100, 10),
    };
  }

  function normalizeSeeds(payload) {
    if (Array.isArray(payload.seeds)) {
      if (!payload.seeds.length || payload.seeds.length > 64) {
        fail('BAD_SEEDS', 'seeds must contain between 1 and 64 fixed seeds.');
      }
      return payload.seeds.map((seed, index) => integer(seed, `seeds[${index}]`, 0, 0xffff_ffff, 0));
    }
    const count = integer(payload.count, 'count', 1, 64, 5);
    const seedStart = integer(payload.seedStart, 'seedStart', 0, 0xffff_ffff, 1);
    if (seedStart + count - 1 > 0xffff_ffff) fail('BAD_SEEDS', 'The generated seed range exceeds uint32.');
    return Array.from({ length: count }, (_, index) => seedStart + index);
  }

  function readBestOrder(runId) {
    const length = Number(exportsApi.run_best_len(runId));
    if (length > scratchCapacity) {
      scratchCapacity = Math.max(length, scratchCapacity * 2, 64);
      scratchPtr = exportsApi.wasm_alloc(scratchCapacity * Uint32Array.BYTES_PER_ELEMENT);
    }
    exportsApi.run_best_write(runId, scratchPtr);
    const wasmView = new Uint32Array(exportsApi.memory.buffer, scratchPtr, length);
    const copy = new Uint32Array(length);
    copy.set(wasmView);
    return copy;
  }

  function scalarSnapshot(runId) {
    return {
      cost: Number(exportsApi.run_best_cost(runId)),
      iterations: Number(exportsApi.run_iters(runId)),
      evaluations: Number(exportsApi.run_evals(runId)),
    };
  }

  function publicScalars(snapshot) {
    return {
      cost: snapshot.cost,
      bestCost: snapshot.cost,
      iters: snapshot.iterations,
      iterations: snapshot.iterations,
      evals: snapshot.evaluations,
      evaluations: snapshot.evaluations,
    };
  }

  function publicCheckpoint(snapshot) {
    return {
      checkpoint: snapshot.iterations,
      iteration: snapshot.iterations,
      bestCost: snapshot.cost,
      cost: snapshot.cost,
      evals: snapshot.evaluations,
      evaluations: snapshot.evaluations,
    };
  }

  function createRun(seed, config) {
    exportsApi.runs_clear();
    const runId = exportsApi.run_new(
      selected.instId,
      config.d,
      config.accept === 'best' ? 1 : 0,
      config.permute ? 1 : 0,
      seed,
    );
    const initial = scalarSnapshot(runId);
    return {
      runId,
      seed,
      budget: config.iterationBudget,
      checkpointEvery: config.checkpointEvery,
      batchSize: config.batchSize,
      initialBatchSize: config.batchSize,
      progressIntervalMs: config.progressIntervalMs,
      targetChunkMs: config.targetChunkMs,
      lastProgressAt: clock(),
      pendingImprovement: false,
      checkpoints: [publicCheckpoint(initial)],
    };
  }

  function nextCheckpointAt(current) {
    const iteration = Number(exportsApi.run_iters(current.runId));
    return Math.min(
      current.budget,
      (Math.floor(iteration / current.checkpointEvery) + 1) * current.checkpointEvery,
    );
  }

  function addCheckpoint(current) {
    const snapshot = scalarSnapshot(current.runId);
    const previous = current.checkpoints[current.checkpoints.length - 1];
    if (!previous || previous.iteration !== snapshot.iterations) {
      current.checkpoints.push(publicCheckpoint(snapshot));
    }
    return snapshot;
  }

  function progressPayload(operation, current, snapshot) {
    const base = {
      mode: operation.kind === 'comparison' ? 'comparison' : 'single',
      seed: current.seed,
      ...publicScalars(snapshot),
      iterationBudget: current.budget,
    };
    if (operation.kind === 'comparison') {
      base.runIndex = operation.runIndex;
      base.runNumber = operation.runIndex + 1;
      base.runCount = operation.seeds.length;
    }
    return base;
  }

  function maybeEmitProgress(operation, current, snapshot, force = false) {
    const timestamp = clock();
    if (!force && timestamp - current.lastProgressAt < current.progressIntervalMs) return;
    const payload = progressPayload(operation, current, snapshot);
    const transfer = [];
    if (current.pendingImprovement) {
      payload.improved = true;
      payload.order = readBestOrder(current.runId);
      transfer.push(payload.order.buffer);
      current.pendingImprovement = false;
    } else {
      payload.improved = false;
    }
    current.lastProgressAt = timestamp;
    emit('progress', { progress: payload }, transfer);
  }

  function adaptBatch(current, elapsedMs) {
    if (elapsedMs > current.targetChunkMs * 1.5 && current.batchSize > 1) {
      current.batchSize = Math.max(1, Math.floor(current.batchSize / 2));
    } else if (elapsedMs < current.targetChunkMs * 0.45) {
      current.batchSize = Math.min(1_000_000, current.batchSize * 2);
    }
  }

  function stepCurrent(operation, current) {
    const before = Number(exportsApi.run_iters(current.runId));
    const boundary = nextCheckpointAt(current);
    const count = Math.min(current.batchSize, current.budget - before, boundary - before);
    const startedAt = clock();
    const improved = Boolean(exportsApi.run_step(current.runId, count));
    adaptBatch(current, Math.max(0, clock() - startedAt));
    if (improved) current.pendingImprovement = true;
    const after = Number(exportsApi.run_iters(current.runId));
    const atCheckpoint = after === boundary || after === current.budget;
    const snapshot = atCheckpoint ? addCheckpoint(current) : scalarSnapshot(current.runId);
    // Completion publishes its own final order. Do not duplicate that transfer
    // in a forced progress message when the last chunk also improved.
    maybeEmitProgress(operation, current, snapshot, false);
    return { snapshot, complete: after >= current.budget };
  }

  function schedulePump(operation) {
    const token = operation.token;
    schedule(() => {
      if (!active || active !== operation || operation.token !== token || generation !== token) return;
      if (operation.status !== 'running') return;
      try {
        pump(operation);
      } catch (error) {
        operation.status = 'error';
        active = null;
        status = 'error';
        emit('error', { error: serializeError(error), state: stateSnapshot() });
      }
    });
  }

  function completeSingle(operation) {
    const current = operation.current;
    const snapshot = addCheckpoint(current);
    const order = readBestOrder(current.runId);
    const result = {
      instance: selected.name,
      seed: current.seed,
      ...publicScalars(snapshot),
      order,
      checkpoints: current.checkpoints.map((point) => ({ ...point })),
    };
    operation.status = 'completed';
    active = null;
    status = 'completed';
    emit('run-complete', { result, state: stateSnapshot() }, [order.buffer]);
    emit('state', { state: stateSnapshot() });
  }

  function median(sorted) {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function aggregateConvergence(results) {
    if (!results.length) return [];
    const iterations = results[0].checkpoints.map((point) => point.iteration);
    return iterations.map((iteration, checkpointIndex) => {
      const costs = results
        .map((run) => run.checkpoints[checkpointIndex] && run.checkpoints[checkpointIndex].cost)
        .filter((cost) => Number.isFinite(cost))
        .sort((left, right) => left - right);
      const evaluations = results
        .map((run) => run.checkpoints[checkpointIndex] && run.checkpoints[checkpointIndex].evaluations)
        .filter((value) => Number.isFinite(value));
      const mean = costs.reduce((sum, value) => sum + value, 0) / costs.length;
      const meanEvaluations = evaluations.reduce((sum, value) => sum + value, 0) / evaluations.length;
      return {
        iteration,
        best: costs[0],
        mean,
        median: median(costs),
        worst: costs[costs.length - 1],
        meanEvaluations,
        samples: costs.length,
      };
    });
  }

  function startComparisonRun(operation) {
    if (operation.runIndex >= operation.seeds.length) {
      const aggregate = aggregateConvergence(operation.results);
      const orders = operation.results.map((run) => run.order);
      const result = {
        instance: selected.name,
        iterationBudget: operation.config.iterationBudget,
        checkpointEvery: operation.config.checkpointEvery,
        seeds: operation.seeds.slice(),
        runs: operation.results,
        aggregate,
      };
      operation.status = 'completed';
      active = null;
      status = 'completed';
      emit('comparison-complete', { result, state: stateSnapshot() }, orders.map((order) => order.buffer));
      emit('state', { state: stateSnapshot() });
      return;
    }
    operation.current = createRun(operation.seeds[operation.runIndex], operation.config);
    const snapshot = scalarSnapshot(operation.current.runId);
    emit('progress', {
      progress: {
        ...progressPayload(operation, operation.current, snapshot),
        improved: false,
      },
    });
    schedulePump(operation);
  }

  function completeComparisonRun(operation) {
    const current = operation.current;
    const snapshot = addCheckpoint(current);
    const order = readBestOrder(current.runId);
    const result = {
      seed: current.seed,
      ...publicScalars(snapshot),
      order,
      checkpoints: current.checkpoints.map((point) => ({ ...point })),
    };
    operation.results.push(result);
    emit('comparison-run-complete', {
      run: {
        seed: result.seed,
        cost: result.cost,
        bestCost: result.bestCost,
        iters: result.iters,
        iterations: result.iterations,
        evals: result.evals,
        evaluations: result.evaluations,
        runIndex: operation.runIndex,
        runNumber: operation.runIndex + 1,
        runCount: operation.seeds.length,
      },
    });
    operation.runIndex += 1;
    startComparisonRun(operation);
  }

  function pump(operation) {
    if (!operation.current) return;
    const { complete } = stepCurrent(operation, operation.current);
    if (complete) {
      if (operation.kind === 'single') completeSingle(operation);
      else completeComparisonRun(operation);
      return;
    }
    schedulePump(operation);
  }

  async function initialize(payload) {
    if (exportsApi) fail('ALREADY_INITIALIZED', 'The engine is already initialized.');
    const wasmBytes = asBytes(payload.wasm);
    const instantiated = await WebAssemblyApi.instantiate(wasmBytes, {});
    exportsApi = instantiated.instance ? instantiated.instance.exports : instantiated.exports;
    validateExports(exportsApi);
    catalog = normalizeCatalog(await unpackCatalog(payload));
    catalogSummary = summarizeCatalog(catalog);
    status = 'ready';
    return {
      protocolVersion: PROTOCOL_VERSION,
      catalog: catalogSummary,
      wasmBytes: wasmBytes.byteLength,
      state: stateSnapshot(),
    };
  }

  function beginSingle() {
    ensureInitialized();
    if (!selected || !configured) fail('NOT_CONFIGURED', 'Select an instance and configure a run first.');
    ensureIdle();
    generation += 1;
    const operation = {
      kind: 'single',
      token: generation,
      status: 'running',
      config: { ...configured },
      current: createRun(configured.seed, configured),
    };
    active = operation;
    status = 'running';
    const initial = scalarSnapshot(operation.current.runId);
    emit('progress', {
      progress: {
        ...progressPayload(operation, operation.current, initial),
        improved: false,
      },
    });
    emit('state', { state: stateSnapshot() });
    schedulePump(operation);
    return { accepted: true, state: stateSnapshot() };
  }

  function beginComparison(payload) {
    ensureInitialized();
    if (!selected) fail('NO_INSTANCE', 'Select a catalog instance before comparing runs.');
    ensureIdle();
    const merged = { ...(configured || {}), ...(payload.config || {}) };
    for (const key of ['iterationBudget', 'checkpointEvery', 'batchSize', 'progressIntervalMs', 'targetChunkMs', 'd', 'accept', 'permute']) {
      if (payload[key] != null) merged[key] = payload[key];
    }
    const budgetOverridden = payload.iterationBudget != null
      || (payload.config && payload.config.iterationBudget != null);
    const checkpointOverridden = payload.checkpointEvery != null
      || (payload.config && payload.config.checkpointEvery != null);
    if (budgetOverridden && !checkpointOverridden) delete merged.checkpointEvery;
    const config = normalizeConfig(merged);
    const seeds = normalizeSeeds(payload);
    generation += 1;
    const operation = {
      kind: 'comparison',
      token: generation,
      status: 'running',
      config,
      seeds,
      runIndex: 0,
      results: [],
      current: null,
    };
    active = operation;
    status = 'running';
    emit('state', { state: stateSnapshot() });
    startComparisonRun(operation);
    return { accepted: true, seeds: seeds.slice(), state: stateSnapshot() };
  }

  function pauseActive() {
    ensureInitialized();
    if (!active || active.status !== 'running') fail('NOT_RUNNING', 'There is no running operation to pause.');
    active.status = 'paused';
    status = 'paused';
    emit('state', { state: stateSnapshot() });
    return { state: stateSnapshot() };
  }

  function resumeActive() {
    ensureInitialized();
    if (!active || active.status !== 'paused') fail('NOT_PAUSED', 'There is no paused operation to resume.');
    active.status = 'running';
    status = 'running';
    emit('state', { state: stateSnapshot() });
    schedulePump(active);
    return { state: stateSnapshot() };
  }

  function resetEngine() {
    ensureInitialized();
    generation += 1;
    active = null;
    exportsApi.runs_clear();
    status = configured ? 'configured' : selected ? 'instance-selected' : 'ready';
    emit('state', { state: stateSnapshot() });
    return { state: stateSnapshot() };
  }

  async function dispatch(message) {
    if (!message || !Number.isInteger(message.id) || typeof message.type !== 'string') {
      fail('BAD_MESSAGE', 'Commands require an integer id and a string type.');
    }
    const payload = message.payload || {};
    switch (message.type) {
      case 'init':
        return initialize(payload);
      case 'select-instance': {
        ensureInitialized();
        ensureIdle();
        const item = loadCatalogInstance(String(payload.name || ''));
        selected = item;
        configured = null;
        status = 'instance-selected';
        emit('state', { state: stateSnapshot() });
        return { instance: { ...item.metadata, name: item.name, n: item.n }, state: stateSnapshot() };
      }
      case 'configure':
        ensureInitialized();
        ensureIdle();
        configured = normalizeConfig(payload);
        status = 'configured';
        emit('state', { state: stateSnapshot() });
        return { configuration: { ...configured }, state: stateSnapshot() };
      case 'start':
        return beginSingle();
      case 'compare':
        return beginComparison(payload);
      case 'pause':
        return pauseActive();
      case 'resume':
        return resumeActive();
      case 'reset':
        return resetEngine();
      case 'state':
        ensureInitialized();
        return stateSnapshot();
      case 'dispose':
        if (!disposed) {
          generation += 1;
          active = null;
          if (exportsApi) exportsApi.runs_clear();
          disposed = true;
          status = 'disposed';
          emit('state', { state: stateSnapshot() });
          schedule(closeScope);
        }
        return { state: stateSnapshot() };
      default:
        fail('UNKNOWN_COMMAND', `Unknown engine command: ${message.type}.`);
    }
  }

  scope.addEventListener('message', (event) => {
    const message = event && event.data;
    commandQueue = commandQueue.then(async () => {
      try {
        const result = await dispatch(message);
        respond(message.id, result);
      } catch (error) {
        if (message && Number.isInteger(message.id)) reject(message.id, error);
        else emit('error', { error: serializeError(error) });
      }
    });
  });

  return {
    getState: stateSnapshot,
  };
}

export function createWorkerSource() {
  return `(${installEngineWorker.toString()})(self);`;
}
