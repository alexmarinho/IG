#!/usr/bin/env node
/**
 * Produce docs/studio-app.html: the standalone Studio build plus the hosted
 * shell block the homepage iframe expects (IG_STUDIO_CONFIG globals reading
 * ?lang=, and the #ig-hosted-shell style that hides the in-app chrome).
 *
 * The block was extracted verbatim from the hand-maintained artifact; keep it
 * byte-identical (1137 bytes) so the homepage contract never drifts.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const distPath = path.join(repoRoot, "studio", "dist", "index.html");
const outputPath = path.join(repoRoot, "docs", "studio-app.html");

const HOSTED_BLOCK = `<script>globalThis.IG_STUDIO_CONFIG={language:(new URLSearchParams(location.search).get("lang")||"en"),pythonUrl:"https://github.com/alexmarinho/IG/tree/master/python",notebookUrl:"https://colab.research.google.com/github/alexmarinho/IG/blob/master/studio/notebooks/iterated-greedy-experiments.ipynb",resultsUrl:"https://github.com/alexmarinho/IG/blob/master/RESULTS.md",originalUrl:"https://github.com/alexmarinho/IG/tree/master/legacy"};</script><style id="ig-hosted-shell">:root{--header:0px}.topbar{display:none!important}.control-rail::before{display:none!important}html,body{background-color:#f6f1e8!important;background-image:none!important}.body-grid{min-height:100vh;background:transparent}.workspace{background:transparent}.control-rail{top:0;min-height:100vh;max-height:100vh;padding-left:20px!important;background-color:transparent!important;background-image:none!important;border-right:1px solid #e2d9c8}.rail-modes{position:sticky;top:0;z-index:5;margin:0 0 18px;padding:12px 0 10px;background:#f6f1e8}@media(max-width:760px){.control-rail{min-height:0;max-height:none;padding-left:14px}.mobile-sheet.open{inset:0}}</style>`;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

invariant(Buffer.byteLength(HOSTED_BLOCK) === 1137, "Hosted shell block must stay exactly 1137 bytes");

const dist = await readFile(distPath, "utf8");
invariant(!dist.includes('id="ig-hosted-shell"'), "dist already contains the hosted shell block");
/* Append, don't prepend: only `.topbar` and the rail spine carry !important, so
 * at the top of <head> every other hosted rule lost the cascade to the app's own
 * stylesheet — `--header:0px` never applied and the rail kept a 82px offset and
 * a 82px-short height inside the iframe. The head holds no <script>, so the
 * IG_STUDIO_CONFIG assignment still runs before the app module in <body>. */
const marker = "</head>";
const at = dist.indexOf(marker);
invariant(at >= 0, "dist document has no </head> tag");
invariant(!dist.slice(0, at).includes("<script"), "a <script> appeared in <head>: hosted config must still run first");
const html = `${dist.slice(0, at)}${HOSTED_BLOCK}${dist.slice(at)}`;
await writeFile(outputPath, html);
console.log(`Hosted Studio written: ${path.relative(repoRoot, outputPath)} (${html.length} chars, +${Buffer.byteLength(HOSTED_BLOCK)} hosted bytes)`);
