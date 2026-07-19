/* global SpreadsheetApp, LockService, PropertiesService, Utilities, IG_PAYLOAD */

var IG_SHEETS = Object.freeze({
  config: '_CONFIG',
  runs: '_RUNS',
  checkpoints: '_CHECKPOINTS',
  schedule: '_SCHEDULE',
  instance: '_INSTANCE',
  setups: '_SETUPS',
  state: '_STATE',
});
var IG_SIGNING_KEY_CACHE = null;
var IG_TRUST_MODEL_CACHE = Object.create(null);
var IG_VIEW_SHEET_NAMES = Object.freeze({
  start: Object.freeze({ en: 'START', pt: 'INÍCIO', legacy: 'START · INÍCIO' }),
  dashboard: Object.freeze({ en: 'DASHBOARD', pt: 'RESULTADO', legacy: 'DASHBOARD · RESULTADO' }),
  schedule: Object.freeze({ en: 'SCHEDULE', pt: 'PROGRAMAÇÃO', legacy: 'SCHEDULE · PROGRAMAÇÃO' }),
  experiments: Object.freeze({ en: 'EXPERIMENTS', pt: 'EXPERIMENTOS', legacy: 'EXPERIMENTS · EXPERIMENTOS' }),
  instance: Object.freeze({ en: 'INSTANCE', pt: 'INSTÂNCIA', legacy: 'INSTANCE · INSTÂNCIA' }),
  method: Object.freeze({ en: 'METHOD', pt: 'MÉTODO', legacy: 'METHOD · MÉTODO' }),
  engineering: Object.freeze({ en: 'ENGINEERING', pt: 'ENGENHARIA', legacy: 'ENGINEERING · ENGENHARIA' }),
});

function IG_writerUiCopy_() {
  if (typeof IG_uiCopy_ === 'function') return IG_uiCopy_(IG_currentLanguage_());
  return {
    busy: 'Another workbook update is still in progress.',
    runWritten: 'Verified run written to the dashboard.',
    experimentWritten: 'Verified experiment written to the dashboard.',
    experimentRange: 'An experiment requires 1 to 64 runs.',
    sameInstanceBudget: 'Every experiment run must use the same instance and iteration budget.',
    sameAlgorithm: 'Every experiment run must use the same algorithm configuration.',
    uniqueSeeds: 'Experiment seeds must be unique.',
  };
}

function IG_signingKey_() {
  if (IG_SIGNING_KEY_CACHE) return IG_SIGNING_KEY_CACHE;
  var properties = PropertiesService.getDocumentProperties();
  var key = properties.getProperty('IG_RESULT_SIGNING_KEY_V1');
  if (key) {
    IG_SIGNING_KEY_CACHE = key;
    return key;
  }
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error(IG_writerUiCopy_().busy);
  try {
    key = properties.getProperty('IG_RESULT_SIGNING_KEY_V1');
    if (!key) {
      key = Utilities.getUuid() + Utilities.getUuid();
      properties.setProperty('IG_RESULT_SIGNING_KEY_V1', key);
    }
    IG_SIGNING_KEY_CACHE = key;
    return key;
  } finally {
    lock.releaseLock();
  }
}

function IG_signatureEnvelope_(result) {
  var config = result && result.config ? result.config : {};
  return JSON.stringify({
    schemaVersion: result && result.schemaVersion,
    instance: result && result.instance,
    seed: result && result.seed,
    config: {
      instance: config.instance,
      seed: config.seed,
      iterationBudget: config.iterationBudget,
      d: config.d,
      accept: config.accept,
      permute: config.permute,
      checkpointCount: config.checkpointCount,
    },
    bestCost: result && result.bestCost,
    iterations: result && result.iterations,
    evaluations: result && result.evaluations,
    elapsedMs: result && result.elapsedMs,
    compileMs: result && result.compileMs,
    parseMs: result && result.parseMs,
    searchMs: result && result.searchMs,
    order: Array.from((result && result.order) || []),
    checkpoints: Array.from((result && result.checkpoints) || []).map(function(point) {
      return {
        iteration: point && point.iteration,
        evaluations: point && point.evaluations,
        bestCost: point && point.bestCost,
      };
    }),
  });
}

