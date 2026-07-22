/**
 * Race-lab solution-space tree: sample greedy schedules, cluster them by
 * position-vector similarity and lay the clusters out as a canopy that the
 * racers climb during the race. Pure logic — no DOM access; `prerenderSpace`
 * paints into a canvas handed in by the caller.
 *
 * Ported from the home-page racelab (buildSpace / layoutSpace / spaceY /
 * nearestLeaf / prerender) with two adaptations: sampling uses the engine
 * currency via race/evaluate.js, and construction is chunked so large
 * instances never block the frame loop.
 */
import { solFeatures } from "./evaluate.js";
import { createSearchOps, mulberry32 } from "./strategies.js";

/** Vertical px band at the top of the canvas: better than every sampled leaf. */
export const CROWN = 46;

/** Size gates: fewer leaves past 240 jobs, no tree past 400 jobs. */
export function spacePlan(n) {
  if (n > 400) return null;
  if (n > 240) return { seeds: 8, kids: 5 };
  if (n >= 60) return { seeds: 20, kids: 12 };
  return { seeds: 26, kids: 14 };
}

export const vDist = (a, b) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d;
};

/**
 * Incremental space builder. `step(msBudget)` samples one cluster at a time
 * (greedy construction + destroy/rebuild children) and reports completion so
 * the view can drive it from idle callbacks without jank.
 */
export function createSpaceBuilder(evaluator, raceSeed) {
  const plan = spacePlan(evaluator.n);
  const space = {
    leaves: [], clusters: [], yLo: 0, yHi: 1, bestLeaf: null, supported: Boolean(plan),
  };
  if (!plan) {
    return { supported: false, space, progress: 1, step: () => true };
  }
  const rng = mulberry32((raceSeed ^ 0xA11CE) >>> 0);
  const { greedyPass } = createSearchOps(evaluator);
  const total = plan.seeds;
  let clusterId = 0;

  function buildCluster() {
    const seedSol = { order: [], rejected: evaluator.jobs.map((j) => j.id) };
    greedyPass(seedSol, rng, null);
    const cluster = { id: clusterId, leaves: [], cx: 0, rank: clusterId };
    const put = (sol) => {
      const cost = evaluator.costOnly(sol.order, sol.rejected);
      if (!Number.isFinite(cost)) return; // infeasible samples cannot be leaves
      const leaf = {
        vec: solFeatures(evaluator.n, sol), cost, nSch: sol.order.length, cluster: clusterId, x: 0, y: 0,
        order: sol.order.slice(), rejected: sol.rejected.slice(),
      };
      space.leaves.push(leaf);
      cluster.leaves.push(leaf);
    };
    put(seedSol);
    for (let k = 1; k < plan.kids; k++) {
      const kid = { order: seedSol.order.slice(), rejected: seedSol.rejected.slice() };
      const nd = 2 + Math.floor(rng() * 5);
      for (let q = 0; q < nd && kid.order.length; q++) {
        const i = Math.floor(rng() * kid.order.length);
        kid.rejected.push(kid.order[i]); kid.order.splice(i, 1);
      }
      greedyPass(kid, rng, null);
      put(kid);
    }
    if (cluster.leaves.length) space.clusters.push(cluster);
    clusterId++;
  }

  function finalize() {
    if (!space.clusters.length) return;
    // 1D similarity ordering of clusters: project between the two farthest centroids
    const cent = space.clusters.map((cl) => {
      const m = new Float32Array(evaluator.n);
      for (const lf of cl.leaves) for (let i = 0; i < m.length; i++) m[i] += lf.vec[i] / cl.leaves.length;
      return m;
    });
    let A = 0;
    let B = Math.min(1, cent.length - 1);
    let maxd = -1;
    for (let i = 0; i < cent.length; i++) {
      for (let j = i + 1; j < cent.length; j++) {
        const d = vDist(cent[i], cent[j]);
        if (d > maxd) { maxd = d; A = i; B = j; }
      }
    }
    space.clusters.forEach((cl, i) => {
      const da = vDist(cent[i], cent[A]);
      const db = vDist(cent[i], cent[B]);
      cl.t = da / Math.max(1e-6, da + db);
    });
    const ordered = space.clusters.slice().sort((a, b) => a.t - b.t);
    ordered.forEach((cl, rank) => { cl.rank = rank; });
    let lo = Infinity;
    let hi = 0;
    for (const lf of space.leaves) { lo = Math.min(lo, lf.cost); hi = Math.max(hi, lf.cost); }
    space.yLo = lo;
    space.yHi = hi;
    space.bestLeaf = space.leaves.reduce((b, l) => (l.cost < b.cost ? l : b), space.leaves[0]);
  }

  return {
    supported: true,
    space,
    get progress() { return Math.min(1, clusterId / total); },
    get done() { return clusterId >= total; },
    step() {
      if (this.done) return true;
      buildCluster();
      if (this.done) finalize();
      return this.done;
    },
  };
}

