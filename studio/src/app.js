import { IG_ENGINE_PAYLOAD } from "./generated/engine-payload.js";
import { INSTANCE_STATS } from "./generated/instance-stats.js";
import { IGEngineClient, ENGINE_EVENT } from "./engine/index.js";
import {
  INSTANCE_BY_ID,
  SCENARIO_CATALOG,
  SCENARIO_TIME_SCALES,
  getLocalizedScenario,
  listScenarioInstances,
} from "./data/catalog.js";
import {
  NEW_SCENARIO_IDS,
  TIER_META,
  deltaChips,
  formatTimeSpan,
  miniBarsSvg,
  orderedScenarioIds,
  tierOf,
} from "./levels.js";
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
import {
  FAMILY_COLORS,
  attachCanvasTooltip,
  drawConvergence,
  drawDistribution,
  drawGantt,
  drawHeatmap,
  drawHistogram,
} from "./visuals/charts.js";

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
    ai: "./assets/scenarios/ai-server.webp",
    kitchen: "./assets/scenarios/restaurant-kitchen.webp",
    surgery: "./assets/scenarios/surgery-center.webp",
    print3d: "./assets/scenarios/print3d.webp",
    coffee: "./assets/scenarios/coffee.webp",
    bakery: "./assets/scenarios/bakery.webp",
    dental: "./assets/scenarios/dental.webp",
    laser: "./assets/scenarios/laser.webp",
    laundry: "./assets/scenarios/laundry.webp",
    studio: "./assets/scenarios/studio.webp",
    lab: "./assets/scenarios/lab.webp",
    brewery: "./assets/scenarios/brewery.webp",
  }),
});

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const sentenceLabel = (value) => {
  const text = String(value || "");
  return text ? `${text[0].toLocaleUpperCase()}${text.slice(1)}` : text;
};