function IG_authTag_(result) {
  var bytes = Utilities.computeHmacSha256Signature(IG_signatureEnvelope_(result), IG_signingKey_());
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function IG_constantTimeEqual_(left, right) {
  left = String(left || '');
  right = String(right || '');
  var difference = left.length ^ right.length;
  var length = Math.max(left.length, right.length);
  for (var index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index % Math.max(1, left.length)) || 0)
      ^ (right.charCodeAt(index % Math.max(1, right.length)) || 0);
  }
  return difference === 0;
}

function IG_signRunResult_(result) {
  return Object.assign({}, result, { authTag: IG_authTag_(result) });
}

function IG_verifyRunSignature_(result) {
  if (!result || typeof result.authTag !== 'string' || !IG_constantTimeEqual_(result.authTag, IG_authTag_(result))) {
    throw new Error('Run result failed its server round-trip integrity check.');
  }
}

function IG_sheet_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Workbook contract is missing sheet ' + name + '.');
  return sheet;
}

function IG_viewSheet_(key) {
  var names = IG_VIEW_SHEET_NAMES[key];
  if (!names) throw new Error('Unknown presentation sheet key ' + key + '.');
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(names.en)
    || spreadsheet.getSheetByName(names.pt)
    || spreadsheet.getSheetByName(names.legacy);
  if (!sheet) throw new Error('Workbook contract is missing presentation sheet ' + key + '.');
  return sheet;
}

function IG_ensureSheetSize_(sheet, rows, columns) {
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < columns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
  }
}

function IG_setTable_(sheetName, headers, rows, clearRows) {
  var sheet = IG_sheet_(sheetName);
  var requiredRows = Math.max(2, rows.length + 1);
  var requiredColumns = Math.max(1, headers.length);
  IG_ensureSheetSize_(sheet, requiredRows, requiredColumns);
  var rowsToClear = Math.max(requiredRows, sheet.getLastRow(), clearRows ? clearRows + 1 : 0);
  var columnsToClear = Math.max(requiredColumns, sheet.getLastColumn());
  IG_ensureSheetSize_(sheet, rowsToClear, columnsToClear);
  sheet.getRange(1, 1, rowsToClear, columnsToClear).clearContent();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function IG_validatedOrder_(result, model) {
  if (!result || typeof result !== 'object') throw new TypeError('Run result is required.');
  var order = Array.from(result.order || [], Number);
  var seen = new Set();
  order.forEach(function(internalId) {
    if (!Number.isSafeInteger(internalId) || internalId < 0 || internalId >= model.jobs.length) {
      throw new RangeError('Run contains an invalid job id.');
    }
    if (seen.has(internalId)) throw new RangeError('Run contains a duplicate job id.');
    seen.add(internalId);
  });
  return order;
}

function IG_resultInteger_(value, label, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(label + ' is outside its valid integer range.');
  }
  return value;
}

function IG_resultNumber_(value, label, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(label + ' is outside its valid numeric range.');
  }
  return value;
}

function IG_optionalDuration_(value, label, elapsedMs) {
  if (value == null) return null;
  return IG_resultNumber_(value, label, 0, Math.max(3600000, elapsedMs));
}

function IG_validateCheckpoints_(result, config, evaluations, bestCost) {
  var source = result.checkpoints;
  if (!Array.isArray(source)) throw new TypeError('Run checkpoints are required.');
  var every = Math.max(1, Math.ceil(config.iterationBudget / config.checkpointCount));
  var expectedIterations = [0];
  for (var boundary = every; boundary < config.iterationBudget; boundary += every) {
    expectedIterations.push(boundary);
  }
  expectedIterations.push(config.iterationBudget);
  if (source.length !== expectedIterations.length) {
    throw new Error('Run checkpoints do not match the configured sampling cadence.');
  }

  var previousEvaluations = -1;
  var previousCost = Number.POSITIVE_INFINITY;
  var checkpoints = source.map(function(point, index) {
    if (!point || typeof point !== 'object') throw new TypeError('A run checkpoint is malformed.');
    var iteration = IG_resultInteger_(point.iteration, 'checkpoint iteration', 0, config.iterationBudget);
    if (iteration !== expectedIterations[index]) throw new Error('A run checkpoint has an unexpected iteration.');
    var pointEvaluations = IG_resultInteger_(point.evaluations, 'checkpoint evaluations', 0, Number.MAX_SAFE_INTEGER);
    var pointCost = IG_resultNumber_(point.bestCost, 'checkpoint cost', 0, Number.MAX_SAFE_INTEGER);
    if (pointEvaluations < previousEvaluations) throw new Error('Checkpoint evaluations must be monotone.');
    if (pointCost > previousCost + 0.0000001) throw new Error('The incumbent cost must never increase.');
    previousEvaluations = pointEvaluations;
    previousCost = pointCost;
    return { iteration: iteration, evaluations: pointEvaluations, bestCost: pointCost };
  });

  var finalPoint = checkpoints[checkpoints.length - 1];
  if (finalPoint.evaluations !== evaluations || Math.abs(finalPoint.bestCost - bestCost) > 0.0000001) {
    throw new Error('The final checkpoint does not close to the reported run result.');
  }
  return checkpoints;
}

