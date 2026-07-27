/**
 * The solution-space sampler's construction kit — and nothing else.
 *
 * This file is what is left of `race/strategies.js` after the six methods moved
 * to Rust (`engine/src/race/`). Everything that constituted a method is gone:
 * the six `make*` factories, `baseRacer`, `bestNeighbor`, `applyMove` and the
 * seed hash. What survives is the greedy construction the solution-space tree
 * builds its leaves from, and the PRNG that scatters them.
 *
 * NOTHING HERE IS ON THE RACE'S PATH. No racer calls it, no evaluation it
 * performs is charged to any budget, and no decision any method makes depends
 * on it. `space.js` is its only consumer, plus the leaf jitter in `layoutSpace`.
 * That distinction matters: `mulberry32` is a float-producing generator, and a
 * float anywhere in an index path is exactly the determinism hole the engine's
 * `Rng` exists to close. It is safe here because the tree is decoration —
 * a backdrop the racers climb, sampled once, off the budget, never compared.
 */

/**
 * The sampler's PRNG. Deliberately NOT the engine's: the race is seeded by
 * `rng::method_seed` inside wasm, and this stream never touches it.
 */
export function mulberry32(a) {
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Greedy construction over a shuffled pending list, used to draw a sample of
 * the solution space. Same shape as the engine's `greedy_pass`, but it is a
 * sampler: it reports no evaluations because none of them are spent.
 */
export function createSearchOps(evaluator) {
  const { costOnly } = evaluator;

  function bestInsertion(order, rejected, id) {
    const base = costOnly(order, rejected);
    const rIdx = rejected.indexOf(id);
    const r2 = rejected.slice(); r2.splice(rIdx, 1);
    let best = { cost: base, pos: -1 };
    for (let p = 0; p <= order.length; p++) {
      order.splice(p, 0, id);
      const c = costOnly(order, r2);
      if (c < best.cost - 1e-9) best = { cost: c, pos: p };
      order.splice(p, 1);
    }
    return best;
  }

  function greedyPass(cur, rng, cb) {
    const pend = cur.rejected.slice();
    for (let i = pend.length - 1; i > 0; i--) {
      const k = Math.floor(rng() * (i + 1));
      [pend[i], pend[k]] = [pend[k], pend[i]];
    }
    for (const id of pend) {
      const bi = bestInsertion(cur.order, cur.rejected, id);
      if (bi.pos >= 0) {
        cur.order.splice(bi.pos, 0, id);
        cur.rejected.splice(cur.rejected.indexOf(id), 1);
        if (cb) cb(bi.cost);
      }
    }
  }

  return { bestInsertion, greedyPass };
}
