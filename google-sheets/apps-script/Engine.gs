/* global IG_PAYLOAD, Utilities, WebAssembly */

var IG_CATALOG_CACHE = null;
var IG_DEFAULT_INSTANCE = 'STC_NCOS_32';

function IG_integer_(value, label, minimum, maximum, fallback) {
  var candidate = value == null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new RangeError(label + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
  }
  return candidate;
}

function IG_boolean_(value, label, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'boolean') throw new TypeError(label + ' must be true or false.');
  return value;
}

function IG_unpackCatalog_() {
  if (IG_CATALOG_CACHE) return IG_CATALOG_CACHE;
  var compressed = Utilities.base64Decode(IG_PAYLOAD.catalogGzipBase64);
  var blob = Utilities.newBlob(compressed, 'application/gzip', 'instances.json.gz');
  var json = Utilities.ungzip(blob).getDataAsString('UTF-8');
  IG_CATALOG_CACHE = JSON.parse(json);
  return IG_CATALOG_CACHE;
}

function IG_catalogJobCount_(item, name) {
  var reported = Number(item && item.metadata ? item.metadata.jobs : 0);
  if (Number.isSafeInteger(reported) && reported > 0) return reported;
  return IG_parseInstance_(item.csv, name).jobs.length;
}

function IG_catalogRows_() {
  var catalog = IG_unpackCatalog_();
  return Object.keys(catalog).sort().map(function(name) {
    var metadata = catalog[name].metadata || {};
    var n = IG_catalogJobCount_(catalog[name], name);
    return {
      id: name,
      jobs: n,
      referenceCost: metadata.bestKnown == null ? null : Number(metadata.bestKnown),
      dataset: metadata.dataset || '',
      family: metadata.family || 'standard',
      suggestedIterations: n >= 500 ? 120 : n >= 200 ? 500 : n >= 90 ? 1200 : n >= 50 ? 2500 : 5000,
      suggestedD: n >= 500 ? 50 : 2,
      suggestedPermute: n < 500,
    };
  });
}

function IG_normalizeConfig_(raw) {
  raw = raw || {};
  var catalog = IG_unpackCatalog_();
  var instance = String(raw.instance || IG_DEFAULT_INSTANCE);
  if (!catalog[instance]) throw new RangeError('Unknown bundled instance: ' + instance + '.');
  var metadata = catalog[instance].metadata || {};
  var n = IG_catalogJobCount_(catalog[instance], instance);
  var accept = raw.accept == null ? 'current' : String(raw.accept);
  if (accept !== 'current' && accept !== 'best') {
    throw new RangeError('accept must be current or best.');
  }
  var iterationFallback = n >= 500 ? 120 : n >= 200 ? 500 : n >= 90 ? 1200 : n >= 50 ? 2500 : 5000;
  return {
    instance: instance,
    seed: IG_integer_(raw.seed, 'seed', 0, 0xffffffff, 1),
    iterationBudget: IG_integer_(raw.iterationBudget, 'iterationBudget', 1, IG_MAX_ITERATIONS, iterationFallback),
    d: IG_integer_(raw.d, 'd', 1, Math.max(1, n), n >= 500 ? 50 : 2),
    accept: accept,
    permute: IG_boolean_(raw.permute, 'permute', n < 500),
    checkpointCount: IG_integer_(raw.checkpointCount, 'checkpointCount', 5, 100, 40),
  };
}

function IG_validateExports_(api) {
  var required = [
    'memory', 'wasm_alloc', 'inst_load', 'inst_n', 'run_new', 'run_step',
    'run_best_cost', 'run_best_len', 'run_best_write', 'run_iters',
    'run_evals', 'runs_clear',
  ];
  required.forEach(function(name) {
    if (!(name in api)) throw new Error('Embedded engine is missing export: ' + name + '.');
  });
}

function IG_unsignedBytes_(bytes) {
  return Uint8Array.from(bytes, function(value) { return value & 255; });
}

async function IG_instantiateEngine_() {
  var wasmBytes = IG_unsignedBytes_(Utilities.base64Decode(IG_PAYLOAD.wasmBase64));
  var loaded = await WebAssembly.instantiate(wasmBytes, {});
  var api = loaded.instance ? loaded.instance.exports : loaded.exports;
  IG_validateExports_(api);
  return api;
}

function IG_loadInstance_(api, csv) {
  var encoded = IG_unsignedBytes_(Utilities.newBlob(csv, 'text/plain').getBytes());
  var pointer = api.wasm_alloc(encoded.length);
  new Uint8Array(api.memory.buffer, pointer, encoded.length).set(encoded);
  var instanceId = Number(api.inst_load(pointer, encoded.length));
  if (instanceId < 0) throw new Error('The embedded Rust engine rejected the bundled instance.');
  return instanceId;
}