function IG_trustResult_(result) {
  if (!result || typeof result !== 'object') throw new TypeError('Run result is required.');
  IG_verifyRunSignature_(result);
  if (Number(result.schemaVersion) !== 1) throw new Error('Unsupported run result schema.');
  var config = IG_normalizeConfig_(result.config || result);
  var item = IG_unpackCatalog_()[config.instance];
  var cachedModel = IG_TRUST_MODEL_CACHE[config.instance];
  if (!cachedModel || cachedModel.csv !== item.csv) {
    cachedModel = { csv: item.csv, model: IG_parseInstance_(item.csv, config.instance) };
    IG_TRUST_MODEL_CACHE[config.instance] = cachedModel;
  }
  var model = cachedModel.model;
  if (String(result.instance) !== config.instance) throw new Error('Run instance and configuration disagree.');
  if (IG_resultInteger_(result.seed, 'seed', 0, 0xffffffff) !== config.seed) {
    throw new Error('Run seed and configuration disagree.');
  }
  var iterations = IG_resultInteger_(result.iterations, 'iterations', 0, IG_MAX_ITERATIONS);
  if (iterations !== config.iterationBudget) throw new Error('Run did not complete its configured iteration budget.');
  var evaluations = IG_resultInteger_(result.evaluations, 'evaluations', 0, Number.MAX_SAFE_INTEGER);
  var elapsedMs = IG_resultNumber_(result.elapsedMs, 'runtime', 0, 3600000);
  var compileMs = IG_optionalDuration_(result.compileMs, 'compile time', elapsedMs);
  var parseMs = IG_optionalDuration_(result.parseMs, 'parse time', elapsedMs);
  var searchMs = IG_optionalDuration_(result.searchMs, 'search time', elapsedMs);
  if (compileMs != null && parseMs != null && compileMs + parseMs > elapsedMs + 1) {
    throw new Error('Run timing phases exceed the total runtime.');
  }
  if (searchMs != null && searchMs > elapsedMs + 1) throw new Error('Search time exceeds the total runtime.');
  if (
    compileMs != null && parseMs != null && searchMs != null
    && compileMs + parseMs + searchMs > elapsedMs + 2
  ) {
    throw new Error('Run timing phases do not close to the total runtime.');
  }
  var order = IG_validatedOrder_(result, model);
  var evaluation = IG_evaluateOrder_(model, order);
  if (evaluation.rows.some(function(row) { return !row.feasible; })) {
    throw new Error('Result violates at least one hard completion deadline.');
  }
  var reported = Number(result.bestCost);
  if (!Number.isFinite(reported) || Math.abs(evaluation.breakdown.total - reported) > 0.051) {
    throw new Error('Result failed independent objective verification.');
  }
  var checkpoints = IG_validateCheckpoints_(result, config, evaluations, evaluation.breakdown.total);
  var speedBasis = searchMs != null ? searchMs : elapsedMs;
  return {
    schemaVersion: 1,
    instance: config.instance,
    config: config,
    seed: config.seed,
    bestCost: evaluation.breakdown.total,
    iterations: config.iterationBudget,
    evaluations: evaluations,
    elapsedMs: elapsedMs,
    compileMs: compileMs,
    parseMs: parseMs,
    searchMs: searchMs,
    evaluationsPerSecond: speedBasis > 0 ? evaluations / (speedBasis / 1000) : null,
    order: order,
    checkpoints: checkpoints,
    evaluation: evaluation,
    instanceModel: IG_publicInstanceModel_(model),
    metadata: {
      jobs: model.jobs.length,
      families: model.familyCount,
      referenceCost: item.metadata && item.metadata.bestKnown != null
        ? Number(item.metadata.bestKnown)
        : null,
      dataset: item.metadata && item.metadata.dataset ? String(item.metadata.dataset) : '',
    },
    engine: {
      implementation: 'Rust WebAssembly',
      wasmBytes: IG_PAYLOAD.wasmBytes,
      fixedPointScale: 10,
    },
  };
}

