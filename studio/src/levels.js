/**
 * Pure helpers for the level-select home and the instance-page scenario
 * quick-switch. No DOM, no application state: every function takes plain data
 * (plus injected formatters for localization) and returns values or HTML
 * strings that app.js composes into the page.
 */

/** Fixed level order used by the grid, the quick-switch arrows and the dropdown. */
export const SCENARIO_ORDER = Object.freeze(["factory", "print3d", "coffee", "brewery"]);

/** Scenarios introduced with the small-business release; they carry the "new" ribbon. */
export const NEW_SCENARIO_IDS = Object.freeze(["print3d", "coffee", "brewery"]);

/** Tier glyph and rough solver time shown on each instance (tier) button. */
export const TIER_META = Object.freeze({
  S: Object.freeze({ icon: "⚡", time: "~3s" }),
  M: Object.freeze({ icon: "🔥", time: "~15s" }),
  L: Object.freeze({ icon: "🏔️", time: "~30s" }),
});

/** Metrics compared on the delta strip after a scenario switch. */
export const DELTA_METRICS = Object.freeze(["n", "families", "horizon", "setupMean", "rejRatio", "loadRatio", "tightPct"]);

/**
 * Return the scenario ids in the fixed level order. Ids present in the catalog
 * but missing from SCENARIO_ORDER keep their relative catalog order at the end,
 * so the UI never silently drops a scenario.
 */
export function orderedScenarioIds(availableIds) {
  const available = [...availableIds];
  const ordered = SCENARIO_ORDER.filter((id) => available.includes(id));
  for (const id of available) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}

/**
 * Classify an instance into a rough S/M/L effort tier. Domain instances encode
 * the tier in the name (`COFFEE_S_45`); benchmarks fall back to job count.
 */
export function tierOf(instanceId, jobCount) {
  const id = String(instanceId || "");
  if (/_S_\d/i.test(id)) return "S";
  if (/_M_\d/i.test(id)) return "M";
  if (/_L_\d/i.test(id)) return "L";
  const n = Number(jobCount) || 0;
  if (n < 75) return "S";
  if (n < 150) return "M";
  return "L";
}

/**
 * Humanize a minute span: at least two days becomes "X days", at least two
 * hours becomes "Xh Ym", anything smaller stays "X min". The day label and the
 * number formatter are injected so the helper stays locale-agnostic.
 */
export function formatTimeSpan(minutes, {
  dayLength = 1440,
  dayLabel = { one: "day", many: "days" },
  formatNumber = (value) => String(value),
} = {}) {
  const total = Number(minutes);
  if (!Number.isFinite(total)) return "—";
  const value = Math.max(0, Math.round(total));
  if (value >= 2 * dayLength) return `${formatNumber(Math.round(value / dayLength))} ${dayLabel.many}`;
  if (value >= 120) {
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    return rest ? `${formatNumber(hours)}h ${formatNumber(rest)}m` : `${formatNumber(hours)}h`;
  }
  return `${formatNumber(value)} min`;
}

/**
 * Inline SVG sparkline of the 8 processing-time bins from INSTANCE_STATS.
 * Pure string output; no canvas. Pass a localized `label` for screen readers.
 */
export function miniBarsSvg(bins, { label = "" } = {}) {
  const counts = Array.isArray(bins) && bins.length ? bins.slice(0, 8) : [0];
  const max = Math.max(1, ...counts);
  const width = 96;
  const height = 26;
  const gap = 2;
  const barWidth = (width - gap * (counts.length - 1)) / counts.length;
  const rects = counts.map((count, index) => {
    const barHeight = count ? Math.max(2, (count / max) * height) : 1;
    const x = (index * (barWidth + gap)).toFixed(2);
    const y = (height - barHeight).toFixed(2);
    return `<rect x="${x}" y="${y}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="1"${count ? "" : ' class="is-empty"'}></rect>`;
  }).join("");
  const a11y = label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"';
  return `<svg class="mini-bars" viewBox="0 0 ${width} ${height}"${a11y} focusable="false">${rects}</svg>`;
}

/** Columns of the job explorer, keyed by the scenario vocabulary. */
export const EXPLORER_COLUMNS = Object.freeze([
  "job", "family", "processingTime", "releaseTime", "dueDate",
  "hardDeadline", "tardinessWeight", "executionCost", "rejectionCost",
]);

const EXPLORER_SORT_VALUE = {
  job: (job) => job.id,
  family: (job) => job.family,
  processingTime: (job) => job.processingTime,
  releaseTime: (job) => job.releaseTime,
  dueDate: (job) => job.due,
  hardDeadline: (job) => job.hardDeadline,
  tardinessWeight: (job) => job.weight,
  executionCost: (job) => job.processingCost,
  rejectionCost: (job) => job.rejectionCost,
};

/**
 * Sort jobs for the explorer table. Numeric, Infinity-safe (missing hard
 * deadlines always sink to the bottom), with the job id as a stable tiebreak.
 * Unknown keys fall back to the id order; anything but "desc" is ascending.
 */
