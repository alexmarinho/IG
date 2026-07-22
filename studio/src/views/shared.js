/**
 * Shared rendering helpers for the Studio view mixins: HTML escaping, label
 * capitalization and the inline SVG icon set. Everything here is pure and
 * DOM-free so every views/*.js module can import it safely.
 */

export const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

export const sentenceLabel = (value) => {
  const text = String(value || "");
  return text ? `${text[0].toLocaleUpperCase()}${text.slice(1)}` : text;
};

/** Palette used for family chips, tags, gantt bars and heatmap accents. */
export const FAMILY_COLORS = Object.freeze([
  "#2254a3", "#1f7a6d", "#d5481b", "#963d38", "#b17a12",
  "#507b43", "#2f718f", "#a05c2f", "#6e7097", "#4e6662",
]);

export const icons = {
  logo: `<svg viewBox="0 0 28 24" fill="none" aria-hidden="true"><rect x="1" y="11" width="5" height="9" fill="currentColor"/><rect x="8" y="11" width="5" height="9" fill="currentColor" opacity=".72"/><rect x="15" y="4" width="5" height="9" fill="#df430f"/><rect x="22" y="11" width="5" height="9" fill="currentColor" opacity=".42"/><path d="M15.5 17.5h4v4h-4z" stroke="#2254a3" stroke-dasharray="1.6 1.6"/><path d="m17.5 14.5v2.2" stroke="#df430f" stroke-width="1.4"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.2 2.4 3.3 5.4 3.3 9S14.2 18.6 12 21c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3Z"/></svg>`,
  code: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m8 5-6 7 6 7M16 5l6 7-6 7M14 3l-4 18"/></svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 5.5A3.5 3.5 0 0 1 6.5 2H11v18H6.5A3.5 3.5 0 0 0 3 23V5.5ZM21 5.5A3.5 3.5 0 0 0 17.5 2H13v18h4.5A3.5 3.5 0 0 1 21 23V5.5Z"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 20V9M10 20V4M16 20v-7M22 20V7M2 20h22"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 10h18M7 14h2M12 14h2M17 14h1M7 18h2M12 18h2"/></svg>`,
  data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></svg>`,
  flask: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M9 2h6M10 2v6l-6 11a2 2 0 0 0 1.8 3h12.4a2 2 0 0 0 1.8-3L14 8V2M7 16h10"/></svg>`,
  empty: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 48V18h48v30H8Z"/><path d="M8 40h48M18 48V29h10v19M36 48V24h10v24M14 14h36"/><circle cx="50" cy="14" r="5" fill="currentColor" stroke="none"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`,
};
