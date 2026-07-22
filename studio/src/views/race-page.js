/**
 * Race page mixin: the method-race lab (ported from the master's app.js
 * renderRacePage/renderRaceFinalGrid) adapted to the shell's thin data
 * accessors — views never import the heavy data modules directly, so
 * instanceSummary/gapToReference arrive via this.summarizeInstance /
 * this.gapToReference. The live canvases and standings are driven by
 * race/view.js (createRaceView), outside the innerHTML render cycle.
 */

import { escapeHtml, icons, sentenceLabel } from "./shared.js";

/** Roster shown before a race starts (ids/colors match race/strategies.js). */
const RACE_ROSTER = Object.freeze([
  { id: "ig", name: "Iterated Greedy", colorVar: "--race-ig" },
  { id: "greedy", name: "Greedy", colorVar: "--race-greedy" },
  { id: "descent", name: "Descent", colorVar: "--race-descent" },
  { id: "tabu", name: "Tabu", colorVar: "--race-tabu" },
  { id: "tabudiv", name: "TabuDiv", colorVar: "--race-tabudiv" },
  { id: "ama", name: "AMA (memetic)", colorVar: "--race-ama" },
]);

export const racePageView = {
  raceStatusLabel(status) {
    const key = status?.key || "preparing";
    return this.t(`race.status.${key}`, { count: status?.arg });
  },

  renderRacePage() {
    const instance = this.state.instance;
    const head = `<header class="page-head with-scenario"><div class="page-head-main"><h1>${escapeHtml(this.t("race.title"))}</h1><p>${escapeHtml(this.t("race.sub"))}</p></div><span class="page-scenario-tag">${escapeHtml(this.scenario().name)}</span></header>`;
    if (!instance) return `${head}${this.renderEmptyState()}`;
    const race = this.state.race;
    const scenario = this.scenario();
    const metadata = this.metadata();
    const summary = this.summarizeInstance(instance);
    const mapping = this.scenarioInstance();
    const reference = this.referenceCost();
    const playing = Boolean(race?.playing);
    const running = Boolean(race && !race.done);
    const done = Boolean(race?.done);
    const speed = race?.speed ?? 1;
    const instanceLabel = this.instanceDisplayLabel(mapping);
    const instanceNote = mapping?.interpretation?.note || this.t("misc.fixedCatalogNote");
    const setupCosts = instance.setupCost.flat().filter((value) => value > 0);
    const rangeOf = (values) => {
      const finite = values.filter(Number.isFinite);
      return finite.length ? `${this.fmt(Math.min(...finite))}–${this.fmt(Math.max(...finite))}` : "—";
    };
    const facts = [
      [this.t("overview.selectedInstance"), `${instanceLabel} · ${this.state.instanceId}`],
      [this.t("overview.workItems"), `${summary.jobs} × ${scenario.vocabulary.job}`],
      [this.t("instance.families"), String(summary.families)],
      [this.t("overview.changeovers"), metadata?.hasSequenceDependentSetups ? this.t("overview.changeoversYes") : this.t("overview.changeoversNo")],
      [this.t("overview.targetWindow"), `${this.fmt(summary.due.min)}–${this.fmt(summary.due.max)} ${this.t("misc.timeUnits")}`],
      [this.t("overview.reference"), reference ? this.fmt(reference) : this.t("misc.noReference")],
    ];
    const variables = [
      [scenario.vocabulary.releaseTime, `${rangeOf(instance.jobs.map((job) => job.releaseTime))} ${this.t("misc.timeUnits")}`],
      [scenario.vocabulary.processingTime, `${rangeOf(instance.jobs.map((job) => job.processingTime))} ${this.t("misc.timeUnits")}`],
      [scenario.vocabulary.dueDate, `${rangeOf(instance.jobs.map((job) => job.due))} ${this.t("misc.timeUnits")}`],
      [scenario.vocabulary.hardDeadline, summary.hardDeadline.min == null ? "—" : `${rangeOf(instance.jobs.map((job) => job.hardDeadline))} ${this.t("misc.timeUnits")}`],
      [scenario.vocabulary.setupCost, setupCosts.length ? rangeOf(setupCosts) : "0"],
      [scenario.vocabulary.executionCost, rangeOf(instance.jobs.map((job) => job.processingCost))],
      [scenario.vocabulary.tardinessWeight, rangeOf(instance.jobs.map((job) => job.weight))],
      [scenario.vocabulary.rejectionCost, rangeOf(instance.jobs.map((job) => job.rejectionCost))],
    ];
    const roster = race?.racers || RACE_ROSTER;
    const standing = race ? race.racers.slice().sort((a, b) => a.bestCost - b.bestCost) : [];
    const playLabel = playing ? this.t("actions.pause") : running ? this.t("actions.resume") : this.t("race.play");
    const standingsRows = roster.map((racer) => {
      const rank = race ? standing.indexOf(racer) : -1;
      const hasCost = race && Number.isFinite(racer.bestCost);
      return `<li id="race-st-${racer.id}" data-racer="${racer.id}" class="${racer.off ? "off" : ""}${rank === 0 && hasCost && !racer.off ? " leader" : ""}" style="order:${rank >= 0 ? rank : 0}" role="button" tabindex="0" aria-pressed="${racer.off ? "false" : "true"}" title="${escapeHtml(this.t("race.toggleMethod"))}">
        <span class="st-rank" data-st="rank">${hasCost ? `#${rank + 1}` : "–"}</span>
        <span class="st-dot" style="background:var(${racer.colorVar})"></span>
        <span class="st-name">${escapeHtml(racer.name)}<small data-st="status">${race ? escapeHtml(this.raceStatusLabel(racer.status)) : "…"}</small></span>
        <span class="st-cost"><span data-st="cost">${hasCost ? escapeHtml(this.fmt(racer.bestCost)) : "–"}</span><small data-st="evals">${race ? `${escapeHtml(this.fmt(racer.evals))} ${escapeHtml(this.t("race.evals"))}` : ""}</small></span>
      </li>`;
    }).join("");
    const leader = standing[0];
    const leaderNote = leader && Number.isFinite(leader.bestCost)
      ? this.t("race.leaderNote", { method: `<strong>${escapeHtml(leader.name)}</strong>`, cost: escapeHtml(this.fmt(leader.bestCost)) })
      : "";
    const maxE = race?.maxEvals || 0;
    const budgetPct = race ? Math.min(100, (100 * maxE) / Math.max(1, race.budget)) : 0;
    const budgetLabel = race
      ? `${this.t("race.budgetUsed")} ${this.fmt(maxE)} / ${this.fmt(race.budget)} ${this.t("race.evalsPerMethod")}`
      : `${this.t("race.budgetUsed")} 0 / ${this.fmt(this.state.raceBudget)} ${this.t("race.evalsPerMethod")}`;
    const spaceSupported = race ? race.spaceBuilder.supported : instance.n <= 400;
    const finalGrid = done ? this.renderRaceFinalGrid(race, reference) : "";
    return `${head}
      <section class="race-brief">
        <div class="race-brief-main">
          <dl class="problem-facts race-facts">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
          <p class="race-instance-note"><strong>${escapeHtml(instanceLabel)}</strong> — ${escapeHtml(instanceNote)}</p>
          <details class="race-variables"><summary>${escapeHtml(this.t("race.variablesTitle"))}</summary><dl>${variables.map(([label, value]) => `<div><dt>${escapeHtml(sentenceLabel(label))}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></details>
        </div>
        <div class="race-transport">
          <button class="primary-action" data-action="race-play" ${!race && this.state.status !== "ready" ? "disabled" : ""}>${escapeHtml(playLabel)}</button>
          <button class="secondary-action" data-action="race-new" ${this.state.status === "loading" ? "disabled" : ""}>${escapeHtml(this.t("race.newRace"))}</button>
          <div class="race-speed" role="group" aria-label="${escapeHtml(this.t("race.speed"))}"><span>${escapeHtml(this.t("race.speed"))}</span>${[1, 2, 4].map((value) => `<button data-rspeed="${value}" aria-pressed="${speed === value}">${value}×</button>`).join("")}</div>
          <div class="race-budget" aria-hidden="true"><div class="race-budget-track"><div class="race-budget-fill" id="race-budget-fill" style="width:${budgetPct.toFixed(2)}%"></div></div><small id="race-budget-label">${escapeHtml(budgetLabel)}</small></div>
        </div>
      </section>
      <div class="race-grid">
        <section class="analysis-panel race-standings-panel">
          <div class="section-title-row"><h2>${escapeHtml(this.t("race.standings"))}</h2><span class="section-note">${escapeHtml(this.t("race.standingsNote"))}</span></div>
          <ol class="race-standings" id="race-standings">${standingsRows}</ol>
          <p class="race-leader-note" id="race-leader-note">${leaderNote}</p>
        </section>
        <section class="analysis-panel race-convergence-panel">
          <div class="section-title-row"><h2>${escapeHtml(this.t("race.convergenceTitle"))}</h2><span class="section-note">${escapeHtml(this.t("overview.lower"))}</span></div>
          <div class="chart-frame race-chart-frame"><canvas id="race-canvas" data-height="290" aria-label="${escapeHtml(this.t("race.convergenceTitle"))}"></canvas><div class="chart-tooltip" hidden></div></div>
          <div class="stat-legend"><span><i class="legend-dash"></i>${escapeHtml(this.t("race.engineRef"))}</span>${reference ? `<span><i class="legend-dash amber"></i>${escapeHtml(this.t("race.referenceBest"))}</span>` : ""}<span class="axis-label">${escapeHtml(this.t("overview.evaluationsAxis"))} →</span></div>
        </section>
      </div>
      <section class="analysis-panel race-space-panel">
        <div class="section-title-row"><h2>${escapeHtml(this.t("race.spaceTitle"))}</h2><span class="section-note" id="race-space-progress">${race?.spaceBuilder && !race.spaceBuilder.done ? escapeHtml(this.t("race.spaceSampling", { pct: Math.round(race.spaceBuilder.progress * 100) })) : ""}</span></div>
        ${spaceSupported
          ? `<div class="chart-frame race-space-frame"><canvas id="space-canvas" data-height="440" aria-label="${escapeHtml(this.t("race.spaceTitle"))}"></canvas><div class="chart-tooltip" hidden></div></div><p class="race-space-note" id="race-space-note">${race?.selLeaf ? "" : escapeHtml(this.t("race.spaceCaption"))}</p>`
          : `<p class="race-space-note" id="race-space-note">${escapeHtml(this.t("race.spaceUnavailable", { jobs: instance.n }))}</p>`}
      </section>
      ${finalGrid}`;
  },

  renderRaceFinalGrid(race, reference) {
    const sorted = race.racers.slice().sort((a, b) => a.bestCost - b.bestCost);
    const rows = sorted.map((racer, index) => {
      const gap = reference && Number.isFinite(racer.bestCost) ? this.gapToReference(racer.bestCost, reference) : null;
      const isWinner = racer === race.winner;
      return `<tr class="${isWinner ? "is-winner" : ""}">
        <td>${index + 1}</td>
        <td><span class="st-dot" style="background:var(${racer.colorVar})"></span> ${escapeHtml(racer.name)}${isWinner ? ` <span class="race-winner-badge">${escapeHtml(this.t("race.winner"))}</span>` : ""}</td>
        <td>${escapeHtml(this.fmt(racer.bestCost))}</td>
        <td>${gap == null ? "—" : escapeHtml(this.pct(gap))}</td>
        <td>${escapeHtml(this.fmt(racer.evals))}</td>
        <td>${escapeHtml(this.raceStatusLabel(racer.status))}</td>
      </tr>`;
    }).join("");
    return `<section class="analysis-panel race-final">
      <div class="section-title-row"><h2>${escapeHtml(this.t("race.finalTitle"))}</h2><span class="section-note">${escapeHtml(this.t("race.finalSub", { budget: this.fmt(race.budget) }))}</span></div>
      <div class="data-table-wrap"><table class="data-table race-final-table"><thead><tr><th>#</th><th>${escapeHtml(this.t("race.method"))}</th><th>${escapeHtml(this.t("race.cost"))}</th><th>${escapeHtml(this.t("race.gap"))}</th><th>${escapeHtml(this.t("overview.evaluations"))}</th><th>${escapeHtml(this.t("race.statusHeader"))}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="run-actions"><button class="outline-action" data-page="schedule">${escapeHtml(this.t("race.inspectWinner"))}${icons.chevron}</button></div>
    </section>`;
  },
};
