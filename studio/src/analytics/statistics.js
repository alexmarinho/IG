/** Pure statistical helpers for deterministic, equal-budget IG experiments. */

const EMPTY_SUMMARY = Object.freeze({
  count: 0,
  min: null,
  q1: null,
  median: null,
  mean: null,
  q3: null,
  max: null,
  sampleStdDev: null,
});

function assertFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function numericValues(values, label = "values") {
  if (values == null || typeof values[Symbol.iterator] !== "function") {
    throw new TypeError(`${label} must be iterable`);
  }
  return Array.from(values, (value, index) =>
    assertFiniteNumber(value, `${label}[${index}]`),
  );
}

function inclusiveQuantile(sorted, probability) {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Seven-number summary with inclusive, linearly interpolated quartiles.
 * Sample standard deviation uses n - 1 and is therefore null for n < 2.
 */
export function descriptiveStatistics(values) {
  const data = numericValues(values);
  if (data.length === 0) return { ...EMPTY_SUMMARY };

  const sorted = data.slice().sort((left, right) => left - right);
  let mean = 0;
  let squaredDeviationSum = 0;
  for (let index = 0; index < data.length; index += 1) {
    const delta = data[index] - mean;
    mean += delta / (index + 1);
    squaredDeviationSum += delta * (data[index] - mean);
  }

  return {
    count: sorted.length,
    min: sorted[0],
    q1: inclusiveQuantile(sorted, 0.25),
    median: inclusiveQuantile(sorted, 0.5),
    mean,
    q3: inclusiveQuantile(sorted, 0.75),
    max: sorted.at(-1),
    sampleStdDev:
      sorted.length < 2
        ? null
        : Math.sqrt(Math.max(0, squaredDeviationSum / (sorted.length - 1))),
  };
}

/** Relative percentage gap for a minimization objective. Negative is better. */
export function gapToReference(value, referenceCost) {
  const cost = assertFiniteNumber(value, "value");
  const reference = assertFiniteNumber(referenceCost, "referenceCost");
  if (reference <= 0) throw new RangeError("referenceCost must be greater than zero");
  const gap = ((cost - reference) / reference) * 100;
  return Object.is(gap, -0) ? 0 : gap;
}

/**
 * Count minimization results that match or improve a reference. `tolerance`
 * is an absolute objective-unit allowance and must be explicit at the caller.
 */
export function referenceHitRate(values, referenceCost, tolerance = 0) {
  const data = numericValues(values);
  const reference = assertFiniteNumber(referenceCost, "referenceCost");
  const allowance = assertFiniteNumber(tolerance, "tolerance");
  if (reference <= 0) throw new RangeError("referenceCost must be greater than zero");
  if (allowance < 0) throw new RangeError("tolerance must not be negative");
  const hitCount = data.reduce(
    (count, cost) => count + Number(cost <= reference + allowance),
    0,
  );
  return {
    hitCount,
    total: data.length,
    rate: data.length === 0 ? null : hitCount / data.length,
  };
}

function compareSeeds(left, right) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "en", { numeric: true });
}

function validateRuns(runs, { checkpoints = false } = {}) {
  if (!Array.isArray(runs)) throw new TypeError("runs must be an array");
  const seeds = new Set();
  return runs.map((run, index) => {
    if (!run || typeof run !== "object") {
      throw new TypeError(`runs[${index}] must be an object`);
    }
    if (!(typeof run.seed === "number" || typeof run.seed === "string")) {
      throw new TypeError(`runs[${index}].seed must be a number or string`);
    }
    if (typeof run.seed === "number" && !Number.isFinite(run.seed)) {
      throw new TypeError(`runs[${index}].seed must be finite`);
    }
    const seedIdentity = `${typeof run.seed}:${String(run.seed)}`;
    if (seeds.has(seedIdentity)) throw new RangeError(`duplicate seed: ${String(run.seed)}`);
    seeds.add(seedIdentity);
    assertFiniteNumber(run.bestCost, `runs[${index}].bestCost`);
    if (checkpoints && !Array.isArray(run.checkpoints)) {
      throw new TypeError(`runs[${index}].checkpoints must be an array`);
    }
    return run;
  });
}

/** Return deterministic best/worst run records, using seed order to break ties. */
export function rankRunSeeds(runs) {
  const validated = validateRuns(runs);
  if (validated.length === 0) return { best: null, worst: null };
  const ranked = validated
    .map(({ seed, bestCost }) => ({ seed, bestCost }))
    .sort((left, right) =>
      left.bestCost - right.bestCost || compareSeeds(left.seed, right.seed),
    );
  return {
    best: { ...ranked[0] },
    worst: { ...ranked.at(-1) },
  };
}

