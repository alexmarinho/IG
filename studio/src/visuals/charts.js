const COLORS = {
  grid: "rgba(34,84,163,.16)",
  axis: "#62645e",
  text: "#62645e",
  strong: "#171918",
  violet: "#2254a3",
  violetSoft: "rgba(34,84,163,.12)",
  teal: "#1f7a6d",
  tealSoft: "rgba(31,122,109,.16)",
  amber: "#df430f",
  coral: "#a63a35",
  setup: "#8d8c83",
  background: "#fbf9f2",
};

export const FAMILY_COLORS = Object.freeze([
  "#2254a3", "#1f7a6d", "#d5481b", "#963d38", "#b17a12",
  "#507b43", "#2f718f", "#a05c2f", "#6e7097", "#4e6662",
]);

function canvasSize(canvas, minimumWidth = 0) {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const box = canvas.getBoundingClientRect();
  const width = Math.max(minimumWidth, Math.round(box.width || canvas.parentElement?.clientWidth || 320));
  const height = Math.max(160, Math.round(box.height || Number(canvas.dataset.height) || 260));
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  context.lineJoin = "round";
  context.lineCap = "round";
  return { context, width, height };
}

function formatCompact(value, locale = "en") {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function niceExtent(values, fallback = [0, 1]) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return fallback;
  let minimum = Math.min(...finite);
  let maximum = Math.max(...finite);
  if (minimum === maximum) {
    const padding = Math.max(1, Math.abs(minimum) * 0.05);
    minimum -= padding;
    maximum += padding;
  }
  return [minimum, maximum];
}

function drawFrame(context, plot, { xTicks = [], yTicks = [], formatX = String, formatY = String } = {}) {
  context.strokeStyle = COLORS.grid;
  context.fillStyle = COLORS.text;
  context.lineWidth = 1;
  context.textAlign = "center";
  context.textBaseline = "top";
  for (const tick of xTicks) {
    const x = plot.x + plot.w * tick.ratio;
    context.beginPath(); context.moveTo(x, plot.y); context.lineTo(x, plot.y + plot.h); context.stroke();
    context.fillText(formatX(tick.value), x, plot.y + plot.h + 9);
  }
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (const tick of yTicks) {
    const y = plot.y + plot.h * (1 - tick.ratio);
    context.beginPath(); context.moveTo(plot.x, y); context.lineTo(plot.x + plot.w, y); context.stroke();
    context.fillText(formatY(tick.value), plot.x - 9, y);
  }
  context.strokeStyle = COLORS.axis;
  context.beginPath(); context.moveTo(plot.x, plot.y); context.lineTo(plot.x, plot.y + plot.h); context.lineTo(plot.x + plot.w, plot.y + plot.h); context.stroke();
}

const ticks = (count, minimum, maximum) => Array.from({ length: count }, (_, index) => ({
  ratio: index / (count - 1),
  value: minimum + (maximum - minimum) * index / (count - 1),
}));

export function drawConvergence(canvas, checkpoints, { locale = "en", comparison = false } = {}) {
  const { context, width, height } = canvasSize(canvas);
  const points = Array.isArray(checkpoints) ? checkpoints : [];
  if (!points.length) return;
  const xValue = (point) => comparison ? (point.checkpoint ?? point.iteration) : (point.evaluations ?? point.evals ?? point.iteration);
  const yValue = (point) => point.bestCost ?? point.cost ?? point.median;
  const [xMin, xMax] = niceExtent(points.map(xValue), [0, 1]);
  const [rawMin, rawMax] = niceExtent(points.flatMap((point) => comparison
    ? [point.min, point.q1, point.median, point.q3, point.max]
    : [yValue(point)]));
  const yPadding = Math.max(1, (rawMax - rawMin) * 0.08);
  const yMin = Math.max(0, rawMin - yPadding);
  const yMax = rawMax + yPadding;
  const plot = { x: 58, y: 16, w: Math.max(40, width - 76), h: Math.max(60, height - 58) };
  drawFrame(context, plot, {
    xTicks: ticks(5, xMin, xMax), yTicks: ticks(4, yMin, yMax),
    formatX: (value) => formatCompact(value, locale), formatY: (value) => formatCompact(value, locale),
  });
  const x = (value) => plot.x + (value - xMin) / Math.max(1, xMax - xMin) * plot.w;
  const y = (value) => plot.y + (1 - (value - yMin) / Math.max(1, yMax - yMin)) * plot.h;

  if (comparison) {
    context.fillStyle = COLORS.tealSoft;
    context.beginPath();
    points.forEach((point, index) => {
      const command = index ? "lineTo" : "moveTo";
      context[command](x(xValue(point)), y(point.q3));
    });
    [...points].reverse().forEach((point) => context.lineTo(x(xValue(point)), y(point.q1)));
    context.closePath(); context.fill();

    context.strokeStyle = "rgba(98,100,94,.56)";
    context.setLineDash([5, 5]);
    for (const selector of [(point) => point.min, (point) => point.max]) {
      context.beginPath();
      points.forEach((point, index) => context[index ? "lineTo" : "moveTo"](x(xValue(point)), y(selector(point))));
      context.stroke();
    }
    context.setLineDash([]);
  }

  context.strokeStyle = COLORS.violet;
  context.lineWidth = 2.5;
  context.beginPath();
  points.forEach((point, index) => {
    const px = x(xValue(point));
    const py = y(yValue(point));
    if (!index) context.moveTo(px, py);
    else {
      const previousY = y(yValue(points[index - 1]));
      context.lineTo(px, previousY);
      context.lineTo(px, py);
    }
  });
  context.stroke();
  const last = points.at(-1);
  context.fillStyle = COLORS.violet;
  context.beginPath(); context.arc(x(xValue(last)), y(yValue(last)), 4, 0, Math.PI * 2); context.fill();
}

