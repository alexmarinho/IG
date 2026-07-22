/**
 * Canvas-charts view mixin: per-page chart dispatch, overview charts
 * (gantt, convergence, distribution), instance charts (histograms, setup
 * heatmap) and their canvas tooltips. Mixed onto IGStudioApp.prototype —
 * `this` is the app instance.
 */

import { escapeHtml, sentenceLabel, FAMILY_COLORS } from "./shared.js";
import {
  attachCanvasTooltip,
  drawConvergence,
  drawDistribution,
  drawGantt,
  drawHeatmap,
  drawHistogram,
} from "../visuals/charts.js";

export const chartsView = {
  drawCharts() {
    this.chartCleanups.forEach((cleanup) => cleanup());
    this.chartCleanups = [];
    if (this.state.page === "overview" && this.state.mode === "race") {
      this.raceView.redraw();
      return;
    }
    if (this.state.page === "overview") this.drawOverviewCharts();
    else if (this.state.page === "instance") this.drawInstanceCharts();
  },

  drawOverviewCharts() {
    const locale = this.state.locale;
    if (this.state.mode === "comparison" && this.state.comparisonResult) {
      const result = this.state.comparisonResult;
      const reference = this.referenceCost();
      const distributionCanvas = this.container.querySelector("#distribution-chart");
      if (distributionCanvas) {
        const hits = drawDistribution(distributionCanvas, result.runs, reference, { locale });
        this.chartCleanups.push(attachCanvasTooltip(distributionCanvas, hits, ({ run }) => `<strong>Seed ${run.seed}</strong><dl><dt>${escapeHtml(this.t("overview.best"))}</dt><dd>${this.fmt(run.bestCost)}</dd><dt>${escapeHtml(this.t("overview.gap"))}</dt><dd>${reference ? this.pct(this.gapToReference(run.bestCost, reference)) : "—"}</dd><dt>${escapeHtml(this.t("overview.evaluations"))}</dt><dd>${this.fmt(run.evaluations, { notation: "compact", maximumFractionDigits: 2 })}</dd></dl>`, {
          onSelect: ({ run }) => { this.state.selectedRunSeed = run.seed; this.render(); },
        }));
      }
      const bands = this.checkpointBands(result.runs);
      const convergence = this.container.querySelector("#comparison-convergence");
      if (convergence) drawConvergence(convergence, bands, { locale, comparison: true });
      const selected = this.activeRun();
      const evaluation = this.activeEvaluation();
      const gantt = this.container.querySelector("#selected-gantt");
      if (gantt && evaluation) this.bindGantt(gantt, evaluation, selected);
      return;
    }
    const result = this.state.singleResult;
    if (!result?.order) return;
    const evaluation = this.evaluateOrder(result.order);
    const gantt = this.container.querySelector("#gantt-chart");
    if (gantt) this.bindGantt(gantt, evaluation, result);
    const convergence = this.container.querySelector("#convergence-chart");
    if (convergence) drawConvergence(convergence, result.checkpoints || this.state.liveCheckpoints, { locale });
  },

  bindGantt(canvas, evaluation) {
    const hits = drawGantt(canvas, evaluation, this.state.instance, { locale: this.state.locale });
    const vocabulary = this.scenario().vocabulary;
    this.chartCleanups.push(attachCanvasTooltip(canvas, hits, ({ row }) => `<strong>J${String(row.id + 1).padStart(2, "0")}</strong><dl><dt>${escapeHtml(sentenceLabel(vocabulary.family))}</dt><dd>${row.family}</dd><dt>${escapeHtml(sentenceLabel(vocabulary.releaseTime))}</dt><dd>${this.fmt(row.releaseTime)}</dd><dt>${escapeHtml(this.t("schedule.processStart"))}</dt><dd>${this.fmt(row.processStart)}</dd><dt>${escapeHtml(this.t("schedule.finish"))}</dt><dd>${this.fmt(row.finish)}</dd><dt>${escapeHtml(sentenceLabel(vocabulary.dueDate))}</dt><dd>${this.fmt(row.due)}</dd><dt>${escapeHtml(this.t("schedule.late"))}</dt><dd>${this.fmt(row.late)}</dd></dl>`));
  },

  drawInstanceCharts() {
    const instance = this.state.instance;
    if (!instance) return;
    const definitions = {
      release: instance.jobs.map((job) => job.releaseTime),
      due: instance.jobs.map((job) => job.due),
      processing: instance.jobs.map((job) => job.processingTime),
      rejection: instance.jobs.map((job) => job.rejectionCost),
      weight: instance.jobs.map((job) => job.weight),
    };
    Object.entries(definitions).forEach(([key, values], index) => {
      const canvas = this.container.querySelector(`#hist-${key}`);
      if (canvas) drawHistogram(canvas, values, { locale: this.state.locale, color: FAMILY_COLORS[index % FAMILY_COLORS.length] });
    });
    const canvas = this.container.querySelector("#setup-heatmap");
    if (canvas) {
      const matrix = this.state.matrixKind === "time" ? instance.setupTime : instance.setupCost;
      const hits = drawHeatmap(canvas, matrix, { locale: this.state.locale });
      this.chartCleanups.push(attachCanvasTooltip(canvas, hits, (hit) => `<strong>${escapeHtml(this.t(this.state.matrixKind === "time" ? "instance.matrixTime" : "instance.matrixCost"))}</strong><dl><dt>${escapeHtml(this.t("instance.from"))}</dt><dd>${hit.row}</dd><dt>${escapeHtml(this.t("instance.to"))}</dt><dd>${hit.column}</dd><dt>${escapeHtml(this.t("overview.total"))}</dt><dd>${this.fmt(hit.value)}</dd></dl>`));
    }
  },
};
