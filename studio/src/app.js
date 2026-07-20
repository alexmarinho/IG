/**
 * IG Studio shell: boot, state, engine client lifecycle, run flow and event
 * binding. The render methods live in views/*.js mixins (chromeView,
 * levelsView, overviewView, scheduleView, instanceView, chartsView), which
 * are assigned onto IGStudioApp.prototype below — `this` inside any view
 * method is the app instance, so every helper here stays reachable.
 */

import { IG_ENGINE_PAYLOAD } from "./generated/engine-payload.js";
import { INSTANCE_STATS } from "./generated/instance-stats.js";
import { IGEngineClient, ENGINE_EVENT } from "./engine/index.js";
import {
  INSTANCE_BY_ID,
  SCENARIO_CATALOG,
  SCENARIO_TIME_SCALES,
  getLocalizedScenario,
  getScenario,
  listScenarioInstances,
} from "./data/catalog.js";
import { formatTimeSpan, orderCode, orderedScenarioIds } from "./levels.js";
import {
  evaluateSchedule,
  instanceSummary,
  parseMasclib,
  unpackEmbeddedCatalog,
} from "./data/instance.js";
import {
  aggregateCheckpointBands,
  gapToReference,
  summarizeRunComparison,
} from "./analytics/statistics.js";
import { normalizeUiLocale, translator } from "./i18n.js";
import { escapeHtml, sentenceLabel } from "./views/shared.js";
import { chromeView } from "./views/chrome.js";
import { levelsView } from "./views/levels-page.js";
import { overviewView } from "./views/overview-page.js";
import { scheduleView } from "./views/schedule-page.js";
import { instanceView } from "./views/instance-page.js";
import { chartsView } from "./views/charts.js";

const DEFAULTS = Object.freeze({
  language: "en",
  scenario: "factory",
  instance: "STC_NCOS_31",
  mode: "single",
  iterationBudget: 10_000,
  seed: 16,
  runs: 30,
  d: 2,
  accept: "current",
  permute: true,
  pythonUrl: "../python/README.md",
  notebookUrl: "./notebooks/iterated-greedy-experiments.ipynb",
  notebookUrls: null,
  sheetsUrl: "../google-sheets/README.md",
  sheetsCopyUrl: "../google-sheets/README.md",
  sheetsDownloadUrl: "../google-sheets/dist/ig-scheduling-lab.xlsx",
  originalUrl: "../README.md",
  resultsUrl: "../RESULTS.md",
  sceneAssets: Object.freeze({
    factory: "./assets/scenarios/factory-cnc.webp",
    print3d: "./assets/scenarios/print3d.webp",
    coffee: "./assets/scenarios/coffee.webp",
    brewery: "./assets/scenarios/brewery.webp",
  }),
});

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Math.round(Number(value));
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

