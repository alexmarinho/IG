import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INSTANCE_BY_ID } from "../../src/data/catalog.js";
import { evaluateSchedule, instanceSummary, parseMasclib } from "../../src/data/instance.js";
import { IG_ENGINE_PAYLOAD } from "../../src/generated/engine-payload.js";
import { IGEngineClient } from "../../src/engine/index.js";
import { LoopbackWorker } from "../engine/harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const rawCatalog = JSON.parse(gunzipSync(Buffer.from(IG_ENGINE_PAYLOAD.catalogGzipBase64, "base64")));

test("every embedded fixed instance parses into the advertised job count", () => {
  assert.equal(Object.keys(rawCatalog).length, 53);
  for (const [id, entry] of Object.entries(rawCatalog)) {
    const instance = parseMasclib(entry.csv, id);
    assert.equal(instance.n, INSTANCE_BY_ID[id].jobCount, id);
    assert.equal(instance.jobsById.size, instance.n, id);
    assert.ok(instance.familyCount >= 1, id);
    const summary = instanceSummary(instance);
    assert.ok(summary.processing.min >= 0, id);
    assert.ok(summary.processing.max >= summary.processing.min, id);
  }
});

test("the browser-side objective decomposition closes against a real WASM run", async () => {
  const id = "NCOS_01";
  const wasm = await readFile(path.join(root, "engine", "target", "wasm32-unknown-unknown", "release", "ig_core.wasm"));
  const client = new IGEngineClient({ worker: new LoopbackWorker() });
  await client.init({ wasm, catalog: { [id]: rawCatalog[id] } });
  await client.selectInstance(id);
  await client.configure({ seed: 13, iterationBudget: 200, checkpointEvery: 20, d: 2, accept: "current", permute: true });
  const { result } = await client.runSingle();
  const instance = parseMasclib(rawCatalog[id].csv, id);
  const evaluation = evaluateSchedule(instance, result.order);
  assert.equal(evaluation.breakdown.total, result.bestCost);
  assert.equal(evaluation.scheduledCount + evaluation.rejectedCount, instance.n);
  assert.ok(evaluation.rows.every((row) => row.feasible));
  assert.ok(evaluation.rows.every((row) => row.setupEnd === row.setupStart + row.setupTime
    && row.setupEnd === row.processStart));
  await client.dispose();
});