export function drawDistribution(canvas, runs, referenceCost, { locale = "en" } = {}) {
  const { context, width, height } = canvasSize(canvas);
  const values = (runs || []).map((run) => run.bestCost ?? run.cost).filter(Number.isFinite);
  if (!values.length) return [];
  let [minimum, maximum] = niceExtent([...values, referenceCost]);
  const padding = Math.max(1, (maximum - minimum) * 0.12);
  minimum -= padding; maximum += padding;
  const plot = { x: 46, y: 28, w: Math.max(80, width - 64), h: Math.max(70, height - 66) };
  drawFrame(context, plot, {
    xTicks: ticks(5, minimum, maximum), yTicks: [],
    formatX: (value) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value),
  });
  const x = (value) => plot.x + (value - minimum) / Math.max(1, maximum - minimum) * plot.w;
  if (Number.isFinite(referenceCost)) {
    const rx = x(referenceCost);
    context.strokeStyle = COLORS.amber; context.setLineDash([4, 4]);
    context.beginPath(); context.moveTo(rx, plot.y); context.lineTo(rx, plot.y + plot.h); context.stroke();
    context.setLineDash([]);
  }
  const stacks = new Map();
  const counts = new Map();
  for (const value of values) counts.set(String(value), (counts.get(String(value)) || 0) + 1);
  const largestStack = Math.max(...counts.values(), 1);
  const stackGap = Math.min(11, (plot.h - 24) / Math.max(1, largestStack - 1));
  const dotRadius = Math.max(2.3, Math.min(4.2, stackGap * 0.42));
  const hits = [];
  for (const run of runs) {
    const value = run.bestCost ?? run.cost;
    const key = String(value);
    const stack = stacks.get(key) || 0;
    stacks.set(key, stack + 1);
    const px = x(value);
    const py = plot.y + plot.h - 12 - stack * stackGap;
    context.fillStyle = COLORS.background;
    context.strokeStyle = COLORS.violet;
    context.lineWidth = 1.35;
    context.beginPath(); context.arc(px, py, dotRadius, 0, Math.PI * 2); context.fill(); context.stroke();
    hits.push({ x: px, y: py, r: Math.max(6, dotRadius + 3), run });
  }
  return hits;
}

export function drawHistogram(canvas, values, { locale = "en", color = COLORS.violet } = {}) {
  const { context, width, height } = canvasSize(canvas);
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return;
  const [minimum, maximum] = niceExtent(finite);
  const count = Math.max(4, Math.min(12, Math.round(Math.sqrt(finite.length))));
  const span = Math.max(1, maximum - minimum);
  const bins = Array.from({ length: count }, () => 0);
  for (const value of finite) bins[Math.min(count - 1, Math.floor((value - minimum) / span * count))] += 1;
  const maxBin = Math.max(...bins, 1);
  const plot = { x: 12, y: 10, w: width - 24, h: height - 34 };
  const barWidth = plot.w / count;
  context.fillStyle = color;
  bins.forEach((bin, index) => {
    const barHeight = bin / maxBin * plot.h;
    context.fillRect(plot.x + index * barWidth + 2, plot.y + plot.h - barHeight, Math.max(2, barWidth - 4), barHeight);
  });
  context.strokeStyle = COLORS.axis;
  context.beginPath(); context.moveTo(plot.x, plot.y + plot.h); context.lineTo(plot.x + plot.w, plot.y + plot.h); context.stroke();
  context.fillStyle = COLORS.text; context.textBaseline = "top";
  context.textAlign = "left"; context.fillText(formatCompact(minimum, locale), plot.x, plot.y + plot.h + 7);
  context.textAlign = "right"; context.fillText(formatCompact(maximum, locale), plot.x + plot.w, plot.y + plot.h + 7);
}

