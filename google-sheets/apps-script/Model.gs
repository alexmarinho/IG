var IG_MAX_ITERATIONS = 100000;

function IG_dataInteger_(value, fallback, label) {
  if (value == null || String(value).trim() === '') return fallback;
  var parsed = Number(String(value).trim());
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError((label || 'Integer field') + ' is not a safe integer.');
  }
  return parsed;
}

function IG_deci_(value, fallback) {
  if (value == null || value === '') return fallback || 0;
  var parsed = Number(String(value).trim());
  if (!Number.isFinite(parsed)) throw new TypeError('A monetary field is not numeric.');
  var scaled = parsed * 10;
  // Rust f64::round() rounds half-way cases away from zero.
  return scaled < 0 ? Math.ceil(scaled - 0.5) : Math.floor(scaled + 0.5);
}

function IG_parseInstance_(text, fallbackName) {
  var headers = {};
  var activities = {};
  var dues = {};
  var modes = {};
  var setups = [];
  var name = fallbackName || 'instance';
  var initialState = 0;
  var resourceCount = 0;

  String(text).split(/\r?\n/).forEach(function(sourceLine) {
    var line = sourceLine.trim();
    if (!line) return;
    var cells = line.split(',');
    var rawTag = cells[0];
    var pipe = rawTag.indexOf('|');
    if (pipe >= 0) {
      if (rawTag.slice(pipe + 1) === 'NAMES') headers[rawTag.slice(0, pipe)] = cells.slice(1);
      return;
    }
    var tag = rawTag;
    var sectionHeaders = headers[tag] || [];
    var value = function(field) {
      var index = sectionHeaders.indexOf(field);
      return index < 0 ? undefined : cells[index + 1];
    };
    var number = function(field, fallback) {
      return IG_dataInteger_(
        value(field),
        fallback == null ? 0 : fallback,
        tag + '.' + field,
      );
    };

    if (tag === 'MODEL') name = value('NAME') || name;
    else if (tag === 'RESOURCE') {
      resourceCount += 1;
      if (resourceCount > 1) throw new Error('Multi-resource instances are not supported.');
      initialState = number('INITIAL_SETUP_STATE', 0);
      if (initialState < 0) throw new RangeError('INITIAL_SETUP_STATE cannot be negative.');
    } else if (tag === 'ACTIVITY') {
      var activityId = number('ACTIVITY_ID', 0);
      var activityState = number('SETUP_STATE', 0);
      if (activityId < 0 || activityState < 0) throw new RangeError('Activity ids and states cannot be negative.');
      activities[activityId] = activityState;
    } else if (tag === 'DUE_DATE') {
      var dueActivityId = number('ACTIVITY_ID', 0);
      if (dueActivityId < 0) throw new RangeError('ACTIVITY_ID cannot be negative.');
      dues[dueActivityId] = {
        due: number('DUE_TIME', 0),
        weightDeci: IG_deci_(value('TARDINESS_VARIABLE_COST'), 0),
      };
    } else if (tag === 'MODE') {
      var modeActivityId = number('ACTIVITY_ID', 0);
      if (modeActivityId < 0) throw new RangeError('ACTIVITY_ID cannot be negative.');
      if (Object.prototype.hasOwnProperty.call(modes, modeActivityId)) {
        throw new Error('Multiple MODE rows for one activity are not supported.');
      }
      modes[modeActivityId] = {
        executionCostDeci: IG_deci_(value('MODE_COST'), 0),
        processingTime: number('PROCESSING_TIME', 0),
        releaseTime: number('START_MIN', 0),
        hardDeadline: number('END_MAX', Number.MAX_SAFE_INTEGER),
        rejectionCostDeci: IG_deci_(value('UNPERFORMED_COST'), 0),
      };
    } else if (tag === 'SETUP_MATRIX') {
      var fromState = number('FROM_STATE', 0);
      var toState = number('TO_STATE', 0);
      if (fromState < 0 || toState < 0) throw new RangeError('Setup states cannot be negative.');
      setups.push({
        from: fromState,
        to: toState,
        time: number('SETUP_TIME', 0),
        costDeci: IG_deci_(value('SETUP_COST'), 0),
      });
    }
  });

  var ids = Object.keys(modes).map(Number).sort(function(left, right) { return left - right; });
  var jobs = ids.map(function(id, internalId) {
    // This mirrors the canonical Rust parser: a missing due row means a due
    // time at the hard completion limit with zero tardiness weight.
    var due = dues[id] || { due: modes[id].hardDeadline, weightDeci: 0 };
    return Object.assign({
      internalId: internalId,
      id: id,
      family: activities[id] == null ? 0 : activities[id],
    }, modes[id], due);
  });
  // Rust derives the matrix extent from setup rows and the initial state. A
  // job referring outside that extent is malformed rather than a new state.
  var stateCount = Math.max(1, initialState + 1);
  setups.forEach(function(setup) { stateCount = Math.max(stateCount, setup.from + 1, setup.to + 1); });
  jobs.forEach(function(job) {
    if (job.family < 0 || job.family >= stateCount) {
      throw new RangeError('Job ' + job.id + ' refers to setup state ' + job.family + ' outside the setup matrix.');
    }
  });
  var setupTime = Array.from({ length: stateCount }, function() { return Array(stateCount).fill(0); });
  var setupCostDeci = Array.from({ length: stateCount }, function() { return Array(stateCount).fill(0); });
  setups.forEach(function(setup) {
    setupTime[setup.from][setup.to] = setup.time;
    setupCostDeci[setup.from][setup.to] = setup.costDeci;
  });
  var familyIds = Array.from(new Set(jobs.map(function(job) { return job.family; })))
    .sort(function(left, right) { return left - right; });
  var horizon = Math.max.apply(null, [1].concat(jobs.reduce(function(values, job) {
    return values.concat([job.releaseTime, job.due, job.hardDeadline, job.releaseTime + job.processingTime]);
  }, []).filter(Number.isFinite)));

  return {
    name: name,
    initialState: initialState,
    jobs: jobs,
    stateCount: stateCount,
    familyIds: familyIds,
    familyCount: familyIds.length,
    setupTime: setupTime,
    setupCostDeci: setupCostDeci,
    horizon: horizon,
  };
}