const icons = {
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

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Math.round(Number(value));
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function formatSeedRange(runs) {
  if (!runs?.length) return "—";
  const seeds = runs.map((run) => run.seed);
  return `${Math.min(...seeds)}–${Math.max(...seeds)}`;
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
  }

  renderRail() {
    const scenario = this.scenario();
    const instances = listScenarioInstances(this.state.scenarioId, this.state.locale);
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
  }

  renderScenarioSelector() {
    const activeId = this.state.scenarioId;
    const tiles = SCENARIO_CATALOG.map(({ id }, index) => {
      const sc = getLocalizedScenario(id, this.state.locale);
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
  }

  renderPage() {
    if (this.state.page === "levels") return this.renderLevelsPage();
    if (this.state.page === "schedule") return this.renderSchedulePage();
    if (this.state.page === "instance") return this.renderInstancePage();
    if (this.state.page === "method") return this.renderMethodPage();
    return this.renderOverviewPage();
  }

  renderLevelsPage() {
    const ids = orderedScenarioIds(SCENARIO_CATALOG.map(({ id }) => id));
    return `<header class="page-head levels-hero"><h1>${escapeHtml(this.t("levels.title"))}</h1><p>${escapeHtml(this.t("levels.subtitle"))}</p></header>
      <section class="levels-grid" aria-label="${escapeHtml(this.t("levels.title"))}">${ids.map((id) => this.renderLevelCard(id)).join("")}</section>`;
  }

  renderLevelCard(id) {
    const scenario = getLocalizedScenario(id, this.state.locale);
    const stats = INSTANCE_STATS[scenario.recommendedDefaultInstance] || null;
    const instances = listScenarioInstances(id, this.state.locale);
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
          <img src="${escapeHtml(this.scenarioVisualUrl(scenario))}" alt="${escapeHtml(scenario.visualAlt)}" loading="lazy" decoding="async">
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
  }

  levelCardChips(id, stats) {
    const firstChip = id === "factory"
      ? this.t("levels.benchmarksChip", { count: this.fmt(SCENARIO_CATALOG.find(({ id: scenarioId }) => scenarioId === "factory")?.instanceMappings.length || 0) })
      : id === "ai"
        ? this.t("levels.workloadsChip", { count: this.fmt(SCENARIO_CATALOG.find(({ id: scenarioId }) => scenarioId === "ai")?.instanceMappings.length || 0) })
        : `${this.fmt(stats.n)} ${this.t("misc.jobs")}`;
    const chips = [
      firstChip,
      `${this.fmt(stats.families)} ${this.t("misc.families")}`,
      this.formatSpan(stats.horizon, id),
      this.t("levels.setupMeanChip", { value: this.fmt(stats.setupMean) }),
      this.t("levels.rejectionChip", { value: this.fmt(stats.rejRatio, { maximumFractionDigits: 1 }) }),
    ];
    return chips.map((chip) => `<span class="level-chip">${escapeHtml(chip)}</span>`).join("");
  }

  renderOverviewPage() {
    if (this.state.mode === "comparison" && this.state.comparisonResult) return this.renderComparisonOverview();
    const result = this.state.mode === "single" ? this.state.singleResult : null;
    const evaluation = result?.order ? evaluateSchedule(this.state.instance, result.order) : null;
    const hasResult = Boolean(result && evaluation);
    const title = hasResult ? this.t("overview.singleTitle") : this.t("overview.initialTitle");
    const subtitle = hasResult ? this.t("overview.singleSub") : this.t("overview.initialSub");
    let body = `${this.renderProblemBrief()}${this.renderExperimentGuide()}`;
    if (hasResult) {
      const reference = this.referenceCost();
      const cost = result.bestCost ?? result.cost;
      const gap = reference ? gapToReference(cost, reference) : null;
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
  }

  renderComparisonOverview() {
    const result = this.state.comparisonResult;
    const reference = this.referenceCost();
    const summary = summarizeRunComparison(result.runs, {
      ...(reference ? { referenceCost: reference } : {}),
      includeCheckpointBands: true,
    });
    const bestGap = reference ? gapToReference(summary.costs.min, reference) : null;
    const worstGap = reference ? gapToReference(summary.costs.max, reference) : null;
    const selected = this.activeRun();
    const selectedEvaluation = selected ? evaluateSchedule(this.state.instance, selected.order) : null;
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
  }

  renderRunPicker() {
    const runs = [...(this.state.comparisonResult?.runs || [])].sort((left, right) => left.seed - right.seed);
    if (!runs.length) return "";
    return `<label class="run-picker"><span>${escapeHtml(this.t("overview.inspectSeed"))}</span><select id="run-select">${runs.map((run) => `<option value="${run.seed}" ${run.seed === this.state.selectedRunSeed ? "selected" : ""}>Seed ${run.seed} · ${this.fmt(run.bestCost ?? run.cost)}</option>`).join("")}</select></label>`;
  }

  renderProblemBrief() {
    const instance = this.state.instance;
    if (!instance) return this.renderEmptyState();
    const scenario = this.scenario();
    const summary = instanceSummary(instance);
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
        <img src="${escapeHtml(this.scenarioVisualUrl(scenario))}" alt="${escapeHtml(scenario.visualAlt)}" decoding="async">
        <figcaption class="carousel-caption"><strong>${escapeHtml(scenario.name)}</strong><span>${escapeHtml(scenario.visualCaption)}</span></figcaption>
      </figure>
      <div class="problem-layout"><dl class="problem-facts">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      <div class="problem-story"><strong>${escapeHtml(instanceLabel)}</strong><p>${escapeHtml(instanceNote)}</p><p>${escapeHtml(scenario.objective.summary)}</p><h3>${escapeHtml(this.t("scenario.decisions"))}</h3><ol>${scenario.decisions.map((decision) => `<li>${escapeHtml(decision)}</li>`).join("")}</ol><button class="text-button" data-page="instance">${escapeHtml(this.t("actions.inspectInstance"))} →</button><button class="text-button" data-page="method">${escapeHtml(this.t("method.title"))} →</button></div></div>
    </section>`;
  }

  renderExperimentGuide() {
    return `<section class="experiment-guide"><div class="section-title-row"><h2>${escapeHtml(this.t("overview.experimentTitle"))}</h2><span class="section-note">${escapeHtml(this.t("overview.fairComparison"))}</span></div><div class="experiment-options">
      <button class="experiment-option" data-mode="single" aria-pressed="${this.state.mode === "single"}"><strong>${escapeHtml(this.t("overview.oneRunGuideTitle"))}</strong><span>${escapeHtml(this.t("overview.oneRunGuide"))}</span></button>
      <button class="experiment-option" data-mode="comparison" aria-pressed="${this.state.mode === "comparison"}"><strong>${escapeHtml(this.t("overview.compareGuideTitle"))}</strong><span>${escapeHtml(this.t("overview.compareGuide"))}</span></button>
    </div></section>`;
  }

  renderEmptyState() {
    return `<section class="empty-state"><div>${icons.empty}<h2>${escapeHtml(this.t("status.noResult"))}</h2><p>${escapeHtml(this.scenario().shortDescription)}</p></div></section>`;
  }

  metricStrip(metrics) {
    return `<div class="metric-strip">${metrics.map(([label, value, sub]) => `<div class="metric"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong>${sub ? `<small class="metric-sub">${escapeHtml(sub)}</small>` : ""}</div>`).join("")}</div>`;
  }

  renderObjective(breakdown) {
    const terms = this.scenario().objective.terms;
    const rows = [
      [sentenceLabel(terms.setup), breakdown.setup],
      [sentenceLabel(terms.execution), breakdown.execution],
      [sentenceLabel(terms.tardiness), breakdown.tardiness],
      [sentenceLabel(terms.rejection), breakdown.rejection],
    ];
    return `<div class="objective-list">${rows.map(([label, value]) => `<div class="objective-row"><i></i><span>${escapeHtml(label)}</span><strong>${this.fmt(value)}</strong></div>`).join("")}<div class="objective-row objective-total"><i></i><span>${escapeHtml(this.t("overview.total"))}</span><strong>${this.fmt(breakdown.total)}</strong></div></div>`;
  }

  summaryRow(label, value) {
    return `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

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
      <div class="data-table-wrap"><table class="data-table"><thead><tr>${["position", "job", "status", "family", "setupStart", "setupEnd", "processStart", "finish", "release", "due", "late", "setupCost", "executionCost", "tardinessCost", "rejectionCost"].map((key) => `<th>${escapeHtml(contextualHeaders[key] || this.t(`schedule.${key}`))}</th>`).join("")}</tr></thead><tbody>${tableRows || `<tr><td class="table-empty" colspan="15">${escapeHtml(this.t("schedule.noRows"))}</td></tr>`}</tbody></table></div>`;
  }

  /** Quick-switch bar: cycle scenarios, jump via dropdown, or swap instance. */
  renderScenarioSwitch() {
    const ids = orderedScenarioIds(SCENARIO_CATALOG.map(({ id }) => id));
    const currentIndex = Math.max(0, ids.indexOf(this.state.scenarioId));
    const previousId = ids[(currentIndex - 1 + ids.length) % ids.length];
    const nextId = ids[(currentIndex + 1) % ids.length];
    const scenario = this.scenario();
    const previousName = getLocalizedScenario(previousId, this.state.locale).name;
    const nextName = getLocalizedScenario(nextId, this.state.locale).name;
    const instances = listScenarioInstances(this.state.scenarioId, this.state.locale);
    const running = ["running", "paused"].includes(this.state.status);
    const disabled = running || this.state.status === "loading";
    const options = ids.map((id) => {
      const localized = getLocalizedScenario(id, this.state.locale);
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
  }

  /** Delta strip comparing the current instance with the pre-switch scenario. */
  renderDeltaStrip() {
    const previous = this.state.previousScenarioStats;
    const currentStats = INSTANCE_STATS[this.state.instanceId];
    if (!previous?.stats || !currentStats) return "";
    const previousScenario = getLocalizedScenario(previous.scenarioId, this.state.locale);
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
  }

  renderInstancePage() {
    const instance = this.state.instance;
    if (!instance) return this.renderEmptyState();
    const summary = instanceSummary(instance);
    const metadata = this.metadata();
    const vocabulary = this.scenario().vocabulary;
    const distributionDefinitions = [
      ["release", vocabulary.releaseTime, instance.jobs.map((job) => job.releaseTime)],
      ["due", vocabulary.dueDate, instance.jobs.map((job) => job.due)],
      ["processing", vocabulary.processingTime, instance.jobs.map((job) => job.processingTime)],
      ["rejection", vocabulary.rejectionCost, instance.jobs.map((job) => job.rejectionCost)],
      ["weight", vocabulary.tardinessWeight, instance.jobs.map((job) => job.weight)],
    ];
    const horizonMetric = summary.horizon >= 120
      ? `0–${this.fmt(summary.horizon)} min (${this.formatSpan(summary.horizon)})`
      : `0–${this.fmt(summary.horizon)} min`;
    return `<header class="page-head"><h1>${escapeHtml(this.t("instance.title"))}</h1><p>${escapeHtml(this.t("instance.sub"))}</p></header>
      ${this.renderScenarioSwitch()}
      ${this.renderDeltaStrip()}
      <div class="instance-metrics">
        ${[["jobs", summary.jobs], ["families", summary.families], ["horizon", horizonMetric], ["reference", metadata.referenceBest ? this.fmt(metadata.referenceBest) : this.t("misc.noReference")]].map(([key, value]) => `<div class="instance-metric"><span>${escapeHtml(this.t(`instance.${key}`))}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
      </div>
      <div class="section-title-row"><h2>${escapeHtml(this.t("instance.distributions"))}</h2><span class="section-note">${escapeHtml(this.state.instanceId)}</span></div>
      <div class="distribution-grid">${distributionDefinitions.map(([key, label]) => `<section class="mini-chart"><h3>${escapeHtml(sentenceLabel(label))}</h3><canvas id="hist-${key}" data-height="150"></canvas></section>`).join("")}</div>
      <div class="matrix-tabs" role="group"><button data-matrix="time" aria-pressed="${this.state.matrixKind === "time"}">${escapeHtml(this.t("instance.matrixTime"))}</button><button data-matrix="cost" aria-pressed="${this.state.matrixKind === "cost"}">${escapeHtml(this.t("instance.matrixCost"))}</button></div>
      <div class="chart-frame heatmap-scroll"><canvas id="setup-heatmap" data-height="520"></canvas><div class="chart-tooltip" hidden></div></div>
      <div class="section-title-row job-data-title"><h2>${escapeHtml(this.t("instance.jobData"))}</h2></div>
      ${this.renderJobParameters(instance)} `;
  }

  renderJobParameters(instance) {
    const vocabulary = this.scenario().vocabulary;
    const rows = instance.jobs.map((job) => `<tr><td>J${String(job.id + 1).padStart(2, "0")}</td><td class="family-cell" style="--family:${FAMILY_COLORS[job.family % FAMILY_COLORS.length]}">${job.family}</td><td>${this.fmt(job.releaseTime)}</td><td>${this.fmt(job.processingTime)}</td><td>${this.fmt(job.due)}</td><td>${this.fmt(job.hardDeadline)}</td><td>${this.fmt(job.weight)}</td><td>${this.fmt(job.processingCost)}</td><td>${this.fmt(job.rejectionCost)}</td></tr>`).join("");
    return `<div class="data-table-wrap"><table class="data-table" style="min-width:850px"><thead><tr><th>${escapeHtml(sentenceLabel(vocabulary.job))}</th><th>${escapeHtml(sentenceLabel(vocabulary.family))}</th><th>${escapeHtml(sentenceLabel(vocabulary.releaseTime))}</th><th>${escapeHtml(sentenceLabel(vocabulary.processingTime))}</th><th>${escapeHtml(sentenceLabel(vocabulary.dueDate))}</th><th>${escapeHtml(sentenceLabel(vocabulary.hardDeadline))}</th><th>${escapeHtml(sentenceLabel(vocabulary.tardinessWeight))}</th><th>${escapeHtml(sentenceLabel(vocabulary.executionCost))}</th><th>${escapeHtml(sentenceLabel(vocabulary.rejectionCost))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

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
  }

  renderBottomNav() {
    const items = [["levels", icons.grid], ["overview", icons.chart], ["schedule", icons.calendar]];
    return `<nav class="mobile-bottom-nav" aria-label="${escapeHtml(this.t("a11y.primary"))}">${items.map(([page, icon]) => `<button data-page="${page}" ${this.state.page === page ? 'aria-current="page"' : ""}>${icon}<span>${escapeHtml(this.t(`nav.${page}`))}</span></button>`).join("")}</nav>`;
  }

  renderMobileSheet() {
    return `<div class="mobile-sheet ${this.state.mobileMenu ? "open" : ""}" aria-hidden="${!this.state.mobileMenu}"><a href="${escapeHtml(this.options.sheetsCopyUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("links.sheets"))}</a><a href="${escapeHtml(this.options.sheetsDownloadUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("links.workbook"))}</a><a href="${escapeHtml(this.options.notebookUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("links.notebook"))}</a><a href="${escapeHtml(this.options.pythonUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("links.python"))}</a><a href="${escapeHtml(this.options.originalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("links.original"))}</a><a href="${escapeHtml(this.options.resultsUrl)}" target="_blank" rel="noreferrer">${escapeHtml(this.t("links.results"))}</a><button data-action="language">${this.state.locale === "en" ? "Português" : "English"}</button><button data-action="mobile-menu">${escapeHtml(this.t("actions.close"))}</button></div>`;
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
  }

  drawCharts() {
    this.chartCleanups.forEach((cleanup) => cleanup());
    this.chartCleanups = [];
    if (this.state.page === "overview") this.drawOverviewCharts();
    else if (this.state.page === "instance") this.drawInstanceCharts();
  }

  drawOverviewCharts() {
    const locale = this.state.locale;
    if (this.state.mode === "comparison" && this.state.comparisonResult) {
      const result = this.state.comparisonResult;
      const reference = this.referenceCost();
      const distributionCanvas = this.container.querySelector("#distribution-chart");
      if (distributionCanvas) {
        const hits = drawDistribution(distributionCanvas, result.runs, reference, { locale });
        this.chartCleanups.push(attachCanvasTooltip(distributionCanvas, hits, ({ run }) => `<strong>Seed ${run.seed}</strong><dl><dt>${escapeHtml(this.t("overview.best"))}</dt><dd>${this.fmt(run.bestCost)}</dd><dt>${escapeHtml(this.t("overview.gap"))}</dt><dd>${reference ? this.pct(gapToReference(run.bestCost, reference)) : "—"}</dd><dt>${escapeHtml(this.t("overview.evaluations"))}</dt><dd>${this.fmt(run.evaluations, { notation: "compact", maximumFractionDigits: 2 })}</dd></dl>`, {
          onSelect: ({ run }) => { this.state.selectedRunSeed = run.seed; this.render(); },
        }));
      }
      const bands = aggregateCheckpointBands(result.runs);
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
    const evaluation = evaluateSchedule(this.state.instance, result.order);
    const gantt = this.container.querySelector("#gantt-chart");
    if (gantt) this.bindGantt(gantt, evaluation, result);
    const convergence = this.container.querySelector("#convergence-chart");
    if (convergence) drawConvergence(convergence, result.checkpoints || this.state.liveCheckpoints, { locale });
  }

  bindGantt(canvas, evaluation) {
    const hits = drawGantt(canvas, evaluation, this.state.instance, { locale: this.state.locale });
    const vocabulary = this.scenario().vocabulary;
    this.chartCleanups.push(attachCanvasTooltip(canvas, hits, ({ row }) => `<strong>J${String(row.id + 1).padStart(2, "0")}</strong><dl><dt>${escapeHtml(sentenceLabel(vocabulary.family))}</dt><dd>${row.family}</dd><dt>${escapeHtml(sentenceLabel(vocabulary.releaseTime))}</dt><dd>${this.fmt(row.releaseTime)}</dd><dt>${escapeHtml(this.t("schedule.processStart"))}</dt><dd>${this.fmt(row.processStart)}</dd><dt>${escapeHtml(this.t("schedule.finish"))}</dt><dd>${this.fmt(row.finish)}</dd><dt>${escapeHtml(sentenceLabel(vocabulary.dueDate))}</dt><dd>${this.fmt(row.due)}</dd><dt>${escapeHtml(this.t("schedule.late"))}</dt><dd>${this.fmt(row.late)}</dd></dl>`));
  }

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
