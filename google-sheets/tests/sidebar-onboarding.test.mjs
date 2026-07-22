import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const html = await readFile(path.join(root, 'google-sheets/apps-script/Sidebar.html'), 'utf8');
const inlineScript = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || '';

function copyCatalog() {
  const start = inlineScript.indexOf('const COPY = ');
  const end = inlineScript.indexOf('\n\n    let bootstrap', start);
  assert.ok(start >= 0 && end > start, 'localized copy catalog should be extractable');
  const context = {};
  vm.runInNewContext(`${inlineScript.slice(start, end)}; globalThis.result = COPY;`, context);
  return context.result;
}

test('sidebar leads with one executable-copy and authorization path in both languages', () => {
  const copyUrl = 'https://docs.google.com/spreadsheets/d/18i8zJqT0W6P8xcN1sn6NW0KjdEFYrAJm9zcVqb8fOXg/copy';
  assert.equal(html.split(copyUrl).length - 1, 2, 'first-run and recovery CTAs must use the direct /copy link');
  assert.match(html, /<aside class="first-run" aria-labelledby="first-run-title">/);
  assert.match(html, /target="_blank"[\s\S]*?rel="noopener noreferrer"/);
  assert.match(html, /id="status-setup"[\s\S]*?aria-hidden="true"/);

  const catalog = copyCatalog();
  const keys = [
    'firstRunTitle', 'firstRunSummary', 'copyAction', 'copyActionAria',
    'firstRunVerify', 'firstRunAuthorize', 'xlsxNote',
    'policySummary', 'policyNote', 'setupRequired', 'setupRequiredDetail',
    'policyBlocked', 'policyBlockedDetail',
  ];
  for (const language of ['en', 'pt-BR']) {
    for (const key of keys) assert.ok(catalog[language][key], `${language}.${key} should be localized`);
  }
  assert.match(catalog.en.firstRunSummary, /public master is read-only/i);
  assert.match(catalog.en.firstRunVerify, /IG Scheduler.*Verify embedded engine/);
  assert.match(catalog.en.xlsxNote, /\.xlsx.*cannot include the bound Apps Script/i);
  assert.match(catalog.en.policyNote, /protections enabled.*another standard Google account.*read-only portfolio/i);
  assert.match(catalog['pt-BR'].firstRunSummary, /master público é somente leitura/i);
  assert.match(catalog['pt-BR'].firstRunVerify, /IG Scheduler.*Verificar engine incorporado/);
  assert.match(catalog['pt-BR'].xlsxNote, /\.xlsx.*não pode incluir o Apps Script vinculado/i);
  assert.match(catalog['pt-BR'].policyNote, /proteções.*ativadas.*outra conta Google padrão.*portfólio somente leitura/i);
});

test('permission failures route to actionable setup guidance', () => {
  const start = inlineScript.indexOf('function blockedByAccountPolicy(error)');
  const end = inlineScript.indexOf('\n\n    function showFailure', start);
  assert.ok(start >= 0 && end > start, 'setup error classifier should be extractable');
  const context = {};
  vm.runInNewContext(`${inlineScript.slice(start, end)}; globalThis.requiresSetup = requiresSetup; globalThis.blockedByAccountPolicy = blockedByAccountPolicy;`, context);

  for (const message of [
    'Authorization is required to perform that action.',
    'Error code PERMISSION_DENIED.',
    'You do not have permission to call SpreadsheetApp.',
    'Script function not found: igGetBootstrap',
    'This app is blocked.',
    'Access denied: policy_enforced',
    'Apps Script is unavailable with Advanced Protection.',
  ]) {
    assert.equal(context.requiresSetup(new Error(message)), true, message);
  }
  assert.equal(context.blockedByAccountPolicy(new Error('This app is blocked.')), true);
  assert.equal(context.blockedByAccountPolicy(new Error('Access denied: policy_enforced')), true);
  assert.equal(context.blockedByAccountPolicy(new Error('Advanced Protection is enabled')), true);
  assert.equal(context.requiresSetup(new Error('The iteration budget must be positive.')), false);
  assert.equal((inlineScript.match(/showFailure\(error\);/g) || []).length, 4);
  assert.match(inlineScript, /setStatus\('setupRequired',[\s\S]*?needsSetup: true/);
  assert.match(inlineScript, /setStatus\('policyBlocked',[\s\S]*?needsSetup: true/);
});