function IG_quantile_(sorted, probability) {
  if (!sorted.length) return null;
  var position = (sorted.length - 1) * probability;
  var lower = Math.floor(position);
  var upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  var weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function IG_statistics_(values) {
  var data = values.map(Number).filter(Number.isFinite).sort(function(a, b) { return a - b; });
  if (!data.length) return { count: 0, min: null, q1: null, median: null, mean: null, q3: null, max: null, sd: null };
  var mean = data.reduce(function(sum, value) { return sum + value; }, 0) / data.length;
  var variance = data.length < 2 ? null : data.reduce(function(sum, value) {
    return sum + Math.pow(value - mean, 2);
  }, 0) / (data.length - 1);
  return {
    count: data.length,
    min: data[0],
    q1: IG_quantile_(data, 0.25),
    median: IG_quantile_(data, 0.5),
    mean: mean,
    q3: IG_quantile_(data, 0.75),
    max: data[data.length - 1],
    sd: variance == null ? null : Math.sqrt(Math.max(0, variance)),
  };
}

function IG_configRows_(mode, trustedRuns, best, stats) {
  var evaluation = best.evaluation;
  var reference = best.metadata.referenceCost;
  var gap = reference == null || reference <= 0 ? null : ((best.bestCost - reference) / reference) * 100;
  var currentLanguage = IG_currentLanguage_();
  return [
    ['language', currentLanguage],
    ['status', 'complete'],
    ['mode', mode],
    ['instance', best.instance],
    ['seed', best.seed],
    ['iteration_budget', best.iterations],
    ['destroy_size', best.config.d],
    ['acceptance', best.config.accept],
    ['permutation', best.config.permute],
    ['best_cost', best.bestCost],
    ['reference_cost', reference],
    ['gap_percent', gap],
    ['scheduled_jobs', evaluation.scheduledCount],
    ['rejected_jobs', evaluation.rejectedCount],
    ['makespan', evaluation.makespan],
    ['setup_cost', evaluation.breakdown.setup],
    ['execution_cost', evaluation.breakdown.execution],
    ['tardiness_cost', evaluation.breakdown.tardiness],
    ['rejection_cost', evaluation.breakdown.rejection],
    ['runtime_ms', best.elapsedMs],
    ['evaluations', best.evaluations],
    ['evaluations_per_second', best.evaluationsPerSecond],
    ['run_count', trustedRuns.length],
    ['median_cost', stats.median],
    ['q1_cost', stats.q1],
    ['q3_cost', stats.q3],
    ['sample_sd', stats.sd],
    ['updated_at_utc', new Date().toISOString()],
    ['engine', 'Rust WebAssembly / fixed-point x10'],
  ];
}

function IG_scheduleRows_(trusted) {
  return trusted.evaluation.rows.concat(trusted.evaluation.rejected).map(function(row) {
    return [
      row.position,
      row.status,
      row.jobId,
      row.family,
      row.releaseTime,
      row.due,
      row.hardDeadline,
      row.setupStart,
      row.setupTime,
      row.processStart,
      row.processingTime,
      row.finish,
      row.late,
      row.setupCost,
      row.executionCost,
      row.tardinessCost,
      row.rejectionCost,
      row.totalContribution,
      row.feasible,
    ];
  });
}

function IG_instanceRows_(trusted) {
  return trusted.instanceModel.jobs.map(function(job) {
    return [
      job.internalId,
      job.jobId,
      job.family,
      job.processingTime,
      job.releaseTime,
      job.due,
      job.hardDeadline,
      job.tardinessWeight,
      job.executionCost,
      job.rejectionCost,
    ];
  });
}

function IG_setupRows_(trusted) {
  var stateIds = Array.from({ length: trusted.instanceModel.stateCount }, function(unused, index) { return index; });
  var headers = ['from_to_time'].concat(stateIds.map(String), [''], ['from_to_cost'], stateIds.map(String));
  var rows = stateIds.map(function(from) {
    return [String(from)]
      .concat(stateIds.map(function(to) { return trusted.instanceModel.setupTime[from][to]; }))
      .concat(['', String(from)])
      .concat(stateIds.map(function(to) { return trusted.instanceModel.setupCost[from][to]; }));
  });
  return { headers: headers, rows: rows };
}

function IG_stateRows_(trusted) {
  return [
    ['job_count', trusted.metadata.jobs, 'Jobs in the active bundled instance'],
    ['family_count', trusted.metadata.families, 'Distinct setup families used by jobs'],
    ['horizon', trusted.instanceModel.horizon, 'Latest relevant time in the active instance'],
    ['gantt_bins', 32, 'Time buckets rendered in the schedule overview'],
    ['gantt_jobs', 20, 'Maximum scheduled jobs rendered in the overview'],
    ['engine_scale', trusted.engine.fixedPointScale, 'Canonical monetary fixed-point scale'],
    ['wasm_bytes', trusted.engine.wasmBytes, 'Embedded canonical engine payload size'],
    ['sample_environment', 'Google Apps Script V8', 'Runtime environment for the current results'],
    ['instance_initial_state', trusted.instanceModel.initialState, 'Machine setup state before the first job'],
  ];
}

function IG_refreshAuditFormulas_() {
  var runs = IG_sheet_(IG_SHEETS.runs);
  IG_ensureSheetSize_(runs, 101, 13);
  runs.getRange('L1:M1').setValues([['budget_match', 'seed_duplicate_count']]);
  runs.getRange('L2:L101').setFormulaR1C1('=IF(RC1="","",RC5=\'_CONFIG\'!R7C2)');
  runs.getRange('M2:M101').setFormulaR1C1('=IF(RC2="","",COUNTIF(R2C2:R101C2,RC2))');

  var checkpoints = IG_sheet_(IG_SHEETS.checkpoints);
  // Row 152 is a blank sentinel read by the formula in row 151.
  IG_ensureSheetSize_(checkpoints, 152, 10);
  checkpoints.getRange('A152:J152').clearContent();
  checkpoints.getRange('J1').setValue('monotone');
  checkpoints.getRange('J2:J151').setFormulaR1C1(
    '=IF(RC1="","",IF(R[1]C1="","PASS",IF(AND(R[1]C1>=RC1,R[1]C8>=RC8,R[1]C2<=RC2),"PASS","FAIL")))',
  );

  var schedule = IG_sheet_(IG_SHEETS.schedule);
  IG_ensureSheetSize_(schedule, 601, 20);
  schedule.getRange('T1').setValue('job_duplicate_count');
  schedule.getRange('T2:T601').setFormulaR1C1('=IF(RC3="","",COUNTIF(R2C3:R601C3,RC3))');
}

function IG_checkpointAggregate_(runs) {
  var longest = runs.reduce(function(maximum, run) {
    return Math.max(maximum, (run.checkpoints || []).length);
  }, 0);
  var rows = [];
  for (var index = 0; index < longest; index += 1) {
    var points = runs.map(function(run) { return (run.checkpoints || [])[index]; }).filter(Boolean);
    if (!points.length) continue;
    var stats = IG_statistics_(points.map(function(point) { return point.bestCost; }));
    var iteration = points[0].iteration;
    var meanEvaluations = points.reduce(function(sum, point) {
      return sum + Number(point.evaluations || 0);
    }, 0) / points.length;
    rows.push([
      iteration,
      stats.min,
      stats.q1,
      stats.median,
      stats.mean,
      stats.q3,
      stats.max,
      meanEvaluations,
      points.length,
    ]);
  }
  return rows;
}

function IG_writeTrustedRuns_(mode, trustedRuns) {
  if (!trustedRuns.length) throw new RangeError('At least one verified run is required.');
  var best = trustedRuns.slice().sort(function(left, right) {
    return left.bestCost - right.bestCost || left.seed - right.seed;
  })[0];
  var stats = IG_statistics_(trustedRuns.map(function(run) { return run.bestCost; }));
  var reference = best.metadata.referenceCost;
  var runRows = trustedRuns.map(function(run, index) {
    var evaluation = run.evaluation;
    return [
      index + 1,
      run.seed,
      run.bestCost,
      reference == null || reference <= 0 ? null : ((run.bestCost - reference) / reference) * 100,
      run.iterations,
      run.evaluations,
      run.elapsedMs,
      run.evaluationsPerSecond,
      evaluation.scheduledCount,
      evaluation.rejectedCount,
      run.seed === best.seed && run.bestCost === best.bestCost,
    ];
  });
  var setup = IG_setupRows_(best);

  IG_setTable_(IG_SHEETS.config, ['key', 'value'], IG_configRows_(mode, trustedRuns, best, stats), 40);
  IG_setTable_(IG_SHEETS.runs, [
    'run', 'seed', 'best_cost', 'gap_percent', 'iterations', 'evaluations',
    'runtime_ms', 'evaluations_per_second', 'scheduled_jobs', 'rejected_jobs', 'is_best',
  ], runRows, 100);
  IG_setTable_(IG_SHEETS.checkpoints, [
    'iteration', 'best', 'q1', 'median', 'mean', 'q3', 'worst', 'mean_evaluations', 'samples',
  ], IG_checkpointAggregate_(trustedRuns), 150);
  IG_setTable_(IG_SHEETS.schedule, [
    'position', 'status', 'job_id', 'family', 'release', 'due', 'hard_deadline',
    'setup_start', 'setup_time', 'process_start', 'processing_time', 'finish', 'late',
    'setup_cost', 'execution_cost', 'tardiness_cost', 'rejection_cost', 'total_contribution',
    'feasible',
  ], IG_scheduleRows_(best), 600);
  IG_setTable_(IG_SHEETS.instance, [
    'internal_id', 'job_id', 'family', 'processing_time', 'release', 'due',
    'hard_deadline', 'tardiness_weight', 'execution_cost', 'rejection_cost',
  ], IG_instanceRows_(best), 600);
  IG_setTable_(IG_SHEETS.setups, setup.headers, setup.rows, 30);
  IG_setTable_(IG_SHEETS.state, ['key', 'value', 'purpose'], IG_stateRows_(best), 12);
  IG_refreshAuditFormulas_();
  SpreadsheetApp.flush();
  return { best: best, stats: stats };
}

function IG_commitSingle_(result) {
  var trusted = IG_trustResult_(result);
  var copy = IG_writerUiCopy_();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error(copy.busy);
  try {
    var written = IG_writeTrustedRuns_('single', [trusted]);
    SpreadsheetApp.getActive().toast(copy.runWritten, 'IG Scheduler', 5);
    return IG_publicWriteReceipt_(written.best, written.stats, 1);
  } finally {
    lock.releaseLock();
  }
}

function IG_commitExperiment_(payload) {
  var copy = IG_writerUiCopy_();
  var runs = payload && Array.isArray(payload.runs) ? payload.runs : [];
  if (!runs.length || runs.length > 64) throw new RangeError(copy.experimentRange);
  var trusted = runs.map(IG_trustResult_);
  var instance = trusted[0].instance;
  var budget = trusted[0].iterations;
  var baseline = trusted[0].config;
  var seeds = new Set();
  trusted.forEach(function(run) {
    if (run.instance !== instance || run.iterations !== budget) {
      throw new Error(copy.sameInstanceBudget);
    }
    if (
      run.config.d !== baseline.d
      || run.config.accept !== baseline.accept
      || run.config.permute !== baseline.permute
      || run.config.checkpointCount !== baseline.checkpointCount
    ) {
      throw new Error(copy.sameAlgorithm);
    }
    if (seeds.has(run.seed)) throw new Error(copy.uniqueSeeds);
    seeds.add(run.seed);
  });
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error(copy.busy);
  try {
    var written = IG_writeTrustedRuns_('experiment', trusted);
    SpreadsheetApp.getActive().toast(copy.experimentWritten, 'IG Scheduler', 5);
    return IG_publicWriteReceipt_(written.best, written.stats, trusted.length);
  } finally {
    lock.releaseLock();
  }
}

function IG_publicWriteReceipt_(best, stats, runCount) {
  return {
    instance: best.instance,
    seed: best.seed,
    bestCost: best.bestCost,
    referenceCost: best.metadata.referenceCost,
    runCount: runCount,
    scheduledJobs: best.evaluation.scheduledCount,
    rejectedJobs: best.evaluation.rejectedCount,
    median: stats.median,
    q1: stats.q1,
    q3: stats.q3,
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
  };
}

function IG_currentLanguage_() {
  try {
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) return 'en';
    var configSheet = spreadsheet.getSheetByName(IG_SHEETS.config);
    if (!configSheet) return 'en';
    var values = configSheet.getRange('A1:B40').getValues();
    for (var index = 0; index < values.length; index += 1) {
      if (values[index][0] === 'language') return values[index][1] === 'pt-BR' ? 'pt-BR' : 'en';
    }
  } catch (error) {
    console.warn(error);
  }
  return 'en';
}

