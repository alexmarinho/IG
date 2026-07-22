/** Browser-side MaScLib view model. The Rust engine remains the solver. */

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function headerIndex(headers, tag, name) {
  const index = (headers.get(tag) || []).indexOf(name);
  return index < 0 ? null : index + 1;
}

/** Parse the fixed bundled CSV into fields needed by charts and explanations. */
export function parseMasclib(text, fallbackName = "instance") {
  const headers = new Map();
  const activities = new Map();
  const dues = new Map();
  const modes = new Map();
  const setups = [];
  let name = fallbackName;
  let initialState = 0;

  for (const sourceLine of String(text).split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line) continue;
    const cells = line.split(",");
    const rawTag = cells[0];
    const pipe = rawTag.indexOf("|");
    if (pipe >= 0) {
      if (rawTag.slice(pipe + 1) === "NAMES") {
        headers.set(rawTag.slice(0, pipe), cells.slice(1));
      }
      continue;
    }
    const tag = rawTag;
    const value = (field) => {
      const index = headerIndex(headers, tag, field);
      return index == null ? undefined : cells[index];
    };
    const number = (field, fallback = 0) => asNumber(value(field), fallback);

    if (tag === "MODEL") name = value("NAME") || name;
    else if (tag === "RESOURCE") initialState = number("INITIAL_SETUP_STATE", 0);
    else if (tag === "ACTIVITY") {
      activities.set(number("ACTIVITY_ID"), number("SETUP_STATE", 0));
    } else if (tag === "DUE_DATE") {
      dues.set(number("ACTIVITY_ID"), {
        due: number("DUE_TIME"),
        weight: number("TARDINESS_VARIABLE_COST"),
      });
    } else if (tag === "MODE") {
      modes.set(number("ACTIVITY_ID"), {
        processingCost: number("MODE_COST"),
        processingTime: number("PROCESSING_TIME"),
        releaseTime: number("START_MIN"),
        startMax: number("START_MAX", 0),
        hardDeadline: number("END_MAX", Number.POSITIVE_INFINITY),
        rejectionCost: number("UNPERFORMED_COST"),
      });
    } else if (tag === "SETUP_MATRIX") {
      setups.push({
        from: number("FROM_STATE"),
        to: number("TO_STATE"),
        time: number("SETUP_TIME"),
        cost: number("SETUP_COST"),
      });
    }
  }

  const ids = [...modes.keys()].sort((left, right) => left - right);
  const jobs = ids.map((id) => ({
    id,
    family: activities.get(id) ?? 0,
    ...modes.get(id),
    ...(dues.get(id) || { due: 0, weight: 0 }),
  }));
  let stateCount = Math.max(1, initialState + 1);
  for (const job of jobs) stateCount = Math.max(stateCount, job.family + 1);
  for (const setup of setups) stateCount = Math.max(stateCount, setup.from + 1, setup.to + 1);
  const setupTime = Array.from({ length: stateCount }, () => Array(stateCount).fill(0));
  const setupCost = Array.from({ length: stateCount }, () => Array(stateCount).fill(0));
  for (const setup of setups) {
    setupTime[setup.from][setup.to] = setup.time;
    setupCost[setup.from][setup.to] = setup.cost;
  }
  const familyIds = [...new Set(jobs.map((job) => job.family))].sort((a, b) => a - b);
  const horizon = Math.max(
    1,
    ...jobs.flatMap((job) => [job.releaseTime, job.due, job.hardDeadline, job.releaseTime + job.processingTime])
      .filter(Number.isFinite),
  );
  // Scheduling window: every job must end by START_MAX + processing, so the
  // largest such value is the real planning horizon (due dates may lie beyond).
  const window = Math.max(1, ...jobs.map((job) => job.startMax + job.processingTime));

  return Object.freeze({
    name,
    n: jobs.length,
    jobs: Object.freeze(jobs),
    jobsById: new Map(jobs.map((job) => [job.id, job])),
    initialState,
    stateCount,
    familyIds: Object.freeze(familyIds),
    familyCount: familyIds.length,
    setupTime,
    setupCost,
    horizon,
    window,
  });
}

/** Reconstruct the exact schedule and objective components for an engine order. */
export function evaluateSchedule(instance, orderLike) {
  const order = Array.from(orderLike || [], Number);
  const performed = new Set(order);
  const rows = [];
  let time = 0;
  let previousState = instance.initialState;
  let setupTotal = 0;
  let executionTotal = 0;
  let tardinessTotal = 0;

  for (const [position, id] of order.entries()) {
    const job = instance.jobsById.get(id);
    if (!job) throw new RangeError(`Unknown job id in engine order: ${id}`);
    const setupTime = instance.setupTime[previousState]?.[job.family] ?? 0;
    const setupCost = instance.setupCost[previousState]?.[job.family] ?? 0;
    const setupStart = Math.max(time, job.releaseTime - setupTime);
    const processStart = setupStart + setupTime;
    const finish = processStart + job.processingTime;
    const late = Math.max(0, finish - job.due);
    const tardinessCost = late * job.weight;
    const row = {
      position: position + 1,
      id,
      family: job.family,
      status: "scheduled",
      setupStart,
      setupTime,
      setupEnd: processStart,
      processStart,
      processingTime: job.processingTime,
      finish,
      releaseTime: job.releaseTime,
      due: job.due,
      hardDeadline: job.hardDeadline,
      late,
      setupCost,
      executionCost: job.processingCost,
      tardinessCost,
      rejectionCost: 0,
      feasible: finish <= job.hardDeadline,
    };
    rows.push(row);
    setupTotal += setupCost;
    executionTotal += job.processingCost;
    tardinessTotal += tardinessCost;
    time = finish;
    previousState = job.family;
  }

  const rejected = instance.jobs
    .filter((job) => !performed.has(job.id))
    .map((job) => ({
      position: null,
      id: job.id,
      family: job.family,
      status: "rejected",
      setupStart: null,
      setupTime: null,
      setupEnd: null,
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
      rejectionCost: job.rejectionCost,
      feasible: null,
    }));
  const rejectionTotal = rejected.reduce((sum, row) => sum + row.rejectionCost, 0);
  const total = setupTotal + executionTotal + tardinessTotal + rejectionTotal;

  return {
    order,
    rows,
    rejected,
    scheduledCount: rows.length,
    rejectedCount: rejected.length,
    makespan: time,
    breakdown: {
      setup: setupTotal,
      execution: executionTotal,
      tardiness: tardinessTotal,
      rejection: rejectionTotal,
      total,
    },
  };
}

export function instanceSummary(instance) {
  const finiteDeadlines = instance.jobs.map((job) => job.hardDeadline).filter(Number.isFinite);
  const range = (selector) => {
    const values = instance.jobs.map(selector).filter(Number.isFinite);
    return { min: Math.min(...values), max: Math.max(...values) };
  };
  return {
    jobs: instance.n,
    families: instance.familyCount,
    release: range((job) => job.releaseTime),
    due: range((job) => job.due),
    processing: range((job) => job.processingTime),
    rejection: range((job) => job.rejectionCost),
    weight: range((job) => job.weight),
    hardDeadline: finiteDeadlines.length
      ? { min: Math.min(...finiteDeadlines), max: Math.max(...finiteDeadlines) }
      : { min: null, max: null },
    horizon: instance.horizon,
  };
}

export async function unpackEmbeddedCatalog(gzipBase64) {
  const binary = atob(String(gzipBase64).replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot unpack the embedded instance catalog.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}
