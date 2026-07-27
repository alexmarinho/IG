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
    'race_new', 'race_step', 'race_snapshot', 'race_snapshot_ptr',
    'race_orders_ptr', 'race_best_ptr', 'race_trace_write', 'race_clear',
  ];

  /** Six methods, in the order `engine/src/race/mod.rs` declares them. */
  const RACE_METHOD_COUNT = 6;
  /** `RacerSnapshot` is `#[repr(C)]` with an f64 first: 64 bytes, stride 64. */
  const RACE_SNAPSHOT_STRIDE = 64;
  /** Trace points pulled per `race_trace_write` call, per method. */
  const RACE_TRACE_CHUNK = 512;

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
  let race = null;

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
      } : race ? {
        kind: 'race',
        status: 'running',
        slices: race.slices,
        intrusions: race.intrusions,
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

  /**
   * A live race owns the worker. Solve operations are refused rather than
   * queued, so the per-method wall clock the page prints can never include time
   * this thread spent on somebody else's work (see `race.intrusions`).
   */
  function ensureNoRace() {
    if (race) fail('RACE_ACTIVE', 'Clear the method race before starting a solve run.');
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

  // -------------------------------------------------------------------------
  // The method race: one wasm instance, six methods, round-robin slices.
  //
  // Deliberately NOT six workers. A budget race is deterministic per method, so
  // parallelism cannot change a result, and a fair parallel race would need a
  // per-slice barrier — which, without SharedArrayBuffer (GitHub Pages cannot
  // send COOP/COEP), is a postMessage round trip per method per slice. The gain
  // from Rust here is single-thread throughput, so one thread is the design.
  // -------------------------------------------------------------------------

  /** Round `value` up to the next multiple of `alignment`. */
  function alignUp(value, alignment) {
    return Math.ceil(value / alignment) * alignment;
  }

  /**
   * Views into wasm memory die when the memory grows (the ArrayBuffer detaches),
   * so every one of them is rebuilt behind a single buffer-identity compare —
   * the same trick `readBestOrder` uses by re-creating its view every call.
   * The pointers themselves are stable for the life of a race: `Race::orders`
   * and `Race::best` are allocated once in `Race::new` and never resized.
   */
  function bindRaceViews() {
    const buffer = exportsApi.memory.buffer;
    if (race.boundBuffer === buffer) return;
    race.boundBuffer = buffer;
    // The scalar block is read through a DataView: it is 384 bytes once per
    // slice, and a DataView cannot be wrong about alignment.
    race.scalars = new DataView(buffer, race.snapshotPtr, RACE_METHOD_COUNT * RACE_SNAPSHOT_STRIDE);
    race.orders = race.ordersPtr && race.n
      ? new Uint32Array(buffer, race.ordersPtr, RACE_METHOD_COUNT * race.n)
      : null;
    race.bestOrders = race.bestPtr && race.n
      ? new Uint32Array(buffer, race.bestPtr, RACE_METHOD_COUNT * race.n)
      : null;
    race.traceView = new Float64Array(buffer, race.tracePtr, RACE_TRACE_CHUNK * 2);
  }

  /**
   * One `RacerSnapshot`, at the fixed offsets `engine/src/race/mod.rs` declares:
   *   0 best_cost f64 · 8 cur_cost f64 · 16 evals f64 · 24 status_key u32
   *   28 status_arg u32 · 32 flags u32 · 36 trace_len u32 · 40 order_len u32
   *   44 best_len u32 · 48 phase_arg u32 · 52..64 padding
   * `phase_arg` (d_eff / tabu tenure / AMA population) is deliberately not read:
   * nothing on the page shows it, and the offsets above are the record of where
   * it lives if that ever changes.
   */
  function readRaceScalars(index) {
    const at = index * RACE_SNAPSHOT_STRIDE;
    const view = race.scalars;
    const flags = view.getUint32(at + 32, true);
    return {
      bestCost: view.getFloat64(at + 0, true),
      curCost: view.getFloat64(at + 8, true),
      evals: view.getFloat64(at + 16, true),
      statusKey: view.getUint32(at + 24, true),
      statusArg: view.getUint32(at + 28, true),
      done: (flags & 1) !== 0,
      bestChanged: (flags & 2) !== 0,
      curChanged: (flags & 4) !== 0,
      traceLen: view.getUint32(at + 36, true),
      orderLen: view.getUint32(at + 40, true),
      bestLen: view.getUint32(at + 44, true),
    };
  }

  /**
   * Pull the improvement points this method gained since the last slice.
   * `race_trace_write` writes (evaluations, cost) f64 pairs and returns pairs
   * written, so a delta longer than the scratch is drained in several calls.
   */
  function pullTrace(index, from, total) {
    if (total <= from) return null;
    const out = new Float64Array((total - from) * 2);
    let held = from;
    let cursor = 0;
    while (held < total) {
      const pairs = exportsApi.race_trace_write(index, held, race.tracePtr, RACE_TRACE_CHUNK);
      if (!pairs) break;
      bindRaceViews();
      out.set(race.traceView.subarray(0, pairs * 2), cursor);
      cursor += pairs * 2;
      held += pairs;
    }
    return cursor === out.length ? out : out.subarray(0, cursor).slice();
  }

  /**
   * `wasm_alloc(0)` hands back an unaligned pointer and an empty incumbent has
   * `order_len === 0`, so a zero length never becomes a view. Every block is
   * copied out of wasm memory before it travels: the receiver must not hold a
   * window onto a buffer the next slice will rewrite.
   */
  function copyOrders(source, index, length) {
    if (!source || !length) return null;
    const at = index * race.n;
    return source.slice(at, at + length);
  }

  function beginRace(payload) {
    ensureInitialized();
    if (!selected) fail('NO_INSTANCE', 'Select a catalog instance before starting a race.');
    ensureIdle();
    const budget = integer(payload.budget, 'budget', 1_000, 100_000_000, 250_000);
    const seed = integer(payload.seed, 'seed', 0, 0xffff_ffff, 1);
    const d = integer(payload.d, 'd', 1, Math.max(1, selected.n), selected.n >= 500 ? 50 : 2);
    const acceptRaw = payload.accept == null ? 'current' : payload.accept;
    const accept = acceptRaw === 1 || acceptRaw === 'best' ? 1
      : acceptRaw === 0 || acceptRaw === 'current' ? 0
        : null;
    if (accept == null) fail('BAD_CONFIG', 'accept must be "current" or "best".');
    const permute = payload.permute == null ? selected.n < 500 : Boolean(payload.permute);

    exportsApi.race_clear();
    // One scratch allocation for the whole race, over-allocated by 8 bytes so
    // the f64 view can start on an 8-byte boundary: `wasm_alloc` is a Vec<u8>
    // and promises alignment 1.
    const rawTrace = exportsApi.wasm_alloc(RACE_TRACE_CHUNK * 2 * Float64Array.BYTES_PER_ELEMENT + 8);
    const created = exportsApi.race_new(
      selected.instId,
      seed,
      budget >>> 0,
      Math.floor(budget / 0x1_0000_0000) >>> 0,
      d,
      accept,
      permute ? 1 : 0,
    );
    if (created !== RACE_METHOD_COUNT) fail('RACE_FAILED', 'The Rust engine refused to create the race.');
    race = {
      n: selected.n,
      seed,
      budget,
      config: { d, accept: accept === 1 ? 'best' : 'current', permute },
      snapshotPtr: exportsApi.race_snapshot_ptr(),
      ordersPtr: exportsApi.race_orders_ptr(),
      bestPtr: exportsApi.race_best_ptr(),
      tracePtr: alignUp(rawTrace, 8),
      boundBuffer: null,
      scalars: null,
      orders: null,
      bestOrders: null,
      traceView: null,
      sentTrace: new Array(RACE_METHOD_COUNT).fill(0),
      done: new Array(RACE_METHOD_COUNT).fill(false),
      ms: new Array(RACE_METHOD_COUNT).fill(0),
      slices: 0,
      intrusions: 0,
    };
    bindRaceViews();
    status = 'racing';
    emit('state', { state: stateSnapshot() });
    return {
      methods: RACE_METHOD_COUNT,
      instance: selected.name,
      n: selected.n,
      seed,
      budget,
      config: { ...race.config },
      state: stateSnapshot(),
    };
  }

  function stepRace(payload) {
    ensureInitialized();
    if (!race) fail('NO_RACE', 'Start a race before asking for a slice.');
    const slice = integer(payload.slice, 'slice', 1, 0xffff_ffff, 4_096);
    const wantOrders = Boolean(payload.wantOrders);

    // Every method that is not finished is stepped, every slice. There is no
    // way to sit one out: the page's method toggle hides a racer from the
    // charts, it does not stop it, because an equal evaluation budget per
    // method is the whole currency of the race.
    for (let index = 0; index < RACE_METHOD_COUNT; index += 1) {
      if (race.done[index]) continue;
      // Wall clock is measured HERE and only here: around the step, never
      // around the snapshot, the trace pull, the copies or the postMessage.
      const startedAt = clock();
      exportsApi.race_step(index, slice);
      race.ms[index] += Math.max(0, clock() - startedAt);
    }
    // bit0 refreshes the incumbent-order block, bit1 the best-order block. Best
    // orders are always refreshed inside wasm (a memcpy into a buffer that is
    // already there) because `best_changed` is only readable after the snapshot
    // that clears it — what costs is copying out to JS, and that stays gated.
    exportsApi.race_snapshot(wantOrders ? 3 : 2);
    bindRaceViews();

    const methods = [];
    const traces = [];
    const orders = [];
    const best = [];
    let allDone = true;
    for (let index = 0; index < RACE_METHOD_COUNT; index += 1) {
      const scalars = readRaceScalars(index);
      race.done[index] = scalars.done;
      if (!scalars.done) allDone = false;
      traces.push(pullTrace(index, race.sentTrace[index], scalars.traceLen));
      race.sentTrace[index] = scalars.traceLen;
      orders.push(wantOrders && scalars.curChanged
        ? copyOrders(race.orders, index, scalars.orderLen)
        : null);
      best.push(scalars.bestChanged ? copyOrders(race.bestOrders, index, scalars.bestLen) : null);
      methods.push({
        evals: scalars.evals,
        bestCost: scalars.bestCost,
        curCost: scalars.curCost,
        statusKey: scalars.statusKey,
        statusArg: scalars.statusArg,
        done: scalars.done,
        ms: race.ms[index],
      });
    }
    race.slices += 1;
    return { methods, traces, orders, best, allDone, intrusions: race.intrusions };
  }

  function clearRace() {
    ensureInitialized();
    if (!race) return { cleared: false, state: stateSnapshot() };
    const spent = { slices: race.slices, intrusions: race.intrusions, ms: race.ms.slice() };
    race = null;
    exportsApi.race_clear();
    status = configured ? 'configured' : selected ? 'instance-selected' : 'ready';
    emit('state', { state: stateSnapshot() });
    return { cleared: true, ...spent, state: stateSnapshot() };
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
    // Single-tenancy ledger for the wall-clock column. `race-slice` is the
    // race; `race-clear`, `state` and `dispose` end or only observe it. Anything
    // else serviced while a race is live would put foreign work on this thread
    // between two `race_step` calls, and the page must be able to say so.
    if (race && !['race-slice', 'race-clear', 'state', 'dispose'].includes(message.type)) {
      race.intrusions += 1;
    }
    switch (message.type) {
      case 'init':
        return initialize(payload);
      case 'race-new':
        return beginRace(payload);
      case 'race-slice':
        return stepRace(payload);
      case 'race-clear':
        return clearRace();
      case 'select-instance': {
        ensureInitialized();
        ensureIdle();
        ensureNoRace();
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
        ensureNoRace();
        configured = normalizeConfig(payload);
        status = 'configured';
        emit('state', { state: stateSnapshot() });
        return { configuration: { ...configured }, state: stateSnapshot() };
      case 'start':
        ensureNoRace();
        return beginSingle();
      case 'compare':
        ensureNoRace();
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
          race = null;
          if (exportsApi) { exportsApi.runs_clear(); exportsApi.race_clear(); }
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
