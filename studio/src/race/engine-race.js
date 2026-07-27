/**
 * The method race, driven by the Rust engine.
 *
 * There is no JavaScript search in this file and none anywhere behind it. All
 * six methods live in `engine/src/race/`, behind one objective, one PRNG family
 * and one budget counter, and reach the page through the `race_*` exports. What
 * is left here is bookkeeping: turn a slice reply into the racer objects the
 * view already knows how to draw.
 *
 * Each racer keeps the shape `race/view.js` and `views/race-page.js` read:
 *   { id, name, colorVar, evals, bestCost, hist, done, status,
 *     bestVec, bestSol, off, ms, view() }
 * so the convergence chart, the standings, the fireflies, the pins and the
 * final table are untouched by the port. Only the filler changed.
 *
 * EXECUTION MODEL — one worker, round-robin slices, one slice in flight.
 * Not six workers: a budget race is deterministic per method, so parallelism
 * cannot change a result, and a fair parallel race needs a per-slice barrier
 * that without SharedArrayBuffer (GitHub Pages cannot set COOP/COEP) costs a
 * postMessage round trip per method per slice — more than it buys. The gain
 * from Rust is throughput on one thread.
 */
import { RACE_METHOD_IDS, RACE_STATUS_KEYS } from "../engine/protocol.js";
import { solFeatures } from "./evaluate.js";

/**
 * Display order for the standings, which is not the wire order: `m` is the
 * index `engine/src/race/mod.rs` gives the method and the only number that ever
 * crosses to wasm.
 */
export const RACE_ROSTER = Object.freeze([
  { id: "ig", name: "Iterated Greedy", colorVar: "--race-ig" },
  { id: "greedy", name: "Greedy", colorVar: "--race-greedy" },
  { id: "descent", name: "Descent", colorVar: "--race-descent" },
  { id: "tabu", name: "Tabu", colorVar: "--race-tabu" },
  { id: "tabudiv", name: "TabuDiv", colorVar: "--race-tabudiv" },
  { id: "ama", name: "AMA (memetic)", colorVar: "--race-ama" },
].map((entry) => Object.freeze({ ...entry, m: RACE_METHOD_IDS.indexOf(entry.id) })));

const statusKeyName = (index) => RACE_STATUS_KEYS[index] || "preparing";

/** Jobs not in `order`, as the view's schedule strips and closure check expect. */
function complement(n, order) {
  const seen = new Uint8Array(n);
  for (let i = 0; i < order.length; i += 1) seen[order[i]] = 1;
  const rest = [];
  for (let id = 0; id < n; id += 1) if (!seen[id]) rest.push(id);
  return rest;
}

/** Fresh racer objects, before the first slice has been asked for. */
export function createEngineRacers(n) {
  return RACE_ROSTER.map((entry) => {
    const racer = {
      id: entry.id,
      name: entry.name,
      colorVar: entry.colorVar,
      m: entry.m,
      evals: 0,
      bestCost: Infinity,
      curCost: Infinity,
      hist: [],
      done: false,
      off: false,
      status: { key: "preparing" },
      bestVec: null,
      bestSol: null,
      /** live incumbent; null until the first orders block arrives */
      cur: null,
      /** wall clock spent inside `race_step` for this method, milliseconds */
      ms: 0,
      view() {
        const sol = racer.cur || racer.bestSol;
        if (!sol) return { sol: null, cost: null };
        const cost = racer.cur ? racer.curCost : racer.bestCost;
        return { sol, cost: Number.isFinite(cost) ? cost : null };
      },
    };
    racer.n = n;
    return racer;
  });
}

/** Fold one `race-slice` reply into the racer objects. */
export function applyRaceSnapshot(race, reply) {
  const n = race.evaluator.n;
  for (const racer of race.racers) {
    const scalars = reply.methods[racer.m];
    if (!scalars) continue;
    racer.evals = scalars.evals;
    racer.bestCost = scalars.bestCost;
    racer.curCost = scalars.curCost;
    racer.done = scalars.done;
    racer.ms = scalars.ms;
    racer.status = { key: statusKeyName(scalars.statusKey), arg: scalars.statusArg || undefined };
    const trace = reply.traces[racer.m];
    if (trace) {
      for (let k = 0; k < trace.length; k += 2) racer.hist.push({ e: trace[k], c: trace[k + 1] });
    }
    const best = reply.best[racer.m];
    if (best) {
      const order = Array.from(best);
      racer.bestSol = { order, rejected: complement(n, order) };
      racer.bestVec = solFeatures(n, racer.bestSol);
    }
    const live = reply.orders[racer.m];
    if (live) {
      const order = Array.from(live);
      racer.cur = { order, rejected: complement(n, order) };
    }
  }
  race.maxEvals = Math.max(0, ...race.racers.map((racer) => racer.evals));
  race.wallClockValid = reply.intrusions === 0;
  return reply.allDone;
}

/**
 * The pump. It holds at most one `race-slice` in flight and issues the next one
 * when the reply lands — driven by the reply, never by requestAnimationFrame,
 * because rAF does not fire in a backgrounded tab. Message-driven, a race in a
 * hidden tab still finishes; only the drawing stops and catches up. That is
 * also what makes the wall-clock readout survive a backgrounded tab.
 */
export function createRacePump({ client, race, onFinished, onError }) {
  /** Compute budget aimed at per full round, before the speed multiplier. */
  const TARGET_MS = 8;
  const MIN_SLICE = 64;
  const MAX_SLICE = 50_000_000;
  let slice = 4_096;
  let inFlight = false;
  let stopped = false;

  /**
   * Adapt the slice toward one round per frame. Safe only because the race is
   * slice-invariant by construction: a racer carries unspent credit across
   * slices, and `engine/tests/race.rs::the_race_does_not_depend_on_the_slice_size`
   * pins the ledger, the trace and the final sequence at slices 1, 97, 4096 and
   * 1e9. Without that property an adaptive slice would silently change results.
   */
  function adapt(elapsedMs, target) {
    if (elapsedMs > target * 1.5 && slice > MIN_SLICE) slice = Math.max(MIN_SLICE, Math.floor(slice / 2));
    else if (elapsedMs < target * 0.45) slice = Math.min(MAX_SLICE, slice * 2);
  }

  async function request() {
    if (stopped || inFlight || race.done || !race.playing) return;
    inFlight = true;
    const target = TARGET_MS * (race.speed || 1);
    const before = race.racers.reduce((sum, racer) => sum + racer.ms, 0);
    try {
      const reply = await client.raceSlice({
        slice: Math.max(1, Math.min(0xffff_ffff, Math.round(slice))),
        wantOrders: Boolean(race.wantOrders),
      });
      inFlight = false;
      if (stopped) return;
      const allDone = applyRaceSnapshot(race, reply);
      const after = race.racers.reduce((sum, racer) => sum + racer.ms, 0);
      adapt(after - before, target);
      if (allDone) {
        stopped = true;
        onFinished?.();
        return;
      }
      request();
    } catch (error) {
      inFlight = false;
      stopped = true;
      onError?.(error);
    }
  }

  return {
    /** Idempotent: call it from play, from resume, from anywhere. */
    kick() { request(); },
    stop() { stopped = true; },
  };
}