function IG_readOrder_(api, runId) {
  var length = Number(api.run_best_len(runId));
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('The embedded engine returned an invalid order length.');
  var pointer = api.wasm_alloc(length * Uint32Array.BYTES_PER_ELEMENT);
  api.run_best_write(runId, pointer);
  return Array.from(new Uint32Array(api.memory.buffer, pointer, length));
}

function IG_snapshot_(api, runId) {
  return {
    iteration: Number(api.run_iters(runId)),
    evaluations: Number(api.run_evals(runId)),
    bestCost: Number(api.run_best_cost(runId)),
  };
}

async function IG_computeRun_(rawConfig) {
  var includeDetail = !(rawConfig && rawConfig.compact === true);
  var config = IG_normalizeConfig_(rawConfig);
  var catalog = IG_unpackCatalog_();
  var item = catalog[config.instance];
  var startedAt = Date.now();
  var api = await IG_instantiateEngine_();
  var compiledAt = Date.now();
  var instanceId = IG_loadInstance_(api, item.csv);
  var engineJobs = Number(api.inst_n(instanceId));
  if (!Number.isSafeInteger(engineJobs) || engineJobs < 0) {
    throw new Error('The embedded engine returned an invalid instance size.');
  }
  var parsedAt = Date.now();
  // run_new performs the randomized construction and may already execute a
  // substantial number of candidate evaluations, so it belongs to search.
  var searchStartedAt = Date.now();
  var runId = Number(api.run_new(
    instanceId,
    config.d,
    config.accept === 'best' ? 1 : 0,
    config.permute ? 1 : 0,
    config.seed,
  ));
  if (!Number.isSafeInteger(runId) || runId < 0) throw new Error('The embedded engine could not start the run.');
  var checkpoints = [IG_snapshot_(api, runId)];
  var checkpointEvery = Math.max(1, Math.ceil(config.iterationBudget / config.checkpointCount));

  while (Number(api.run_iters(runId)) < config.iterationBudget) {
    var completed = Number(api.run_iters(runId));
    var boundary = Math.min(
      config.iterationBudget,
      (Math.floor(completed / checkpointEvery) + 1) * checkpointEvery,
    );
    api.run_step(runId, boundary - completed);
    checkpoints.push(IG_snapshot_(api, runId));
  }

  var finishedAt = Date.now();
  var finalSnapshot = IG_snapshot_(api, runId);
  var order = IG_readOrder_(api, runId);
  var model = IG_parseInstance_(item.csv, config.instance);
  if (engineJobs !== model.jobs.length) {
    throw new Error('Canonical and independent parsers disagree on the number of jobs.');
  }
  if (order.length > engineJobs) throw new Error('The embedded engine returned more jobs than the instance contains.');
  var evaluation = IG_evaluateOrder_(model, order);
  if (evaluation.rows.some(function(row) { return !row.feasible; })) {
    throw new Error('The embedded engine returned a schedule that violates a hard deadline.');
  }
  if (Math.abs(evaluation.breakdown.total - finalSnapshot.bestCost) > 0.051) {
    throw new Error(
      'Independent evaluator mismatch: engine=' + finalSnapshot.bestCost
      + ', reconstructed=' + evaluation.breakdown.total + '.',
    );
  }
  api.runs_clear();

  return {
    schemaVersion: 1,
    instance: config.instance,
    metadata: {
      jobs: model.jobs.length,
      families: model.familyCount,
      referenceCost: item.metadata && item.metadata.bestKnown != null
        ? Number(item.metadata.bestKnown)
        : null,
      dataset: item.metadata && item.metadata.dataset ? item.metadata.dataset : '',
    },
    config: config,
    seed: config.seed,
    bestCost: finalSnapshot.bestCost,
    iterations: finalSnapshot.iteration,
    evaluations: finalSnapshot.evaluations,
    elapsedMs: finishedAt - startedAt,
    compileMs: compiledAt - startedAt,
    parseMs: parsedAt - compiledAt,
    searchMs: finishedAt - searchStartedAt,
    evaluationsPerSecond: (finishedAt - searchStartedAt) > 0
      ? finalSnapshot.evaluations / ((finishedAt - searchStartedAt) / 1000)
      : null,
    order: order,
    checkpoints: checkpoints,
    evaluation: includeDetail ? evaluation : {
      scheduledCount: evaluation.scheduledCount,
      rejectedCount: evaluation.rejectedCount,
      makespan: evaluation.makespan,
      breakdown: evaluation.breakdown,
    },
    instanceModel: includeDetail ? IG_publicInstanceModel_(model) : null,
    engine: {
      implementation: 'Rust WebAssembly',
      wasmBytes: IG_PAYLOAD.wasmBytes,
      fixedPointScale: 10,
    },
  };
}