function IG_roundDataUnit_(deci) {
  return Math.round(deci) / 10;
}

function IG_evaluateOrder_(instance, orderLike) {
  var order = Array.from(orderLike || [], Number);
  var performed = new Set();
  order.forEach(function(internalId) {
    if (!Number.isSafeInteger(internalId) || internalId < 0 || internalId >= instance.jobs.length) {
      throw new RangeError('Unknown internal job id in engine order: ' + internalId + '.');
    }
    if (performed.has(internalId)) throw new RangeError('Duplicate internal job id in engine order: ' + internalId + '.');
    performed.add(internalId);
  });
  var rows = [];
  var time = 0;
  var previousState = instance.initialState;
  var setupTotal = 0;
  var executionTotal = 0;
  var tardinessTotal = 0;

  order.forEach(function(internalId, position) {
    var job = instance.jobs[internalId];
    var setupTime = instance.setupTime[previousState][job.family];
    var setupCostDeci = instance.setupCostDeci[previousState][job.family];
    if (!Number.isSafeInteger(setupTime) || !Number.isSafeInteger(setupCostDeci)) {
      throw new Error('Schedule refers to an incomplete setup matrix.');
    }
    var setupStart = Math.max(time, job.releaseTime - setupTime);
    var processStart = setupStart + setupTime;
    var finish = processStart + job.processingTime;
    var late = Math.max(0, finish - job.due);
    var tardinessCostDeci = late * job.weightDeci;
    rows.push({
      position: position + 1,
      internalId: internalId,
      jobId: job.id,
      family: job.family,
      status: 'scheduled',
      setupStart: setupStart,
      setupTime: setupTime,
      processStart: processStart,
      processingTime: job.processingTime,
      finish: finish,
      releaseTime: job.releaseTime,
      due: job.due,
      hardDeadline: job.hardDeadline,
      late: late,
      setupCost: IG_roundDataUnit_(setupCostDeci),
      executionCost: IG_roundDataUnit_(job.executionCostDeci),
      tardinessCost: IG_roundDataUnit_(tardinessCostDeci),
      rejectionCost: 0,
      totalContribution: IG_roundDataUnit_(setupCostDeci + job.executionCostDeci + tardinessCostDeci),
      feasible: finish <= job.hardDeadline,
    });
    setupTotal += setupCostDeci;
    executionTotal += job.executionCostDeci;
    tardinessTotal += tardinessCostDeci;
    time = finish;
    previousState = job.family;
  });

  var rejectionTotal = 0;
  var rejected = instance.jobs.filter(function(job) {
    return !performed.has(job.internalId);
  }).map(function(job) {
    rejectionTotal += job.rejectionCostDeci;
    return {
      position: null,
      internalId: job.internalId,
      jobId: job.id,
      family: job.family,
      status: 'rejected',
      setupStart: null,
      setupTime: null,
      processStart: null,
      processingTime: job.processingTime,
      finish: null,
      releaseTime: job.releaseTime,
      due: job.due,
      hardDeadline: job.hardDeadline,
      late: null,
      setupCost: 0,
      executionCost: 0,
      tardinessCost: 0,
      rejectionCost: IG_roundDataUnit_(job.rejectionCostDeci),
      totalContribution: IG_roundDataUnit_(job.rejectionCostDeci),
      feasible: null,
    };
  });
  var total = setupTotal + executionTotal + tardinessTotal + rejectionTotal;

  return {
    order: order,
    rows: rows,
    rejected: rejected,
    scheduledCount: rows.length,
    rejectedCount: rejected.length,
    makespan: time,
    breakdown: {
      setup: IG_roundDataUnit_(setupTotal),
      execution: IG_roundDataUnit_(executionTotal),
      tardiness: IG_roundDataUnit_(tardinessTotal),
      rejection: IG_roundDataUnit_(rejectionTotal),
      total: IG_roundDataUnit_(total),
    },
  };
}

function IG_publicInstanceModel_(instance) {
  return {
    name: instance.name,
    initialState: instance.initialState,
    stateCount: instance.stateCount,
    familyIds: instance.familyIds.slice(),
    familyCount: instance.familyCount,
    horizon: instance.horizon,
    jobs: instance.jobs.map(function(job) {
      return {
        internalId: job.internalId,
        jobId: job.id,
        family: job.family,
        processingTime: job.processingTime,
        releaseTime: job.releaseTime,
        due: job.due,
        hardDeadline: job.hardDeadline,
        tardinessWeight: IG_roundDataUnit_(job.weightDeci),
        executionCost: IG_roundDataUnit_(job.executionCostDeci),
        rejectionCost: IG_roundDataUnit_(job.rejectionCostDeci),
      };
    }),
    setupTime: instance.setupTime,
    setupCost: instance.setupCostDeci.map(function(row) {
      return row.map(IG_roundDataUnit_);
    }),
  };
}
