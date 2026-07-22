/**
 * Headless smoke test for the Studio shell: mounts the real app against a
 * minimal DOM stub and the in-process loopback engine worker, then walks the
 * level-select flow (grid render, tier pick, quick-switch, delta strip).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { LoopbackWorker } from "../engine/harness.mjs";

class FakeElement {
  constructor() { this._innerHTML = ""; }
  set innerHTML(value) { this._innerHTML = String(value); }
  get innerHTML() { return this._innerHTML; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  removeEventListener() {}
  focus() {}
  replaceChildren() {}
}

// Browser surface stubs; must exist before app.js is imported.
globalThis.Element = FakeElement;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = () => 0;
globalThis.document = {
  querySelector: () => null,
  documentElement: { lang: "" },
};
globalThis.Worker = class extends LoopbackWorker {
  constructor() { super(); }
};

const { mountIGStudio } = await import("../../src/app.js");
const { SCENARIO_CATALOG, SCENARIO_TIME_SCALES } = await import("../../src/data/catalog.js");

test("studio boots into the level-select page and renders all 4 level cards", async (t) => {
  const container = new FakeElement();
  const app = mountIGStudio(container, {});
  t.after(async () => { await app.destroy(); });
  await app.ready;

  assert.equal(app.state.status, "ready");
  assert.equal(app.state.page, "levels");
  assert.equal(app.state.scenarioId, "factory");
  assert.equal(app.state.previousView, null);
  assert.equal(app.state.previousScenarioStats, null);

  const html = container.innerHTML;
  assert.equal((html.match(/class="level-card">/g) || []).length, 4);
  assert.equal((html.match(/level-ribbon/g) || []).length, 3);
  assert.equal((html.match(/class="mini-bars"/g) || []).length, 4);
  assert.match(html, /Choose the problem/);
  assert.match(html, /44 MaScLib benchmarks/);
  assert.match(html, /possible sequences/);
  assert.match(html, /⚡|🔥|🏔️/);
  // Every scenario exposes tier buttons; factory lists its 44 benchmarks.
  assert.equal((html.match(/data-level-pick="factory"/g) || []).length, 45);
  assert.match(html, /data-instance="3DPRINT_FARM_90"/);

  // pt-BR render of the same page.
  app.setLanguage("pt-BR");
  assert.match(container.innerHTML, /Escolha o problema/);
  assert.match(container.innerHTML, />novo</);
  assert.match(container.innerHTML, /sequências possíveis/);
  app.setLanguage("en");
});

test("level pick lands on the instance page with quick-switch and delta strip", async (t) => {
  const container = new FakeElement();
  const app = mountIGStudio(container, {});
  t.after(async () => { await app.destroy(); });
  await app.ready;

  // Emulate the card/tier click handler: pick the coffee L tier.
  app.state.previousView = null;
  await app.selectScenario("coffee", { render: false, instanceId: "COFFEE_L_180" });
  app.state.page = "instance";
  app.render();

  assert.equal(app.state.scenarioId, "coffee");
  assert.equal(app.state.instanceId, "COFFEE_L_180");
  assert.equal(app.state.page, "instance");
  assert.equal(app.state.previousView, null);
  assert.equal(app.state.previousScenarioStats?.scenarioId, "factory");

  const html = container.innerHTML;
  assert.match(html, /class="scenario-switch"/);
  assert.match(html, /id="scenario-select"/);
  assert.match(html, /id="switch-instance-select"/);
  assert.match(html, /class="delta-strip"/);
  assert.match(html, /vs CNC factory:/);
  // +105 jobs (180 vs 75), humanized horizon delta, neutral arrows only.
  assert.match(html, /\+105 jobs/);
  assert.match(html, /▲|▼/);
  assert.doesNotMatch(html, /#0a0|#d00/);
  // Humanized window inside the instance metric (5,760 min = eight 12-hour days).
  assert.match(html, /8 days \(5,760 min\)/);

  // Switching instance within the same scenario keeps the same comparison.
  await app.selectInstance("COFFEE_S_45");
  assert.equal(app.state.previousScenarioStats?.scenarioId, "factory");
  assert.match(container.innerHTML, /vs CNC factory:/);

  // A second scenario switch replaces the comparison reference.
  await app.selectScenario("brewery");
  assert.equal(app.state.previousScenarioStats?.scenarioId, "coffee");
  assert.equal(app.state.instanceId, "BREWERY_M_90");
  assert.match(container.innerHTML, /vs Coffee roastery:/);

  // Prev/next arrows cycle the fixed level order (coffee → brewery).
  const { orderedScenarioIds } = await import("../../src/levels.js");
  const ids = orderedScenarioIds(SCENARIO_CATALOG.map(({ id }) => id));
  assert.equal(ids[ids.indexOf("coffee") + 1], "brewery");
  assert.ok(SCENARIO_TIME_SCALES.coffee.dayLength > 0);
});

test("quick-switch navigation and run flow stay intact after the additions", async (t) => {
  const container = new FakeElement();
  const app = mountIGStudio(container, {});
  t.after(async () => { await app.destroy(); });
  await app.ready;

  // Overview still renders the problem brief for the current selection.
  app.state.page = "overview";
  app.render();
  assert.match(container.innerHTML, /problem-brief/);
  assert.match(container.innerHTML, /CNC factory/);

  // A small real single-seed run through the app state machine.
  await app.selectScenario("print3d", { render: false });
  app.state.page = "overview";
  app.state.iterationBudget = 120;
  await app.startRun();
  const deadline = Date.now() + 10_000;
  while (app.state.status !== "complete" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(app.state.status, "complete");
  assert.ok(app.state.singleResult?.order?.length > 0);
  assert.match(container.innerHTML, /gantt-chart/);

  // Schedule page renders from the completed run.
  app.state.page = "schedule";
  app.render();
  assert.match(container.innerHTML, /data-table/);
  assert.match(container.innerHTML, /J01/);
});

test("order explorer renders order codes, humanized cells and sorts columns", async (t) => {
  const container = new FakeElement();
  const app = mountIGStudio(container, {});
  t.after(async () => { await app.destroy(); });
  await app.ready;

  await app.selectScenario("print3d", { render: false });
  app.state.page = "instance";
  app.render();

  const codesOf = (source) => [...source.matchAll(/<td>(ORD-\d+)<\/td>/g)].map((match) => match[1]);
  let html = container.innerHTML;
  assert.match(html, /class="data-table explorer-table"/);
  assert.match(html, /ORD-1001/);
  assert.match(html, /aria-sort="ascending"/); // default: order code ascending
  assert.match(html, /\(h\)/); // processing-time unit in the header
  assert.match(html, />PLA</); // localized family chip name
  assert.match(html, /R\$ [\d.,]+\/dia/); // tardiness weight converted to R$/dia
  assert.match(html, /day \d+, \d{2}:\d{2}/); // scenario-calendar timestamps
  assert.match(html, /data-help-toggle/); // per-column help from vocabularyHelp
  assert.equal(codesOf(html)[0], "ORD-1001");

  // Sort by due date, descending: the first row must be the max-due order.
  app.state.explorerSort = { key: "dueDate", direction: "desc" };
  app.render();
  html = container.innerHTML;
  assert.match(html, /aria-sort="descending"/);
  const latest = [...app.state.instance.jobs].sort((left, right) => right.due - left.due || left.id - right.id)[0];
  assert.equal(codesOf(html)[0], `ORD-${1001 + latest.id}`);

  // Toggling the same column flips the direction back.
  app.state.explorerSort = { key: "dueDate", direction: "asc" };
  app.render();
  const soonest = [...app.state.instance.jobs].sort((left, right) => left.due - right.due || left.id - right.id)[0];
  assert.equal(codesOf(container.innerHTML)[0], `ORD-${1001 + soonest.id}`);

  // Coffee M: several promised dates pass the 2,880-min window → flag chip.
  await app.selectScenario("coffee", { render: false });
  app.state.page = "instance";
  app.state.explorerSort = { key: "job", direction: "asc" };
  app.render();
  html = container.innerHTML;
  assert.match(html, /PED-2401/);
  assert.match(html, /beyond the window/);
  assert.match(html, /4 days \(2,880 min\)/); // window metric: four 12-hour roast days

  // pt-BR explorer rendering keeps the same codes and adds localized labels.
  app.setLanguage("pt-BR");
  html = container.innerHTML;
  assert.match(html, /além da janela/);
  assert.match(html, /dia \d+, \d{2}:\d{2}/);
  assert.match(html, /R\$ [\d.,]+\/dia/);
  assert.match(html, /4 dias de torra \(2\.880 min\)/);
  app.setLanguage("en");

  // The factory benchmark has no order spec: classic J labels, no flags.
  await app.selectScenario("factory", { render: false });
  app.state.page = "instance";
  app.render();
  assert.match(container.innerHTML, /<td>J01<\/td>/);
  assert.doesNotMatch(container.innerHTML, /ORD-|PED-|LOTE-/);
});

test("schedule page shows the final-analysis panel after a single-seed run", async (t) => {
  const container = new FakeElement();
  const app = mountIGStudio(container, {});
  t.after(async () => { await app.destroy(); });
  await app.ready;

  await app.selectScenario("print3d", { render: false, instanceId: "3DPRINT_FARM_45" });
  app.state.iterationBudget = 120;
  await app.startRun();
  const deadline = Date.now() + 10_000;
  while (app.state.status !== "complete" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(app.state.status, "complete");

  app.state.page = "schedule";
  app.render();
  const html = container.innerHTML;
  assert.match(html, /class="final-analysis"/);
  assert.match(html, /Final analysis/);
  assert.match(html, /First come, first served/);
  assert.match(html, /By promised date/);
  assert.match(html, /Batch by family/);
  assert.match(html, /Optimizer \(this solution\)/);
  assert.match(html, /family blocks for 6 families/);
  assert.match(html, /busy \d+% of the window/);
  assert.match(html, /vs optimizer/);

  // Comparison mode hides the panel.
  app.state.mode = "comparison";
  app.render();
  assert.doesNotMatch(container.innerHTML, /class="final-analysis"/);
});
