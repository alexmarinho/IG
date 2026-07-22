/**
 * Level-select view mixin: the four scenario cards with stats chips, mini
 * processing-time bars and per-instance tier buttons. Mixed onto
 * IGStudioApp.prototype — `this` is the app instance.
 */

import { escapeHtml } from "./shared.js";
import {
  NEW_SCENARIO_IDS,
  TIER_META,
  miniBarsSvg,
  orderedScenarioIds,
  tierOf,
} from "../levels.js";

export const levelsView = {
  renderLevelsPage() {
    const ids = orderedScenarioIds(this.catalogScenarios().map(({ id }) => id));
    return `<header class="page-head levels-hero"><h1>${escapeHtml(this.t("levels.title"))}</h1><p>${escapeHtml(this.t("levels.subtitle"))}</p></header>
      <section class="levels-grid" aria-label="${escapeHtml(this.t("levels.title"))}">${ids.map((id) => this.renderLevelCard(id)).join("")}</section>`;
  },

  renderLevelCard(id) {
    const scenario = this.localizedScenario(id);
    const stats = this.instanceStats(scenario.recommendedDefaultInstance);
    const instances = this.scenarioInstances(id);
    const loading = this.state.status === "loading";
    const isNew = NEW_SCENARIO_IDS.includes(id);
    const chips = stats ? this.levelCardChips(id, stats) : "";
    const bars = stats ? miniBarsSvg(stats.procBins, { label: escapeHtml(this.t("instance.processing")) }) : "";
    const tierButtons = instances.map((instance) => {
      const tier = TIER_META[tierOf(instance.id, instance.jobCount)];
      const label = this.instanceDisplayLabel(instance);
      return `<button type="button" class="level-tier" data-level-pick="${escapeHtml(id)}" data-instance="${escapeHtml(instance.id)}" aria-label="${escapeHtml(this.t("levels.openTier", { scenario: scenario.name, label }))}" title="${escapeHtml(`${label} · ${this.t("levels.tierEstimate", { time: tier.time })}`)}"${loading ? " disabled" : ""}>
        <span class="level-tier-icon" aria-hidden="true">${tier.icon}</span><span class="level-tier-label">${escapeHtml(label)}</span><span class="level-tier-time">${escapeHtml(tier.time)}</span>
      </button>`;
    }).join("");
    return `<article class="level-card">
      <button type="button" class="level-card-main" data-level-pick="${escapeHtml(id)}" data-instance="${escapeHtml(scenario.recommendedDefaultInstance)}" aria-label="${escapeHtml(this.t("levels.openScenario", { scenario: scenario.name }))}"${loading ? " disabled" : ""}>
        <span class="level-card-media" style="--scenario-focus:${escapeHtml(scenario.visual.objectPosition)}">
          <img src="${escapeHtml(this.scenarioVisualUrl(scenario))}" alt="${escapeHtml(scenario.visualAlt)}" loading="lazy" decoding="async" onerror="this.style.display='none'">
          ${isNew ? `<span class="level-ribbon">${escapeHtml(this.t("levels.newRibbon"))}</span>` : ""}
        </span>
        <span class="level-card-body">
          <span class="level-card-name">${escapeHtml(scenario.name)}</span>
          <span class="level-card-desc">${escapeHtml(scenario.shortDescription)}</span>
          ${bars}
          <span class="level-chips">${chips}</span>
        </span>
      </button>
      <div class="level-tiers${instances.length > 6 ? " is-scroll" : ""}" role="group" aria-label="${escapeHtml(this.t("levels.tiers"))}">${tierButtons}</div>
    </article>`;
  },

  levelCardChips(id, stats) {
    const firstChip = id === "factory"
      ? this.t("levels.benchmarksChip", { count: this.fmt(this.catalogScenarios().find(({ id: scenarioId }) => scenarioId === "factory")?.instanceMappings.length || 0) })
      : `${this.fmt(stats.n)} ${this.t("misc.jobs")}`;
    const chips = [
      firstChip,
      `${this.fmt(stats.families)} ${this.t("misc.families")}`,
      this.formatSpan(stats.horizon, id),
      `${stats.possibilities} ${this.t("levels.possibilitiesChip")}`,
    ];
    return chips.map((chip) => `<span class="level-chip">${escapeHtml(chip)}</span>`).join("");
  },
};
