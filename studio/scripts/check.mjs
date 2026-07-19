#!/usr/bin/env node
/**
 * Dependency-free structural checks for IG Studio.
 *
 * These checks deliberately do not execute the browser entry module. They
 * verify its complete static module graph, then inspect the embedded solver
 * payload and the public catalog contract directly.
 */
import { execFile } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(here, "..");
const sourceRoot = path.join(studioRoot, "src");
const entryPath = path.join(sourceRoot, "app.js");
const payloadPath = path.join(sourceRoot, "generated", "engine-payload.js");
const sourceHtmlPath = path.join(studioRoot, "index.html");
const packagePath = path.join(studioRoot, "package.json");
const sceneAssetRoot = path.join(studioRoot, "assets", "scenarios");

export const SCENE_ASSET_FILES = Object.freeze({
  factory: "factory-cnc.webp",
  ai: "ai-server.webp",
  kitchen: "restaurant-kitchen.webp",
  surgery: "surgery-center.webp",
});
export const MAX_SCENE_ASSET_BYTES = 256 * 1024;

const RELATIVE_SPECIFIER = /^\.{1,2}\//;
const WEB_OR_DATA_SPECIFIER = /^(?:https?:|data:|blob:|\/\/)/i;
const IMPORT_PATTERNS = [
  /^[ \t]*import\s+(?:[\s\S]*?\s+from\s+)?(["'])([^"'\r\n]+)\1\s*;?/gm,
  /^[ \t]*export\s+(?:\*|\{[\s\S]*?\})\s+(?:as\s+\w+\s+)?from\s*(["'])([^"'\r\n]+)\1\s*;?/gm,
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function collectFiles(directory, predicate, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(absolute, predicate, output);
    else if (predicate(absolute)) output.push(absolute);
  }
  return output;
}

export function staticSpecifiers(source) {
  const found = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
      found.add(match[2]);
    }
  }
  return [...found];
}

async function assertExists(filename, context) {
  try {
    await access(filename);
  } catch {
    throw new Error(`${context}: missing ${path.relative(studioRoot, filename)}`);
  }
}

async function validateSyntax(files) {
  await Promise.all(files.map(async (filename) => {
    try {
      await execFileAsync(process.execPath, ["--check", filename], {
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (error) {
      const detail = error.stderr || error.stdout || error.message;
      throw new Error(`JavaScript syntax check failed for ${path.relative(studioRoot, filename)}\n${detail}`);
    }
  }));
}

async function validateImportBoundaries(files) {
  let importCount = 0;
  for (const filename of files) {
    const source = await readFile(filename, "utf8");
    for (const specifier of staticSpecifiers(source)) {
      importCount += 1;
      invariant(!WEB_OR_DATA_SPECIFIER.test(specifier),
        `${path.relative(studioRoot, filename)} imports a web/data resource: ${specifier}`);
      if (specifier.startsWith("node:")) {
        invariant(!filename.startsWith(sourceRoot + path.sep),
          `Browser source imports Node.js: ${path.relative(studioRoot, filename)} -> ${specifier}`);
        continue;
      }
      invariant(RELATIVE_SPECIFIER.test(specifier),
        `Bare package import is not allowed: ${path.relative(studioRoot, filename)} -> ${specifier}`);
      const resolved = path.resolve(path.dirname(filename), specifier);
      await assertExists(resolved, `Import from ${path.relative(studioRoot, filename)}`);
      if (filename.startsWith(sourceRoot + path.sep)) {
        invariant(resolved.startsWith(sourceRoot + path.sep),
          `Browser module escapes studio/src: ${path.relative(studioRoot, filename)} -> ${specifier}`);
        invariant(path.extname(resolved) === ".js",
          `Browser module imports a non-JavaScript runtime asset: ${specifier}`);
      }
    }
  }
  return importCount;
}

async function browserModuleGraph(entry) {
  const visited = new Set();
  const active = new Set();

  async function visit(filename) {
    const absolute = path.resolve(filename);
    if (visited.has(absolute)) return;
    invariant(!active.has(absolute), `Circular browser import at ${path.relative(studioRoot, absolute)}`);
    active.add(absolute);
    const source = await readFile(absolute, "utf8");
    for (const specifier of staticSpecifiers(source)) {
      invariant(RELATIVE_SPECIFIER.test(specifier),
        `Browser graph contains a non-relative import: ${specifier}`);
      const dependency = path.resolve(path.dirname(absolute), specifier);
      invariant(dependency.startsWith(sourceRoot + path.sep),
        `Browser graph escapes studio/src: ${specifier}`);
      await assertExists(dependency, `Browser graph from ${path.relative(studioRoot, absolute)}`);
      await visit(dependency);
    }
    active.delete(absolute);
    visited.add(absolute);
  }

  await visit(entry);
  return visited;
}

async function validateOfflineContract(browserFiles) {
  const source = (await Promise.all([...browserFiles].map((filename) => readFile(filename, "utf8")))).join("\n");
  const html = await readFile(sourceHtmlPath, "utf8");
  const css = await readFile(path.join(sourceRoot, "styles.css"), "utf8");
  const forbiddenRuntimeApis = [
    ["fetch", /\bfetch\s*\(/],
    ["XMLHttpRequest", /\bXMLHttpRequest\b/],
    ["WebSocket", /\bWebSocket\b/],
    ["EventSource", /\bEventSource\b/],
    ["importScripts", /\bimportScripts\s*\(/],
  ];
  const forbiddenFileInputs = [
    ["file input", /<input\b[^>]*\btype\s*=\s*["']?file\b/i],
    ["FileReader", /\bFileReader\b/],
    ["file picker", /\bshowOpenFilePicker\b/],
  ];

  for (const [name, pattern] of forbiddenRuntimeApis) {
    invariant(!pattern.test(source), `Offline runtime contract violated by ${name}`);
  }
  for (const [name, pattern] of forbiddenFileInputs) {
    invariant(!pattern.test(`${html}\n${source}`), `Fixed-catalog contract violated by ${name}`);
  }
  invariant(!/\bhttps?:\/\//i.test(source), "Browser modules contain an external URL");
  invariant(!/@import\b|url\s*\(/i.test(css),
    "Stylesheet must not import or load any runtime asset");
  invariant(!/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(html),
    "Source HTML references an external runtime asset");
  invariant(/<link\s+rel=["']stylesheet["']\s+href=["']\.\/src\/styles\.css["']/.test(html),
    "Source HTML must load the local Studio stylesheet");
  invariant(/<script\s+type=["']module["']\s+src=["']\.\/src\/app\.js["']/.test(html),
    "Source HTML must load the local Studio entry module");
}

async function validateCatalogAndPayload() {
  const [{ IG_ENGINE_PAYLOAD }, catalogModule] = await Promise.all([
    import(`${pathToFileURL(payloadPath).href}?check=${Date.now()}`),
    import(`${pathToFileURL(path.join(sourceRoot, "data", "catalog.js")).href}?check=${Date.now()}`),
  ]);
  const wasm = Buffer.from(IG_ENGINE_PAYLOAD.wasmBase64, "base64");
  invariant(wasm.length > 8, "Embedded WebAssembly payload is empty");
  invariant(wasm.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])),
    "Embedded engine payload does not start with the WebAssembly magic bytes");

  let packedCatalog;
  try {
    packedCatalog = JSON.parse(gunzipSync(Buffer.from(
      IG_ENGINE_PAYLOAD.catalogGzipBase64,
      "base64",
    )).toString("utf8"));
  } catch (error) {
    throw new Error(`Embedded catalog cannot be decoded: ${error.message}`);
  }

  const payloadIds = Object.keys(packedCatalog).sort();
  const publicIds = catalogModule.INSTANCE_CATALOG.map(({ id }) => id).sort();
  invariant(payloadIds.length === 53,
    `Fixed catalog must contain 53 bundled instances; found ${payloadIds.length}`);
  invariant(JSON.stringify(payloadIds) === JSON.stringify(publicIds),
    "Public instance catalog and embedded solver catalog do not match");
  invariant(catalogModule.SCENARIO_CATALOG.length === 4,
    "Studio must expose exactly four fixed scenario interpretations");

  const expectedAssetFiles = Object.values(SCENE_ASSET_FILES).sort();
  const presentAssetFiles = (await readdir(sceneAssetRoot))
    .filter((filename) => path.extname(filename).toLowerCase() === ".webp")
    .sort();
  invariant(JSON.stringify(presentAssetFiles) === JSON.stringify(expectedAssetFiles),
    `Scenario asset pack must contain exactly: ${expectedAssetFiles.join(", ")}`);

  const assetKeys = [];
  let sceneAssetBytes = 0;

  for (const scenario of catalogModule.SCENARIO_CATALOG) {
    invariant(scenario.instanceMappings.length > 0, `Scenario ${scenario.id} has no fixed instances`);
    invariant(scenario.instanceMappings.some(({ instanceId }) => instanceId === scenario.recommendedDefaultInstance),
      `Scenario ${scenario.id} default is not in its fixed mappings`);
    invariant(scenario.content.en && scenario.content["pt-BR"],
      `Scenario ${scenario.id} must include EN and PT-BR descriptions`);
    invariant(scenario.visual && typeof scenario.visual.assetKey === "string",
      `Scenario ${scenario.id} has no visual asset key`);
    invariant(Object.hasOwn(SCENE_ASSET_FILES, scenario.visual.assetKey),
      `Scenario ${scenario.id} references an unknown visual asset: ${scenario.visual.assetKey}`);
    assetKeys.push(scenario.visual.assetKey);
    for (const locale of ["en", "pt-BR"]) {
      invariant(typeof scenario.content[locale].visualAlt === "string"
        && scenario.content[locale].visualAlt.trim().length > 0,
      `Scenario ${scenario.id} has no ${locale} visual alt text`);
      invariant(typeof scenario.content[locale].visualCaption === "string"
        && scenario.content[locale].visualCaption.trim().length > 0,
      `Scenario ${scenario.id} has no ${locale} visual caption`);
    }
    for (const { instanceId } of scenario.instanceMappings) {
      invariant(Object.hasOwn(packedCatalog, instanceId),
        `Scenario ${scenario.id} references a missing embedded instance: ${instanceId}`);
    }
  }

  invariant(new Set(assetKeys).size === Object.keys(SCENE_ASSET_FILES).length,
    "Each Studio scenario must use one distinct visual asset");

  for (const [assetKey, filename] of Object.entries(SCENE_ASSET_FILES)) {
    const bytes = await readFile(path.join(sceneAssetRoot, filename));
    invariant(bytes.length > 12, `Scenario asset ${assetKey} is empty`);
    invariant(bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP",
    `Scenario asset ${assetKey} is not a valid WebP container`);
    invariant(bytes.length <= MAX_SCENE_ASSET_BYTES,
      `Scenario asset ${assetKey} exceeds ${MAX_SCENE_ASSET_BYTES} bytes`);
    sceneAssetBytes += bytes.length;
  }

  for (const [id, item] of Object.entries(packedCatalog)) {
    invariant(typeof item.csv === "string" && item.csv.trim().length > 0,
      `Embedded instance ${id} has no CSV data`);
  }

  return {
    catalogEntries: payloadIds.length,
    scenarios: catalogModule.SCENARIO_CATALOG.length,
    wasmBytes: wasm.length,
    catalogGzipBytes: Buffer.from(IG_ENGINE_PAYLOAD.catalogGzipBase64, "base64").length,
    sceneAssets: Object.keys(SCENE_ASSET_FILES).length,
    sceneAssetBytes,
  };
}

async function validatePackageAndLinks() {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  invariant(!packageJson.dependencies && !packageJson.devDependencies,
    "IG Studio must stay dependency-free");

  const appSource = await readFile(entryPath, "utf8");
  const relativeLinks = {
    notebookUrl: "./notebooks/iterated-greedy-experiments.ipynb",
    pythonUrl: "../python/README.md",
    sheetsUrl: "../google-sheets/README.md",
    sheetsCopyUrl: "../google-sheets/README.md",
    sheetsDownloadUrl: "../google-sheets/dist/ig-scheduling-lab.xlsx",
    originalUrl: "../README.md",
    resultsUrl: "../RESULTS.md",
  };
  for (const [option, relativePath] of Object.entries(relativeLinks)) {
    invariant(appSource.includes(`${option}: ${JSON.stringify(relativePath)}`),
      `Source ${option} link must be ${relativePath}`);
    await assertExists(path.resolve(studioRoot, relativePath), `${option} link`);
  }
}

export async function runChecks({ quiet = false } = {}) {
  const moduleFiles = (await collectFiles(studioRoot,
    (filename) => /\.(?:js|mjs)$/.test(filename))).sort();
  await validateSyntax(moduleFiles);
  const importCount = await validateImportBoundaries(moduleFiles);
  const graph = await browserModuleGraph(entryPath);
  await validateOfflineContract(graph);
  const payload = await validateCatalogAndPayload();
  await validatePackageAndLinks();

  const report = {
    syntaxModules: moduleFiles.length,
    staticImports: importCount,
    browserModules: graph.size,
    ...payload,
    externalRuntimeDependencies: 0,
    fileImportPaths: 0,
  };
  if (!quiet) {
    console.log("IG Studio checks passed");
    for (const [key, value] of Object.entries(report)) console.log(`  ${key}: ${value}`);
  }
  return report;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  runChecks().catch((error) => {
    console.error(`IG Studio check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
