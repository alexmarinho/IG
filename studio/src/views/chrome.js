/**
 * App-chrome view mixin: topbar, control rail, scenario selector, page
 * dispatch, method page and mobile navigation. Methods are mixed onto
 * IGStudioApp.prototype, so `this` is the app instance (state, t(), fmt(),
 * scenario helpers and the other view methods are all available).
 */

import { escapeHtml, icons } from "./shared.js";

export const chromeView = {
  renderTopbar() {
    const pages = ["levels"];
    return `<header class="topbar">
      <a class="brand" href="#levels" data-page="levels" aria-label="Iterated Greedy">
        <span class="brand-mark">${icons.logo}</span><span>Iterated Greedy</span>
      </a>
      <nav class="primary-nav" aria-label="${escapeHtml(this.t("a11y.primary"))}">
        ${pages.map((page) => `<button class="nav-button" data-page="${page}" ${this.state.page === page ? 'aria-current="page"' : ""}>${escapeHtml(this.t(`nav.${page}`))}</button>`).join("")}
      </nav>
      <div class="top-actions">
        <button class="top-action language-action" data-action="language" aria-label="${escapeHtml(this.t("controls.language"))}">${icons.globe}<span>${this.state.locale === "en" ? "EN / PT" : "PT / EN"}</span></button>
        <a class="top-action" href="${escapeHtml(this.options.pythonUrl)}" target="_blank" rel="noreferrer">${icons.code}<span>${escapeHtml(this.t("links.python"))}</span></a>
        <a class="top-action" href="${escapeHtml(this.options.notebookUrl)}" target="_blank" rel="noreferrer">${icons.book}<span>${escapeHtml(this.t("links.notebook"))}</span></a>
        <button class="mobile-menu" data-action="mobile-menu" aria-label="${escapeHtml(this.t("a11y.menu"))}" aria-expanded="${this.state.mobileMenu}">${icons.menu}</button>
      </div>
    </header>`;
  },

  renderRail() {
    const scenario = this.scenario();
    const instances = this.scenarioInstances();
    const metadata = this.metadata();
    const selectedMapping = this.scenarioInstance();
    const instanceLabel = this.instanceDisplayLabel(selectedMapping);
    const instanceNote = selectedMapping?.interpretation?.note || this.t("misc.fixedCatalogNote");
    const running = ["running", "paused"].includes(this.state.status);
    const compactRail = this.state.page !== "overview" || this.state.mode === "comparison" || Boolean(this.state.singleResult || this.state.comparisonResult);
    const statusText = this.statusText();
    const hasOverviewResult = this.state.mode === "comparison" ? Boolean(this.state.comparisonResult) : Boolean(this.state.singleResult);
    const mobileTitle = hasOverviewResult
      ? (this.state.mode === "comparison" ? this.t("overview.compareTitle") : this.t("overview.singleTitle"))
      : this.t("overview.initialTitle");
    const modeSummary = this.state.mode === "comparison"
      ? `${this.t("controls.compare")} · ${this.state.runs} · ${this.fmt(this.state.iterationBudget)} ${this.t("controls.perSeed")}`
      : `${this.t("controls.oneRun")} · ${this.fmt(this.state.iterationBudget)} · seed ${this.state.seed}`;
    return `<aside class="control-rail ${compactRail ? "is-compact" : ""}" aria-label="${escapeHtml(this.t("a11y.controls"))}">
      ${this.state.page === "overview" ? this.renderScenarioSelector() : ""}
      ${this.state.page === "overview" ? `<header class="mobile-rail-intro"><h1>${escapeHtml(mobileTitle)}</h1></header>` : ""}
      <p class="scenario-description">${escapeHtml(scenario.description)}</p>
      <p class="instance-facts">${escapeHtml(this.state.instanceId)} · ${metadata?.jobCount ?? "—"} ${escapeHtml(this.t("misc.jobs"))}${this.state.instance ? ` · ${this.state.instance.familyCount} ${escapeHtml(this.t("misc.families"))}` : ""}</p>
      <div class="selected-instance-story"><strong>${escapeHtml(instanceLabel)}</strong><span>${escapeHtml(instanceNote)}</span></div>
      <nav class="rail-modes" aria-label="${escapeHtml(this.t("a11y.primary"))}">
        <button class="rail-mode" data-page="levels" aria-current="${this.state.page === "levels" ? "page" : "false"}">${escapeHtml(this.t("nav.levels"))}</button>
        <button class="rail-mode" data-page="overview" aria-current="${this.state.page === "overview" ? "page" : "false"}">${escapeHtml(this.t("nav.overview"))}</button>
        <button class="rail-mode" data-page="schedule" aria-current="${this.state.page === "schedule" ? "page" : "false"}"${(this.state.singleResult || this.state.comparisonResult) ? "" : " disabled"}>${escapeHtml(this.t("nav.schedule"))}</button>
      </nav>
      <details class="model-disclosure">
        <summary>${escapeHtml(this.t("actions.simplify"))}</summary>
        <div class="disclosure-copy"><p>${escapeHtml(scenario.disclosure)}</p><ul>${scenario.simplifications.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      </details>
      <button class="mobile-config-toggle" data-action="mobile-config" aria-controls="experiment-fields" aria-expanded="${this.state.mobileConfigOpen}"><span>${escapeHtml(this.t("actions.configure"))}</span><strong>${escapeHtml(modeSummary)}</strong>${icons.chevron}</button>
      <div class="control-stack ${this.state.mobileConfigOpen ? "is-mobile-open" : ""}">
        <div class="experiment-fields" id="experiment-fields">
        <label class="field"><span>${escapeHtml(this.t("actions.changeInstance"))}</span>
          <select id="instance-select" ${running ? "disabled" : ""}>
            ${instances.map((instance) => `<option value="${escapeHtml(instance.id)}" ${instance.id === this.state.instanceId ? "selected" : ""}>${escapeHtml(this.instanceDisplayLabel(instance))} · ${escapeHtml(instance.id)}</option>`).join("")}
          </select>
        </label>
        <div class="field mode-field"><span class="field-label">${escapeHtml(this.t("controls.runMode"))}</span>
          <div class="segmented" role="group">
            <button data-mode="single" aria-pressed="${this.state.mode === "single"}" ${running ? "disabled" : ""}>${escapeHtml(this.t("controls.oneRun"))}</button>
            <button data-mode="comparison" aria-pressed="${this.state.mode === "comparison"}" ${running ? "disabled" : ""}>${escapeHtml(this.t("controls.compare"))}</button>
          </div>
        </div>
        <label class="field"><span>${escapeHtml(this.t("controls.budget"))}</span>
          <div class="field-inline"><input id="budget-input" type="number" min="1" max="1000000000" step="100" value="${this.state.iterationBudget}" ${running ? "disabled" : ""}><span class="field-suffix">${this.state.mode === "comparison" ? escapeHtml(this.t("controls.perSeed")) : ""}</span></div>
        </label>
        ${this.state.mode === "single" ? `<label class="field"><span>${escapeHtml(this.t("controls.seed"))}</span><input id="seed-input" type="number" min="0" max="4294967295" step="1" value="${this.state.seed}" ${running ? "disabled" : ""}></label>`
          : `<label class="field"><span>${escapeHtml(this.t("controls.runs"))}</span><input id="runs-input" type="number" min="2" max="64" step="1" value="${this.state.runs}" ${running ? "disabled" : ""}></label>
             <label class="field"><span>${escapeHtml(this.t("controls.seed"))}</span><input id="seed-input" type="number" min="0" max="4294967232" step="1" value="${this.state.seed}" ${running ? "disabled" : ""}></label>`}
        <details class="advanced"><summary>${escapeHtml(this.t("actions.settings"))}</summary><div class="advanced-grid">
          <label class="field"><span>${escapeHtml(this.t("controls.destruction"))}</span><input id="d-input" type="number" min="1" max="${this.state.instance?.n || 500}" value="${this.state.d}" ${running ? "disabled" : ""}></label>
          <label class="field"><span>${escapeHtml(this.t("controls.acceptance"))}</span><select id="accept-select" ${running ? "disabled" : ""}><option value="current" ${this.state.accept === "current" ? "selected" : ""}>${escapeHtml(this.t("controls.current"))}</option><option value="best" ${this.state.accept === "best" ? "selected" : ""}>${escapeHtml(this.t("controls.best"))}</option></select></label>
          <label class="check-field"><input id="permute-input" type="checkbox" ${this.state.permute ? "checked" : ""} ${running ? "disabled" : ""}>${escapeHtml(this.t("controls.exchange"))}</label>
        </div></details>
        </div>
        <div class="run-dock">
          <button class="primary-action" data-action="run" ${running || this.state.status === "loading" ? "disabled" : ""}>${escapeHtml(this.state.mode === "comparison" ? this.t("actions.runSeeds", { count: this.state.runs }) : this.t("actions.run"))}</button>
          <div class="transport">
            <button class="secondary-action" data-action="pause" ${!running ? "disabled" : ""}>${escapeHtml(this.state.status === "paused" ? this.t("actions.resume") : this.t("actions.pause"))}</button>
            <button class="secondary-action" data-action="reset" ${this.state.status === "loading" ? "disabled" : ""}>${escapeHtml(this.t("actions.reset"))}</button>
          </div>
          <div class="rail-progress" aria-hidden="true" style="--progress:${(this.progressRatio() * 100).toFixed(2)}%"><span></span></div>
          <div class="run-status" role="status"><i class="status-dot ${this.state.status}"></i><span>${escapeHtml(statusText || this.t("status.ready"))}${this.state.error ? `<br><small>${escapeHtml(this.state.error)}</small>` : ""}</span></div>
        </div>
      </div>
    </aside>`;
  },

  renderScenarioSelector() {
    const activeId = this.state.scenarioId;
    const tiles = this.catalogScenarios().map(({ id }, index) => {
      const sc = this.localizedScenario(id);
      const url = this.scenarioVisualUrl(sc);
      const active = id === activeId;
      return `<button type="button" class="scenario-pick${active ? " is-active" : ""}" data-scenario="${escapeHtml(id)}" aria-pressed="${active}" title="${escapeHtml(sc.name)}">
          <span class="scenario-pick-index">${String(index + 1).padStart(2, "0")}</span>
          <span class="scenario-pick-img" style="background-image:url('${url}');--scenario-focus:${escapeHtml(sc.visual.objectPosition)}"></span>
          <span class="scenario-pick-name">${escapeHtml(sc.name)}</span>
        </button>`;
    }).join("");
    return `<section class="scenario-picker" aria-label="${escapeHtml(this.t("controls.scenario"))}">
      <p class="scenario-picker-label">${escapeHtml(this.t("controls.scenario"))}</p>
      <div class="scenario-pick-grid" role="group">${tiles}</div>
    </section>`;
  },

  renderPage() {
    if (this.state.page === "levels") return this.renderLevelsPage();
    if (this.state.page === "schedule") return this.renderSchedulePage();
    if (this.state.page === "instance") return this.renderInstancePage();
    if (this.state.page === "method") return this.renderMethodPage();
    return this.renderOverviewPage();
  },

  renderMethodPage() {
    const scenario = this.scenario();
    const configRows = [
      [this.t("actions.changeInstance"), this.state.instanceId],
      [this.t("controls.budget"), this.fmt(this.state.iterationBudget)],
      [this.t("controls.seed"), String(this.state.seed)],
      ["d", String(this.state.d)],
      [this.t("controls.acceptance"), this.state.accept === "best" ? this.t("controls.best") : this.t("controls.current")],
      [this.t("controls.exchange"), this.state.permute ? this.t("misc.yes") : this.t("misc.no")],
      [this.t("method.engine"), "Rust · WebAssembly"],
    ];
    return `<header class="page-head"><h1>${escapeHtml(this.t("method.title"))}</h1><p>${escapeHtml(this.t("method.sub"))}</p></header>
      <div class="method-intro"><section class="method-copy"><p>${escapeHtml(this.t("method.intro"))}</p><p>${escapeHtml(this.t("method.randomness"))}</p><div class="formula">${escapeHtml(this.t("method.formula"))}</div><div class="method-steps">${[["construct", "constructText"], ["perturb", "perturbText"], ["repair", "repairText"], ["compare", "compareText"]].map(([title, text]) => `<article class="method-step"><h3>${escapeHtml(this.t(`method.${title}`))}</h3><p>${escapeHtml(this.t(`method.${text}`))}</p></article>`).join("")}</div></section>
      <aside><section class="manifest"><h2>${escapeHtml(this.t("method.config"))}</h2><dl>${configRows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl></section><div class="resource-links">
        <a class="resource-link" href="${escapeHtml(this.options.sheetsCopyUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(this.t("method.sheets"))}</strong><span>${escapeHtml(this.t("method.sheetsText"))}</span></a>
        <a class="resource-link" href="${escapeHtml(this.options.sheetsDownloadUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(this.t("method.workbook"))}</strong><span>${escapeHtml(this.t("method.workbookText"))}</span></a>
        <a class="resource-link" href="${escapeHtml(this.options.notebookUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(this.t("method.notebook"))}</strong><span>${escapeHtml(this.t("method.notebookText"))}</span></a>
        <a class="resource-link" href="${escapeHtml(this.options.pythonUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(this.t("method.implementation"))}</strong><span>${escapeHtml(this.t("method.fixedCatalog"))}</span></a>
        <a class="resource-link" href="${escapeHtml(this.options.originalUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(this.t("method.original"))}</strong><span>${escapeHtml(this.t("method.originalText"))}</span></a>
        <a class="resource-link" href="${escapeHtml(this.options.resultsUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(this.t("method.results"))}</strong><span>${escapeHtml(this.t("method.resultsText"))}</span></a>
      </div></aside></div>
      <section class="analysis-panel scenario-method-note"><h2 class="panel-title">${escapeHtml(scenario.name)} · ${escapeHtml(this.t("scenario.decisions"))}</h2><ol class="interpretation">${scenario.decisions.map((decision) => `<li>${escapeHtml(decision)}</li>`).join("")}</ol><h3 class="panel-title note-subtitle">${escapeHtml(this.t("scenario.objective"))}</h3><p class="interpretation">${escapeHtml(scenario.objective.summary)}</p><h3 class="panel-title note-subtitle">${escapeHtml(this.t("scenario.model"))}</h3><p class="interpretation">${escapeHtml(scenario.disclosure)}</p></section>`;
  },

  renderBottomNav() {
    const items = [["levels", icons.grid], ["overview", icons.chart], ["schedule", icons.calendar]];
    return `<nav class="mobile-bottom-nav" aria-label="${escapeHtml(this.t("a11y.primary"))}">${items.map(([page, icon]) => `<button data-page="${page}" ${this.state.page === page ? 'aria-current="page"' : ""}>${icon}<span>${escapeHtml(this.t(`nav.${page}`))}</span></button>`).join("")}</nav>`;
  },

  renderMobileSheet() {
    return `<div class="mobile-sheet ${this.state.mobileMenu ? "open" : ""}" aria-hidden="${!this.state.mobileMenu}"><a href="${escapeHtml(this.options.sheetsCopyUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("links.sheets"))}</a><a href="${escapeHtml(this.options.sheetsDownloadUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("links.workbook"))}</a><a href="${escapeHtml(this.options.notebookUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("links.notebook"))}</a><a href="${escapeHtml(this.options.pythonUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("links.python"))}</a><a href="${escapeHtml(this.options.originalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("links.original"))}</a><a href="${escapeHtml(this.options.resultsUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("links.results"))}</a><button data-action="language">${this.state.locale === "en" ? "Português" : "English"}</button><button data-action="mobile-menu">${escapeHtml(this.t("actions.close"))}</button></div>`;
  },
};