export function drawHeatmap(canvas, matrix, { locale = "en" } = {}) {
  const { context, width, height } = canvasSize(canvas, 440);
  const size = matrix.length;
  if (!size) return [];
  const values = matrix.flat().filter(Number.isFinite);
  const maximum = Math.max(...values, 1);
  const left = 34, top = 24;
  const cell = Math.min((width - left - 10) / size, (height - top - 18) / size);
  const hits = [];
  context.textAlign = "center"; context.textBaseline = "middle";
  for (let row = 0; row < size; row += 1) {
    context.fillStyle = COLORS.text;
    context.fillText(String(row), left - 13, top + row * cell + cell / 2);
    context.fillText(String(row), left + row * cell + cell / 2, top - 10);
    for (let column = 0; column < size; column += 1) {
      const value = matrix[row][column] || 0;
      const ratio = Math.sqrt(value / maximum);
      context.fillStyle = `rgba(34,84,163,${0.05 + ratio * 0.74})`;
      context.fillRect(left + column * cell + 1, top + row * cell + 1, Math.max(1, cell - 2), Math.max(1, cell - 2));
      if (cell >= 24) {
        context.fillStyle = ratio > 0.55 ? COLORS.strong : COLORS.text;
        context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.fillText(new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value), left + column * cell + cell / 2, top + row * cell + cell / 2);
      }
      hits.push({ x: left + column * cell, y: top + row * cell, w: cell, h: cell, row, column, value });
    }
  }
  return hits;
}

export function drawGantt(canvas, evaluation, instance, { locale = "en" } = {}) {
  const { context, width, height } = canvasSize(canvas, canvas.closest(".gantt-scroll") ? 820 : 0);
  const rows = evaluation?.rows || [];
  if (!rows.length) return [];
  const maximum = Math.max(evaluation.makespan, ...rows.map((row) => row.due), 1);
  const plot = { x: 54, y: 30, w: width - 72, h: Math.min(104, height - 74) };
  const y = plot.y + 22;
  const laneHeight = Math.max(34, plot.h - 34);
  const x = (value) => plot.x + value / maximum * plot.w;
  const xTicks = ticks(5, 0, maximum);
  drawFrame(context, { ...plot, y: plot.y, h: laneHeight + 22 }, {
    xTicks, yTicks: [], formatX: (value) => formatCompact(value, locale),
  });
  context.fillStyle = COLORS.text; context.textAlign = "right"; context.textBaseline = "middle";
  context.fillText("M1", plot.x - 12, y + laneHeight / 2);
  const hits = [];
  for (const row of rows) {
    const setupX = x(row.setupStart);
    const processX = x(row.processStart);
    const finishX = x(row.finish);
    if (row.setupTime > 0) {
      const setupWidth = Math.max(1, processX - setupX);
      context.fillStyle = "#d8d2c5";
      context.fillRect(setupX, y, setupWidth, laneHeight);
      context.save();
      context.beginPath();
      context.rect(setupX, y, setupWidth, laneHeight);
      context.clip();
      context.strokeStyle = "rgba(98,100,94,.62)";
      context.lineWidth = .8;
      for (let hatchX = setupX - laneHeight; hatchX < processX + laneHeight; hatchX += 6) {
        context.beginPath();
        context.moveTo(hatchX, y + laneHeight);
        context.lineTo(hatchX + laneHeight, y);
        context.stroke();
      }
      context.restore();
    }
    context.fillStyle = FAMILY_COLORS[row.family % FAMILY_COLORS.length];
    context.fillRect(processX + 0.5, y, Math.max(1.5, finishX - processX - 1), laneHeight);
    if (finishX - processX > 28) {
      context.fillStyle = "#fffaf0";
      context.textAlign = "center"; context.textBaseline = "middle";
      context.font = "600 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      context.fillText(`J${String(row.id + 1).padStart(2, "0")}`, (processX + finishX) / 2, y + laneHeight / 2);
    }
    if (row.late > 0) {
      const dueX = x(row.due);
      context.fillStyle = COLORS.coral;
      context.beginPath(); context.moveTo(dueX, y - 3); context.lineTo(dueX - 4, y - 10); context.lineTo(dueX + 4, y - 10); context.closePath(); context.fill();
    }
    hits.push({ x: setupX, y, w: Math.max(4, finishX - setupX), h: laneHeight, row });
  }
  return hits;
}

export function attachCanvasTooltip(canvas, hits, render, { onSelect } = {}) {
  const tooltip = canvas.closest(".chart-frame")?.querySelector(".chart-tooltip");
  if (!tooltip) return () => {};
  const hitAt = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return hits.find((hit) => {
      if ("r" in hit) return Math.hypot(x - hit.x, y - hit.y) <= hit.r;
      return x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h;
    });
  };
  const move = (event) => {
    const hit = hitAt(event);
    if (!hit) { tooltip.hidden = true; canvas.style.cursor = "default"; return; }
    tooltip.innerHTML = render(hit);
    tooltip.hidden = false;
    const frame = canvas.closest(".chart-frame").getBoundingClientRect();
    tooltip.style.left = `${Math.min(frame.width - tooltip.offsetWidth - 8, Math.max(8, event.clientX - frame.left + 12))}px`;
    tooltip.style.top = `${Math.max(8, event.clientY - frame.top - tooltip.offsetHeight - 8)}px`;
    canvas.style.cursor = onSelect ? "pointer" : "crosshair";
  };
  const leave = () => { tooltip.hidden = true; canvas.style.cursor = "default"; };
  const click = (event) => { const hit = hitAt(event); if (hit && onSelect) onSelect(hit); };
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("click", click);
  return () => {
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerleave", leave);
    canvas.removeEventListener("click", click);
  };
}