class IGStudioApp {
  constructor(container, options = {}) {
    this.container = container;
    this.options = { ...DEFAULTS, ...options };
    this.state = {
      locale: normalizeUiLocale(this.options.language),
      page: "levels",
      scenarioId: this.options.scenario,
      instanceId: this.options.instance,
      previousView: null,
      previousScenarioStats: null,
      mode: this.options.mode,
      iterationBudget: this.options.iterationBudget,
      seed: this.options.seed,
      runs: this.options.runs,
      d: this.options.d,
      accept: this.options.accept,
      permute: this.options.permute,
      status: "loading",
      progress: null,
      liveCheckpoints: [],
      singleResult: null,
      comparisonResult: null,
      selectedRunSeed: null,
      scheduleFilter: "all",
      scheduleQuery: "",
      matrixKind: "time",
      explorerSort: { key: "job", direction: "asc" },
      mobileMenu: false,
      mobileConfigOpen: false,
      error: null,
      instance: null,
      rawCatalog: null,
    };
    this.client = null;
    this.chartCleanups = [];
    this.renderTimer = 0;
    this.renderNeedsFull = false;
    this.resizeTimer = 0;
    this.boundResize = () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.drawCharts(), 80);
    };
  }

  async init() {
    this.render();
    try {
      const [rawCatalog] = await Promise.all([
        unpackEmbeddedCatalog(IG_ENGINE_PAYLOAD.catalogGzipBase64),
      ]);
      this.state.rawCatalog = rawCatalog;
      this.client = new IGEngineClient();
      this.client.on(ENGINE_EVENT.PROGRESS, ({ progress }) => this.onProgress(progress));
      this.client.on(ENGINE_EVENT.RUN_COMPLETE, ({ result }) => this.onSingleComplete(result));
      this.client.on(ENGINE_EVENT.COMPARISON_COMPLETE, ({ result }) => this.onComparisonComplete(result));
      this.client.on(ENGINE_EVENT.ERROR, ({ error }) => this.onError(error));
      await this.client.init({
        wasmBase64: IG_ENGINE_PAYLOAD.wasmBase64,
        catalogGzipBase64: IG_ENGINE_PAYLOAD.catalogGzipBase64,
      });
      if (!this.validScenarioInstance(this.state.scenarioId, this.state.instanceId)) {
        this.state.instanceId = getLocalizedScenario(this.state.scenarioId, this.state.locale).recommendedDefaultInstance;
      }
      await this.selectInstance(this.state.instanceId, { render: false });
      this.state.status = "ready";
      addEventListener("resize", this.boundResize, { passive: true });
      this.render();
    } catch (error) {
      this.onError(error);
    }
    return this;
  }

  validScenarioInstance(scenarioId, instanceId) {
    return listScenarioInstances(scenarioId, this.state.locale).some((instance) => instance.id === instanceId);
  }

  scenario() {
    return getLocalizedScenario(this.state.scenarioId, this.state.locale);
  }

  scenarioVisualUrl(scenario = this.scenario()) {
    return this.options.sceneAssets?.[scenario.visual.assetKey] || "";
  }

  metadata() {
    return INSTANCE_BY_ID[this.state.instanceId];
  }

  scenarioInstance() {
    return listScenarioInstances(this.state.scenarioId, this.state.locale)
      .find((instance) => instance.id === this.state.instanceId) || null;
  }

  applyRunDefaults(instance = this.scenarioInstance()) {
    if (!instance) return;
    const n = instance.jobCount || 0;
    const fallback = n >= 400
      ? { singleBudget: 5_000, comparisonBudget: 600, comparisonRuns: 8, d: 2 }
      : n >= 180
        ? { singleBudget: 3_000, comparisonBudget: 500, comparisonRuns: 8, d: 2 }
        : n >= 100
          ? { singleBudget: 30_000, comparisonBudget: 3_000, comparisonRuns: 10, d: 2 }
          : n >= 40
            ? { singleBudget: 100_000, comparisonBudget: 10_000, comparisonRuns: 10, d: 2 }
            : { singleBudget: 500_000, comparisonBudget: 50_000, comparisonRuns: 10, d: 2 };
    const defaults = instance.runDefaults || fallback;
    const budget = this.state.mode === "comparison"
      ? defaults.comparisonBudget
      : defaults.singleBudget;
    if (Number.isSafeInteger(budget) && budget > 0) this.state.iterationBudget = budget;
    if (Number.isSafeInteger(defaults.comparisonRuns) && defaults.comparisonRuns >= 2) {
      this.state.runs = defaults.comparisonRuns;
    }
    if (Number.isSafeInteger(defaults.d) && defaults.d >= 1) this.state.d = defaults.d;
  }

  instanceDisplayLabel(instance = this.scenarioInstance()) {
    if (!instance) return this.state.instanceId;
    if (instance.interpretation?.label) return instance.interpretation.label;
    const setupLabel = instance.hasSequenceDependentSetups
      ? this.t("misc.sequenceSetups")
      : this.t("misc.noSequenceSetups");
    return `${instance.jobCount} ${this.t("misc.jobs")} · ${setupLabel}`;
  }

  t(path, variables) {
    return translator(this.state.locale)(path, variables);
  }

  fmt(value, options = {}) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    return new Intl.NumberFormat(this.state.locale, {
      maximumFractionDigits: options.maximumFractionDigits ?? (Number.isInteger(Number(value)) ? 0 : 2),
      minimumFractionDigits: options.minimumFractionDigits ?? 0,
      ...options,
    }).format(Number(value));
  }

  pct(value, digits = 2) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    const numeric = Number(value);
    return `${numeric > 0 ? "+" : ""}${this.fmt(numeric, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
  }

  async selectInstance(instanceId, { render = true } = {}) {
    if (!this.state.rawCatalog?.[instanceId]) throw new Error(`Missing embedded instance: ${instanceId}`);
    if (this.state.status === "running" || this.state.status === "paused") await this.client.reset();
    await this.client.selectInstance(instanceId);
    this.state.instanceId = instanceId;
    this.state.instance = parseMasclib(this.state.rawCatalog[instanceId].csv, instanceId);
    this.applyRunDefaults();
    this.state.singleResult = null;
    this.state.comparisonResult = null;
    this.state.selectedRunSeed = null;
    this.state.liveCheckpoints = [];
    this.state.progress = null;
    this.state.status = "ready";
    this.state.error = null;
    if (render) {
      this.render();
      // Keep the viewport where it is on scenario/instance switch. A window-level
      // scroll-to-top here yanked the page up on every carousel tap — jarring on
      // mobile, where the rail (and carousel) stack above the main content.
    }
  }

  /**
   * Switch the scenario lens, remembering the previous instance stats so the
   * instance page can show a delta strip ("vs previous scenario"). Switching
   * always lands on the scenario's recommended default instance unless an
   * explicit valid instanceId is requested (level-select tier buttons).
   */
  async selectScenario(scenarioId, { render = true, instanceId = null } = {}) {
    if (this.state.status === "loading") return;
    if (scenarioId === this.state.scenarioId) {
      if (instanceId && instanceId !== this.state.instanceId && this.validScenarioInstance(scenarioId, instanceId)) {
        await this.selectInstance(instanceId, { render });
      }
      return;
    }
    const previousStats = INSTANCE_STATS[this.state.instanceId] || null;
    this.state.previousScenarioStats = previousStats
      ? { scenarioId: this.state.scenarioId, stats: previousStats }
      : null;
    this.state.scenarioId = scenarioId;
    this._scenarioSwitched = true;
    const scenario = getLocalizedScenario(scenarioId, this.state.locale);
    const target = instanceId && this.validScenarioInstance(scenarioId, instanceId)
      ? instanceId
      : scenario.recommendedDefaultInstance;
    await this.selectInstance(target, { render });
  }

  /** Humanize a minute span using the scenario day length and localized labels. */
  formatSpan(minutes, scenarioId = this.state.scenarioId) {
    return formatTimeSpan(minutes, {
      dayLength: SCENARIO_TIME_SCALES[scenarioId]?.dayLength ?? 1440,
      dayLabel: { one: this.t("levels.day"), many: this.t("levels.days") },
      formatNumber: (value) => this.fmt(value),
    });
  }

  /** Scenario day length in minutes (coffee roasts 12-hour days). */
  dayLength() {
    return SCENARIO_TIME_SCALES[this.state.scenarioId]?.dayLength ?? 1440;
  }

  /** Human-facing order code: ORD-1044 style for domains, J07 for the factory. */
  orderLabel(id) {
    return orderCode(getScenario(this.state.scenarioId)?.orderId, id);
  }

  /** Localized family display name; falls back past the six catalogued names. */
  familyDisplayName(family) {
    const scenario = this.scenario();
    const named = scenario.familyNames?.[family]?.name;
    return named || `${sentenceLabel(scenario.vocabulary.family)} ${family + 1}`;
  }

  /** "4 dias de torra (2.880 min)" — the window metric on the problem page. */
  windowMetricText(minutes) {
    const scale = SCENARIO_TIME_SCALES[this.state.scenarioId] || { dayLength: 1440 };
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const minuteSuffix = `(${this.fmt(total)} ${this.t("misc.minutes")})`;
    const days = Math.round(total / scale.dayLength);
    if (days >= 2) {
      const dayWord = this.state.locale === "pt-BR"
        ? String(scale.dayLabel || "dia").replace(/^dia/, "dias")
        : this.t("levels.days");
      return `${this.fmt(days)} ${dayWord} ${minuteSuffix}`;
    }
    return `${this.formatSpan(total)} ${minuteSuffix}`;
  }

  /** Accessible "?" toggle + popover used by metric cards and column headers. */
  renderHelpToggle(text, ariaLabel) {
    return `<span class="help-wrap"><button type="button" class="help-dot" data-help-toggle aria-expanded="false" aria-label="${escapeHtml(ariaLabel || this.t("a11y.help"))}">?</button><span class="help-pop" role="tooltip" hidden>${escapeHtml(text)}</span></span>`;
  }

  // --- Thin data/analysis accessors for the view mixins -------------------
  // Views call these instead of importing the heavy data modules directly:
  // the dist inliner embeds one data-URI per import edge, so keeping catalog,
  // stats and statistics behind a single importer (this shell) avoids nested
  // copies of those modules inside every view's data-URI.

  /** Raw scenario catalog entries (ids, mappings) — frozen data, safe to share. */
  catalogScenarios() {
    return SCENARIO_CATALOG;
  }

  /** Any scenario localized to the current locale. */
  localizedScenario(scenarioId) {
    return getLocalizedScenario(scenarioId, this.state.locale);
  }

  /** Instances of a scenario, localized to the current locale. */
  scenarioInstances(scenarioId = this.state.scenarioId) {
    return listScenarioInstances(scenarioId, this.state.locale);
  }

  /** Precomputed INSTANCE_STATS entry (null when missing). */
  instanceStats(instanceId = this.state.instanceId) {
    return INSTANCE_STATS[instanceId] || null;
  }

  /** Evaluate a job order against the current instance. */
  evaluateOrder(order) {
    return evaluateSchedule(this.state.instance, order);
  }

  /** instanceSummary passthrough for the problem-data page. */
  summarizeInstance(instance) {
    return instanceSummary(instance);
  }

  /** gapToReference passthrough (percentage points above the reference). */
  gapToReference(cost, reference) {
    return gapToReference(cost, reference);
  }

  /** summarizeRunComparison passthrough for the comparison overview. */
  summarizeRuns(runs, options) {
    return summarizeRunComparison(runs, options);
  }

  /** aggregateCheckpointBands passthrough for the comparison chart. */
  checkpointBands(runs) {
    return aggregateCheckpointBands(runs);
  }

  activeRun() {
    if (this.state.mode === "single") return this.state.singleResult;
    const runs = this.state.comparisonResult?.runs || [];
    if (!runs.length) return null;
    return runs.find((run) => run.seed === this.state.selectedRunSeed)
      || [...runs].sort((left, right) => left.bestCost - right.bestCost || left.seed - right.seed)[0];
  }

  activeEvaluation() {
    const run = this.activeRun();
    if (!run?.order || !this.state.instance) return null;
    return evaluateSchedule(this.state.instance, run.order);
  }

  referenceCost() {
    return this.metadata()?.referenceBest ?? null;
  }

  async startRun() {
    if (!this.client || !this.state.instance || ["running", "paused"].includes(this.state.status)) return;
    const controlValue = (selector, fallback) => this.container.querySelector(selector)?.value ?? fallback;
    this.state.iterationBudget = clampInteger(controlValue("#budget-input", this.state.iterationBudget), 1, 1_000_000_000, 10_000);
    this.state.runs = clampInteger(controlValue("#runs-input", this.state.runs), 2, 64, 30);
    const maximumSeed = 0xffff_ffff - (this.state.mode === "comparison" ? this.state.runs - 1 : 0);
    this.state.seed = clampInteger(controlValue("#seed-input", this.state.seed), 0, maximumSeed, 1);
    this.state.d = clampInteger(controlValue("#d-input", this.state.d), 1, Math.max(1, this.state.instance.n), 2);
    this.state.accept = this.container.querySelector("#accept-select")?.value || this.state.accept;
    this.state.permute = this.container.querySelector("#permute-input")?.checked ?? this.state.permute;
    this.state.status = "running";
    this.state.error = null;
    this.state.progress = null;
    this.state.liveCheckpoints = [];
    if (this.state.mode === "single") this.state.singleResult = null;
    else { this.state.comparisonResult = null; this.state.selectedRunSeed = null; }
    this.render();
    try {
      const checkpointEvery = Math.max(1, Math.ceil(this.state.iterationBudget / 50));
      await this.client.configure({
        seed: this.state.seed,
        iterationBudget: this.state.iterationBudget,
        checkpointEvery,
        progressIntervalMs: 100,
        d: this.state.d,
        accept: this.state.accept,
        permute: this.state.permute,
      });
      if (this.state.mode === "single") await this.client.start();
      else {
        await this.client.compare({
          count: this.state.runs,
          seedStart: this.state.seed,
          iterationBudget: this.state.iterationBudget,
          checkpointEvery,
          progressIntervalMs: 100,
          d: this.state.d,
          accept: this.state.accept,
          permute: this.state.permute,
        });
      }
    } catch (error) {
      this.onError(error);
    }
  }

  onProgress(progress) {
    this.state.progress = progress;
    this.state.status = "running";
    let needsFullRender = false;
    if (progress.mode === "single") {
      const previous = this.state.liveCheckpoints.at(-1);
      if (!previous || previous.iteration !== progress.iterations) {
        this.state.liveCheckpoints.push({
          iteration: progress.iterations,
          evaluations: progress.evaluations,
          cost: progress.cost,
          bestCost: progress.bestCost,
        });
      }
      if (progress.order) {
        this.state.singleResult = {
          instance: this.state.instanceId,
          seed: progress.seed,
          iterations: progress.iterations,
          evaluations: progress.evaluations,
          cost: progress.cost,
          bestCost: progress.bestCost,
          order: progress.order,
          checkpoints: this.state.liveCheckpoints.slice(),
          partial: true,
        };
        needsFullRender = true;
      } else if (this.state.singleResult) {
        this.state.singleResult.iterations = progress.iterations;
        this.state.singleResult.evaluations = progress.evaluations;
        this.state.singleResult.checkpoints = this.state.liveCheckpoints.slice();
      }
    }
    this.scheduleRender(needsFullRender);
  }

  onSingleComplete(result) {
    this.state.singleResult = result;
    this.state.progress = { ...result, mode: "single", iterationBudget: this.state.iterationBudget };
    this.state.status = "complete";
    this.assertClosure(result);
    this.render();
  }

  onComparisonComplete(result) {
    this.state.comparisonResult = result;
    const ranked = [...result.runs].sort((left, right) => left.bestCost - right.bestCost || left.seed - right.seed);
    this.state.selectedRunSeed = ranked[0]?.seed ?? null;
    this.state.progress = null;
    this.state.status = "complete";
    for (const run of result.runs) this.assertClosure(run);
    this.render();
  }

  assertClosure(result) {
    if (!result?.order || !this.state.instance) return;
    const evaluated = evaluateSchedule(this.state.instance, result.order);
    const engineCost = result.bestCost ?? result.cost;
    if (Math.abs(evaluated.breakdown.total - engineCost) > 0.051) {
      this.onError(new Error(`Objective identity mismatch: engine ${engineCost}, display ${evaluated.breakdown.total}`));
    }
  }

  onError(error) {
    this.state.error = error?.message || String(error);
    this.state.status = "error";
    this.render();
  }

  scheduleRender(needsFullRender = false) {
    this.renderNeedsFull ||= needsFullRender;
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = 0;
      const renderLayout = this.renderNeedsFull;
      this.renderNeedsFull = false;
      if (renderLayout) this.render();
      else this.updateProgressUi();
    }, 100);
  }

  statusText() {
    if (this.state.error) return this.t("status.error");
    if (this.state.status === "running" && this.state.mode === "comparison" && this.state.progress?.runNumber) {
      return this.t("status.comparing", { current: this.state.progress.runNumber, total: this.state.runs });
    }
    if (this.state.status === "complete" && this.state.mode === "comparison" && this.state.comparisonResult) {
      return this.t("status.comparisonComplete", { count: this.state.comparisonResult.runs.length });
    }
    return this.t(`status.${this.state.status === "complete" ? "complete" : this.state.status}`);
  }

  updateProgressUi() {
    const bar = this.container.querySelector(".rail-progress");
    if (bar) bar.style.setProperty("--progress", `${(this.progressRatio() * 100).toFixed(2)}%`);
    const status = this.container.querySelector(".run-status");
    if (status) {
      const dot = status.querySelector(".status-dot");
      const copy = status.querySelector("span");
      if (dot) dot.className = `status-dot ${this.state.status}`;
      if (copy) copy.textContent = this.statusText() || this.t("status.ready");
    }
    if (this.state.page === "overview") this.drawCharts();
  }

  async pauseResume() {
    try {
      if (this.state.status === "paused") {
        await this.client.resume();
        this.state.status = "running";
      } else {
        await this.client.pause();
        this.state.status = "paused";
      }
      this.render();
    } catch (error) { this.onError(error); }
  }

  async reset() {
    try {
      await this.client.reset();
      this.state.status = "ready";
      this.state.progress = null;
      this.state.singleResult = null;
      this.state.comparisonResult = null;
      this.state.selectedRunSeed = null;
      this.state.liveCheckpoints = [];
      this.state.error = null;
      this.render();
    } catch (error) { this.onError(error); }
  }

  progressRatio() {
    const progress = this.state.progress;
    if (!progress) return this.state.status === "complete" ? 1 : 0;
    const within = Math.min(1, (progress.iterations || 0) / Math.max(1, this.state.iterationBudget));
    if (this.state.mode === "single") return within;
    const completedRuns = Math.max(0, (progress.runNumber || 1) - 1);
    return Math.min(1, (completedRuns + within) / Math.max(1, this.state.runs));
  }

  render() {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = 0;
    this.renderNeedsFull = false;
    this.chartCleanups.forEach((cleanup) => cleanup());
    this.chartCleanups = [];
    this.container.innerHTML = `
      <div class="studio-shell" data-active-page="${this.state.page}" data-active-scenario="${this.state.scenarioId}" data-run-mode="${this.state.mode}" data-status="${this.state.status}" data-has-result="${Boolean(this.state.singleResult || this.state.comparisonResult)}">
        ${this.renderTopbar()}
        <div class="body-grid">
          ${this.renderRail()}
          <main class="workspace" id="studio-main" tabindex="-1">${this.renderPage()}</main>
        </div>
        ${this.renderBottomNav()}
        ${this.renderMobileSheet()}
      </div>`;
    this._scenarioSwitched = false;
    document.documentElement.lang = this.state.locale;
    this.bindEvents();
    requestAnimationFrame(() => this.drawCharts());
  }

  bindEvents() {
    this.container.querySelectorAll("[data-page]").forEach((element) => element.addEventListener("click", (event) => {
      event.preventDefault();
      this.state.previousView = this.state.page;
      this.state.page = element.dataset.page;
      this.state.mobileMenu = false;
      this.render();
      requestAnimationFrame(() => this.container.querySelector("#studio-main")?.focus({ preventScroll: true }));
    }));
    this.container.querySelectorAll("[data-level-pick]").forEach((element) => element.addEventListener("click", async () => {
      const scenarioId = element.dataset.levelPick;
      const instanceId = element.dataset.instance || null;
      if (this.state.status === "loading") return;
      this.state.previousView = null;
      await this.selectScenario(scenarioId, { render: false, instanceId });
      this.state.page = "instance";
      this.state.mobileMenu = false;
      this.render();
      requestAnimationFrame(() => this.container.querySelector("#studio-main")?.focus({ preventScroll: true }));
    }));
    this.container.querySelectorAll("[data-scenario]").forEach((button) => button.addEventListener("click", async () => {
      await this.selectScenario(button.dataset.scenario);
    }));
    this.container.querySelectorAll("[data-scenario-step]").forEach((button) => button.addEventListener("click", async () => {
      const ids = orderedScenarioIds(SCENARIO_CATALOG.map((entry) => entry.id));
      const current = ids.indexOf(this.state.scenarioId);
      const step = Number(button.dataset.scenarioStep) || 0;
      const nextId = ids[(current + step + ids.length) % ids.length];
      await this.selectScenario(nextId);
    }));
    this.container.querySelector("#scenario-select")?.addEventListener("change", (event) => this.selectScenario(event.target.value));
    this.container.querySelector("#switch-instance-select")?.addEventListener("change", (event) => this.selectInstance(event.target.value));
    this.container.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
      const nextMode = button.dataset.mode;
      if (nextMode === this.state.mode) return;
      this.state.mode = nextMode;
      this.applyRunDefaults();
      this.state.progress = null;
      const hasResult = nextMode === "single" ? this.state.singleResult : this.state.comparisonResult;
      this.state.status = hasResult ? "complete" : "ready";
      this.render();
    }));
    this.container.querySelector("[data-action='mobile-config']")?.addEventListener("click", () => {
      this.state.mobileConfigOpen = !this.state.mobileConfigOpen;
      this.render();
    });
    this.container.querySelector("#instance-select")?.addEventListener("change", (event) => this.selectInstance(event.target.value));
    this.container.querySelector("#run-select")?.addEventListener("change", (event) => {
      this.state.selectedRunSeed = Number(event.target.value);
      this.render();
    });
    const bindNumber = (selector, key, min, max) => this.container.querySelector(selector)?.addEventListener("change", (event) => {
      this.state[key] = clampInteger(event.target.value, min, max, this.state[key]);
      event.target.value = this.state[key];
      if (key === "runs" || key === "iterationBudget") this.render();
    });
    bindNumber("#budget-input", "iterationBudget", 1, 1_000_000_000);
    bindNumber("#seed-input", "seed", 0, 0xffff_ffff);
    bindNumber("#runs-input", "runs", 2, 64);
    bindNumber("#d-input", "d", 1, this.state.instance?.n || 500);
    this.container.querySelector("#accept-select")?.addEventListener("change", (event) => { this.state.accept = event.target.value; });
    this.container.querySelector("#permute-input")?.addEventListener("change", (event) => { this.state.permute = event.target.checked; });
    this.container.querySelector('[data-action="run"]')?.addEventListener("click", () => this.startRun());
    this.container.querySelector('[data-action="pause"]')?.addEventListener("click", () => this.pauseResume());
    this.container.querySelector('[data-action="reset"]')?.addEventListener("click", () => this.reset());
    this.container.querySelectorAll('[data-action="language"]').forEach((button) => button.addEventListener("click", () => {
      this.state.mobileMenu = false;
      this.setLanguage(this.state.locale === "en" ? "pt-BR" : "en");
    }));
    this.container.querySelectorAll('[data-action="mobile-menu"]').forEach((button) => button.addEventListener("click", () => { this.state.mobileMenu = !this.state.mobileMenu; this.render(); }));
    this.container.querySelector("#schedule-query")?.addEventListener("input", (event) => {
      const caret = event.target.selectionStart;
      this.state.scheduleQuery = event.target.value;
      this.render();
      requestAnimationFrame(() => {
        const replacement = this.container.querySelector("#schedule-query");
        replacement?.focus({ preventScroll: true });
        replacement?.setSelectionRange(caret, caret);
      });
    });
    this.container.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => { this.state.scheduleFilter = button.dataset.filter; this.render(); }));
    this.container.querySelectorAll("[data-matrix]").forEach((button) => button.addEventListener("click", () => { this.state.matrixKind = button.dataset.matrix; this.render(); }));
    this.container.querySelectorAll("[data-explorer-sort]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.explorerSort;
      const current = this.state.explorerSort;
      this.state.explorerSort = current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" };
      this.render();
    }));
    this.container.querySelectorAll("[data-help-toggle]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const popover = button.parentElement?.querySelector(".help-pop");
      if (!popover) return;
      const willOpen = popover.hidden;
      this.container.querySelectorAll(".help-pop").forEach((entry) => { entry.hidden = true; });
      this.container.querySelectorAll("[data-help-toggle]").forEach((entry) => entry.setAttribute("aria-expanded", "false"));
      popover.hidden = !willOpen;
      button.setAttribute("aria-expanded", String(willOpen));
    }));
  }

  serializeState() {
    return {
      locale: this.state.locale,
      page: this.state.page,
      scenario: this.state.scenarioId,
      instance: this.state.instanceId,
      mode: this.state.mode,
      iterationBudget: this.state.iterationBudget,
      seed: this.state.seed,
      runs: this.state.runs,
      d: this.state.d,
      accept: this.state.accept,
      permute: this.state.permute,
    };
  }

  setLanguage(locale) {
    this.state.locale = normalizeUiLocale(locale);
    const localizedNotebook = this.options.notebookUrls?.[this.state.locale];
    if (localizedNotebook) this.options.notebookUrl = localizedNotebook;
    this.render();
  }

  resize() { this.drawCharts(); }

  async destroy() {
    removeEventListener("resize", this.boundResize);
    clearTimeout(this.renderTimer);
    clearTimeout(this.resizeTimer);
    this.chartCleanups.forEach((cleanup) => cleanup());
    if (this.client) await this.client.dispose();
    this.container.replaceChildren();
  }
}

// View mixins: every render/chart method lives in views/*.js and lands on the
// prototype here, so `this` inside a view method is the app instance.
Object.assign(
  IGStudioApp.prototype,
  chromeView,
  levelsView,
  overviewView,
  scheduleView,
  instanceView,
  chartsView,
);

export function mountIGStudio(container, options = {}) {
  if (!(container instanceof Element)) throw new TypeError("mountIGStudio requires a container Element.");
  const app = new IGStudioApp(container, options);
  app.ready = app.init();
  return app;
}

globalThis.mountIGStudio = mountIGStudio;
const root = document.querySelector("#ig-studio");
if (root) {
  globalThis.__igStudio = mountIGStudio(root, globalThis.IG_STUDIO_CONFIG || {});
  globalThis.__igStudio.ready.then(() => {
    if (parent !== globalThis) parent.postMessage({ type: "ig-studio:ready" }, "*");
  });
}

// Tiny integration bridge for the self-contained home-page iframe.  The
// parent owns only the current locale; the Studio keeps its own dictionaries,
// state and rendering lifecycle.
addEventListener("message", (event) => {
  if (event.data?.type !== "ig-studio:set-language") return;
  globalThis.__igStudio?.setLanguage(event.data.language);
});