function IG_setLanguage_(language) {
  var value = language === 'pt-BR' ? 'pt-BR' : 'en';
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error(IG_writerUiCopy_().busy);
  try {
    var sheet = IG_sheet_(IG_SHEETS.config);
    var values = sheet.getRange('A1:B40').getValues();
    var row = 2;
    for (var index = 0; index < values.length; index += 1) {
      if (values[index][0] === 'language') {
        row = index + 1;
        break;
      }
    }
    sheet.getRange(row, 1, 1, 2).setValues([['language', value]]);
    IG_localizeWorkbook_(value);
    IG_addMenu_(value);
    SpreadsheetApp.flush();
    return value;
  } finally {
    lock.releaseLock();
  }
}

function IG_localizeWorkbook_(language) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var targetKey = language === 'pt-BR' ? 'pt' : 'en';
  Object.keys(IG_VIEW_SHEET_NAMES).forEach(function(key) {
    var sheet = IG_viewSheet_(key);
    var targetName = IG_VIEW_SHEET_NAMES[key][targetKey];
    if (sheet.getName() !== targetName) sheet.setName(targetName);
  });

  // Locale-aware number separators complement the formula-driven copy in the
  // presentation sheets. Technical values remain numeric and unchanged.
  spreadsheet.setSpreadsheetLocale(language === 'pt-BR' ? 'pt_BR' : 'en_US');

  var chartCopy = language === 'pt-BR' ? {
    dashboard: [
      { title: 'Melhor objetivo nas execuções com mesmo orçamento' },
      { title: 'Contribuição de custo por componente' },
    ],
    experiments: [
      {
        title: 'Objetivo por semente versus referência histórica',
        series: {
          0: { color: '#0C7C82', labelInLegend: 'Objetivo' },
          1: { color: '#D99A2B', labelInLegend: 'Referência histórica' },
        },
      },
      {
        title: 'Melhor, mediana e pior objetivo por iteração',
        series: {
          0: { color: '#0C7C82', labelInLegend: 'Melhor' },
          1: { color: '#D99A2B', labelInLegend: 'Mediana' },
          2: { color: '#2F8A63', labelInLegend: 'Pior' },
        },
      },
    ],
    instance: [
      { title: 'Carga de processamento por família' },
      { title: 'Perfil de prazos por ID do job' },
    ],
  } : {
    dashboard: [
      { title: 'Best objective across equal-budget runs' },
      { title: 'Cost contribution by component' },
    ],
    experiments: [
      {
        title: 'Objective by seed vs historical reference',
        series: {
          0: { color: '#0C7C82', labelInLegend: 'Objective' },
          1: { color: '#D99A2B', labelInLegend: 'Historical reference' },
        },
      },
      {
        title: 'Best, median and worst objective by iteration',
        series: {
          0: { color: '#0C7C82', labelInLegend: 'Best' },
          1: { color: '#D99A2B', labelInLegend: 'Median' },
          2: { color: '#2F8A63', labelInLegend: 'Worst' },
        },
      },
    ],
    instance: [
      { title: 'Processing workload by family' },
      { title: 'Due-date profile by job ID' },
    ],
  };

  Object.keys(chartCopy).forEach(function(key) {
    var presentationSheet = IG_viewSheet_(key);
    var charts = presentationSheet.getCharts();
    chartCopy[key].forEach(function(options, index) {
      if (!charts[index]) return;
      var builder = charts[index].modify().setOption('title', options.title);
      if (options.series) builder.setOption('series', options.series);
      presentationSheet.updateChart(builder.build());
    });
  });

  if (typeof IG_uiCopy_ === 'function') {
    var buttonCopy = IG_uiCopy_(language);
    IG_viewSheet_('start').getImages().forEach(function(image) {
      if (image.getAltTextTitle() === 'IG_CONTROL_PANEL_BUTTON') {
        image.setAltTextDescription(buttonCopy.buttonAlt);
      }
    });
  }
}
