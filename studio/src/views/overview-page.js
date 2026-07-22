/**
 * Overview-page view mixin: single-run and comparison overviews, problem
 * brief, experiment guide, metric strips and objective decomposition.
 * Mixed onto IGStudioApp.prototype — `this` is the app instance.
 */

import { escapeHtml, icons, sentenceLabel } from "./shared.js";

function formatSeedRange(runs) {
  if (!runs?.length) return "—";
  const seeds = runs.map((run) => run.seed);
  return `${Math.min(...seeds)}–${Math.max(...seeds)}`;
}

export const overviewView = {
  renderOverviewPage() {
    if (this.state.mode === "comparison" && this.state.comparisonResult) return this.renderComparisonOverview();
    const result = this.state.mode === "single" ? this.state.singleResult : null;
    const evaluation = result?.order ? this.evaluateOrder(result.order) : null;
    const hasResult = Boolean(result && evaluation);
    const title = hasResult ? this.t("overview.singleTitle") : this.t("overview.initialTitle");
    const subtitle = hasResult ? this.t("overview.singleSub") : this.t("overview.initialSub");
    let body = `${this.renderProblemBrief()}${this.renderExperimentGuide()}`;
    if (hasResult) {
      const reference = this.referenceCost();
      const cost = result.bestCost ?? result.cost;
      const gap = reference ? this.gapToReference(cost, reference) : null;
      const breakdown = evaluation.breakdown;
      const interpretation = evaluation.rejectedCount
        ? this.t("overview.runInterpretationRejected", { count: evaluation.rejectedCount })
        : this.t("overview.runInterpretationAll");
      body = `${this.metricStrip([
        [this.t("overview.best"), this.fmt(cost)],
        [this.t("overview.reference"), reference ? this.fmt(reference) : this.t("misc.noReference")],
        [this.t("overview.gap"), gap == null ? "—" : this.pct(gap)],
        [this.t("overview.evaluations"), this.fmt(result.evaluations ?? result.evals, { notation: "compact", maximumFractionDigits: 2 })],
        [this.t("overview.scheduled"), `${evaluation.scheduledCount} / ${this.state.instance.n}`],
      ])}
      <section>
        <div class="section-title-row"><h2>${escapeHtml(this.t("overview.resourceSchedule", { resource: this.scenario().vocabulary.resource }))}</h2><span class="section-note">${escapeHtml(this.state.instanceId)}</span></div>
        <div class="chart-frame gantt-frame"><div class="gantt-scroll"><canvas id="gantt-chart" data-height="178" aria-label="${escapeHtml(this.t("overview.gantt"))}"></canvas></div><div class="chart-tooltip" hidden></div>
          <div class="plot-legend"><span><i class="legend-swatch"></i>${escapeHtml(this.scenario().vocabulary.processingTime)}</span><span><i class="legend-swatch setup"></i>${escapeHtml(this.scenario().vocabulary.setupTime)}</span><span><i class="legend-marker">▼</i>${escapeHtml(this.scenario().vocabulary.dueDate)}</span><span class="gantt-footer">${escapeHtml(this.t("instance.horizon"))} ${this.fmt(evaluation.makespan)} · ${evaluation.scheduledCount} ${escapeHtml(this.t("schedule.scheduled").toLowerCase())} · ${evaluation.rejectedCount} ${escapeHtml(this.t("schedule.rejected").toLowerCase())}</span></div>
        </div>
      </section>
      <div class="analysis-grid">
        <section class="analysis-panel"><div class="section-title-row"><h2>${escapeHtml(this.t("overview.convergence"))}</h2><span class="section-note">${escapeHtml(this.t("overview.lower"))}</span></div><canvas id="convergence-chart" data-height="250" aria-label="${escapeHtml(this.t("overview.convergence"))}"></canvas><div class="axis-caption"><span>${escapeHtml(this.t("overview.evaluationsAxis"))}</span><span>${escapeHtml(this.t("overview.bestCostAxis"))}</span></div></section>
        <section class="analysis-panel objective-panel"><h2 class="panel-title">${escapeHtml(this.t("overview.objective"))}</h2>${this.renderObjective(breakdown)}<p class="interpretation">${escapeHtml(interpretation)}</p><a class="text-link" href="${escapeHtml(this.options.notebookUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("actions.notebook"))} →</a></section>
      </div>`;
    }
    return `<header class="page-head with-scenario"><div class="page-head-main"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><span class="page-scenario-tag">${escapeHtml(this.scenario().name)}</span></header>${body}`;
  },

  renderComparisonOverview() {
    const result = this.state.comparisonResult;
    const reference = this.referenceCost();
    const summary = this.summarizeRuns(result.runs, {
      ...(reference ? { referenceCost: reference } : {}),
      includeCheckpointBands: true,
    });
    const bestGap = reference ? this.gapToReference(summary.costs.min, reference) : null;
    const worstGap = reference ? this.gapToReference(summary.costs.max, reference) : null;
    const selected = this.activeRun();
    const selectedEvaluation = selected ? this.evaluateOrder(selected.order) : null;
    const hitRate = summary.reference?.rate;
    const comparisonInterpretation = summary.reference
      ? this.t("overview.compareInterpretationReference", {
        hits: summary.reference.hitCount,
        total: summary.reference.total,
        deviation: this.fmt(summary.costs.sampleStdDev, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      })
      : this.t("overview.compareInterpretation");
    return `<header class="page-head"><h1>${escapeHtml(this.t("overview.compareTitle"))}</h1><p>${escapeHtml(this.t("overview.compareSub"))}</p></header>
      ${this.metricStrip([
        [this.t("overview.best"), this.fmt(summary.costs.min)],
        [this.t("overview.median"), this.fmt(summary.costs.median)],
        [this.t("overview.mean"), this.fmt(summary.costs.mean, { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
        [this.t("overview.deviation"), this.fmt(summary.costs.sampleStdDev, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), this.t("overview.sampleDeviationHint")],
        [this.t("overview.hits"), summary.reference ? `${summary.reference.hitCount} / ${summary.reference.total}` : "—", this.t("overview.referenceHitHint")],
      ])}
      <div class="comparison-figures">
        <section class="analysis-panel distribution-panel"><div class="section-title-row"><h2>${escapeHtml(this.t("overview.distribution"))}</h2><span class="section-note">${escapeHtml(this.t("overview.selectRun"))}</span></div><div class="chart-frame"><canvas id="distribution-chart" data-height="230" aria-label="${escapeHtml(this.t("overview.distribution"))}"></canvas><div class="chart-tooltip" hidden></div></div><div class="stat-legend"><span><i class="legend-dot"></i>${escapeHtml(this.t("overview.runLegend"))}</span>${reference ? `<span><i class="legend-dash amber"></i>${escapeHtml(this.t("overview.referenceLegend"))}</span>` : ""}<span class="axis-label">${escapeHtml(this.t("overview.costAxis"))} →</span></div><p class="five-number">${escapeHtml(this.t("overview.fiveNumber", { min: this.fmt(summary.costs.min), q1: this.fmt(summary.costs.q1), median: this.fmt(summary.costs.median), q3: this.fmt(summary.costs.q3), max: this.fmt(summary.costs.max) }))}</p></section>
        <section class="analysis-panel comparison-convergence-panel"><div class="section-title-row"><h2>${escapeHtml(this.t("overview.convergenceSeeds"))}</h2><span class="section-note">${escapeHtml(this.t("overview.lower"))}</span></div><canvas id="comparison-convergence" data-height="260" aria-label="${escapeHtml(this.t("overview.convergenceSeeds"))}"></canvas><div class="stat-legend"><span><i class="legend-line violet"></i>${escapeHtml(this.t("overview.medianLegend"))}</span><span><i class="legend-band"></i>${escapeHtml(this.t("overview.iqrLegend"))}</span><span><i class="legend-dash"></i>${escapeHtml(this.t("overview.rangeLegend"))}</span></div><div class="axis-caption"><span>${escapeHtml(this.t("overview.iterationsAxis"))}</span><span>${escapeHtml(this.t("overview.bestCostAxis"))}</span></div></section>
      </div>
      <section class="analysis-panel comparison-summary"><h2 class="panel-title">${escapeHtml(this.t("overview.summary"))}</h2><div class="summary-list">
          ${this.summaryRow(this.t("overview.reached"), hitRate == null ? "—" : this.pct(hitRate * 100, 1).replace("+", ""))}
          ${this.summaryRow(this.t("overview.bestGap"), bestGap == null ? "—" : this.pct(bestGap))}
          ${this.summaryRow(this.t("overview.worstGap"), worstGap == null ? "—" : this.pct(worstGap))}
          ${this.summaryRow(this.t("overview.seedsCompared"), formatSeedRange(result.runs))}
        </div><p class="interpretation">${escapeHtml(comparisonInterpretation)}</p><div class="run-actions"><button class="outline-action" data-page="schedule">${escapeHtml(this.t("actions.inspectRuns"))}${icons.chevron}</button><a class="outline-action" href="${escapeHtml(this.options.notebookUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("actions.notebook"))}${icons.chevron}</a></div></section>
      ${selectedEvaluation ? `<section class="selected-schedule"><div class="selected-run-head"><div><h2>${escapeHtml(this.t("overview.resourceSchedule", { resource: this.scenario().vocabulary.resource }))} · seed ${selected.seed}</h2><span class="section-note">${escapeHtml(this.t("overview.best"))} ${this.fmt(selected.bestCost)}</span></div>${this.renderRunPicker()}</div><div class="chart-frame gantt-frame"><div class="gantt-scroll"><canvas id="selected-gantt" data-height="178"></canvas></div><div class="chart-tooltip" hidden></div></div></section>` : ""}`;
  },

  renderRunPicker() {
    const runs = [...(this.state.comparisonResult?.runs || [])].sort((left, right) => left.seed - right.seed);
    if (!runs.length) return "";
    return `<label class="run-picker"><span>${escapeHtml(this.t("overview.inspectSeed"))}</span><select id="run-select">${runs.map((run) => `<option value="${run.seed}" ${run.seed === this.state.selectedRunSeed ? "selected" : ""}>Seed ${run.seed} · ${this.fmt(run.bestCost ?? run.cost)}</option>`).join("")}</select></label>`;
  },

  renderProblemBrief() {
    const instance = this.state.instance;
    if (!instance) return this.renderEmptyState();
    const scenario = this.scenario();
    const summary = this.summarizeInstance(instance);
    const mapping = this.scenarioInstance();
    const instanceLabel = this.instanceDisplayLabel(mapping);
    const instanceNote = mapping?.interpretation?.note || this.t("misc.fixedCatalogNote");
    const facts = [
      [this.t("overview.selectedInstance"), `${instanceLabel} · ${this.state.instanceId}`],
      [this.t("overview.resource"), scenario.vocabulary.resource],
      [this.t("overview.workItems"), `${summary.jobs} × ${scenario.vocabulary.job}`],
      [this.t("overview.availability"), `${this.fmt(summary.release.min)}–${this.fmt(summary.release.max)} ${this.t("misc.timeUnits")}`],
      [this.t("overview.targetWindow"), `${this.fmt(summary.due.min)}–${this.fmt(summary.due.max)} ${this.t("misc.timeUnits")}`],
      [this.t("overview.processingRange"), `${this.fmt(summary.processing.min)}–${this.fmt(summary.processing.max)} ${this.t("misc.timeUnits")}`],
      [this.t("overview.changeovers"), this.metadata()?.hasSequenceDependentSetups ? this.t("overview.changeoversYes") : this.t("overview.changeoversNo")],
    ];
    return `<section class="problem-brief">
      <header><h2>${escapeHtml(this.t("overview.problemTitle"))}</h2><p>${escapeHtml(this.t("overview.problemSub"))}</p></header>
      <figure class="scenario-figure scenario-hero${this._scenarioSwitched ? " is-switching" : ""}" style="--scenario-focus:${escapeHtml(scenario.visual.objectPosition)}">
        <img src="${escapeHtml(this.scenarioVisualUrl(scenario))}" alt="${escapeHtml(scenario.visualAlt)}" decoding="async" onerror="this.style.display='none'">
        <figcaption class="carousel-caption"><strong>${escapeHtml(scenario.name)}</strong><span>${escapeHtml(scenario.visualCaption)}</span></figcaption>
      </figure>
      <div class="problem-layout"><dl class="problem-facts">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      <div class="problem-story"><strong>${escapeHtml(instanceLabel)}</strong><p>${escapeHtml(instanceNote)}</p><p>${escapeHtml(scenario.objective.summary)}</p><h3>${escapeHtml(this.t("scenario.decisions"))}</h3><ol>${scenario.decisions.map((decision) => `<li>${escapeHtml(decision)}</li>`).join("")}</ol><button class="text-button" data-page="instance">${escapeHtml(this.t("actions.inspectInstance"))} →</button><button class="text-button" data-page="method">${escapeHtml(this.t("method.title"))} →</button></div></div>
    </section>`;
  },

  renderExperimentGuide() {
    return `<section class="experiment-guide"><div class="section-title-row"><h2>${escapeHtml(this.t("overview.experimentTitle"))}</h2><span class="section-note">${escapeHtml(this.t("overview.fairComparison"))}</span></div><div class="experiment-options">
      <button class="experiment-option" data-mode="single" aria-pressed="${this.state.mode === "single"}"><strong>${escapeHtml(this.t("overview.oneRunGuideTitle"))}</strong><span>${escapeHtml(this.t("overview.oneRunGuide"))}</span></button>
      <button class="experiment-option" data-mode="comparison" aria-pressed="${this.state.mode === "comparison"}"><strong>${escapeHtml(this.t("overview.compareGuideTitle"))}</strong><span>${escapeHtml(this.t("overview.compareGuide"))}</span></button>
    </div></section>`;
  },

  renderEmptyState() {
    return `<section class="empty-state"><div>${icons.empty}<h2>${escapeHtml(this.t("status.noResult"))}</h2><p>${escapeHtml(this.scenario().shortDescription)}</p></div></section>`;
  },

  metricStrip(metrics) {
    return `<div class="metric-strip">${metrics.map(([label, value, sub]) => `<div class="metric"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong>${sub ? `<small class="metric-sub">${escapeHtml(sub)}</small>` : ""}</div>`).join("")}</div>`;
  },

  renderObjective(breakdown) {
    const terms = this.scenario().objective.terms;
    const rows = [
      [sentenceLabel(terms.setup), breakdown.setup],
      [sentenceLabel(terms.execution), breakdown.execution],
      [sentenceLabel(terms.tardiness), breakdown.tardiness],
      [sentenceLabel(terms.rejection), breakdown.rejection],
    ];
    return `<div class="objective-list">${rows.map(([label, value]) => `<div class="objective-row"><i></i><span>${escapeHtml(label)}</span><strong>${this.fmt(value)}</strong></div>`).join("")}<div class="objective-row objective-total"><i></i><span>${escapeHtml(this.t("overview.total"))}</span><strong>${this.fmt(breakdown.total)}</strong></div></div>`;
  },

  summaryRow(label, value) {
    return `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  },
};
