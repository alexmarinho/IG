/**
 * The sampler's objective, and the closure cross-check. NOT the race objective.
 *
 * This file used to be the objective every racer priced against. It is not any
 * more: all six methods run in `engine/src/race/`, behind the Rust evaluator,
 * and nothing here is charged to the evaluation budget or consulted by any
 * method. Three live consumers survive the port, and all three are off the race:
 *
 *   1. `space.js` — prices every sampled leaf of the solution-space tree
 *      (`costOnly`) and builds the position vectors it clusters on
 *      (`solFeatures`). A few hundred samples, once, off the budget.
 *   2. `view.js` — `solFeatures` for the firefly positions and the best-pin.
 *   3. `tests/race/*` — the independent second opinion. A cost the Rust engine
 *      reports has to survive re-evaluation here, which is a stronger claim
 *      than either implementation could make alone.
 *
 * Keeping it is therefore not inertia: it is the only remaining check that the
 * number the page prints means what the page says it means.
 *
 * Currency (identical to the Rust solver and to `evaluateSchedule`):
 *   total = Σ scheduled [ setupCost(prev → family) + modeCost + w · max(0, finish − due) ]
 *         + Σ rejected  [ rejectionCost ]
 * scheduled ASAP with `setupStart = max(t, release − setupTime)`,
 * `finish = setupStart + setupTime + processingTime`, and a candidate is
 * infeasible (cost +∞) as soon as any job finishes after its hard deadline
 * (`END_MAX`), mirroring `try_insert`/`try_replace` in engine/src/solver.rs.
 *
 * Racer-facing jobs are re-indexed to 0..n-1 (the catalog keeps its own ids);
 * `toEngineOrder` maps an internal order back to catalog job ids so the winning
 * schedule can be validated through `evaluateSchedule` (see assertClosure).
 */
export function createRaceEvaluator(instance) {
  const n = instance.n;
  const jobs = instance.jobs.map((job, index) => ({
    id: index,
    origId: job.id,
    fam: job.family,
    p: job.processingTime,
    rel: job.releaseTime,
    due: job.due,
    w: job.weight,
    rej: job.rejectionCost,
    modeCost: job.processingCost,
    endMax: job.hardDeadline,
  }));
  const states = Math.max(1, instance.stateCount);
  const setup = Array.from({ length: states }, (_, from) => Array.from(
    { length: states },
    (_, to) => ({
      t: instance.setupTime[from]?.[to] ?? 0,
      c: instance.setupCost[from]?.[to] ?? 0,
    }),
  ));
  const setup0 = setup[instance.initialState].map((cell) => ({ ...cell }));

  /**
   * Objective of one (order, rejected) partition, or +∞ when some scheduled job
   * would violate its hard deadline. The race's budget is counted in wasm, by
   * `race::Ctx`, over this same objective compiled from Rust — calls to this
   * function are never charged to it.
   */
  function costOnly(order, rejected) {
    let t = 0;
    let prev = -1;
    let cost = 0;
    for (let k = 0; k < order.length; k++) {
      const j = jobs[order[k]];
      const su = prev < 0 ? setup0[j.fam] : setup[prev][j.fam];
      const ss = Math.max(t, j.rel - su.t);
      const f = ss + su.t + j.p;
      if (f > j.endMax) return Number.POSITIVE_INFINITY;
      cost += su.c + j.modeCost;
      const late = f - j.due;
      if (late > 0) cost += late * j.w;
      t = f;
      prev = j.fam;
    }
    for (let k = 0; k < rejected.length; k++) cost += jobs[rejected[k]].rej;
    return cost;
  }

  const costOf = (sol) => (sol ? costOnly(sol.order, sol.rejected) : Number.POSITIVE_INFINITY);

  /** Map an internal (0..n-1) order back to catalog job ids. */
  const toEngineOrder = (order) => Array.from(order || [], (index) => jobs[index].origId);

  /** Map a catalog-id order to internal indices (used by tests/tools). */
  const toInternalOrder = (order) => {
    const byOrig = new Map(jobs.map((job) => [job.origId, job.id]));
    return Array.from(order || [], (origId) => {
      const index = byOrig.get(origId);
      if (index == null) throw new RangeError(`Unknown job id in order: ${origId}`);
      return index;
    });
  };

  return Object.freeze({
    n,
    jobs: Object.freeze(jobs),
    setup,
    setup0,
    costOnly,
    costOf,
    toEngineOrder,
    toInternalOrder,
  });
}

/**
 * Position feature vector of a solution (normalized start rank per job, with a
 * sentinel above 1 for rejected jobs). Shared by the space projection and by
 * the racer "pin" markers; identical to the home-page racelab mapping. Job ids
 * here are 0..n-1 in the instance's own order, which is also the numbering the
 * Rust engine uses for the sequences it hands back.
 */
export function solFeatures(n, sol) {
  const vector = new Float32Array(n).fill(1.25);
  const length = Math.max(1, sol?.order?.length || 0);
  if (sol?.order) sol.order.forEach((id, k) => { vector[id] = k / length; });
  return vector;
}
