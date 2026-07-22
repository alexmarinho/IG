#!/usr/bin/env node
/** Build a flat, clasp-ready Apps Script deployment directory. */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sheetsRoot = path.resolve(here, '..');
const source = path.join(sheetsRoot, 'apps-script');
const output = path.join(sheetsRoot, 'dist', 'apps-script');
const singleOutput = path.join(sheetsRoot, 'dist', 'apps-script-single-file');
const files = [
  'appsscript.json',
  'Code.gs',
  'Engine.gs',
  'Model.gs',
  'Writer.gs',
  'Sidebar.html',
];

await rm(output, { recursive: true, force: true });
await rm(singleOutput, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mkdir(singleOutput, { recursive: true });
for (const name of files) await cp(path.join(source, name), path.join(output, name));
await cp(path.join(sheetsRoot, 'generated', 'Payload.gs'), path.join(output, 'Payload.gs'));

await writeFile(path.join(output, '.clasp.json.example'), `${JSON.stringify({
  scriptId: 'REPLACE_WITH_BOUND_SCRIPT_ID',
  rootDir: '.',
}, null, 2)}\n`);
await writeFile(path.join(output, '.claspignore'), [
  '**/*',
  '!appsscript.json',
  '!*.gs',
  '!*.html',
  '',
].join('\n'));

// The single-file variant makes the first browser-editor installation much
// less error-prone. Apps Script still receives the identical source, merely
// concatenated into one global-scope .gs file.
const combinedParts = await Promise.all([
  'Code.gs',
  'Model.gs',
  'Engine.gs',
  'Writer.gs',
].map(async (name) => `/* ---- ${name} ---- */\n${await readFile(path.join(source, name), 'utf8')}`));
combinedParts.push(`/* ---- Payload.gs (generated) ---- */\n${await readFile(path.join(sheetsRoot, 'generated', 'Payload.gs'), 'utf8')}`);
await writeFile(path.join(singleOutput, 'Code.gs'), `${combinedParts.join('\n\n')}\n`);
await cp(path.join(source, 'Sidebar.html'), path.join(singleOutput, 'Sidebar.html'));
await cp(path.join(source, 'appsscript.json'), path.join(singleOutput, 'appsscript.json'));

const payload = await readFile(path.join(output, 'Payload.gs'), 'utf8');
console.log(JSON.stringify({
  output,
  singleOutput,
  files: files.length + 3,
  payloadCharacters: payload.length,
}));
