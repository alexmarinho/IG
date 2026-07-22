/* global IG_PAYLOAD, Utilities, WebAssembly */

var IG_CATALOG_CACHE = null;
var IG_CSV_CACHE = {};
var IG_WASM_MODULE_CACHE = null;
var IG_DEFAULT_INSTANCE = 'STC_NCOS_32';
// Upper bound on seeds per experiment chunk: the sidebar sends small chunks so
// each server execution stays well under the Apps Script 6-minute limit even on
// the largest bundled instances; this only guards against an oversized request.
var IG_MAX_EXPERIMENT_SEEDS = 16;

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

function IG_instanceCsv_(name) {
  if (!Object.prototype.hasOwnProperty.call(IG_CSV_CACHE, name)) {
    var encoded = IG_PAYLOAD.instanceGzipBase64[name];
    if (!encoded) throw new RangeError('Unknown bundled instance: ' + name + '.');
    var compressed = Utilities.base64Decode(encoded);
    var blob = Utilities.newBlob(compressed, 'application/gzip', name + '.csv.gz');
    IG_CSV_CACHE[name] = Utilities.ungzip(blob).getDataAsString('UTF-8');
  }
  return IG_CSV_CACHE[name];
}

function IG_unpackCatalog_() {
  // Metadata is a small plain-JSON map; each instance's CSV is ungzipped only on
  // first access. Listing the catalog (the sidebar bootstrap) therefore never
  // decompresses a single instance, while `item.csv` still works everywhere.
  if (IG_CATALOG_CACHE) return IG_CATALOG_CACHE;
  var meta = JSON.parse(IG_PAYLOAD.catalogMetaJson);
  var catalog = {};
  Object.keys(meta).forEach(function(name) {
    var entry = { metadata: meta[name] };
    Object.defineProperty(entry, 'csv', {
      enumerable: true,
      get: function() { return IG_instanceCsv_(name); },
    });
    catalog[name] = entry;
  });
  IG_CATALOG_CACHE = catalog;
  return catalog;
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

function IG_wasmModule_() {
  // Compile the embedded engine once per server execution and reuse the compiled
  // Module across every seed in an experiment; only the cheap instantiation is
  // repeated. (Apps Script resets globals between executions, so this pays off
  // within a chunked experiment call, not across separate single runs.)
  if (!IG_WASM_MODULE_CACHE) {
    var wasmBytes = IG_unsignedBytes_(Utilities.base64Decode(IG_PAYLOAD.wasmBase64));
    IG_WASM_MODULE_CACHE = new WebAssembly.Module(wasmBytes);
  }
  return IG_WASM_MODULE_CACHE;
}

async function IG_instantiateModule_(module) {
  // A fresh instance per run keeps runs_clear semantics and linear-memory
  // isolation unchanged; instantiating a pre-compiled Module is ~0.1 ms.
  var loaded = await WebAssembly.instantiate(module, {});
  var api = loaded.instance ? loaded.instance.exports : loaded.exports;
  IG_validateExports_(api);
  return api;
}

async function IG_instantiateEngine_() {
  return IG_instantiateModule_(IG_wasmModule_());
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
  var model = IG_parseInstance_(item.csv, config.instance);
  return IG_runSeeded_(IG_wasmModule_(), item, model, config, config.seed, includeDetail);
}

// One server execution that runs every requested seed on the same instance,
// compiling the engine and unpacking the catalog once. Semantics are identical
// to calling IG_computeRun_ per seed — same engine, same per-seed signing later
// — only the orchestration (and amortized compile/parse metadata) changes.
async function IG_computeExperiment_(rawConfig, seeds) {
  if (!Array.isArray(seeds) || !seeds.length) throw new RangeError('At least one seed is required.');
  if (seeds.length > IG_MAX_EXPERIMENT_SEEDS) {
    throw new RangeError('An experiment chunk may not exceed ' + IG_MAX_EXPERIMENT_SEEDS + ' seeds.');
  }
  var config = IG_normalizeConfig_(rawConfig);
  var catalog = IG_unpackCatalog_();
  var item = catalog[config.instance];
  var model = IG_parseInstance_(item.csv, config.instance);
  var module = IG_wasmModule_();
  var results = [];
  for (var i = 0; i < seeds.length; i += 1) {
    var seed = IG_integer_(seeds[i], 'seed', 0, 0xffffffff, config.seed);
    results.push(await IG_runSeeded_(module, item, model, config, seed, false));
  }
  return results;
}

async function IG_runSeeded_(module, item, model, config, seed, includeDetail) {
  // Each run reports its own seed as config.seed so the trust boundary
  // (result.seed === config.seed) and the signature envelope stay consistent.
  var runConfig = seed === config.seed ? config : Object.assign({}, config, { seed: seed });
  var startedAt = Date.now();
  var api = await IG_instantiateModule_(module);
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
    runConfig.d,
    runConfig.accept === 'best' ? 1 : 0,
    runConfig.permute ? 1 : 0,
    seed,
  ));
  if (!Number.isSafeInteger(runId) || runId < 0) throw new Error('The embedded engine could not start the run.');
  var checkpoints = [IG_snapshot_(api, runId)];
  var checkpointEvery = Math.max(1, Math.ceil(runConfig.iterationBudget / runConfig.checkpointCount));

  while (Number(api.run_iters(runId)) < runConfig.iterationBudget) {
    var completed = Number(api.run_iters(runId));
    var boundary = Math.min(
      runConfig.iterationBudget,
      (Math.floor(completed / checkpointEvery) + 1) * checkpointEvery,
    );
    api.run_step(runId, boundary - completed);
    checkpoints.push(IG_snapshot_(api, runId));
  }

  var finishedAt = Date.now();
  var finalSnapshot = IG_snapshot_(api, runId);
  var order = IG_readOrder_(api, runId);
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
    instance: runConfig.instance,
    metadata: {
      jobs: model.jobs.length,
      families: model.familyCount,
      referenceCost: item.metadata && item.metadata.bestKnown != null
        ? Number(item.metadata.bestKnown)
        : null,
      dataset: item.metadata && item.metadata.dataset ? item.metadata.dataset : '',
    },
    config: runConfig,
    seed: seed,
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
