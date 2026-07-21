import test from "node:test";
import assert from "node:assert/strict";

import { analyzeResult, baselineOrders } from "../../src/analysis.js";

/**
 * Synthetic 5-job, 2-family instance with hand-checked numbers.
 * Setups: 0→1 costs 10 min / R$5, 1→0 costs 20 min / R$8; initial state 0.
 * The solution [0, 1, 2, 4] rejects job 3 and splits family 0 around job 1.
 */
const jobs = [
  { id: 0, family: 0, releaseTime: 0, processingTime: 10, due: 25, weight: 2, processingCost: 10, rejectionCost: 50, hardDeadline: 1000, startMax: 990 },
  { id: 1, family: 1, releaseTime: 0, processingTime: 5, due: 12, weight: 3, processingCost: 4, rejectionCost: 40, hardDeadline: 1000, startMax: 995 },
  { id: 2, family: 0, releaseTime: 2, processingTime: 8, due: 40, weight: 1, processingCost: 6, rejectionCost: 60, hardDeadline: 1000, startMax: 992 },
  { id: 3, family: 1, releaseTime: 0, processingTime: 6, due: 18, weight: 1, processingCost: 3, rejectionCost: 30, hardDeadline: 1000, startMax: 994 },
  { id: 4, family: 0, releaseTime: 0, processingTime: 4, due: 15, weight: 10, processingCost: 2, rejectionCost: 12, hardDeadline: 1000, startMax: 996 },
];
const instance = Object.freeze({
  name: "synthetic",
  n: jobs.length,
  jobs: Object.freeze(jobs),
  jobsById: new Map(jobs.map((job) => [job.id, job])),
  initialState: 0,
  stateCount: 2,
  familyIds: Object.freeze([0, 1]),
  familyCount: 2,
  setupTime: [[0, 10], [20, 0]],
  setupCost: [[0, 5], [8, 0]],
  horizon: 1000,
  window: 1000,
});

test("baseline orders follow FCFS, EDD and family-batching rules", () => {
  const orders = baselineOrders(instance);
  assert.deepEqual(orders.fcfs, [0, 1, 3, 4, 2]); // (release, id)
  assert.deepEqual(orders.edd, [1, 4, 3, 0, 2]); // (due, release, id)
  // Family 1 group is more urgent (min due 12 < 15); groups sorted internally by (due, id).
  assert.deepEqual(orders.family, [1, 3, 4, 0, 2]);
});

test("baselines evaluate to hand-checked costs and lateness", () => {
  const result = analyzeResult(instance, [0, 1, 2, 4]);
  const byKey = Object.fromEntries(result.baselines.map((baseline) => [baseline.key, baseline]));
  // FCFS [0,1,3,4,2]: setup 13 + execution 25 + tardiness 475 = 513, four late jobs.
  assert.equal(byKey.fcfs.cost, 513);
  assert.equal(byKey.fcfs.lateCount, 4);
  assert.equal(byKey.fcfs.hardViolations, 0);
  assert.equal(byKey.fcfs.rejectedCount, 0);
  // EDD [1,4,3,0,2]: setup 26 + execution 25 + tardiness 459 = 510, all five late.
  assert.equal(byKey.edd.cost, 510);
  assert.equal(byKey.edd.lateCount, 5);
  // Family batching [1,3,4,0,2]: setup 13 + execution 25 + tardiness 395 = 433.
  assert.equal(byKey.family.cost, 433);
  assert.equal(byKey.family.lateCount, 5);
  assert.deepEqual(result.baselines.map(({ key }) => key), ["fcfs", "edd", "family"]);
});

test("comparison reports savings against the best baseline and FCFS", () => {
  const result = analyzeResult(instance, [0, 1, 2, 4]);
  // Solution [0,1,2,4]: setup 13 + execution 22 + tardiness 472 + rejection 30 = 537.
  assert.equal(result.evaluation.breakdown.total, 537);
  assert.equal(result.comparison.bestBaselineCost, 433);
  assert.ok(Math.abs(result.comparison.savingsVsBestBaselinePct - ((433 - 537) / 433) * 100) < 1e-9);
  assert.ok(Math.abs(result.comparison.savingsVsFcfsPct - ((513 - 537) / 513) * 100) < 1e-9);
});

