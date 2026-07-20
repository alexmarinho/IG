/**
 * Instance-page (problem data) view mixin: quick-switch bar, delta strip,
 * intro metric block with help popovers, distributions/heatmap scaffolding
 * and the sortable, humanized order explorer. Mixed onto
 * IGStudioApp.prototype — `this` is the app instance.
 */

import { escapeHtml, sentenceLabel, FAMILY_COLORS } from "./shared.js";
import {
  EXPLORER_COLUMNS,
  deltaChips,
  formatDayTime,
  humanizeMinutes,
  orderedScenarioIds,
  sortJobs,
} from "../levels.js";

export const instanceView = {
  /** Quick-switch bar: cycle scenarios, jump via dropdown, or swap instance. */
  renderScenarioSwitch() {
    const ids = orderedScenarioIds(this.catalogScenarios().map(({ id }) => id));
    const currentIndex = Math.max(0, ids.indexOf(this.state.scenarioId));
    const previousId = ids[(currentIndex - 1 + ids.length) % ids.length];
    const nextId = ids[(currentIndex + 1) % ids.length];
    const scenario = this.scenario();
    const previousName = this.localizedScenario(previousId).name;
    const nextName = this.localizedScenario(nextId).name;
    const instances = this.scenarioInstances();
    const running = ["running", "paused"].includes(this.state.status);
    const disabled = running || this.state.status === "loading";
    const options = ids.map((id) => {
      const localized = this.localizedScenario(id);
      return `<option value="${escapeHtml(id)}"${id === this.state.scenarioId ? " selected" : ""}>${escapeHtml(localized.name)}</option>`;
    }).join("");
    const instanceOptions = instances.map((instance) => `<option value="${escapeHtml(instance.id)}"${instance.id === this.state.instanceId ? " selected" : ""}>${escapeHtml(this.instanceDisplayLabel(instance))}</option>`).join("");
    return `<div class="scenario-switch">
      <button type="button" class="switch-arrow" data-scenario-step="-1" aria-label="${escapeHtml(this.t("controls.scenarioPrev"))}"${disabled ? " disabled" : ""}><i aria-hidden="true">‹</i><span>${escapeHtml(previousName)}</span></button>
      <div class="switch-current">
        <span class="switch-thumb" style="background-image:url('${escapeHtml(this.scenarioVisualUrl(scenario))}');--scenario-focus:${escapeHtml(scenario.visual.objectPosition)}" aria-hidden="true"></span>
        <label class="switch-scenario-field"><span class="switch-field-label">${escapeHtml(this.t("controls.scenario"))}</span>
          <select id="scenario-select" aria-label="${escapeHtml(this.t("controls.scenario"))}"${disabled ? " disabled" : ""}>${options}</select>
        </label>
      </div>
      <button type="button" class="switch-arrow is-next" data-scenario-step="1" aria-label="${escapeHtml(this.t("controls.scenarioNext"))}"${disabled ? " disabled" : ""}><span>${escapeHtml(nextName)}</span><i aria-hidden="true">›</i></button>
      <label class="switch-instance-field"><span class="switch-field-label">${escapeHtml(this.t("actions.changeInstance"))}</span>
        <select id="switch-instance-select"${disabled ? " disabled" : ""}>${instanceOptions}</select>
      </label>
    </div>`;
  },

  /** Delta strip comparing the current instance with the pre-switch scenario. */
  renderDeltaStrip() {
    const previous = this.state.previousScenarioStats;
    const currentStats = this.instanceStats();
    if (!previous?.stats || !currentStats) return "";
    const previousScenario = this.localizedScenario(previous.scenarioId);
    const titles = {
      n: this.t("instance.jobs"),
      families: this.t("instance.families"),
      horizon: this.t("instance.horizon"),
      setupMean: this.t("levels.metricSetup"),
      rejRatio: this.t("levels.metricRejection"),
      loadRatio: this.t("levels.metricLoad"),
      tightPct: this.t("levels.metricTight"),
    };
    const chips = deltaChips(currentStats, previous.stats, {
      formatNumber: (value) => this.fmt(value),
      formatSpan: (minutes) => this.formatSpan(minutes),
      jobsLabel: this.t("misc.jobs"),
      familiesLabel: this.t("misc.families"),
      pointsSuffix: this.t("levels.pointsSuffix"),
    });
    return `<div class="delta-strip" role="status">
      <span class="delta-strip-title">${escapeHtml(this.t("levels.vsPrevious", { scenario: previousScenario?.name ?? previous.scenarioId }))}</span>
      <div class="delta-chips">${chips.map((chip) => `<span class="delta-chip is-${chip.direction}" title="${escapeHtml(titles[chip.key] || chip.key)}">${escapeHtml(chip.text)}${chip.direction === "flat" ? "" : `<i aria-hidden="true">${chip.direction === "up" ? "▲" : "▼"}</i>`}</span>`).join("")}</div>
    </div>`;
  },

  renderInstancePage() {
    const instance = this.state.instance;
    if (!instance) return this.renderEmptyState();
    const summary = this.summarizeInstance(instance);
    const vocabulary = this.scenario().vocabulary;
    const distributionDefinitions = [
      ["release", vocabulary.releaseTime, instance.jobs.map((job) => job.releaseTime)],
      ["due", vocabulary.dueDate, instance.jobs.map((job) => job.due)],
      ["processing", vocabulary.processingTime, instance.jobs.map((job) => job.processingTime)],
      ["rejection", vocabulary.rejectionCost, instance.jobs.map((job) => job.rejectionCost)],
      ["weight", vocabulary.tardinessWeight, instance.jobs.map((job) => job.weight)],
    ];
    return `<header class="page-head"><h1>${escapeHtml(this.t("instance.title"))}</h1><p>${escapeHtml(this.t("instance.sub"))}</p></header>
      ${this.renderScenarioSwitch()}
      ${this.renderDeltaStrip()}
      ${this.renderInstanceMetrics(instance, summary)}
      <p class="instance-lead">${escapeHtml(this.scenario().description)}</p>
      <div class="section-title-row"><h2>${escapeHtml(this.t("instance.distributions"))}</h2><span class="section-note">${escapeHtml(this.state.instanceId)}</span></div>
      <div class="distribution-grid">${distributionDefinitions.map(([key, label]) => `<section class="mini-chart"><h3>${escapeHtml(sentenceLabel(label))}</h3><canvas id="hist-${key}" data-height="150"></canvas></section>`).join("")}</div>
      <div class="matrix-tabs" role="group"><button data-matrix="time" aria-pressed="${this.state.matrixKind === "time"}">${escapeHtml(this.t("instance.matrixTime"))}</button><button data-matrix="cost" aria-pressed="${this.state.matrixKind === "cost"}">${escapeHtml(this.t("instance.matrixCost"))}</button></div>
      <div class="chart-frame heatmap-scroll"><canvas id="setup-heatmap" data-height="520"></canvas><div class="chart-tooltip" hidden></div></div>
      <div class="section-title-row job-data-title"><h2>${escapeHtml(this.t("instance.jobData"))}</h2></div>
      ${this.renderJobExplorer(instance)} `;
  },

  /** Intro metric block: jobs, families, window, load, possibilities, tightness. */
  renderInstanceMetrics(instance, summary) {
    const stats = this.instanceStats() || null;
    const metrics = [
      ["jobs", this.t("instance.jobs"), this.fmt(summary.jobs), this.t("metricHelp.jobs")],
      ["families", this.t("instance.families"), this.fmt(summary.families), this.t("metricHelp.families")],
      ["window", this.t("instance.metricWindow"), this.windowMetricText(instance.window), this.t("metricHelp.window")],
    ];
    if (stats) {
      metrics.push(
        ["load", this.t("instance.metricLoad"), `${this.fmt(Math.round(stats.loadRatio * 100))}%`, this.t("metricHelp.load")],
        ["possibilities", this.t("instance.metricPossibilities"), stats.possibilities, this.t("metricHelp.possibilities")],
        ["tight", this.t("instance.metricTight"), `${this.fmt(stats.tightPct)}%`, this.t("metricHelp.tight")],
      );
    }
    return `<div class="instance-metrics">${metrics.map(([key, label, value, help]) => `<div class="instance-metric" data-metric="${key}"><span>${escapeHtml(label)} ${this.renderHelpToggle(help)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>`;
  },

  /** Sortable, humanized order explorer — the problem-data centerpiece. */
  renderJobExplorer(instance) {
    const scenario = this.scenario();
    const vocabulary = scenario.vocabulary;
    const units = scenario.vocabularyUnits || {};
    const help = scenario.vocabularyHelp || {};
    const dayLength = this.dayLength();
    const dayWord = this.t("explorer.day");
    // The CSV stores R$/min; the app shows R$/dia, per the scenario contract.
    const perDay = String(units.tardinessWeight || "R$/dia").replace(/^R\$/, "");
    const { key: sortKey, direction } = this.state.explorerSort;
    const rows = sortJobs(instance.jobs, sortKey, direction);
    const dayTime = (minutes) => {
      const stamp = formatDayTime(minutes, { dayLength, dayWord });
      return this.t("explorer.dayTime", { day: stamp.day, time: stamp.clock });
    };
    const header = EXPLORER_COLUMNS.map((column) => {
      const label = sentenceLabel(vocabulary[column] || column);
      const unit = units[column];
      const active = sortKey === column;
      const ariaSort = active ? (direction === "desc" ? "descending" : "ascending") : "none";
      const nextDirection = active && direction === "asc" ? this.t("explorer.descending") : this.t("explorer.ascending");
      const marker = active ? `<i class="sort-marker" aria-hidden="true">${direction === "desc" ? "▼" : "▲"}</i>` : "";
      const helpToggle = help[column] ? this.renderHelpToggle(help[column], this.t("explorer.columnHelp", { column: label })) : "";
      return `<th aria-sort="${ariaSort}"><span class="th-inner"><button type="button" class="th-sort" data-explorer-sort="${column}" aria-label="${escapeHtml(this.t("explorer.sortColumn", { column: label }))}" title="${escapeHtml(nextDirection)}">${escapeHtml(label)}${unit ? `<span class="explorer-unit"> (${escapeHtml(unit)})</span>` : ""}${marker}</button>${helpToggle}</span></th>`;
    }).join("");
    const body = rows.map((job) => {
      const beyondWindow = job.due > instance.window;
      const dueCell = `${escapeHtml(dayTime(job.due))}${beyondWindow ? ` <span class="explorer-flag">${escapeHtml(this.t("explorer.beyondWindow"))}</span>` : ""}`;
      const deadlineCell = Number.isFinite(job.hardDeadline)
        ? this.t("explorer.dayOnly", { day: Math.floor(job.hardDeadline / dayLength) + 1 })
        : "—";
      return `<tr>
        <td>${escapeHtml(this.orderLabel(job.id))}</td>
        <td><span class="family-tag" style="--family:${FAMILY_COLORS[job.family % FAMILY_COLORS.length]}"><i aria-hidden="true"></i>${escapeHtml(this.familyDisplayName(job.family))}</span></td>
        <td>${escapeHtml(humanizeMinutes(job.processingTime, { formatNumber: (value) => this.fmt(value, { maximumFractionDigits: 1 }) }))}</td>
        <td>${escapeHtml(dayTime(job.releaseTime))}</td>
        <td>${dueCell}</td>
        <td>${escapeHtml(deadlineCell)}</td>
        <td>R$ ${this.fmt(job.weight * dayLength, { maximumFractionDigits: 0 })}${escapeHtml(perDay)}</td>
        <td>R$ ${this.fmt(job.processingCost)}</td>
        <td>R$ ${this.fmt(job.rejectionCost)}</td>
      </tr>`;
    }).join("");
    return `<div class="data-table-wrap explorer-wrap"><table class="data-table explorer-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
  },
};
