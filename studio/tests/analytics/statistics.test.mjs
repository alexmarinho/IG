import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateCheckpointBands,
  descriptiveStatistics,
  gapToReference,
  rankRunSeeds,
  referenceHitRate,
  summarizeRunComparison,
} from "../../src/analytics/statistics.js";

const closeTo = (actual, expected, tolerance = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

test("descriptiveStatistics calculates inclusive quartiles and sample deviation", () => {
  const summary = descriptiveStatistics([4, 1, 3, 2]);
  assert.deepEqual(
    {
      count: summary.count,
      min: summary.min,
      q1: summary.q1,
      median: summary.median,
      mean: summary.mean,
      q3: summary.q3,
      max: summary.max,
    },
    { count: 4, min: 1, q1: 1.75, median: 2.5, mean: 2.5, q3: 3.25, max: 4 },
  );
  closeTo(summary.sampleStdDev, Math.sqrt(5 / 3));
});

test("descriptiveStatistics handles empty and singleton experiments explicitly", () => {
  assert.deepEqual(descriptiveStatistics([]), {
    count: 0,
    min: null,
    q1: null,
    median: null,
    mean: null,
    q3: null,
    max: null,
    sampleStdDev: null,
  });
  assert.deepEqual(descriptiveStatistics([17]), {
    count: 1,
    min: 17,
    q1: 17,
    median: 17,
    mean: 17,
    q3: 17,
    max: 17,
    sampleStdDev: null,
  });
  assert.throws(() => descriptiveStatistics([1, Number.NaN]), /finite number/);
});

test("gap and hit-rate helpers follow minimization semantics", () => {
  assert.equal(gapToReference(90, 100), -10);
  assert.equal(gapToReference(100, 100), 0);
  assert.equal(gapToReference(110, 100), 10);
  assert.deepEqual(referenceHitRate([90, 100, 101], 100), {
    hitCount: 2,
    total: 3,
    rate: 2 / 3,
  });
  assert.deepEqual(referenceHitRate([90, 100, 101], 100, 1), {
    hitCount: 3,
    total: 3,
    rate: 1,
  });
  assert.throws(() => gapToReference(1, 0), /greater than zero/);
  assert.throws(() => referenceHitRate([1], 1, -1), /must not be negative/);
});

test("seed ranking is deterministic, including tied costs", () => {
  assert.deepEqual(
    rankRunSeeds([
      { seed: 9, bestCost: 100 },
      { seed: 2, bestCost: 100 },
      { seed: 7, bestCost: 90 },
    ]),
    {
      best: { seed: 7, bestCost: 90 },
      worst: { seed: 9, bestCost: 100 },
    },
  );
  assert.deepEqual(rankRunSeeds([]), { best: null, worst: null });
  assert.throws(
    () => rankRunSeeds([{ seed: 1, bestCost: 10 }, { seed: 1, bestCost: 11 }]),
    /duplicate seed/,
  );
});

const runs = [
  {
    seed: 7,
    bestCost: 100,
    checkpoints: [
      { checkpoint: 0, bestCost: 140 },
      { checkpoint: 10, bestCost: 100 },
    ],
  },
  {
    seed: 2,
    bestCost: 90,
    checkpoints: [
      { checkpoint: 0, bestCost: 130 },
      { checkpoint: 10, bestCost: 90 },
    ],
  },
  {
    seed: 9,
    bestCost: 110,
    checkpoints: [
      { checkpoint: 0, bestCost: 150 },
      { checkpoint: 10, bestCost: 110 },
    ],
  },
];

test("aggregateCheckpointBands builds honest bands over a shared grid", () => {
  const bands = aggregateCheckpointBands(runs);
  assert.equal(bands.length, 2);
  assert.deepEqual(
    {
      checkpoint: bands[0].checkpoint,
      count: bands[0].count,
      min: bands[0].min,
      q1: bands[0].q1,
      median: bands[0].median,
      q3: bands[0].q3,
      max: bands[0].max,
      mean: bands[0].mean,
    },
    { checkpoint: 0, count: 3, min: 130, q1: 135, median: 140, q3: 145, max: 150, mean: 140 },
  );
  assert.deepEqual(
    { min: bands[1].min, median: bands[1].median, max: bands[1].max },
    { min: 90, median: 100, max: 110 },
  );
});

test("checkpoint aggregation rejects mixed or unordered grids", () => {
  const mixed = structuredClone(runs);
  mixed[1].checkpoints[1].checkpoint = 11;
  assert.throws(() => aggregateCheckpointBands(mixed), /same checkpoint grid/);

  const unordered = structuredClone(runs.slice(0, 1));
  unordered[0].checkpoints[1].checkpoint = 0;
  assert.throws(() => aggregateCheckpointBands(unordered), /strictly increasing/);

  const worsening = structuredClone(runs.slice(0, 1));
  worsening[0].checkpoints[1].bestCost = 160;
  assert.throws(() => aggregateCheckpointBands(worsening), /must not increase/);
});

test("summarizeRunComparison combines costs, reference outcomes, seeds, and bands", () => {
  const summary = summarizeRunComparison(runs, {
    referenceCost: 100,
    includeCheckpointBands: true,
  });
  assert.equal(summary.runCount, 3);
  assert.equal(summary.costs.mean, 100);
  assert.equal(summary.costs.sampleStdDev, 10);
  assert.equal(summary.bestSeed, 2);
  assert.equal(summary.worstSeed, 9);
  assert.deepEqual(summary.bestRun, { seed: 2, bestCost: 90 });
  assert.equal(summary.reference.hitCount, 2);
  assert.equal(summary.reference.rate, 2 / 3);
  assert.equal(summary.reference.gaps.mean, 0);
  assert.equal(summary.checkpointBands.length, 2);
});

test("run summaries work without convergence points unless bands are requested", () => {
  const summary = summarizeRunComparison(
    [{ seed: 1, bestCost: 12 }, { seed: 2, bestCost: 10 }],
    { referenceCost: 10 },
  );
  assert.equal(summary.bestSeed, 2);
  assert.deepEqual(summary.checkpointBands, []);
  assert.throws(
    () => summarizeRunComparison([{ seed: 1, bestCost: 10 }], { includeCheckpointBands: true }),
    /checkpoints must be an array/,
  );
  assert.throws(
    () => summarizeRunComparison([{ seed: 1, bestCost: 10 }], { hitTolerance: 1 }),
    /requires referenceCost/,
  );
});
