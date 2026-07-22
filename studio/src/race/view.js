/**
 * Race-lab view: convergence canvas, solution-space canvas, live standings and
 * tooltips. Owns a requestAnimationFrame loop that lives OUTSIDE the app's
 * innerHTML render cycle (race state lives in app.state.race; the DOM is only
 * patched incrementally, following updateProgressUi's pattern).
 */
import { solFeatures } from "./evaluate.js";
import {
  layoutSpace,
  nearestLeaf,
  prerenderSpace,
  spaceY,
} from "./space.js";
import { FAMILY_COLORS } from "../views/shared.js";

const REDUCED_MOTION = typeof matchMedia === "function"
  && matchMedia("(prefers-reduced-motion: reduce)").matches;

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function sizeCanvas(canvas, cssHeight) {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const holder = canvas.parentElement;
  const width = Math.max(240, (holder?.clientWidth || 600) - 4);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(cssHeight * dpr);
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W: width, H: cssHeight };
}

export function createRaceView(app) {
  const view = {
    app,
    frame: 0,
    running: false,
    lastDraw: 0,
    spacePre: null,
    spacePreKey: "",
    bound: new WeakMap(),
  };

  const race = () => app.state.race;
  const t = (path, vars) => app.t(path, vars);
  const fmtRound = (value) => app.fmt(Math.round(value));

  const RACE_H = 290;
  const SPACE_H = 440;

  /* ---------------- DOM binding (idempotent, identity-checked) ---------------- */

  function bindOnce(element, type, handler) {
    if (!element) return;
    const key = `${type}`;
    const previous = view.bound.get(element);
    if (previous?.has(key)) return;
    if (!previous) view.bound.set(element, new Set([key]));
    else previous.add(key);
    element.addEventListener(type, handler);
  }

  function frameTooltip(canvas) {
    return canvas?.closest(".chart-frame")?.querySelector(".chart-tooltip") || null;
  }

  function attach() {
    const r = race();
    const raceCv = app.container.querySelector("#race-canvas");
    const spaceCv = app.container.querySelector("#space-canvas");
    if (!r || !raceCv) return false;
    bindOnce(raceCv, "pointermove", (event) => {
      const rect = raceCv.getBoundingClientRect();
      r.hover = { x: event.clientX - rect.left, y: event.clientY - rect.top, cx: event.clientX, cy: event.clientY };
      if (!r.playing) drawAll(performance.now());
    });
    bindOnce(raceCv, "pointerleave", () => {
      r.hover = null; r.focus = null;
      const tip = frameTooltip(raceCv);
      if (tip) tip.hidden = true;
      if (!r.playing) drawAll(performance.now());
    });
    if (spaceCv) {
      bindOnce(spaceCv, "pointermove", (event) => {
        const rect = spaceCv.getBoundingClientRect();
        onSpaceHover(event, spaceCv, event.clientX - rect.left, event.clientY - rect.top);
      });
      bindOnce(spaceCv, "pointerleave", () => {
        const tip = frameTooltip(spaceCv);
        if (tip) tip.hidden = true;
        spaceCv.style.cursor = "default";
      });
      bindOnce(spaceCv, "click", (event) => {
        const rect = spaceCv.getBoundingClientRect();
        const hit = spaceHit(event.clientX - rect.left, event.clientY - rect.top);
        r.selLeaf = hit?.leaf || null;
        renderSpaceNote();
        drawAll(performance.now());
      });
    }
    app.container.querySelectorAll("#race-standings > li").forEach((li) => {
      bindOnce(li, "click", () => {
        const racer = r.racers.find((candidate) => candidate.id === li.dataset.racer);
        if (!racer) return;
        racer.off = !racer.off;
        li.classList.toggle("off", racer.off);
        li.setAttribute("aria-pressed", racer.off ? "false" : "true");
        drawAll(performance.now());
      });
    });
    return true;
  }

  /* ---------------- loop ---------------- */

  function start() {
    if (view.running) return;
    view.running = true;
    view.frame = requestAnimationFrame(tick);
  }

  function stop() {
    view.running = false;
    if (view.frame) cancelAnimationFrame(view.frame);
    view.frame = 0;
  }

  function tick(now) {
    if (!view.running) return;
    view.frame = 0;
    const r = race();
    if (!r) { view.running = false; return; }
    view.frame = requestAnimationFrame(tick);
    driveSpaceBuilder();
    if (r.playing) stepRacers(r);
    if (now - view.lastDraw > 40) {
      if (attach()) drawAll(now);
      view.lastDraw = now;
    }
  }

  function driveSpaceBuilder() {
    const r = race();
    const builder = r?.spaceBuilder;
    if (!builder || builder.done) return;
    const t0 = performance.now();
    while (!builder.done && performance.now() - t0 < 6) builder.step();
    if (builder.done) {
      r.space = builder.space;
      view.spacePre = null;
      renderSpaceNote();
    } else {
      const label = app.container.querySelector("#race-space-progress");
      if (label) {
        label.textContent = t("race.spaceSampling", { pct: Math.round(builder.progress * 100) });
      }
    }
  }

  function stepRacers(r) {
    const n = r.evaluator.n;
    const base = n >= 400 ? 15 : n >= 200 ? 40 : 130;
    const perRacer = base * r.speed;
    let allDone = true;
    for (const racer of r.racers) {
      if (racer.done || racer.evals >= r.budget) {
        if (!racer.done) { racer.done = true; racer.status = { key: "budgetExhausted" }; }
        continue;
      }
      allDone = false;
      racer.step(Math.min(perRacer, r.budget - racer.evals));
    }
    r.maxEvals = Math.max(0, ...r.racers.map((candidate) => candidate.evals));
    if (allDone) finish();
  }

  function finish() {
    const r = race();
    if (!r || r.done) return;
    r.done = true;
    r.playing = false;
    r.winner = r.racers.reduce(
      (best, candidate) => (candidate.bestCost < (best?.bestCost ?? Infinity) ? candidate : best),
      null,
    );
    stop();
    app.onRaceFinished();
  }

  /* ---------------- convergence chart ---------------- */

  function drawRace() {
    const r = race();
    const canvas = app.container.querySelector("#race-canvas");
    if (!r || !canvas) return;
    const { ctx, W, H } = sizeCanvas(canvas, RACE_H);
    ctx.clearRect(0, 0, W, H);
    const padL = 56;
    const padR = 150;
    const padT = 14;
    const padB = 26;
    const pw = W - padL - padR;
    const ph = H - padT - padB;
    const maxE = Math.max(1000, r.budget, ...r.racers.map((candidate) => candidate.evals));
    let lo = Infinity;
    let hi = 0;
    for (const racer of r.racers) {
      if (racer.bestCost < lo) lo = racer.bestCost;
      for (const h of racer.hist) hi = Math.max(hi, h.c);
    }
    for (const point of r.engineTrace) { lo = Math.min(lo, point.c); hi = Math.max(hi, point.c); }
    const reference = app.referenceCost();
    if (Number.isFinite(reference)) { lo = Math.min(lo, reference); hi = Math.max(hi, reference); }
    if (!Number.isFinite(lo) || !hi) {
      ctx.fillStyle = cssVar("--muted");
      ctx.font = "11px system-ui";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(t("race.waiting"), padL, padT + ph / 2);
      return;
    }
    const span = Math.max(1, hi - lo);
    lo -= span * 0.06;
    hi += span * 0.04;
    const X = (e) => padL + (e / maxE) * pw;
    const Y = (c) => padT + (1 - (c - lo) / (hi - lo)) * ph;
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    const ys = (hi - lo) / 3;
    for (let k = 0; k <= 3; k++) {
      const c = lo + ys * k;
      ctx.strokeStyle = "rgba(34,84,163,.16)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, Y(c)); ctx.lineTo(W - padR, Y(c)); ctx.stroke();
      ctx.fillStyle = cssVar("--muted");
      ctx.fillText(fmtRound(c), padL - 6, Y(c));
    }
    // published reference line
    if (Number.isFinite(reference)) {
      ctx.strokeStyle = cssVar("--signal");
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, Y(reference)); ctx.lineTo(W - padR, Y(reference)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cssVar("--signal");
      ctx.textAlign = "left";
      ctx.fillText(t("race.referenceBest"), padL + 4, Y(reference) - 7);
    }
    // engine reference trace (WASM IG on the same seed)
    if (r.engineTrace.length > 1) {
      ctx.strokeStyle = cssVar("--ink");
      ctx.globalAlpha = 0.75;
      ctx.setLineDash([6, 3]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let prev = null;
      for (const point of r.engineTrace) {
        const px = X(Math.min(point.e, maxE));
        if (!prev) ctx.moveTo(px, Y(point.c));
        else { ctx.lineTo(px, Y(prev.c)); ctx.lineTo(px, Y(point.c)); }
        prev = point;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (prev) {
        ctx.fillStyle = cssVar("--ink");
        ctx.textAlign = "left";
        ctx.fillText(t("race.engineRef"), X(Math.min(prev.e, maxE)) - 4, Y(prev.c) - 8);
      }
    }
    // racer lines
    const ends = [];
    for (const racer of r.racers) {
      if (racer.off) continue;
      const col = cssVar(racer.colorVar);
      ctx.globalAlpha = r.focus && r.focus !== racer.id ? 0.28 : 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = r.focus === racer.id ? 3 : 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let prev = null;
      for (const h of racer.hist) {
        if (!prev) ctx.moveTo(X(h.e), Y(h.c));
        else { ctx.lineTo(X(h.e), Y(prev.c)); ctx.lineTo(X(h.e), Y(h.c)); }
        prev = h;
      }
      if (prev) {
        ctx.lineTo(X(racer.evals), Y(prev.c));
        ctx.stroke();
        ends.push({ racer, y: Y(prev.c), col, c: prev.c });
      }
      ctx.globalAlpha = 1;
    }
    // crosshair scrubber: every racer's cost at a chosen evaluation budget
    r.focus = null;
    const tip = frameTooltip(canvas);
    if (r.hover && r.hover.x > padL && r.hover.x < W - padR && r.hover.y > padT && r.hover.y < H - padB) {
      const eAt = ((r.hover.x - padL) / pw) * maxE;
      ctx.strokeStyle = cssVar("--muted");
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(r.hover.x, padT); ctx.lineTo(r.hover.x, H - padB); ctx.stroke();
      ctx.setLineDash([]);
      const rows = [];
      for (const racer of r.racers) {
        if (racer.off) continue;
        let c = null;
        for (let i = racer.hist.length - 1; i >= 0; i--) if (racer.hist[i].e <= eAt) { c = racer.hist[i].c; break; }
        if (c != null) rows.push({ racer, c, dy: Math.abs(Y(c) - r.hover.y) });
      }
      rows.sort((a, b) => a.c - b.c);
      const near = rows.slice().sort((a, b) => a.dy - b.dy)[0];
      if (near && near.dy < 14) r.focus = near.racer.id;
      if (rows.length && tip) {
        tip.innerHTML = `<b>@ ${fmtRound(eAt)} ${t("race.evals")}</b><br>` + rows.map((row) => `<span style="color:${cssVar(row.racer.colorVar)}">●</span> ${escapeName(row.racer)} ${fmtRound(row.c)}`).join("<br>");
        tip.hidden = false;
        const frame = canvas.closest(".chart-frame").getBoundingClientRect();
        tip.style.left = `${Math.min(frame.width - tip.offsetWidth - 8, Math.max(8, r.hover.cx - frame.left + 12))}px`;
        tip.style.top = `${Math.max(8, r.hover.cy - frame.top - tip.offsetHeight - 8)}px`;
        drawEndLabels();
        return;
      }
    }
    if (tip) tip.hidden = true;
    drawEndLabels();

    function drawEndLabels() {
      // collision-free end labels (stack, then shift the stack up if it overflows)
      ends.sort((a, b) => a.y - b.y);
      let lastY = -99;
      const lys = ends.map((end) => (lastY = Math.max(end.y, lastY + 14)));
      const over = (lys[lys.length - 1] ?? 0) - (H - 10);
      if (over > 0) for (let i = 0; i < lys.length; i++) lys[i] -= over;
      ctx.textAlign = "left";
      for (let i = 0; i < ends.length; i++) {
        const end = ends[i];
        ctx.fillStyle = cssVar("--paper-bright");
        ctx.beginPath(); ctx.arc(X(end.racer.evals), end.y, 5, 0, 7); ctx.fill();
        ctx.fillStyle = end.col;
        ctx.beginPath(); ctx.arc(X(end.racer.evals), end.y, 3.2, 0, 7); ctx.fill();
        ctx.fillStyle = cssVar("--ink");
        ctx.font = "600 11px system-ui";
        ctx.fillText(`${shortName(end.racer)} ${fmtRound(end.c)}`, X(end.racer.evals) + 9, lys[i]);
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      }
    }
  }

  const shortName = (racer) => (racer.id === "ig" ? "IG" : racer.name.split(" ")[0]);
  const escapeName = (racer) => shortName(racer);

  /* ---------------- solution-space tree ---------------- */

  function drawSpace(now) {
    const r = race();
    const canvas = app.container.querySelector("#space-canvas");
    if (!r || !canvas) return;
    const space = r.space;
    const { ctx, W, H } = sizeCanvas(canvas, SPACE_H);
    ctx.clearRect(0, 0, W, H);
    if (!space || !space.leaves.length) {
      ctx.fillStyle = cssVar("--muted");
      ctx.font = "11px system-ui";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const building = r.spaceBuilder?.supported && !r.spaceBuilder.done;
      ctx.fillText(building ? t("race.spaceSampling", { pct: Math.round(r.spaceBuilder.progress * 100) }) : t("race.spaceUnavailableShort"), 16, 24);
      return;
    }
    const key = `${W}x${H}:${app.state.locale}:${space.leaves.length}`;
    if (view.spacePreKey !== key || !view.spacePre) {
      layoutSpace(space, W, H, r.seed);
      const pre = document.createElement("canvas");
      prerenderSpace(space, W, H, pre, {
        dpr: Math.min(2, globalThis.devicePixelRatio || 1),
        colors: {
          muted: cssVar("--muted"),
          base: cssVar("--rule"),
          gold: cssVar("--ochre"),
          ink: cssVar("--ink"),
          inkSoft: cssVar("--ink-soft"),
        },
        labels: {
          aboveCanopy: t("race.aboveCanopy"),
          bestSampledLeaf: t("race.bestSampledLeaf"),
          formatCost: fmtRound,
        },
      });
      view.spacePre = pre;
      view.spacePreKey = key;
    }
    ctx.drawImage(view.spacePre, 0, 0, W, H);
    // race-best dashed line
    const gb = r.racers.reduce((m, candidate) => (candidate.off ? m : Math.min(m, candidate.bestCost)), Infinity);
    if (Number.isFinite(gb)) {
      const y = spaceY(space, gb, H);
      ctx.strokeStyle = cssVar("--ochre");
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(W - 10, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cssVar("--ink");
      ctx.font = "600 10.5px system-ui, sans-serif";
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      ctx.fillText(`${t("race.raceBest")} ${fmtRound(gb)}`, Math.max(10, W - 150), y - 3);
    }
    // fireflies
    ctx.textBaseline = "middle";
    r.racers.forEach((racer, idx) => {
      if (racer.off) return;
      const live = racer.view?.();
      if (!live?.sol) return;
      const cost = live.cost != null ? live.cost : r.evaluator.costOnly(live.sol.order, live.sol.rejected);
      if (!racer.fly) racer.fly = { x: W / 2, y: H - 30, trail: [] };
      if (!racer.fly.tick || now - racer.fly.tick > 200) {
        racer.fly.leaf = nearestLeaf(space, solFeatures(r.evaluator.n, live.sol));
        racer.fly.tick = now;
      }
      const lx = (racer.fly.leaf ? racer.fly.leaf.x : W / 2) + (idx - 2.5) * 5;
      const ly = spaceY(space, Math.min(cost, space.yHi * 1.05), H);
      const k = REDUCED_MOTION ? 1 : 0.12;
      racer.fly.x += (lx - racer.fly.x) * k;
      racer.fly.y += (ly - racer.fly.y) * k;
      const trail = racer.fly.trail;
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(last.x - racer.fly.x, last.y - racer.fly.y) > 3) {
        trail.push({ x: racer.fly.x, y: racer.fly.y });
        if (trail.length > 46) trail.shift();
      }
      const col = cssVar(racer.colorVar);
      const fA = r.focus && r.focus !== racer.id ? 0.25 : 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4;
      ctx.lineJoin = "round";
      for (let i = 1; i < trail.length; i++) {
        ctx.globalAlpha = fA * 0.35 * (i / trail.length);
        ctx.beginPath(); ctx.moveTo(trail[i - 1].x, trail[i - 1].y); ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
      }
      ctx.globalAlpha = fA;
      // pin at the racer's locked-in best
      if (Number.isFinite(racer.bestCost)) {
        const py = spaceY(space, Math.min(racer.bestCost, space.yHi * 1.05), H);
        if (racer.bestVec && (!racer.fly.pinTick || now - racer.fly.pinTick > 600)) {
          const leaf = nearestLeaf(space, racer.bestVec);
          racer.fly.pinX = leaf ? leaf.x + (idx - 2.5) * 5 : racer.fly.x;
          racer.fly.pinTick = now;
        }
        const pinX = racer.fly.pinX != null ? racer.fly.pinX : racer.fly.x;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(pinX, py - 5); ctx.lineTo(pinX - 4, py + 3); ctx.lineTo(pinX + 4, py + 3);
        ctx.closePath(); ctx.fill();
      }
      const pulse = REDUCED_MOTION ? 1 : 1 + 0.2 * Math.sin(now / 260 + idx);
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 12 * pulse;
      ctx.fillStyle = cssVar("--paper-bright");
      ctx.beginPath(); ctx.arc(racer.fly.x, racer.fly.y, 5.4, 0, 7); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(racer.fly.x, racer.fly.y, 3.6, 0, 7); ctx.fill();
      ctx.restore();
    });
    ctx.globalAlpha = 1;
    if (r.selLeaf && space.leaves.includes(r.selLeaf)) {
      ctx.strokeStyle = cssVar("--ink");
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(r.selLeaf.x, r.selLeaf.y, 8, 0, 7); ctx.stroke();
    }
  }

  function spaceHit(mx, my) {
    const r = race();
    if (!r?.space) return null;
    for (const racer of r.racers) {
      if (racer.off || !racer.fly) continue;
      if (Math.hypot(racer.fly.x - mx, racer.fly.y - my) < 10) return { fly: racer };
    }
    let best = null;
    let bd = 121;
    for (const leaf of r.space.leaves) {
      const d = (leaf.x - mx) ** 2 + (leaf.y - my) ** 2;
      if (d < bd) { bd = d; best = leaf; }
    }
    return best ? { leaf: best } : null;
  }

  function schedStrip(leaf) {
    const r = race();
    const jobs = r.evaluator.jobs;
    const total = Math.max(1, leaf.order.reduce((acc, id) => acc + jobs[id].p, 0));
    const spans = leaf.order.map((id) => {
      const job = jobs[id];
      return `<span style="width:${(100 * job.p / total).toFixed(2)}%;background:${FAMILY_COLORS[job.fam % FAMILY_COLORS.length]}"></span>`;
    }).join("");
    return `<span class="race-leaf-strip">${spans}</span>`;
  }

  function onSpaceHover(event, canvas, mx, my) {
    const hit = spaceHit(mx, my);
    canvas.style.cursor = hit ? "pointer" : "default";
    const tip = frameTooltip(canvas);
    if (!tip) return;
    if (!hit) { tip.hidden = true; return; }
    tip.innerHTML = hit.fly
      ? `<b>${hit.fly.name}</b> · ${t("race.tipBest")} ${Number.isFinite(hit.fly.bestCost) ? fmtRound(hit.fly.bestCost) : "…"} · ${statusLabel(hit.fly.status)}`
      : `<b>${fmtRound(hit.leaf.cost)}</b> · ${hit.leaf.order.length} ${t("race.tipScheduled")} / ${hit.leaf.rejected.length} ${t("race.tipRejected")}${schedStrip(hit.leaf)}`;
    tip.hidden = false;
    const frame = canvas.closest(".chart-frame").getBoundingClientRect();
    tip.style.left = `${Math.min(frame.width - tip.offsetWidth - 8, Math.max(8, event.clientX - frame.left + 12))}px`;
    tip.style.top = `${Math.max(8, event.clientY - frame.top - tip.offsetHeight - 8)}px`;
  }

  function renderSpaceNote() {
    const r = race();
    const note = app.container.querySelector("#race-space-note");
    if (!note || !r) return;
    note.innerHTML = r.selLeaf
      ? `<b>${t("race.pinnedLeaf")}</b> — ${t("race.tipCost")} ${fmtRound(r.selLeaf.cost)} · ${r.selLeaf.order.length} ${t("race.tipScheduled")} / ${r.selLeaf.rejected.length} ${t("race.tipRejected")} ${schedStrip(r.selLeaf)}`
      : t("race.spaceCaption");
  }

  /* ---------------- standings (incremental DOM, never re-rendered) ---------------- */

  const statusLabel = (status) => {
    const key = status?.key || "preparing";
    return t(`race.status.${key}`, { count: status?.arg });
  };

  function updateStandings() {
    const r = race();
    if (!r) return;
    const ordered = r.racers.slice().sort((a, b) => a.bestCost - b.bestCost);
    for (const racer of r.racers) {
      const li = app.container.querySelector(`#race-st-${racer.id}`);
      if (!li) continue;
      const rank = ordered.indexOf(racer);
      li.style.order = rank;
      li.classList.toggle("leader", rank === 0 && Number.isFinite(racer.bestCost) && !racer.off);
      const set = (suffix, value) => {
        const node = li.querySelector(`[data-st="${suffix}"]`);
        if (node && node.textContent !== value) node.textContent = value;
      };
      set("rank", Number.isFinite(racer.bestCost) ? `#${rank + 1}` : "–");
      set("cost", Number.isFinite(racer.bestCost) ? fmtRound(racer.bestCost) : "–");
      set("evals", `${app.fmt(racer.evals)} ${t("race.evals")}`);
      set("status", statusLabel(racer.status));
    }
    const maxE = r.maxEvals || 0;
    const fill = app.container.querySelector("#race-budget-fill");
    if (fill) fill.style.width = `${Math.min(100, (100 * maxE) / Math.max(1, r.budget)).toFixed(2)}%`;
    const label = app.container.querySelector("#race-budget-label");
    if (label) label.textContent = `${t("race.budgetUsed")} ${app.fmt(maxE)} / ${app.fmt(r.budget)} ${t("race.evalsPerMethod")}`;
    const leader = ordered[0];
    const note = app.container.querySelector("#race-leader-note");
    if (note) {
      note.innerHTML = leader && Number.isFinite(leader.bestCost)
        ? t("race.leaderNote", { method: `<strong>${leader.name}</strong>`, cost: fmtRound(leader.bestCost) })
        : "";
    }
  }

  /* ---------------- public API ---------------- */

  function drawAll(now) {
    drawRace();
    drawSpace(now);
    updateStandings();
  }

  return {
    attach,
    start,
    stop,
    drawAll,
    renderSpaceNote,
    get running() { return view.running; },
    redraw() {
      view.spacePreKey = "";
      if (attach()) drawAll(performance.now());
    },
    dispose: stop,
  };
}
