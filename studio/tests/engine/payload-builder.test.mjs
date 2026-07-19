import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { WorkerHarness } from './harness.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('payload builder embeds the WASM and compressed fixed catalog without touching docs', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ig-engine-payload-'));
  const output = path.join(directory, 'payload.mjs');
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      path.join(root, 'studio', 'scripts', 'build-engine-payload.mjs'),
      `--out=${output}`,
    ], { cwd: root });
    const report = JSON.parse(stdout.trim());
    assert.equal(report.catalogEntries, 53);
    assert.ok(report.wasmBytes > 80_000);
    assert.ok(report.catalogGzipBytes < 80_000);

    const { IG_ENGINE_PAYLOAD } = await import(`${pathToFileURL(output).href}?test=1`);
    assert.ok(IG_ENGINE_PAYLOAD.wasmBase64.length > 100_000);
    const harness = new WorkerHarness({
      decompressCatalog: (bytes) => JSON.parse(gunzipSync(bytes).toString('utf8')),
    });
    const initialized = await harness.command('init', {
      wasm: IG_ENGINE_PAYLOAD.wasmBase64,
      catalogGzipBase64: IG_ENGINE_PAYLOAD.catalogGzipBase64,
    });
    assert.equal(initialized.ok, true, initialized.error && initialized.error.message);
    assert.equal(initialized.result.catalog.length, 53);
    const selected = await harness.command('select-instance', { name: 'GPU_HEAVY_120' });
    assert.equal(selected.result.instance.n, 120);
    const surgery = await harness.command('select-instance', { name: 'SURGERY_BLOCK_90' });
    assert.equal(surgery.result.instance.n, 90);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