function validateCheckpointGrid(runs) {
  if (runs.length === 0) return [];
  const expected = runs[0].checkpoints.map((point, pointIndex) => {
    if (!point || typeof point !== "object") {
      throw new TypeError(`runs[0].checkpoints[${pointIndex}] must be an object`);
    }
    const checkpoint = assertFiniteNumber(
      point.checkpoint,
      `runs[0].checkpoints[${pointIndex}].checkpoint`,
    );
    const bestCost = assertFiniteNumber(
      point.bestCost,
      `runs[0].checkpoints[${pointIndex}].bestCost`,
    );
    if (pointIndex > 0 && checkpoint <= runs[0].checkpoints[pointIndex - 1].checkpoint) {
      throw new RangeError("checkpoint values must be strictly increasing");
    }
    if (pointIndex > 0 && bestCost > runs[0].checkpoints[pointIndex - 1].bestCost) {
      throw new RangeError("checkpoint bestCost values must not increase");
    }
    return checkpoint;
  });

  for (let runIndex = 1; runIndex < runs.length; runIndex += 1) {
    const points = runs[runIndex].checkpoints;
    if (points.length !== expected.length) {
      throw new RangeError("all runs must use the same checkpoint grid");
    }
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex];
      if (!point || typeof point !== "object") {
        throw new TypeError(
          `runs[${runIndex}].checkpoints[${pointIndex}] must be an object`,
        );
      }
      const checkpoint = assertFiniteNumber(
        point.checkpoint,
        `runs[${runIndex}].checkpoints[${pointIndex}].checkpoint`,
      );
      const bestCost = assertFiniteNumber(
        point.bestCost,
        `runs[${runIndex}].checkpoints[${pointIndex}].bestCost`,
      );
      if (checkpoint !== expected[pointIndex]) {
        throw new RangeError("all runs must use the same checkpoint grid");
      }
      if (pointIndex > 0 && bestCost > points[pointIndex - 1].bestCost) {
        throw new RangeError("checkpoint bestCost values must not increase");
      }
    }
  }
  return expected;
}

/**
 * Aggregate an equal-budget convergence grid into min/max and interquartile
 * bands. Every run must be sampled at the same deterministic checkpoints;
 * rejecting mixed grids prevents a visually plausible but misleading band.
 */
export function aggregateCheckpointBands(runs) {
  const validated = validateRuns(runs, { checkpoints: true });
  const grid = validateCheckpointGrid(validated);
  return grid.map((checkpoint, pointIndex) => ({
    checkpoint,
    ...descriptiveStatistics(
      validated.map((run) => run.checkpoints[pointIndex].bestCost),
    ),
  }));
}

/**
 * Complete comparison summary for deterministic N-run experiments.
 *
 * Each run is `{ seed, bestCost, checkpoints?: [{checkpoint, bestCost}] }`.
 * Reference statistics are omitted when no `referenceCost` is supplied.
 */
export function summarizeRunComparison(
  runs,
  { referenceCost = null, hitTolerance = 0, includeCheckpointBands = false } = {},
) {
  const validated = validateRuns(runs, { checkpoints: includeCheckpointBands });
  const costs = validated.map((run) => run.bestCost);
  const ranking = rankRunSeeds(validated);
  let reference = null;

  if (referenceCost != null) {
    const referenceValue = assertFiniteNumber(referenceCost, "referenceCost");
    if (referenceValue <= 0) {
      throw new RangeError("referenceCost must be greater than zero");
    }
    const hits = referenceHitRate(costs, referenceValue, hitTolerance);
    reference = {
      cost: referenceValue,
      hitTolerance,
      ...hits,
      gaps: descriptiveStatistics(
        costs.map((cost) => gapToReference(cost, referenceValue)),
      ),
    };
  } else if (hitTolerance !== 0) {
    throw new RangeError("hitTolerance requires referenceCost");
  }

  return {
    runCount: validated.length,
    costs: descriptiveStatistics(costs),
    bestSeed: ranking.best?.seed ?? null,
    worstSeed: ranking.worst?.seed ?? null,
    bestRun: ranking.best,
    worstRun: ranking.worst,
    reference,
    checkpointBands: includeCheckpointBands
      ? aggregateCheckpointBands(validated)
      : [],
  };
}