test("blocks and split detection read the solution family runs", () => {
  const result = analyzeResult(instance, [0, 1, 2, 4]);
  assert.equal(result.blocks.count, 3); // families 0 | 1 | 0 0
  assert.equal(result.blocks.familiesPresent, 2);
  assert.deepEqual(result.blocks.list.map((block) => block.family), [0, 1, 0]);
  // Job 2 leaves family 1 for family 0, which still reappears (job 4): a split.
  // Slack = due 40 − finish 53 = −13.
  assert.deepEqual(result.blocks.splits, [{ id: 2, family: 0, slack: -13 }]);
});

test("setup totals compare the solution with the family baseline", () => {
  const result = analyzeResult(instance, [0, 1, 2, 4]);
  assert.equal(result.setups.count, 2); // 0→1 and 1→0 in the solution
  assert.equal(result.setups.totalTime, 30);
  assert.equal(result.setups.totalCost, 13);
  assert.equal(result.setups.family.totalCost, 13);
  assert.equal(result.setups.avoided, 0);
});

test("late jobs carry minutes and penalties; rejected jobs estimate the saving", () => {
  const result = analyzeResult(instance, [0, 1, 2, 4]);
  assert.deepEqual(result.late, [
    { id: 1, minutesLate: 13, penalty: 39 },
    { id: 2, minutesLate: 13, penalty: 13 },
    { id: 4, minutesLate: 42, penalty: 420 },
  ]);
  // Job 3 squeezed after the makespan: 57 + setup(0→1) 10 + 6 min = forced end 73;
  // penalty = 1 × (73 − 18) + 3 = 58, so rejecting saved 58 − 30 = 28.
  assert.deepEqual(result.rejected, [
    { id: 3, forcedEnd: 73, estimatedPenalty: 58, rejectionCost: 30, saved: 28 },
  ]);
});

test("utilization, makespan and the not-obvious callout stay consistent", () => {
  const result = analyzeResult(instance, [0, 1, 2, 4]);
  assert.equal(result.makespan, 57);
  // (27 processing + 30 setup) / 57 makespan — the machine never idles here.
  assert.equal(result.utilization, 1);
  assert.equal(result.notObvious.length, 2);
  const [split, reject] = result.notObvious;
  assert.equal(split.kind, "split");
  assert.equal(split.jobId, 2);
  assert.equal(split.numbers.weightPerDay, 1440); // weight 1 × default dayLength
  assert.equal(split.numbers.batchingSavings, 0); // avoided = 0 → batching saves nothing
  assert.equal(reject.kind, "reject");
  assert.equal(reject.jobId, 3);
  assert.equal(reject.numbers.saved, 28);
});

test("a solution better than every baseline yields positive savings and a setup note", () => {
  // Order [1, 3] batches the urgent family behind one 0→1 setup and rejects
  // the rest: setup 5 + execution 7 + tardiness 12 + rejection 122 = 146.
  const result = analyzeResult(instance, [1, 3]);
  assert.equal(result.evaluation.breakdown.total, 146);
  assert.ok(Math.abs(result.comparison.savingsVsBestBaselinePct - ((433 - 146) / 433) * 100) < 1e-9);
  assert.ok(Math.abs(result.comparison.savingsVsFcfsPct - ((513 - 146) / 513) * 100) < 1e-9);
  assert.equal(result.blocks.count, 1);
  assert.deepEqual(result.blocks.splits, []); // no family reappears after a change
  // One paid setup (R$5) against two (R$13) in the family baseline.
  assert.equal(result.setups.count, 1);
  assert.equal(result.setups.totalCost, 5);
  assert.equal(result.setups.avoided, 8);
  // Job 4 is the rejection with the highest estimated saving:
  // forced end 21 + 20 + 4 = 45 → 10 × 30 + 2 = 302 vs R$12 → saved 290.
  const bestReject = result.notObvious.find(({ kind }) => kind === "reject");
  assert.equal(bestReject.jobId, 4);
  assert.equal(bestReject.numbers.saved, 290);
  const setupNote = result.notObvious.find(({ kind }) => kind === "setup");
  assert.equal(setupNote.numbers.avoided, 8);
});

test("empty order rejects everything and keeps utilization at zero", () => {
  const result = analyzeResult(instance, []);
  assert.equal(result.evaluation.scheduledCount, 0);
  assert.equal(result.evaluation.rejectedCount, 5);
  assert.equal(result.makespan, 0);
  assert.equal(result.utilization, 0);
  assert.equal(result.blocks.count, 0);
  assert.equal(result.rejected.length, 5);
  // With no scheduled row, the initial state drives the forced-end estimate.
  assert.equal(result.rejected.find(({ id }) => id === 1).forcedEnd, 10 + 5);
});
