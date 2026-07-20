#!/usr/bin/env node
/** Build IG Studio as one offline, self-contained HTML document. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runChecks, SCENE_ASSET_FILES, STYLE_PARTS, staticSpecifiers, stylesRoot } from "./check.mjs";
import { SCENE_ASSET_DATA } from "../src/generated/scene-assets/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(here, "..");
const sourceRoot = path.join(studioRoot, "src");
const entryPath = path.join(sourceRoot, "app.js");
const outputPath = path.join(studioRoot, "dist", "index.html");
const sceneAssetRoot = path.join(studioRoot, "assets", "scenarios");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Recursively turn every local module into a data URL. The browser still gets
 * native ES modules, while the resulting document has no runtime file loads.
 */
async function embedModuleGraph(entry) {
  const cache = new Map();
  const active = new Set();

  async function embed(filename) {
    const absolute = path.resolve(filename);
    if (cache.has(absolute)) return cache.get(absolute);
    invariant(!active.has(absolute), `Circular module import at ${path.relative(studioRoot, absolute)}`);
    invariant(absolute.startsWith(sourceRoot + path.sep),
      `Runtime module escapes studio/src: ${path.relative(studioRoot, absolute)}`);
    active.add(absolute);

    let source = await readFile(absolute, "utf8");
    const specifiers = staticSpecifiers(source);
    for (const specifier of specifiers) {
      invariant(/^\.{1,2}\//.test(specifier),
        `Runtime module has a non-relative import: ${specifier}`);
      const dependency = path.resolve(path.dirname(absolute), specifier);
      const dependencyUrl = await embed(dependency);
      const quoted = JSON.stringify(dependencyUrl);
      source = source
        .replaceAll(JSON.stringify(specifier), quoted)
        .replaceAll(`'${specifier}'`, quoted);
    }

    active.delete(absolute);
    const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
    cache.set(absolute, url);
    return url;
  }

  return { entryUrl: await embed(entry), modules: cache.size };
}

/**
 * Inline the scenario artwork. The committed generated modules carry the
 * canonical data URIs; the local .webp files are only a fallback for keys
 * missing from the generated pack (e.g. artwork being re-authored).
 */
async function embedSceneAssets() {
  const entries = await Promise.all(Object.entries(SCENE_ASSET_FILES)
    .map(async ([assetKey, filename]) => {
      const generated = SCENE_ASSET_DATA[assetKey];
      if (typeof generated === "string" && generated.startsWith("data:image/")) {
        return [assetKey, generated];
      }
      const bytes = await readFile(path.join(sceneAssetRoot, filename));
      return [assetKey, `data:image/webp;base64,${bytes.toString("base64")}`];
    }));
  return Object.fromEntries(entries);
}

async function build() {
  const checks = await runChecks({ quiet: true });
  const [sourceHtml, cssParts, bundle, sceneAssets] = await Promise.all([
    readFile(path.join(studioRoot, "index.html"), "utf8"),
    // Concatenate the stylesheet parts in the fixed cascade order — the dist
    // inline must behave exactly like the dev <link> sequence in index.html.
    Promise.all(STYLE_PARTS.map((part) => readFile(path.join(stylesRoot, part), "utf8"))),
    embedModuleGraph(entryPath),
    embedSceneAssets(),
  ]);
  const css = cssParts.join("\n");

  const links = {
    pythonUrl: "https://github.com/alexmarinho/IG/tree/master/python",
    notebookUrl: "https://colab.research.google.com/github/alexmarinho/IG/blob/master/studio/notebooks/iterated-greedy-experiments.ipynb",
    notebookUrls: {
      en: "https://colab.research.google.com/github/alexmarinho/IG/blob/master/studio/notebooks/iterated-greedy-experiments.ipynb",
      "pt-BR": "https://colab.research.google.com/github/alexmarinho/IG/blob/master/studio/notebooks/iterated-greedy-experiments-pt-br.ipynb",
    },
    sheetsUrl: "https://docs.google.com/spreadsheets/d/18i8zJqT0W6P8xcN1sn6NW0KjdEFYrAJm9zcVqb8fOXg/edit?usp=sharing",
    sheetsCopyUrl: "https://docs.google.com/spreadsheets/d/18i8zJqT0W6P8xcN1sn6NW0KjdEFYrAJm9zcVqb8fOXg/copy",
    sheetsDownloadUrl: "https://github.com/alexmarinho/IG/raw/refs/heads/master/google-sheets/dist/ig-scheduling-lab.xlsx",
    originalUrl: "https://github.com/alexmarinho/IG/tree/master/legacy",
    resultsUrl: "https://github.com/alexmarinho/IG/blob/master/RESULTS.md",
  };
  const config = { ...links, sceneAssets };
  const inlineStyle = `<style data-ig-studio-styles>\n${css.replaceAll("</style", "<\\/style")}\n</style>`;
  const inlineConfig = `<script data-ig-studio-config>\n`+
    `globalThis.IG_STUDIO_CONFIG = { ...${JSON.stringify(config)}, ...(globalThis.IG_STUDIO_CONFIG || {}) };\n`+
    `</script>`;
  const inlineEntry = `<script type="module" data-ig-studio-bundle>\n`+
    `import ${JSON.stringify(bundle.entryUrl)};\n`+
    `</script>`;

  // The first stylesheet link becomes the inline <style>; the rest go away.
  let inlinedStyles = false;
  let html = sourceHtml.replace(
    /<link\s+rel=["']stylesheet["']\s+href=["']\.\/src\/styles\/[a-z-]+\.css["']\s*\/?>/g,
    () => {
      if (inlinedStyles) return "";
      inlinedStyles = true;
      return inlineStyle;
    },
  );
  invariant(inlinedStyles, "Build found no Studio stylesheet part link to inline");
  html = html.replace(
    /<script\s+type=["']module["']\s+src=["']\.\/src\/app\.js["']\s*><\/script>/,
    `${inlineConfig}\n  ${inlineEntry}`,
  );

  invariant(html !== sourceHtml, "Build did not inline the Studio source assets");
  invariant(!/<script\b[^>]*\bsrc\s*=/i.test(html), "Standalone HTML still has a script src");
  invariant(!/<link\b[^>]*\brel\s*=\s*["']stylesheet["']/i.test(html),
    "Standalone HTML still has a stylesheet link");
  invariant(!/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(html),
    "Standalone HTML contains an external runtime asset");

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html);
  const bytes = Buffer.byteLength(html);
  const sha256 = createHash("sha256").update(html).digest("hex");
  console.log("IG Studio standalone built");
  console.log(`  output: ${path.relative(path.resolve(studioRoot, ".."), outputPath)}`);
  console.log(`  bytes: ${bytes}`);
  console.log(`  sha256: ${sha256}`);
  console.log(`  embeddedModules: ${bundle.modules}`);
  console.log(`  catalogEntries: ${checks.catalogEntries}`);
  console.log(`  sceneAssets: ${checks.sceneAssets} (${checks.sceneAssetBytes} source bytes)`);
  console.log("  externalRuntimeAssets: 0");
}

build().catch((error) => {
  console.error(`IG Studio build failed: ${error.message}`);
  process.exitCode = 1;
});
