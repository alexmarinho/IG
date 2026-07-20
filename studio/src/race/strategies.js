/**
 * Race-lab strategies: the six home-page racers ported to the real parsed
 * instances. Pure logic — no DOM access anywhere in this module.
 *
 * Every racer follows the same contract:
 *   step(budget)  → evaluations consumed this call (≤ budget unless finishing a phase)
 *   evals         → total evaluations consumed so far
 *   bestCost      → lowest objective found (+∞ while none)
 *   hist          → [{ e, c }] improvement history (evaluation, cost)
 *   view()        → { sol, cost } live incumbent for the space projection
 *   bestVec       → feature vector of the best solution (space "pin")
 *   bestSol       → { order, rejected } snapshot of the best solution
 *   done / status → lifecycle; status = { key, arg } translated by the view
 *
 * Ported from docs/index.html racelab (greedyPass / bestNeighbor / applyMove
 * and the six make* factories) with two adaptations: the objective is the
 * engine currency from race/evaluate.js (mode cost + hard-deadline
 * feasibility), and status strings are i18n keys instead of literals.
 */
import { solFeatures } from "./evaluate.js";

export function mulberry32(a) {
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Neighborhood shared by Descent/Tabu: add, remove, reposition, swap. */
export function createSearchOps(evaluator) {
  const { costOnly } = evaluator;
  // Past 240 jobs the exhaustive O(n²) scan would block the frame loop for
  // seconds, so large instances sample a bounded random move set per call
  // (uniform over the same four move families; exact scan otherwise).
  const STOCHASTIC_N = 240;
  const STOCHASTIC_BUDGET = 6_000;

  function bestNeighbor(cur, tabuUntil, iter, bestCost, rng = null) {
    let evals = 0;
    let best = null;
    const O = cur.order;
    const R = cur.rejected;
    const consider = (cost, apply, job) => {
      evals++;
      const isTabu = tabuUntil && (tabuUntil[job] || 0) > iter;
      if (isTabu && cost >= bestCost) return; // aspiration
      if (!Number.isFinite(cost)) return; // hard-deadline infeasible
      if (!best || cost < best.cost) best = { cost, apply, job };
    };
    const tryAdd = (ri, p) => {
      const j = R[ri];
      O.splice(p, 0, j);
      const r2 = R.slice(); r2.splice(ri, 1);
      consider(costOnly(O, r2), { type: "add", j, p }, j);
      O.splice(p, 1);
    };
    const tryRem = (oi) => {
      const j = O[oi];
      const o2 = O.slice(); o2.splice(oi, 1);
      consider(costOnly(o2, R.concat(j)), { type: "rem", j, oi }, j);
    };
    const tryMov = (oi, p) => {
      if (p === oi) return;
      const j = O[oi];
      const o2 = O.slice(); o2.splice(oi, 1);
      o2.splice(p, 0, j);
      consider(costOnly(o2, R), { type: "mov", j, oi, p }, j);
    };
    const trySwp = (oi, ri) => {
      const o2 = O.slice(); o2[oi] = R[ri];
      const r2 = R.slice(); r2[ri] = O[oi];
      consider(costOnly(o2, r2), { type: "swp", oi, ri }, R[ri]);
    };
    if (evaluator.n <= STOCHASTIC_N || !rng) {
      for (let ri = 0; ri < R.length; ri++) for (let p = 0; p <= O.length; p++) tryAdd(ri, p);
      for (let oi = 0; oi < O.length; oi++) tryRem(oi);
      for (let oi = 0; oi < O.length; oi++) for (let p = 0; p < O.length; p++) tryMov(oi, p);
      for (let oi = 0; oi < O.length; oi++) for (let ri = 0; ri < R.length; ri++) trySwp(oi, ri);
    } else {
      const perFamily = Math.max(64, Math.floor(STOCHASTIC_BUDGET / 4));
      if (R.length) for (let k = 0; k < perFamily; k++) tryAdd(Math.floor(rng() * R.length), Math.floor(rng() * (O.length + 1)));
      if (O.length) {
        for (let k = 0; k < perFamily; k++) tryRem(Math.floor(rng() * O.length));
        for (let k = 0; k < perFamily; k++) tryMov(Math.floor(rng() * O.length), Math.floor(rng() * O.length));
        if (R.length) for (let k = 0; k < perFamily; k++) trySwp(Math.floor(rng() * O.length), Math.floor(rng() * R.length));
      }
    }
    return { best, evals };
  }

  function applyMove(cur, mv) {
    const O = cur.order;
    const R = cur.rejected;
    if (mv.type === "add") { O.splice(mv.p, 0, mv.j); R.splice(R.indexOf(mv.j), 1); } else if (mv.type === "rem") { O.splice(mv.oi, 1); R.push(mv.j); } else if (mv.type === "mov") { O.splice(mv.oi, 1); O.splice(mv.p, 0, mv.j); } else if (mv.type === "swp") { const t = O[mv.oi]; O[mv.oi] = R[mv.ri]; R[mv.ri] = t; }
  }

  function bestInsertion(order, rejected, id) {
    let evals = 0;
    const base = costOnly(order, rejected);
    const rIdx = rejected.indexOf(id);
    const r2 = rejected.slice(); r2.splice(rIdx, 1);
    let best = { cost: base, pos: -1 };
    for (let p = 0; p <= order.length; p++) {
      order.splice(p, 0, id);
      const c = costOnly(order, r2); evals++;
      if (c < best.cost - 1e-9) best = { cost: c, pos: p };
      order.splice(p, 1);
    }
    return { ...best, evals };
  }

  /** Shared greedy construction over a shuffled pending list — consumes evaluations. */
  function greedyPass(cur, rng, cb) {
    let evals = 0;
    const pend = cur.rejected.slice();
    for (let i = pend.length - 1; i > 0; i--) {
      const k = Math.floor(rng() * (i + 1));
      [pend[i], pend[k]] = [pend[k], pend[i]];
    }
    for (const id of pend) {
      const bi = bestInsertion(cur.order, cur.rejected, id);
      evals += bi.evals;
      if (bi.pos >= 0) {
        cur.order.splice(bi.pos, 0, id);
        cur.rejected.splice(cur.rejected.indexOf(id), 1);
        if (cb) cb(bi.cost, bi.evals);
      }
    }
    return evals;
  }

  return { bestNeighbor, applyMove, bestInsertion, greedyPass };
}

export function createRaceStrategies({ evaluator, seed }) {
  const inst = evaluator;
  const raceSeed = seed >>> 0;
  const ops = createSearchOps(evaluator);
  const { bestNeighbor, applyMove, bestInsertion, greedyPass } = ops;

  function baseRacer(id, name, colorVar) {
    return {
      id, name, colorVar, evals: 0, done: false, status: { key: "preparing" },
      cur: { order: [], rejected: inst.jobs.map((j) => j.id) },
      bestCost: Infinity, hist: [], credit: 0, bestVec: null, bestSol: null,
      rng: mulberry32((0xBEEF ^ (id.length * 2654435761) ^ raceSeed) >>> 0),
      note(cost, sol) {
        if (cost < this.bestCost - 1e-9) {
          this.bestCost = cost;
          this.hist.push({ e: this.evals, c: cost });
          if (sol) {
            this.bestVec = solFeatures(inst.n, sol);
            this.bestSol = { order: sol.order.slice(), rejected: sol.rejected.slice() };
          }
        }
      },
    };
  }

  function makeGreedy() {
    const r = baseRacer("greedy", "Greedy", "--race-greedy");
    r.status = { key: "constructing" };
    r.step = function step(budget) {
      if (this.done) return 0;
      let used = 0;
      const pend = this.pend || (this.pend = (() => {
        const p = this.cur.rejected.slice();
        for (let i = p.length - 1; i > 0; i--) {
          const k = Math.floor(this.rng() * (i + 1));
          [p[i], p[k]] = [p[k], p[i]];
        }
        return p;
      })());
      while (pend.length && used < budget) {
        const id = pend.shift();
        const bi = bestInsertion(this.cur.order, this.cur.rejected, id);
        used += bi.evals; this.evals += bi.evals;
        if (bi.pos >= 0) {
          this.cur.order.splice(bi.pos, 0, id);
          this.cur.rejected.splice(this.cur.rejected.indexOf(id), 1);
          this.note(bi.cost, this.cur);
        }
      }
      if (!pend.length) { this.done = true; this.status = { key: "doneConstructive" }; }
      return used;
    };
    return r;
  }

  function makeDescent() {
    const r = baseRacer("descent", "Descent", "--race-descent");
    r.phase = "build"; r.status = { key: "constructingGreedy" };
    r.step = function step(budget) {
      if (this.done) return 0;
      let used = 0;
      if (this.phase === "build") {
        used = greedyPass(this.cur, this.rng, (c) => this.note(c, this.cur));
        this.evals += used; this.phase = "search"; this.status = { key: "descending" };
        return used;
      }
      this.credit += budget;
      while (this.credit > 0 && !this.done) {
        const { best, evals } = bestNeighbor(this.cur, null, 0, this.bestCost, this.rng);
        used += evals; this.evals += evals; this.credit -= evals;
        if (best && best.cost < this.bestCost - 1e-9) {
          applyMove(this.cur, best.apply);
          this.note(best.cost, this.cur);
        } else {
          this.done = true; this.status = { key: "stuckLocal" };
        }
      }
      return used;
    };
    return r;
  }

  function makeTabu(div) {
    const r = baseRacer(div ? "tabudiv" : "tabu", div ? "TabuDiv" : "Tabu", div ? "--race-tabudiv" : "--race-tabu");
    r.phase = "build"; r.iter = 0; r.tabuUntil = {}; r.age = {}; r.jumps = 0;
    r.status = { key: "constructingGreedy" };
    r.step = function step(budget) {
      if (this.done) return 0;
      let used = 0;
      if (this.phase === "build") {
        used = greedyPass(this.cur, this.rng, (c) => this.note(c, this.cur));
        this.evals += used; this.phase = "search";
        this.cur.order.forEach((j) => { this.age[j] = 0; });
        return used;
      }
      this.credit += budget;
      while (this.credit > 0) {
        this.iter++;
        if (div && this.iter % 45 === 0) { // diversification: reject the 30% oldest
          const byAge = this.cur.order.slice().sort((a, b) => (this.age[a] || 0) - (this.age[b] || 0));
          const k = Math.max(1, Math.floor(this.cur.order.length * 0.3));
          for (const j of byAge.slice(0, k)) {
            this.cur.order.splice(this.cur.order.indexOf(j), 1);
            this.cur.rejected.push(j);
            this.tabuUntil[j] = this.iter + 12;
          }
          this.evals++; used++; this.credit--;
          this.jumps++;
          this.status = { key: "diversified", arg: this.jumps };
          continue;
        }
        const { best, evals } = bestNeighbor(this.cur, this.tabuUntil, this.iter, this.bestCost, this.rng);
        used += evals; this.evals += evals; this.credit -= evals;
        if (!best) break;
        applyMove(this.cur, best.apply);
        this.tabuUntil[best.job] = this.iter + 8;
        if (best.apply.type === "add") this.age[best.job] = this.iter;
        this.note(best.cost, this.cur);
        if (!div) this.status = { key: "iteration", arg: this.iter };
      }
      return used;
    };
    return r;
  }

  function makeAMA() {
    const r = baseRacer("ama", "AMA (memetic)", "--race-ama");
    r.phase = "build"; r.pop = []; r.gen = 0; r.status = { key: "breeding" };
    r.step = function step(budget) {
      if (this.done) return 0;
      let used = 0;
      if (this.phase === "build") {
        while (this.pop.length < 6 && used < budget + 4000) {
          const sol = { order: [], rejected: inst.jobs.map((j) => j.id) };
          const e = greedyPass(sol, this.rng, null);
          used += e; this.evals += e;
          const c = inst.costOnly(sol.order, sol.rejected); used++; this.evals++;
          this.pop.push({ ...sol, cost: c });
          this.note(c, sol);
        }
        if (this.pop.length >= 6) { this.phase = "evolve"; this.status = { key: "generation", arg: 0 }; }
        return used;
      }
      this.credit += budget;
      while (this.credit > 0) {
        this.gen++;
        const pick = () => {
          let b = null;
          for (let k = 0; k < 3; k++) { const c = this.pop[Math.floor(this.rng() * this.pop.length)]; if (!b || c.cost < b.cost) b = c; }
          return b;
        };
        const pa = pick(); let pb = pick(); if (pb === pa) pb = pick();
        // OX-lite crossover: A's prefix + the rest in B's order
        const cut = 1 + Math.floor(this.rng() * Math.max(1, pa.order.length - 1));
        const head = pa.order.slice(0, cut);
        const tail = pb.order.filter((j) => !head.includes(j));
        const child = { order: head.concat(tail), rejected: inst.jobs.map((j) => j.id).filter((j) => !head.includes(j) && !tail.includes(j)) };
        let e = 1; this.evals++;
        e += greedyPass(child, this.rng, null); // repair/intensification
        if (this.rng() < 0.35 && child.order.length > 2) { // mutation: destroy 2 + reinsert
          for (let k = 0; k < 2; k++) {
            const i = Math.floor(this.rng() * child.order.length);
            child.rejected.push(child.order[i]); child.order.splice(i, 1);
          }
          e += greedyPass(child, this.rng, null);
        }
        const cc = inst.costOnly(child.order, child.rejected); e++;
        this.evals += e - 1; used += e; this.credit -= e;
        const worst = this.pop.reduce((w, s) => (s.cost > w.cost ? s : w), this.pop[0]);
        if (cc < worst.cost) Object.assign(worst, { order: child.order, rejected: child.rejected, cost: cc });
        this.note(cc, child);
        this.status = { key: "generation", arg: this.gen };
      }
      return used;
    };
    return r;
  }

  function makeIGr() {
    const r = baseRacer("ig", "Iterated Greedy", "--race-ig");
    r.phase = "build"; r.iter = 0; r.bestSol = null; r.stall = 0; r.status = { key: "constructingEDD" };
    r.step = function step(budget) {
      if (this.done) return 0;
      let used = 0;
      if (this.phase === "build") {
        const edd = inst.jobs.slice().sort((a, b) => a.due - b.due).map((j) => j.id);
        for (const id of edd) {
          const bi = bestInsertion(this.cur.order, this.cur.rejected, id);
          used += bi.evals; this.evals += bi.evals;
          if (bi.pos >= 0) {
            this.cur.order.splice(bi.pos, 0, id);
            this.cur.rejected.splice(this.cur.rejected.indexOf(id), 1);
            this.note(bi.cost, this.cur);
          }
        }
        this.bestSol = { order: this.cur.order.slice(), rejected: this.cur.rejected.slice() };
        this.phase = "search"; this.status = { key: "igLoop" };
        return used;
      }
      this.credit += budget;
      while (this.credit > 0) {
        this.iter++;
        const order = this.bestSol.order.slice();
        const rejected = this.bestSol.rejected.slice();
        // the full IG loop: destroy d (adaptive on stagnation), greedy rebuild, swap phase
        const nd = Math.min(order.length, 2 + Math.floor(this.stall / 40));
        for (let k = 0; k < nd; k++) {
          const i = Math.floor(this.rng() * order.length);
          rejected.push(order[i]); order.splice(i, 1);
        }
        let e = 0;
        const sol = { order, rejected };
        e += greedyPass(sol, this.rng, null);
        let c = inst.costOnly(sol.order, sol.rejected); e++;
        // swap scheduled ↔ rejected, first-improvement sweeps (third move of the recipe)
        let improved = true;
        while (improved) {
          improved = false;
          for (let oi = 0; oi < sol.order.length && !improved; oi++) {
            for (let ri = 0; ri < sol.rejected.length && !improved; ri++) {
              const o2 = sol.order.slice();
              const r2 = sol.rejected.slice();
              const tmp = o2[oi]; o2[oi] = r2[ri]; r2[ri] = tmp;
              const c2 = inst.costOnly(o2, r2); e++;
              if (c2 < c - 1e-9) { sol.order = o2; sol.rejected = r2; c = c2; improved = true; }
            }
          }
        }
        this.evals += e; used += e; this.credit -= e;
        if (c < this.bestCost - 1e-9) {
          this.bestSol = sol; this.stall = 0;
          this.note(c, sol);
        } else this.stall++;
        this.status = { key: "iteration", arg: this.iter };
      }
      return used;
    };
    return r;
  }

  const racers = [makeIGr(), makeGreedy(), makeDescent(), makeTabu(false), makeTabu(true), makeAMA()];
  for (const r of racers) {
    if (r.id === "ig") r.view = () => ({ sol: r.bestSol || r.cur, cost: Number.isFinite(r.bestCost) ? r.bestCost : null });
    else if (r.id === "ama") {
      r.view = () => {
        if (!r.pop.length) return { sol: r.cur, cost: null };
        const b = r.pop.reduce((x, m) => (m.cost < x.cost ? m : x), r.pop[0]);
        return { sol: b, cost: b.cost };
      };
    } else r.view = () => ({ sol: r.cur, cost: null });
  }
  return racers;
}
