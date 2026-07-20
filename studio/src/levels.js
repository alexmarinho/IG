/**
 * Pure helpers for the level-select home and the instance-page scenario
 * quick-switch. No DOM, no application state: every function takes plain data
 * (plus injected formatters for localization) and returns values or HTML
 * strings that app.js composes into the page.
 */

/** Fixed level order used by the grid, the quick-switch arrows and the dropdown. */
export const SCENARIO_ORDER = Object.freeze([
  "factory", "ai", "kitchen", "surgery", "print3d", "coffee", "bakery",
  "dental", "laser", "laundry", "studio", "lab", "brewery",
]);

/** Scenarios introduced with the level-select release; they carry the "new" ribbon. */
export const NEW_SCENARIO_IDS = Object.freeze([
  "print3d", "coffee", "bakery", "dental", "laser", "laundry", "studio", "lab", "brewery",
]);

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
