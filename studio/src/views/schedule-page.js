/**
 * Schedule-page view mixin: the run table (searchable/filterable) and the
 * final-analysis panel with baseline bars, structural bullets and the
 * not-obvious callout. Mixed onto IGStudioApp.prototype — `this` is the app.
 */

import { escapeHtml, sentenceLabel, FAMILY_COLORS } from "./shared.js";
import { analyzeResult } from "../analysis.js";

export const scheduleView = {
  renderSchedulePage() {
    const evaluation = this.activeEvaluation();
    const run = this.activeRun();
    if (!evaluation) return `<header class="page-head"><h1>${escapeHtml(this.t("schedule.title"))}</h1><p>${escapeHtml(this.t("schedule.sub"))}</p></header>${this.renderEmptyState()}`;
    const query = this.state.scheduleQuery.trim().toLowerCase();
    const vocabulary = this.scenario().vocabulary;
    const contextualHeaders = {
      job: sentenceLabel(vocabulary.job), family: sentenceLabel(vocabulary.family),
      release: sentenceLabel(vocabulary.releaseTime), due: sentenceLabel(vocabulary.dueDate),
      setupCost: sentenceLabel(vocabulary.setupCost), executionCost: sentenceLabel(vocabulary.executionCost),
      tardinessCost: sentenceLabel(this.scenario().objective.terms.tardiness), rejectionCost: sentenceLabel(vocabulary.rejectionCost),
    };
    const rows = [...evaluation.rows, ...evaluation.rejected].filter((row) => {
      if (this.state.scheduleFilter !== "all" && row.status !== this.state.scheduleFilter) return false;
      return !query || [`j${row.id + 1}`, String(row.id + 1), row.status, String(row.family)].some((value) => value.includes(query));
    });
    const tableRows = rows.map((row) => `<tr>
      <td>${row.position ?? "—"}</td><td>J${String(row.id + 1).padStart(2, "0")}</td><td><span class="status-text ${row.status}">${escapeHtml(this.t(`schedule.${row.status}`))}</span></td>
      <td class="family-cell" style="--family:${FAMILY_COLORS[row.family % FAMILY_COLORS.length]}">${row.family}</td>
      <td>${this.fmt(row.setupStart)}</td><td>${this.fmt(row.setupEnd)}</td><td>${this.fmt(row.processStart)}</td><td>${this.fmt(row.finish)}</td><td>${this.fmt(row.releaseTime)}</td><td>${this.fmt(row.due)}</td><td>${this.fmt(row.late)}</td><td>${this.fmt(row.setupCost)}</td><td>${this.fmt(row.executionCost)}</td><td>${this.fmt(row.tardinessCost)}</td><td>${this.fmt(row.rejectionCost)}</td>
    </tr>`).join("");
    return `<header class="page-head"><h1>${escapeHtml(this.t("schedule.title"))}</h1><p>${escapeHtml(this.t("schedule.sub"))}</p></header>
      ${this.metricStrip([
        ...(this.state.mode === "comparison" ? [[this.t("controls.seed"), String(run.seed)]] : []),
        [this.t("overview.best"), this.fmt(run.bestCost ?? run.cost)],
        [this.t("overview.scheduled"), `${evaluation.scheduledCount} / ${this.state.instance.n}`],
        [this.t("overview.rejection"), this.fmt(evaluation.rejectedCount)],
        [this.t("instance.horizon"), this.fmt(evaluation.makespan)],
      ])}
      ${this.state.mode === "comparison" ? `<div class="schedule-run-picker">${this.renderRunPicker()}</div>` : ""}
      <div class="table-tools"><input class="search-input" id="schedule-query" type="search" placeholder="${escapeHtml(this.t("schedule.filter"))}" value="${escapeHtml(this.state.scheduleQuery)}"><div class="filter-tabs">${["all", "scheduled", "rejected"].map((filter) => `<button data-filter="${filter}" aria-pressed="${this.state.scheduleFilter === filter}">${escapeHtml(this.t(`schedule.${filter}`))}</button>`).join("")}</div></div>
      <div class="data-table-wrap"><table class="data-table"><thead><tr>${["position", "job", "status", "family", "setupStart", "setupEnd", "processStart", "finish", "release", "due", "late", "setupCost", "executionCost", "tardinessCost", "rejectionCost"].map((key) => `<th>${escapeHtml(contextualHeaders[key] || this.t(`schedule.${key}`))}</th>`).join("")}</tr></thead><tbody>${tableRows || `<tr><td class="table-empty" colspan="15">${escapeHtml(this.t("schedule.noRows"))}</td></tr>`}</tbody></table></div>
      ${this.renderAnalysisPanel()}`;
  },

  /**
   * Final-analysis panel (single-seed mode only): baseline bars, structural
   * bullets and the "not obvious" callout, all from the pure analysis module.
   */
  renderAnalysisPanel() {
    if (this.state.mode !== "single" || !this.state.singleResult?.order || !this.state.instance) return "";
    const analysis = analyzeResult(this.state.instance, this.state.singleResult.order, { dayLength: this.dayLength() });
    const solutionCost = analysis.evaluation.breakdown.total;
    const money = (value) => this.fmt(value, { maximumFractionDigits: 0 });
    const vsOptimizer = (cost) => (solutionCost > 0 ? ((cost - solutionCost) / solutionCost) * 100 : 0);
    const entries = [
      ...analysis.baselines.map((baseline) => ({
        key: baseline.key,
        label: this.t(`analysis.baseline${baseline.key === "fcfs" ? "Fcfs" : baseline.key === "edd" ? "Edd" : "Family"}`),
        cost: baseline.cost,
        note: baseline.hardViolations > 0 ? this.t("analysis.infeasible", { count: baseline.hardViolations }) : "",
        optimizer: false,
      })),
      { key: "optimizer", label: this.t("analysis.optimizer"), cost: solutionCost, note: "", optimizer: true },
    ];
    const maxCost = Math.max(1, ...entries.map((entry) => entry.cost));
    const bars = entries.map((entry) => {
      const width = Math.max(3, (entry.cost / maxCost) * 100);
      const delta = entry.optimizer ? "" : `<span class="baseline-delta">${escapeHtml(this.t("analysis.vsOptimizer", { value: this.pct(vsOptimizer(entry.cost), 1) }))}</span>`;
      return `<div class="baseline-row${entry.optimizer ? " is-optimizer" : ""}">
        <span class="baseline-label">${escapeHtml(entry.label)}</span>
        <span class="baseline-track"><span class="baseline-bar" style="width:${width.toFixed(2)}%"></span></span>
        <span class="baseline-cost">R$ ${money(entry.cost)}</span>
        ${delta}
        ${entry.note ? `<span class="baseline-note">${escapeHtml(entry.note)}</span>` : ""}
      </div>`;
    }).join("");

    const bullets = [
      this.t("analysis.bulletBlocks", { count: analysis.blocks.count, families: analysis.blocks.familiesPresent }),
      `${this.t("analysis.bulletSetups", { count: analysis.setups.count, time: this.fmt(analysis.setups.totalTime), cost: money(analysis.setups.totalCost) })}${analysis.setups.avoided > 0 ? ` — ${this.t("analysis.bulletSetupsAvoided", { avoided: money(analysis.setups.avoided) })}` : ""}`,
      this.t("analysis.bulletUtilization", { resource: this.scenario().vocabulary.resource, pct: this.fmt(Math.round(analysis.utilization * 100)) }),
    ];
    if (analysis.late.length) {
      const items = analysis.late.slice(0, 3)
        .map((entry) => this.t("analysis.lateItem", { code: this.orderLabel(entry.id), minutes: this.fmt(entry.minutesLate), penalty: money(entry.penalty) }))
        .join(" · ");
      bullets.push(this.t("analysis.bulletLate", { items }));
    }
    if (analysis.rejected.length) {
      const items = analysis.rejected.slice(0, 3)
        .map((entry) => (entry.saved > 0
          ? this.t("analysis.rejectedSaved", { code: this.orderLabel(entry.id), saved: money(entry.saved) })
          : this.t("analysis.rejectedCost", { code: this.orderLabel(entry.id), cost: money(entry.rejectionCost) })))
        .join(" · ");
      bullets.push(this.t("analysis.bulletRejected", { items }));
    }

    const callouts = analysis.notObvious.map((item) => {
      if (item.kind === "split") {
        return this.t("analysis.notObviousSplit", {
          code: this.orderLabel(item.jobId),
          family: this.familyDisplayName(item.numbers.family),
          batchingSavings: money(item.numbers.batchingSavings),
          weightPerDay: money(item.numbers.weightPerDay),
        });
      }
      if (item.kind === "reject") {
        return this.t("analysis.notObviousReject", {
          code: this.orderLabel(item.jobId),
          saved: money(item.numbers.saved),
          estimatedPenalty: money(item.numbers.estimatedPenalty),
          rejectionCost: money(item.numbers.rejectionCost),
        });
      }
      return this.t("analysis.notObviousSetup", {
        avoided: money(item.numbers.avoided),
        count: item.numbers.count,
        totalCost: money(item.numbers.totalCost),
      });
    });

    return `<section class="final-analysis" aria-label="${escapeHtml(this.t("analysis.title"))}">
      <div class="section-title-row"><h2>${escapeHtml(this.t("analysis.title"))}</h2><span class="section-note">${escapeHtml(this.t("analysis.subtitle"))}</span></div>
      <div class="baseline-rows" role="list">${bars}</div>
      <ul class="analysis-bullets">${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>
      ${callouts.length ? `<aside class="not-obvious"><h3>${escapeHtml(this.t("analysis.notObviousTitle"))}</h3><ul>${callouts.map((text) => `<li>${escapeHtml(text)}</li>`).join("")}</ul></aside>` : ""}
    </section>`;
  },
};
