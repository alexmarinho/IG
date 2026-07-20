/**
 * Final-analysis module: pure, DOM-free helpers that contrast an engine
 * result with three deterministic scheduling rules (FCFS, EDD, family
 * batching) and extract the structural story of the solution — family
 * blocks, splits, setups, lateness, outsourcing and utilization.
 * Everything is computed from the same evaluateSchedule used by the UI,
 * so every number shown matches the objective decomposition exactly.
 */

import { evaluateSchedule } from "./data/instance.js";

/** Deterministic baseline orders covering every job of the instance. */
export function baselineOrders(instance) {
  const jobs = [...instance.jobs];
  const byId = (left, right) => left.id - right.id;
  const fcfs = jobs.slice()
    .sort((left, right) => left.releaseTime - right.releaseTime || byId(left, right))
    .map((job) => job.id);
  const edd = jobs.slice()
    .sort((left, right) => left.due - right.due || left.releaseTime - right.releaseTime || byId(left, right))
    .map((job) => job.id);
  const groups = new Map();
  for (const job of jobs) {
    if (!groups.has(job.family)) groups.set(job.family, []);
    groups.get(job.family).push(job);
  }
  const batched = [...groups.values()]
    .map((group) => group.slice().sort((left, right) => left.due - right.due || byId(left, right)))
    // The group's urgency is its earliest due date; family id breaks ties.
    .sort((left, right) => left[0].due - right[0].due || left[0].family - right[0].family);
  const family = batched.flatMap((group) => group.map((job) => job.id));
  return { fcfs, edd, family };
}

const setupSummary = (evaluation) => ({
  count: evaluation.rows.filter((row) => row.setupTime > 0 || row.setupCost > 0).length,
  totalTime: evaluation.rows.reduce((sum, row) => sum + row.setupTime, 0),
  totalCost: evaluation.rows.reduce((sum, row) => sum + row.setupCost, 0),
});

const savingsPct = (baselineCost, solutionCost) => (
  baselineCost > 0 ? ((baselineCost - solutionCost) / baselineCost) * 100 : 0
);

/**
 * Analyze an engine result for one instance.
 * `order` is the engine's job-id list (rejected jobs are absent from it).
 * Options: `dayLength` converts per-minute tardiness weights to per-day.
 */
export function analyzeResult(instance, order, { dayLength = 1440 } = {}) {
  const evaluation = evaluateSchedule(instance, order);
  const orders = baselineOrders(instance);
  const baselines = ["fcfs", "edd", "family"].map((key) => {
    const baselineOrder = orders[key];
    const baselineEvaluation = evaluateSchedule(instance, baselineOrder);
    return {
      key,
      order: baselineOrder,
      evaluation: baselineEvaluation,
      cost: baselineEvaluation.breakdown.total,
      hardViolations: baselineEvaluation.rows.filter((row) => !row.feasible).length,
      lateCount: baselineEvaluation.rows.filter((row) => row.late > 0).length,
      rejectedCount: baselineEvaluation.rejectedCount,
    };
  });

  const solutionCost = evaluation.breakdown.total;
  const fcfsCost = baselines[0].cost;
  const bestBaselineCost = Math.min(...baselines.map((baseline) => baseline.cost));
  const comparison = {
    bestBaselineCost,
    savingsVsBestBaselinePct: savingsPct(bestBaselineCost, solutionCost),
    savingsVsFcfsPct: savingsPct(fcfsCost, solutionCost),
  };

  // Maximal same-family runs in the solution order.
  const blockList = [];
  for (const row of evaluation.rows) {
    const last = blockList[blockList.length - 1];
    if (last && last.family === row.family) last.jobs.push(row.id);
    else blockList.push({ family: row.family, jobs: [row.id] });
  }
  // Split jobs: a family change whose own family still reappears later —
  // the signature of an order pulled out of its batch on purpose.
  const splits = [];
  for (let index = 1; index < evaluation.rows.length; index += 1) {
    const row = evaluation.rows[index];
    if (row.family === evaluation.rows[index - 1].family) continue;
    const reappears = evaluation.rows.slice(index + 1).some((later) => later.family === row.family);
    if (reappears) splits.push({ id: row.id, family: row.family, slack: row.due - row.finish });
  }
  splits.sort((left, right) => left.slack - right.slack || left.id - right.id);

  const solutionSetups = setupSummary(evaluation);
  const familySetups = setupSummary(baselines[2].evaluation);
  const setups = {
    ...solutionSetups,
    family: familySetups,
    avoided: familySetups.totalCost - solutionSetups.totalCost,
  };

  const late = evaluation.rows
    .filter((row) => row.late > 0)
    .map((row) => ({ id: row.id, minutesLate: row.late, penalty: row.tardinessCost }));

  // What would it cost to squeeze each rejected job in after the last one?
  const lastState = evaluation.rows.length
    ? evaluation.rows[evaluation.rows.length - 1].family
    : instance.initialState;
  const rejected = evaluation.rejected.map((row) => {
    const job = instance.jobsById.get(row.id);
    const setupMin = instance.setupTime[lastState]?.[job.family] ?? 0;
    const forcedEnd = evaluation.makespan + setupMin + job.processingTime;
    const estimatedPenalty = job.weight * Math.max(0, forcedEnd - job.due) + job.processingCost;
    return {
      id: row.id,
      forcedEnd,
      estimatedPenalty,
      rejectionCost: job.rejectionCost,
      saved: estimatedPenalty - job.rejectionCost,
    };
  });

  const processingSum = evaluation.rows.reduce((sum, row) => sum + row.processingTime, 0);
  const utilization = evaluation.makespan > 0
    ? (processingSum + solutionSetups.totalTime) / evaluation.makespan
    : 0;

  const notObvious = [];
  if (splits.length) {
    const split = splits[0];
    const job = instance.jobsById.get(split.id);
    notObvious.push({
      kind: "split",
      jobId: split.id,
      numbers: {
        family: split.family,
        slack: split.slack,
        // What blind batching would save on setup: only meaningful when the
        // solution deliberately pays for extra swaps (avoided < 0).
        batchingSavings: Math.max(0, -setups.avoided),
        weightPerDay: job.weight * dayLength,
      },
    });
  }
  const bestReject = rejected
    .filter((entry) => entry.saved > 0)
    .sort((left, right) => right.saved - left.saved || left.id - right.id)[0];
  if (bestReject) {
    notObvious.push({
      kind: "reject",
      jobId: bestReject.id,
      numbers: {
        saved: bestReject.saved,
        estimatedPenalty: bestReject.estimatedPenalty,
        rejectionCost: bestReject.rejectionCost,
      },
    });
  }
  if (setups.avoided > 0) {
    notObvious.push({
      kind: "setup",
      numbers: { avoided: setups.avoided, count: setups.count, totalCost: setups.totalCost },
    });
  }

  return {
    evaluation,
    baselines,
    comparison,
    blocks: {
      count: blockList.length,
      familiesPresent: new Set(evaluation.rows.map((row) => row.family)).size,
      list: blockList,
      splits: splits.slice(0, 2),
    },
    setups,
    late,
    rejected,
    utilization,
    makespan: evaluation.makespan,
    notObvious: notObvious.slice(0, 3),
  };
}