export function sortJobs(jobs, key = "job", direction = "asc") {
  const valueOf = EXPLORER_SORT_VALUE[key] || EXPLORER_SORT_VALUE.job;
  const sign = direction === "desc" ? -1 : 1;
  return [...(jobs || [])].sort((left, right) => {
    const a = Number(valueOf(left));
    const b = Number(valueOf(right));
    const finiteA = Number.isFinite(a);
    const finiteB = Number.isFinite(b);
    if (finiteA && finiteB && a !== b) return sign * (a - b);
    if (finiteA !== finiteB) return finiteA ? -1 : 1;
    return left.id - right.id;
  });
}

/**
 * Human-facing order code for a job. Domain scenarios map the job id through
 * their `orderId { prefix, offset }` spec (ORD-1044); the factory benchmark
 * keeps the classic `J07` label.
 */
export function orderCode(orderIdSpec, id) {
  if (orderIdSpec && typeof orderIdSpec.prefix === "string" && Number.isFinite(orderIdSpec.offset)) {
    return `${orderIdSpec.prefix}${orderIdSpec.offset + Number(id)}`;
  }
  return `J${String(Number(id) + 1).padStart(2, "0")}`;
}

/**
 * "day 2, 09:00" style timestamp: 1-based day inside the scenario calendar
 * plus the intra-day clock. The day word is injected for localization.
 */
export function formatDayTime(minutes, { dayLength = 1440, dayWord = "day" } = {}) {
  const total = Number(minutes);
  if (!Number.isFinite(total)) return "—";
  const value = Math.max(0, Math.round(total));
  const day = Math.floor(value / dayLength) + 1;
  const rest = value % dayLength;
  const hours = String(Math.floor(rest / 60)).padStart(2, "0");
  const mins = String(rest % 60).padStart(2, "0");
  return { day, clock: `${hours}:${mins}`, text: `${dayWord} ${day}, ${hours}:${mins}` };
}

/**
 * Compact processing-time label: under one hour stays in minutes, anything
 * longer becomes hours with at most one decimal ("18 min", "2,5 h").
 */
export function humanizeMinutes(minutes, { formatNumber = (value) => String(value) } = {}) {
  const total = Number(minutes);
  if (!Number.isFinite(total)) return "—";
  const value = Math.max(0, Math.round(total));
  if (value < 60) return `${formatNumber(value)} min`;
  const hours = Math.round((value / 60) * 10) / 10;
  return `${formatNumber(hours)} h`;
}

/**
 * Compare two INSTANCE_STATS entries and return one chip per DELTA_METRICS
 * entry: `{ key, text, direction }` with direction "up" | "down" | "flat".
 * All words and number formatting arrive via options so nothing is hardcoded.
 */
export function deltaChips(current, previous, {
  formatNumber = (value) => String(value),
  formatSpan = (minutes) => `${minutes} min`,
  jobsLabel = "jobs",
  familiesLabel = "families",
  pointsSuffix = "pp",
} = {}) {
  if (!current || !previous) return [];
  const directionOf = (delta) => (delta > 0 ? "up" : delta < 0 ? "down" : "flat");
  const signed = (delta, magnitude) => {
    if (delta > 0) return `+${magnitude}`;
    if (delta < 0) return `−${magnitude}`;
    return `±${magnitude}`;
  };
  const absolute = (value) => formatNumber(Math.abs(value));
  return [
    { key: "n", text: signed(current.n - previous.n, absolute(current.n - previous.n)), direction: directionOf(current.n - previous.n), suffix: jobsLabel },
    { key: "families", text: signed(current.families - previous.families, absolute(current.families - previous.families)), direction: directionOf(current.families - previous.families), suffix: familiesLabel },
    { key: "horizon", text: signed(current.horizon - previous.horizon, formatSpan(Math.abs(current.horizon - previous.horizon))), direction: directionOf(current.horizon - previous.horizon), suffix: "" },
    { key: "setupMean", text: signed(current.setupMean - previous.setupMean, `${absolute(current.setupMean - previous.setupMean)} min`), direction: directionOf(current.setupMean - previous.setupMean), suffix: "" },
    { key: "rejRatio", text: signed(current.rejRatio - previous.rejRatio, `${formatNumber(Math.abs(Math.round((current.rejRatio - previous.rejRatio) * 10) / 10))}×`), direction: directionOf(current.rejRatio - previous.rejRatio), suffix: "" },
    { key: "loadRatio", text: signed(current.loadRatio - previous.loadRatio, `${absolute(Math.round((current.loadRatio - previous.loadRatio) * 100))}%`), direction: directionOf(current.loadRatio - previous.loadRatio), suffix: "" },
    { key: "tightPct", text: signed(current.tightPct - previous.tightPct, `${absolute(current.tightPct - previous.tightPct)} ${pointsSuffix}`), direction: directionOf(current.tightPct - previous.tightPct), suffix: "" },
  ].map((chip) => ({ key: chip.key, text: chip.suffix ? `${chip.text} ${chip.suffix}` : chip.text, direction: chip.direction }));
}