export function spaceY(space, cost, H) {
  const t = (cost - space.yLo) / Math.max(1, space.yHi - space.yLo);
  return CROWN + 12 + Math.max(0, Math.min(1.02, t)) * (H - CROWN - 70);
}

export function layoutSpace(space, W, H, raceSeed) {
  const pad = 30;
  const span = W - pad * 2;
  const n = Math.max(1, space.clusters.length);
  for (const cl of space.clusters) {
    cl.cx = pad + ((cl.rank + 0.5) / n) * span;
    const jig = mulberry32((cl.id * 977 + raceSeed) >>> 0);
    for (const lf of cl.leaves) {
      lf.x = cl.cx + (jig() - 0.5) * (span / n) * 1.35;
      lf.y = spaceY(space, lf.cost, H);
    }
  }
}

export function nearestLeaf(space, vec) {
  let best = null;
  let bd = Infinity;
  for (const lf of space.leaves) {
    const d = vDist(vec, lf.vec);
    if (d < bd) { bd = d; best = lf; }
  }
  return best;
}

/**
 * Paint the static canopy (crown band, trunk, limbs, twigs, leaves, golden
 * best-sample leaf) into `canvas`. Colors/labels come from the caller so this
 * stays theme- and locale-agnostic.
 */
export function prerenderSpace(space, W, H, canvas, { colors, labels, dpr = 1 }) {
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { muted, base, gold, inkSoft } = colors;
  // crown band: beyond every sampled schedule
  const grad = ctx.createLinearGradient(0, 0, 0, CROWN + 16);
  grad.addColorStop(0, `${gold}2e`);
  grad.addColorStop(1, `${gold}00`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, CROWN + 16);
  ctx.font = "600 10.5px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillStyle = inkSoft;
  ctx.fillText(labels.aboveCanopy, 12, 14);
  // trunk
  const bx = W / 2;
  const by = H - 12;
  const ty = H - 58;
  ctx.strokeStyle = base;
  ctx.lineCap = "round";
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, ty); ctx.stroke();
  // limbs + twigs + leaves
  for (const cl of space.clusters) {
    let my = 0;
    for (const lf of cl.leaves) my += lf.y / cl.leaves.length;
    ctx.strokeStyle = base;
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(bx, ty);
    ctx.quadraticCurveTo(cl.cx, H - 40, cl.cx, my + 26); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    for (const lf of cl.leaves) {
      ctx.beginPath(); ctx.moveTo(cl.cx, my + 26);
      ctx.quadraticCurveTo((cl.cx + lf.x) / 2, (my + lf.y) / 2 + 8, lf.x, lf.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = muted;
    for (const lf of cl.leaves) {
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.arc(lf.x, lf.y, 2.4, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // the golden leaf (best sample)
  const bl = space.bestLeaf;
  if (bl) {
    ctx.fillStyle = gold;
    ctx.beginPath(); ctx.arc(bl.x, bl.y, 4.5, 0, 7); ctx.fill();
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(bl.x, bl.y, 7, 0, 7); ctx.stroke();
    ctx.fillStyle = inkSoft;
    ctx.font = "600 10.5px system-ui, sans-serif";
    ctx.fillText(`${labels.bestSampledLeaf} · ${labels.formatCost(bl.cost)}`, Math.min(bl.x + 12, W - 170), bl.y);
  }
  return canvas;
}
