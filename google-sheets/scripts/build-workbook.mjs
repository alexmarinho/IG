#!/usr/bin/env node
/**
 * Build the IG Scheduling Lab portfolio workbook.
 *
 * The workbook is intentionally authored as an auditable BI product:
 * presentation sheets contain formulas and charts, while raw engine output
 * lives in stable underscore-prefixed sheets consumed by Apps Script.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const packageRoot = path.join(root, 'google-sheets');
const sample = JSON.parse(await fs.readFile(path.join(packageRoot, 'generated', 'sample-data.json'), 'utf8'));
const benchmark = JSON.parse(await fs.readFile(path.join(root, 'benchmark.json'), 'utf8'));

const outputPath = path.join(packageRoot, 'dist', 'ig-scheduling-lab.xlsx');
const previewDir = path.join(packageRoot, 'previews');
const runnableCopyUrl = 'https://docs.google.com/spreadsheets/d/18i8zJqT0W6P8xcN1sn6NW0KjdEFYrAJm9zcVqb8fOXg/copy';

const VISIBLE = [
  'START',
  'DASHBOARD',
  'SCHEDULE',
  'EXPERIMENTS',
  'INSTANCE',
  'METHOD',
  'ENGINEERING',
];

const INTERNAL = [
  '_CONFIG',
  '_RUNS',
  '_CHECKPOINTS',
  '_SCHEDULE',
  '_INSTANCE',
  '_SETUPS',
  '_CATALOG',
  '_CHARTS',
  '_STATS',
  '_I18N',
  '_STATE',
  '_AUDIT',
];

const P = Object.freeze({
  ink: '#14212B',
  ink2: '#223542',
  canvas: '#F7F4EE',
  paper: '#FFFFFF',
  teal: '#0C7C82',
  tealSoft: '#DDEEEF',
  amber: '#D99A2B',
  amberSoft: '#F5E9CF',
  red: '#C6534B',
  redSoft: '#F3DEDA',
  green: '#2F8A63',
  greenSoft: '#DDEBE4',
  blue: '#467AA0',
  blueSoft: '#DFE9F0',
  purple: '#7A628E',
  setup: '#A8ADB2',
  grid: '#D9D8D2',
  text: '#24333C',
  muted: '#65747D',
  pale: '#EEEAE2',
  white: '#FFFFFF',
});

const FAMILY_COLORS = [
  '#2F8A63', '#467AA0', '#D99A2B', '#7A628E', '#C6534B',
  '#0C7C82', '#9A7148', '#506A7A', '#8A8F4E', '#A05E78', '#356F91',
];

const workbook = Workbook.create();
const sheets = Object.fromEntries([...VISIBLE, ...INTERNAL].map((name) => [name, workbook.worksheets.add(name)]));

function matrix(rows, cols, value = null) {
  return Array.from({ length: rows }, () => Array(cols).fill(value));
}

function quoteSheet(name) {
  return `'${name.replaceAll("'", "''")}'`;
}

function ref(sheet, cell) {
  return `=${quoteSheet(sheet)}!${cell}`;
}

function columnName(number) {
  let value = number;
  let letters = '';
  while (value) {
    value -= 1;
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

function blankSafeRef(sheet, cell) {
  const source = `${quoteSheet(sheet)}!${cell}`;
  return `=IF(ISBLANK(${source}),"",${source})`;
}

function formulaText(value) {
  return String(value).replaceAll('"', '""');
}

/**
 * Return a cell formula that reacts to the workbook language selector.
 * `_CONFIG!B2` is the stable language contract consumed by Apps Script.
 */
function localized(en, pt) {
  return `=IF(${quoteSheet('_CONFIG')}!$B$2="pt-BR","${formulaText(pt)}","${formulaText(en)}")`;
}

function writeCopy(range, copy) {
  if (typeof copy === 'string' && copy.startsWith('=')) range.formulas = [[copy]];
  else range.values = [[copy]];
}

function applyBase(sheet, range = 'A1:Q140') {
  sheet.showGridLines = false;
  const used = sheet.getRange(range);
  used.format = {
    fill: P.canvas,
    font: { name: 'Roboto', size: 10, color: P.text },
    verticalAlignment: 'center',
  };
}

function setWidths(sheet, entries, lastRow = 160) {
  for (const [column, width] of entries) {
    sheet.getRange(`${column}1:${column}${lastRow}`).format.columnWidthPx = width;
  }
}

function setRows(sheet, entries, lastColumn = 'Q') {
  for (const [row, height] of entries) {
    sheet.getRange(`A${row}:${lastColumn}${row}`).format.rowHeightPx = height;
  }
}

function titleRail(sheet, kicker, title, subtitle, lastColumn = 'Q') {
  sheet.mergeCells('A1:C2');
  writeCopy(sheet.getRange('A1'), kicker);
  sheet.getRange('A1:C2').format = {
    fill: P.teal,
    font: { name: 'Roboto', size: 11, bold: true, color: P.white },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    wrapText: true,
  };
  sheet.mergeCells(`D1:${lastColumn}1`);
  writeCopy(sheet.getRange('D1'), title);
  sheet.getRange(`D1:${lastColumn}1`).format = {
    fill: P.ink,
    font: { name: 'Roboto', size: 18, bold: true, color: P.white },
    verticalAlignment: 'center',
  };
  sheet.mergeCells(`D2:${lastColumn}2`);
  writeCopy(sheet.getRange('D2'), subtitle);
  sheet.getRange(`D2:${lastColumn}2`).format = {
    fill: P.ink,
    font: { name: 'Roboto', size: 9, color: '#C7D3D9' },
    verticalAlignment: 'center',
  };
  setRows(sheet, [[1, 32], [2, 26]], lastColumn);
}

function section(sheet, range, label, tone = 'ink') {
  sheet.mergeCells(range);
  const cell = range.split(':')[0];
  writeCopy(sheet.getRange(cell), label);
  const fill = tone === 'teal' ? P.teal : tone === 'amber' ? P.amber : P.ink2;
  sheet.getRange(range).format = {
    fill,
    font: { name: 'Roboto', size: 10, bold: true, color: P.white },
    verticalAlignment: 'center',
  };
}

function textPanel(sheet, range, text, options = {}) {
  sheet.mergeCells(range);
  const cell = range.split(':')[0];
  writeCopy(sheet.getRange(cell), text);
  sheet.getRange(range).format = {
    fill: options.fill || P.paper,
    font: {
      name: options.mono ? 'Roboto Mono' : 'Roboto',
      size: options.size || 10,
      color: options.color || P.text,
      bold: Boolean(options.bold),
      italic: Boolean(options.italic),
    },
    wrapText: true,
    verticalAlignment: options.vertical || 'top',
    horizontalAlignment: options.align || 'left',
    borders: { preset: 'outside', style: 'thin', color: options.border || P.grid },
  };
}

function formulaPanel(sheet, range, formula, options = {}) {
  sheet.mergeCells(range);
  const cell = range.split(':')[0];
  sheet.getRange(cell).formulas = [[formula]];
  sheet.getRange(range).format = {
    fill: options.fill || P.paper,
    font: {
      name: options.mono ? 'Roboto Mono' : 'Roboto',
      size: options.size || 10,
      color: options.color || P.text,
      bold: Boolean(options.bold),
    },
    wrapText: true,
    verticalAlignment: options.vertical || 'center',
    horizontalAlignment: options.align || 'left',
    numberFormat: options.numberFormat,
    borders: { preset: 'outside', style: 'thin', color: options.border || P.grid },
  };
}

function kpi(sheet, columns, label, formula, note, accent, numberFormat = '#,##0') {
  const [left, right] = columns;
  sheet.mergeCells(`${left}4:${right}4`);
  writeCopy(sheet.getRange(`${left}4`), label);
  sheet.getRange(`${left}4:${right}4`).format = {
    fill: accent,
    font: { name: 'Roboto', size: 9, bold: true, color: P.white },
    horizontalAlignment: 'center',
  };
  sheet.mergeCells(`${left}5:${right}7`);
  sheet.getRange(`${left}5`).formulas = [[formula]];
  sheet.getRange(`${left}5:${right}7`).format = {
    fill: P.paper,
    font: { name: 'Roboto', size: 22, bold: true, color: P.ink },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    numberFormat,
    borders: { preset: 'outside', style: 'thin', color: P.grid },
  };
  sheet.mergeCells(`${left}8:${right}8`);
  writeCopy(sheet.getRange(`${left}8`), note);
  sheet.getRange(`${left}8:${right}8`).format = {
    fill: P.pale,
    font: { name: 'Roboto', size: 8, color: P.muted },
    horizontalAlignment: 'center',
    wrapText: true,
    borders: { preset: 'outside', style: 'thin', color: P.grid },
  };
}

function tableStyle(range, options = {}) {
  range.format = {
    fill: options.fill || P.paper,
    font: { name: options.mono ? 'Roboto Mono' : 'Roboto', size: options.size || 9, color: P.text },
    verticalAlignment: 'center',
    wrapText: Boolean(options.wrap),
    borders: {
      insideHorizontal: { style: 'thin', color: P.grid },
      bottom: { style: 'thin', color: P.grid },
    },
  };
}

function tableHeader(range, fill = P.ink2) {
  range.format = {
    fill,
    font: { name: 'Roboto', size: 9, bold: true, color: P.white },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    wrapText: true,
    borders: { preset: 'outside', style: 'thin', color: fill },
  };
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - position) + sorted[upper] * (position - lower);
}

function stats(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.length < 2 ? 0 : sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sorted.length - 1);
  return {
    count: sorted.length,
    min: sorted[0],
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    mean,
    q3: quantile(sorted, 0.75),
    max: sorted.at(-1),
    sd: Math.sqrt(variance),
  };
}

function aggregateCheckpoints(runs) {
  const longest = Math.max(...runs.map((run) => run.checkpoints.length));
  const rows = [];
  for (let index = 0; index < longest; index += 1) {
    const points = runs.map((run) => run.checkpoints[index]).filter(Boolean);
    if (!points.length) continue;
    const s = stats(points.map((point) => point.bestCost));
    rows.push([
      points[0].iteration,
      s.min,
      s.q1,
      s.median,
      s.mean,
      s.q3,
      s.max,
      points.reduce((sum, point) => sum + point.evaluations, 0) / points.length,
      points.length,
    ]);
  }
  return rows;
}

const runStats = stats(sample.runs.map((run) => run.bestCost));
const checkpoints = aggregateCheckpoints(sample.runs);
const checkpointEndRow = checkpoints.length + 1;
const best = sample.bestRun;
const model = sample.instanceModel;
const evaluation = best.evaluation;
const generatedAt = new Date().toISOString();

const runRows = sample.runs.map((run, index) => [
  index + 1,
  run.seed,
  run.bestCost,
  sample.referenceBest > 0 ? ((run.bestCost - sample.referenceBest) / sample.referenceBest) * 100 : null,
  run.iterations,
  run.evaluations,
  run.elapsedMs,
  run.evaluationsPerSecond,
  run.evaluation.scheduledCount,
  run.evaluation.rejectedCount,
  run.seed === best.seed && run.bestCost === best.bestCost,
]);

const scheduleRows = evaluation.rows.concat(evaluation.rejected).map((row) => {
  const setupCost = Number(row.setupCost || 0);
  const executionCost = Number(row.executionCost || 0);
  const tardinessCost = Number(row.tardinessCost || 0);
  const rejectionCost = Number(row.rejectionCost || 0);
  return [
    row.position,
    row.status,
    row.id ?? row.jobId,
    row.family,
    row.releaseTime,
    row.due,
    row.hardDeadline,
    row.setupStart,
    row.setupTime,
    row.processStart,
    row.processingTime,
    row.finish,
    row.late,
    setupCost,
    executionCost,
    tardinessCost,
    rejectionCost,
    setupCost + executionCost + tardinessCost + rejectionCost,
    row.feasible == null ? null : Boolean(row.feasible),
  ];
});

const instanceRows = model.jobs.map((job, index) => [
  index,
  job.id,
  job.family,
  job.processingTime,
  job.releaseTime,
  job.due,
  job.hardDeadline,
  job.weight,
  job.processingCost,
  job.rejectionCost,
]);

const familyRows = model.familyIds.map((family) => {
  const jobs = model.jobs.filter((job) => job.family === family);
  return [
    `F${family}`,
    jobs.length,
    jobs.reduce((sum, job) => sum + job.processingTime, 0),
    jobs.reduce((sum, job) => sum + job.processingCost, 0),
    jobs.reduce((sum, job) => sum + job.rejectionCost, 0),
  ];
});

// ---------------------------------------------------------------------------
// Technical data contract — stable names consumed by Writer.gs.
// ---------------------------------------------------------------------------

function styleTechnical(sheet, usedRange, widths = []) {
  sheet.showGridLines = false;
  sheet.getRange(usedRange).format = {
    fill: P.paper,
    font: { name: 'Roboto Mono', size: 8, color: P.text },
    verticalAlignment: 'center',
  };
  if (widths.length) setWidths(sheet, widths, 650);
  sheet.freezePanes.freezeRows(1);
}

const configRows = [
  ['language', 'en'],
  ['status', 'complete'],
  ['mode', 'experiment'],
  ['instance', sample.instance],
  ['seed', best.seed],
  ['iteration_budget', sample.iterationBudget],
  ['destroy_size', sample.parameters.d],
  ['acceptance', sample.parameters.accept],
  ['permutation', sample.parameters.permute],
  ['best_cost', best.bestCost],
  ['reference_cost', sample.referenceBest],
  ['gap_percent', ((best.bestCost - sample.referenceBest) / sample.referenceBest) * 100],
  ['scheduled_jobs', evaluation.scheduledCount],
  ['rejected_jobs', evaluation.rejectedCount],
  ['makespan', evaluation.makespan],
  ['setup_cost', evaluation.breakdown.setup],
  ['execution_cost', evaluation.breakdown.execution],
  ['tardiness_cost', evaluation.breakdown.tardiness],
  ['rejection_cost', evaluation.breakdown.rejection],
  ['runtime_ms', best.elapsedMs],
  ['evaluations', best.evaluations],
  ['evaluations_per_second', best.evaluationsPerSecond],
  ['run_count', sample.runCount],
  ['median_cost', runStats.median],
  ['q1_cost', runStats.q1],
  ['q3_cost', runStats.q3],
  ['sample_sd', runStats.sd],
  ['updated_at_utc', generatedAt],
  ['engine', 'Rust WebAssembly / fixed-point x10'],
];

{
  const sheet = sheets._CONFIG;
  sheet.getRange('A1:B30').values = [['key', 'value'], ...configRows];
  styleTechnical(sheet, 'A1:B45', [['A', 190], ['B', 220]]);
  tableHeader(sheet.getRange('A1:B1'), P.teal);
  sheet.tables.add('A1:B30', true, 'ConfigTable').style = 'TableStyleMedium2';
}

{
  const sheet = sheets._RUNS;
  const headers = [
    'run', 'seed', 'best_cost', 'gap_percent', 'iterations', 'evaluations',
    'runtime_ms', 'evaluations_per_second', 'scheduled_jobs', 'rejected_jobs', 'is_best',
    'budget_match', 'seed_duplicate_count',
  ];
  sheet.getRange(`A1:M${runRows.length + 1}`).values = [headers, ...runRows.map((row) => [...row, null, null])];
  const auditFormulas = Array.from({ length: 100 }, (_, index) => {
    const row = index + 2;
    return [
      `=IF(A${row}="","",E${row}=${quoteSheet('_CONFIG')}!$B$7)`,
      `=IF(B${row}="","",COUNTIF($B$2:$B$101,B${row}))`,
    ];
  });
  sheet.getRange('L2:M101').formulas = auditFormulas;
  styleTechnical(sheet, 'A1:M110', [['A', 55], ['B', 55], ['C', 85], ['D', 80], ['E', 85], ['F', 100], ['G', 90], ['H', 125], ['I', 100], ['J', 100], ['K', 65], ['L', 90], ['M', 115]]);
  tableHeader(sheet.getRange('A1:M1'), P.teal);
  sheet.getRange(`C2:C${runRows.length + 1}`).format.numberFormat = '#,##0';
  sheet.getRange(`D2:D${runRows.length + 1}`).format.numberFormat = '0.00';
  sheet.getRange(`G2:G${runRows.length + 1}`).format.numberFormat = '0.0';
  sheet.getRange(`H2:H${runRows.length + 1}`).format.numberFormat = '#,##0';
  sheet.tables.add(`A1:M${runRows.length + 1}`, true, 'RunsTable').style = 'TableStyleMedium2';
}

{
  const sheet = sheets._CHECKPOINTS;
  const headers = ['iteration', 'best', 'q1', 'median', 'mean', 'q3', 'worst', 'mean_evaluations', 'samples', 'monotone'];
  sheet.getRange(`A1:J${checkpoints.length + 1}`).values = [headers, ...checkpoints.map((row) => [...row, null])];
  const formulas = Array.from({ length: 150 }, (_, index) => {
    const row = index + 2;
    return [`=IF(A${row}="","",IF(A${row + 1}="","PASS",IF(AND(A${row + 1}>A${row},B${row + 1}<=B${row},H${row + 1}>=H${row}),"PASS","FAIL")))`];
  });
  sheet.getRange('J2:J151').formulas = formulas;
  styleTechnical(sheet, 'A1:J160', [['A', 75], ['B', 75], ['C', 75], ['D', 75], ['E', 75], ['F', 75], ['G', 75], ['H', 110], ['I', 65], ['J', 75]]);
  tableHeader(sheet.getRange('A1:J1'), P.teal);
  sheet.getRange(`B2:H${checkpoints.length + 1}`).format.numberFormat = '#,##0';
  sheet.tables.add(`A1:J${checkpoints.length + 1}`, true, 'CheckpointsTable').style = 'TableStyleMedium2';
}

{
  const sheet = sheets._SCHEDULE;
  const headers = [
    'position', 'status', 'job_id', 'family', 'release', 'due', 'hard_deadline',
    'setup_start', 'setup_time', 'process_start', 'processing_time', 'finish', 'late',
    'setup_cost', 'execution_cost', 'tardiness_cost', 'rejection_cost', 'total_contribution',
    'feasible', 'job_duplicate_count',
  ];
  sheet.getRange(`A1:T${scheduleRows.length + 1}`).values = [headers, ...scheduleRows.map((row) => [...row, null])];
  sheet.getRange('T2:T601').formulas = Array.from({ length: 600 }, (_, index) => {
    const row = index + 2;
    return [`=IF(C${row}="","",COUNTIF($C$2:$C$601,C${row}))`];
  });
  styleTechnical(sheet, 'A1:T610', [
    ['A', 65], ['B', 85], ['C', 65], ['D', 55], ['E', 70], ['F', 70], ['G', 95], ['H', 80], ['I', 75],
    ['J', 85], ['K', 90], ['L', 75], ['M', 60], ['N', 75], ['O', 90], ['P', 90], ['Q', 90], ['R', 105], ['S', 70], ['T', 115],
  ]);
  tableHeader(sheet.getRange('A1:T1'), P.teal);
  sheet.getRange(`E2:R${scheduleRows.length + 1}`).format.numberFormat = '#,##0';
  sheet.tables.add(`A1:T${scheduleRows.length + 1}`, true, 'ScheduleDataTable').style = 'TableStyleMedium2';
}

{
  const sheet = sheets._INSTANCE;
  const headers = [
    'internal_id', 'job_id', 'family', 'processing_time', 'release', 'due',
    'hard_deadline', 'tardiness_weight', 'execution_cost', 'rejection_cost',
  ];
  sheet.getRange(`A1:J${instanceRows.length + 1}`).values = [headers, ...instanceRows];
  styleTechnical(sheet, 'A1:J610', [['A', 85], ['B', 65], ['C', 60], ['D', 105], ['E', 75], ['F', 75], ['G', 100], ['H', 110], ['I', 95], ['J', 95]]);
  tableHeader(sheet.getRange('A1:J1'), P.teal);
  sheet.getRange(`D2:J${instanceRows.length + 1}`).format.numberFormat = '#,##0';
  sheet.tables.add(`A1:J${instanceRows.length + 1}`, true, 'InstanceDataTable').style = 'TableStyleMedium2';
}

{
  const sheet = sheets._SETUPS;
  const states = Array.from({ length: model.stateCount }, (_, state) => state);
  const timeHeaders = ['from_to_time', ...states.map(String)];
  const costHeaders = ['from_to_cost', ...states.map(String)];
  const timeRows = states.map((from) => [String(from), ...states.map((to) => model.setupTime[from][to])]);
  const costRows = states.map((from) => [String(from), ...states.map((to) => model.setupCost[from][to])]);
  const timeEnd = columnName(timeHeaders.length);
  const costStartColumn = states.length + 3; // time block, one gutter, then cost block.
  const costStart = columnName(costStartColumn);
  const costEnd = columnName(costStartColumn + costHeaders.length - 1);
  sheet.getRange(`A1:${timeEnd}${timeRows.length + 1}`).values = [timeHeaders, ...timeRows];
  sheet.getRange(`${costStart}1:${costEnd}${costRows.length + 1}`).values = [costHeaders, ...costRows];
  styleTechnical(sheet, `A1:${costEnd}35`, [
    ...Array.from({ length: timeHeaders.length }, (_, index) => [columnName(index + 1), index === 0 ? 105 : 55]),
    [columnName(states.length + 2), 24],
    ...Array.from({ length: costHeaders.length }, (_, index) => [columnName(costStartColumn + index), index === 0 ? 105 : 55]),
  ]);
  tableHeader(sheet.getRange(`A1:${timeEnd}1`), P.teal);
  tableHeader(sheet.getRange(`${costStart}1:${costEnd}1`), P.amber);
  const timeTable = sheet.tables.add(`A1:${timeEnd}${timeRows.length + 1}`, true, 'SetupTimesTable');
  timeTable.style = 'TableStyleMedium2';
  const costTable = sheet.tables.add(`${costStart}1:${costEnd}${costRows.length + 1}`, true, 'SetupCostsTable');
  costTable.style = 'TableStyleMedium9';
  sheet.getRange(`B2:${timeEnd}${timeRows.length + 1}`).conditionalFormats.add('colorScale', {
    colors: [P.paper, P.blueSoft, P.blue], thresholds: ['min', '50%', 'max'],
  });
  sheet.getRange(`${columnName(costStartColumn + 1)}2:${costEnd}${costRows.length + 1}`).conditionalFormats.add('colorScale', {
    colors: [P.paper, P.amberSoft, P.amber], thresholds: ['min', '50%', 'max'],
  });
}

{
  const catalog = Object.entries(benchmark)
    .map(([instance, entry]) => {
      const reference = Number(entry[1]);
      const numericGap = Number(String(entry[2]).replace(',', '.'));
      return [
        instance,
        instance.startsWith('STC_') ? 'Setup-time constrained' : 'Cost/rejection',
        Number(entry[0]),
        Number.isFinite(reference) ? reference : null,
        Number.isFinite(numericGap) ? numericGap : null,
        Number.isFinite(reference) ? 'historical reference' : 'not provided',
        Number(entry[0]) <= 30 ? 'Small' : Number(entry[0]) <= 90 ? 'Medium' : 'Large',
        `masclib/${instance}.csv`,
      ];
    })
    .concat([
      ['GPU_CALM_40', 'GPU/LLM capacity', 40, null, null, 'not provided', 'Medium', 'masclib-gpu/GPU_CALM_40.csv'],
      ['GPU_RUSH_60', 'GPU/LLM capacity', 60, null, null, 'not provided', 'Medium', 'masclib-gpu/GPU_RUSH_60.csv'],
      ['GPU_HEAVY_120', 'GPU/LLM capacity', 120, null, null, 'not provided', 'Large', 'masclib-gpu/GPU_HEAVY_120.csv'],
    ])
    .sort((left, right) => left[0].localeCompare(right[0]));
  const sheet = sheets._CATALOG;
  sheet.getRange(`A1:H${catalog.length + 1}`).values = [[
    'instance', 'problem_family', 'jobs', 'reference_cost', 'baseline_gap_percent', 'reference_status', 'size_band', 'source_path',
  ], ...catalog];
  styleTechnical(sheet, 'A1:H70', [['A', 145], ['B', 175], ['C', 65], ['D', 95], ['E', 125], ['F', 135], ['G', 85], ['H', 230]]);
  tableHeader(sheet.getRange('A1:H1'), P.teal);
  sheet.getRange(`D2:E${catalog.length + 1}`).format.numberFormat = '#,##0.00';
  sheet.tables.add(`A1:H${catalog.length + 1}`, true, 'CatalogTable').style = 'TableStyleMedium2';
}

{
  const sheet = sheets._STATE;
  sheet.getRange('A1:C10').values = [
    ['key', 'value', 'purpose'],
    ['job_count', model.jobs.length, 'Current instance cardinality'],
    ['family_count', model.familyCount, 'Current instance families'],
    ['horizon', model.horizon, 'Planning horizon'],
    ['gantt_bins', 32, 'Compact timeline resolution'],
    ['gantt_jobs', 20, 'Jobs shown in the compact timeline'],
    ['engine_scale', sample.engine.fixedPointScale, 'Fixed-point monetary scale'],
    ['wasm_bytes', sample.engine.wasmBytes, 'Canonical solver payload'],
    ['sample_environment', 'Node.js local build', 'Runtime is contextual; objective is portable'],
    ['instance_initial_state', model.initialState, 'Initial machine family/state'],
  ];
  styleTechnical(sheet, 'A1:C20', [['A', 170], ['B', 160], ['C', 330]]);
  tableHeader(sheet.getRange('A1:C1'), P.teal);
}

{
  const sheet = sheets._I18N;
  sheet.getRange('A1:C18').values = [
    ['key', 'en', 'pt-BR'],
    ['best_cost', 'Best objective', 'Melhor objetivo'],
    ['reference_cost', 'Historical reference', 'Referência histórica'],
    ['gap', 'Delta to historical reference', 'Delta para referência histórica'],
    ['scheduled', 'Scheduled jobs', 'Jobs programados'],
    ['rejected', 'Rejected jobs', 'Jobs rejeitados'],
    ['runs', 'Equal-budget runs', 'Execuções com mesmo orçamento'],
    ['setup', 'Setup', 'Preparação'],
    ['execution', 'Execution', 'Execução'],
    ['tardiness', 'Tardiness', 'Atraso'],
    ['rejection', 'Rejection', 'Rejeição'],
    ['iteration', 'Iteration', 'Iteração'],
    ['seed', 'Seed', 'Semente'],
    ['family', 'Family', 'Família'],
    ['release', 'Release', 'Liberação'],
    ['due', 'Due date', 'Prazo'],
    ['deadline', 'Hard deadline', 'Limite rígido'],
    ['pass', 'PASS', 'APROVADO'],
  ];
  styleTechnical(sheet, 'A1:C30', [['A', 130], ['B', 190], ['C', 210]]);
  tableHeader(sheet.getRange('A1:C1'), P.teal);
}

{
  const sheet = sheets._STATS;
  sheet.getRange('A1:C12').values = [
    ['metric', 'value', 'definition'],
    ['run_count', null, 'Number of verified equal-budget runs'],
    ['best_cost', null, 'Minimum observed objective'],
    ['median_cost', null, '50th percentile'],
    ['q1_cost', null, '25th percentile'],
    ['q3_cost', null, '75th percentile'],
    ['iqr', null, 'Q3 − Q1'],
    ['sample_sd', null, 'Sample standard deviation'],
    ['reference_hit_rate', null, 'Share of runs at or below historical reference'],
    ['mean_evaluations', null, 'Mean objective evaluations per run'],
    ['mean_runtime_ms', null, 'Mean runtime in current environment'],
    ['mean_eval_per_second', null, 'Mean evaluator throughput in current environment'],
  ];
  sheet.getRange('B2:B12').formulas = [
    [`=COUNT(${quoteSheet('_RUNS')}!$C$2:$C$101)`],
    [ref('_CONFIG', '$B$11')],
    [ref('_CONFIG', '$B$25')],
    [ref('_CONFIG', '$B$26')],
    [ref('_CONFIG', '$B$27')],
    [`=IF(B2<2,"",B6-B5)`],
    [`=IF(B2<2,"",${quoteSheet('_CONFIG')}!$B$28)`],
    [`=IF(OR(B2<2,${quoteSheet('_CONFIG')}!$B$12=""),"",COUNTIFS(${quoteSheet('_RUNS')}!$C$2:$C$101,"<>",${quoteSheet('_RUNS')}!$C$2:$C$101,"<="&${quoteSheet('_CONFIG')}!$B$12)/B2)`],
    [`=IF(B2=0,"",AVERAGE(${quoteSheet('_RUNS')}!$F$2:$F$101))`],
    [`=IF(B2=0,"",AVERAGE(${quoteSheet('_RUNS')}!$G$2:$G$101))`],
    [`=IF(B2=0,"",AVERAGE(${quoteSheet('_RUNS')}!$H$2:$H$101))`],
  ];
  styleTechnical(sheet, 'A1:C20', [['A', 175], ['B', 110], ['C', 340]]);
  tableHeader(sheet.getRange('A1:C1'), P.teal);
  sheet.getRange('B2:B8').format.numberFormat = '#,##0.0';
  sheet.getRange('B9').format.numberFormat = '0.0%';
  sheet.getRange('B10:B12').format.numberFormat = '#,##0.0';
}

{
  const sheet = sheets._CHARTS;
  // Each helper block is formula-backed so charts follow Apps Script writes.
  sheet.getRange('A1:B1').formulas = [[localized('Iteration', 'Iteração'), localized('Best observed', 'Melhor observado')]];
  sheet.getRange('A2:B151').formulas = Array.from({ length: 150 }, (_, index) => [
    blankSafeRef('_CHECKPOINTS', `A${index + 2}`), blankSafeRef('_CHECKPOINTS', `B${index + 2}`),
  ]);

  sheet.getRange('D1:E1').formulas = [[localized('Objective component', 'Componente do objetivo'), localized('Cost', 'Custo')]];
  sheet.getRange('D2:D5').formulas = [
    [localized('Setup', 'Preparação')],
    [localized('Execution', 'Execução')],
    [localized('Tardiness', 'Atraso')],
    [localized('Rejection', 'Rejeição')],
  ];
  sheet.getRange('E2:E5').formulas = [
    [ref('_CONFIG', '$B$17')], [ref('_CONFIG', '$B$18')], [ref('_CONFIG', '$B$19')], [ref('_CONFIG', '$B$20')],
  ];

  sheet.getRange('G1:I1').formulas = [[localized('Seed', 'Semente'), localized('Objective', 'Objetivo'), localized('Reference', 'Referência')]];
  sheet.getRange('G2:I101').formulas = Array.from({ length: 100 }, (_, index) => {
    const row = index + 2;
    return [
      blankSafeRef('_RUNS', `B${row}`),
      blankSafeRef('_RUNS', `C${row}`),
      `=IF(G${row}="","",IF(${quoteSheet('_CONFIG')}!$B$12="","",${quoteSheet('_CONFIG')}!$B$12))`,
    ];
  });

  sheet.getRange('K1:N1').formulas = [[localized('Iteration', 'Iteração'), localized('Best', 'Melhor'), localized('Median', 'Mediana'), localized('Worst', 'Pior')]];
  sheet.getRange('K2:N151').formulas = Array.from({ length: 150 }, (_, index) => [
    blankSafeRef('_CHECKPOINTS', `A${index + 2}`), blankSafeRef('_CHECKPOINTS', `B${index + 2}`),
    blankSafeRef('_CHECKPOINTS', `D${index + 2}`), blankSafeRef('_CHECKPOINTS', `G${index + 2}`),
  ]);

  sheet.getRange('P1:T1').formulas = [[localized('Family', 'Família'), localized('Jobs', 'Jobs'), localized('Processing time', 'Tempo de processamento'), localized('Execution cost', 'Custo de execução'), localized('Rejection exposure', 'Exposição à rejeição')]];
  sheet.getRange('P2:T12').formulas = Array.from({ length: 11 }, (_, family) => {
    const row = family + 2;
    const familyRange = `${quoteSheet('_INSTANCE')}!$C$2:$C$601`;
    return [
      `=IF(COUNTIF(${familyRange},${family})=0,"","F${family}")`,
      `=IF(P${row}="","",COUNTIF(${familyRange},${family}))`,
      `=IF(P${row}="","",SUMIF(${familyRange},${family},${quoteSheet('_INSTANCE')}!$D$2:$D$601))`,
      `=IF(P${row}="","",SUMIF(${familyRange},${family},${quoteSheet('_INSTANCE')}!$I$2:$I$601))`,
      `=IF(P${row}="","",SUMIF(${familyRange},${family},${quoteSheet('_INSTANCE')}!$J$2:$J$601))`,
    ];
  });

  sheet.getRange('V1:W1').formulas = [[localized('Job ID', 'ID do job'), localized('Due date', 'Prazo')]];
  sheet.getRange('V2:W601').formulas = Array.from({ length: 600 }, (_, index) => [
    blankSafeRef('_INSTANCE', `B${index + 2}`), blankSafeRef('_INSTANCE', `F${index + 2}`),
  ]);

  sheet.getRange('Y1:AC1').formulas = [[localized('Family', 'Família'), localized('Scheduled jobs', 'Jobs programados'), localized('Setup cost', 'Custo de preparação'), localized('Execution cost', 'Custo de execução'), localized('Total contribution', 'Contribuição total')]];
  sheet.getRange('Y2:AC12').formulas = Array.from({ length: 11 }, (_, family) => {
    const row = family + 2;
    const familyRange = `${quoteSheet('_INSTANCE')}!$C$2:$C$601`;
    const scheduleFamily = `${quoteSheet('_SCHEDULE')}!$D$2:$D$601`;
    return [
      `=IF(COUNTIF(${familyRange},${family})=0,"","F${family}")`,
      `=IF(Y${row}="","",COUNTIFS(${scheduleFamily},${family},${quoteSheet('_SCHEDULE')}!$B$2:$B$601,"scheduled"))`,
      `=IF(Y${row}="","",SUMIF(${scheduleFamily},${family},${quoteSheet('_SCHEDULE')}!$N$2:$N$601))`,
      `=IF(Y${row}="","",SUMIF(${scheduleFamily},${family},${quoteSheet('_SCHEDULE')}!$O$2:$O$601))`,
      `=IF(Y${row}="","",SUMIF(${scheduleFamily},${family},${quoteSheet('_SCHEDULE')}!$R$2:$R$601))`,
    ];
  });

  sheet.getRange('AE1:AF1').formulas = [[localized('Family', 'Família'), localized('Processing time', 'Tempo de processamento')]];
  sheet.getRange('AE2:AF12').formulas = Array.from({ length: 11 }, (_, index) => [
    blankSafeRef('_CHARTS', `P${index + 2}`), blankSafeRef('_CHARTS', `R${index + 2}`),
  ]);

  styleTechnical(sheet, 'A1:AF610', [
    ['A', 75], ['B', 95], ['D', 135], ['E', 85], ['G', 55], ['H', 85], ['I', 85], ['K', 75], ['L', 80], ['M', 80], ['N', 80],
    ['P', 70], ['Q', 55], ['R', 100], ['S', 90], ['T', 120], ['V', 75], ['W', 75], ['Y', 70], ['Z', 95], ['AA', 85], ['AB', 95], ['AC', 110], ['AE', 70], ['AF', 105],
  ]);
  tableHeader(sheet.getRange('A1:B1'), P.teal);
  tableHeader(sheet.getRange('D1:E1'), P.teal);
  tableHeader(sheet.getRange('G1:I1'), P.teal);
  tableHeader(sheet.getRange('K1:N1'), P.teal);
  tableHeader(sheet.getRange('P1:T1'), P.teal);
  tableHeader(sheet.getRange('V1:W1'), P.teal);
  tableHeader(sheet.getRange('Y1:AC1'), P.teal);
  tableHeader(sheet.getRange('AE1:AF1'), P.teal);
}

{
  const sheet = sheets._AUDIT;
  sheet.getRange('A1:E10').values = [
    ['control', 'requirement', 'observed', 'status', 'why it matters'],
    ['Objective closure', null, null, null, 'Score equals setup + execution + tardiness + rejection'],
    ['Job accounting', null, null, null, 'Scheduled + rejected equals the instance job count'],
    ['Feasible schedule', 0, null, null, 'No scheduled job violates a hard constraint'],
    ['Unique jobs', 1, null, null, 'Every job appears at most once'],
    ['Checkpoint monotonicity', 0, null, null, 'Best-so-far objective never increases'],
    ['Equal iteration budget', 0, null, null, 'Every comparison uses the same search budget'],
    ['Unique experiment seeds', 1, null, null, 'Replications are independently seeded'],
    ['Historical reference', 'present or disclosed', null, null, 'Gap is shown only when a historical reference exists'],
    ['Canonical engine', 'Rust WebAssembly', null, null, 'The spreadsheet runs the same fixed-point solver'],
  ];
  sheet.getRange('B2:B3').formulas = [[ref('_CONFIG', '$B$11')], [ref('_STATE', '$B$2')]];
  sheet.getRange('C2:C10').formulas = [
    [`=SUM(${quoteSheet('_CONFIG')}!$B$17:$B$20)`],
    [`=SUM(${quoteSheet('_CONFIG')}!$B$14:$B$15)`],
    [`=COUNTIFS(${quoteSheet('_SCHEDULE')}!$B$2:$B$601,"scheduled",${quoteSheet('_SCHEDULE')}!$S$2:$S$601,FALSE)`],
    [`=MAX(${quoteSheet('_SCHEDULE')}!$T$2:$T$601)`],
    [`=COUNTIF(${quoteSheet('_CHECKPOINTS')}!$J$2:$J$151,"FAIL")`],
    [`=COUNTIF(${quoteSheet('_RUNS')}!$L$2:$L$101,FALSE)`],
    [`=MAX(${quoteSheet('_RUNS')}!$M$2:$M$101)`],
    [`=IF(${quoteSheet('_CONFIG')}!$B$12<>"","present","not provided")`],
    [ref('_CONFIG', '$B$30')],
  ];
  sheet.getRange('D2:D10').formulas = [
    ['=IF(C2=B2,"PASS","FAIL")'],
    ['=IF(C3=B3,"PASS","FAIL")'],
    ['=IF(C4=B4,"PASS","FAIL")'],
    ['=IF(C5=B5,"PASS","FAIL")'],
    ['=IF(C6=B6,"PASS","FAIL")'],
    ['=IF(C7=B7,"PASS","FAIL")'],
    ['=IF(C8=B8,"PASS","FAIL")'],
    ['=IF(OR(C9="present",C9="not provided"),"PASS","FAIL")'],
    ['=IF(LEFT(C10,16)=B10,"PASS","FAIL")'],
  ];
  styleTechnical(sheet, 'A1:E20', [['A', 185], ['B', 140], ['C', 170], ['D', 75], ['E', 390]]);
  tableHeader(sheet.getRange('A1:E1'), P.teal);
  sheet.getRange('D2:D10').conditionalFormats.add('containsText', { text: 'PASS', format: { fill: P.greenSoft, font: { color: P.green, bold: true } } });
  sheet.getRange('D2:D10').conditionalFormats.add('containsText', { text: 'FAIL', format: { fill: P.redSoft, font: { color: P.red, bold: true } } });
}

// ---------------------------------------------------------------------------
// START
// ---------------------------------------------------------------------------


{
  const sheet = sheets.START;
  applyBase(sheet, 'A1:P42');
  setWidths(sheet, [
    ['A', 42], ['B', 64], ['C', 64], ['D', 64], ['E', 64], ['F', 64], ['G', 24],
    ['H', 68], ['I', 68], ['J', 68], ['K', 68], ['L', 68], ['M', 68], ['N', 68], ['O', 68], ['P', 68],
  ], 44);
  titleRail(
    sheet,
    localized('IG LAB\nOPERATIONS RESEARCH × BI', 'IG LAB\nPESQUISA OPERACIONAL × BI'),
    localized('One machine. Thousands of choices. One explainable decision.', 'Uma máquina. Milhares de escolhas. Uma decisão explicável.'),
    localized('View-only master · To run: /copy → Verify embedded engine (authorize once) → Open control panel', 'Master somente leitura · Para executar: /copy → Verificar engine incorporado (autorizar uma vez) → Abrir painel'),
    'P',
  );
  setRows(sheet, [
    ...Array.from({ length: 6 }, (_, index) => [index + 4, 25]),
    ...Array.from({ length: 6 }, (_, index) => [index + 13, 23]),
    ...Array.from({ length: 6 }, (_, index) => [index + 20, 29]),
    [26, 28],
    ...Array.from({ length: 6 }, (_, index) => [index + 30, 24]),
    ...Array.from({ length: 3 }, (_, index) => [index + 37, 24]),
  ], 'P');
  textPanel(
    sheet,
    'A4:J9',
    localized(
      'START HERE · COPY BEFORE RUNNING\n\nThe public master is view-only so the verified example cannot be overwritten. Use the native Google Sheets /copy link distributed with the project to create a private copy. Authorize once with IG Scheduler → Verify embedded engine; then choose Open control panel.\n\nImported .xlsx? It is the downloadable analytics snapshot: formulas, tables and charts only. Excel imports do not carry the bound Apps Script, so that file cannot execute the solver.',
      'COMECE AQUI · COPIE ANTES DE EXECUTAR\n\nO master público é somente leitura para preservar o exemplo verificado. Use o link /copy da versão nativa no Planilhas Google, distribuído com o projeto, para criar uma cópia privada. Autorize uma vez em IG Scheduler → Verificar engine incorporado; depois escolha Abrir painel de controle.\n\nImportou o .xlsx? Ele é o snapshot analítico para download: fórmulas, tabelas e gráficos. A importação do Excel não leva o Apps Script vinculado, portanto esse arquivo não executa o solver.',
    ),
    { size: 9, fill: P.amberSoft, border: P.amber, bold: true },
  );

  textPanel(sheet, 'K4:P5', localized('RUNNING REQUIRES A PRIVATE COPY', 'A EXECUÇÃO EXIGE UMA CÓPIA PRIVADA'), { fill: P.ink, color: P.white, bold: true, align: 'center', vertical: 'center', size: 9, border: P.ink });
  textPanel(sheet, 'K7:O9', localized('COPY → VERIFY\nOPEN CONTROL PANEL', 'COPIE → VERIFIQUE\nABRA O PAINEL'), { fill: P.teal, color: P.white, bold: true, align: 'center', vertical: 'center', size: 11, border: P.teal });
  sheet.getRange('P7:P9').format = { fill: P.canvas };

  section(sheet, 'A11:F12', localized('CONTROL ROOM', 'SALA DE CONTROLE'), 'teal');
  const controls = [
    [localized('Active instance', 'Instância ativa'), ref('_CONFIG', '$B$5'), '@'],
    [localized('Jobs', 'Jobs'), ref('_STATE', '$B$2'), '#,##0'],
    [localized('Families', 'Famílias'), ref('_STATE', '$B$3'), '#,##0'],
    [localized('Iteration budget', 'Orçamento de iterações'), ref('_CONFIG', '$B$7'), '#,##0'],
    [localized('Destroy size d', 'Tamanho de destruição d'), ref('_CONFIG', '$B$8'), '#,##0'],
    [localized('Replications', 'Repetições'), ref('_CONFIG', '$B$24'), '#,##0'],
  ];
  sheet.getRange('A13:D18').formulas = controls.map(([label]) => [label, null, null, null]);
  sheet.getRange('E13:F18').formulas = controls.map(([, formula]) => [formula, null]);
  tableStyle(sheet.getRange('A13:F18'), { size: 9 });
  sheet.getRange('A13:D18').format.font = { name: 'Roboto', size: 9, color: P.muted };
  sheet.getRange('E13:F18').format = {
    fill: P.tealSoft,
    font: { name: 'Roboto Mono', size: 10, bold: true, color: P.ink },
    horizontalAlignment: 'right',
    borders: { preset: 'outside', style: 'thin', color: P.grid },
  };
  controls.forEach(([, , format], index) => { sheet.getRange(`E${index + 13}:F${index + 13}`).format.numberFormat = format; });

  textPanel(
    sheet,
    'A20:F25',
    localized(
      'RUN IN 4 STEPS\n\n1  Open the project’s native /copy link.\n2  Create your private Google Sheet.\n3  IG Scheduler → Verify embedded engine (one-time authorization).\n4  IG Scheduler → Open control panel.\n\nDo not upload the .xlsx when the goal is to run.',
      'EXECUTE EM 4 PASSOS\n\n1  Abra o link /copy do projeto no Planilhas Google.\n2  Crie sua cópia privada.\n3  IG Scheduler → Verificar engine incorporado (autorização única).\n4  IG Scheduler → Abrir painel de controle.\n\nNão envie o .xlsx quando o objetivo for executar.',
    ),
    { fill: P.ink, color: P.white, border: P.ink, bold: true, size: 9 },
  );
  textPanel(
    sheet,
    'A26:F26',
    localized('CREATE RUNNABLE COPY ↗  /copy OR FILE → MAKE A COPY', 'CRIAR CÓPIA EXECUTÁVEL ↗  /copy OU ARQUIVO → FAZER UMA CÓPIA'),
    { fill: P.teal, color: P.white, border: P.teal, bold: true, align: 'center', vertical: 'center', size: 9 },
  );

  section(sheet, 'H11:P12', localized('THE DECISION', 'A DECISÃO'), 'amber');
  textPanel(
    sheet,
    'H13:P18',
    localized(
      'A candidate schedule must balance four real cost components:\n\nSETUP — changing the machine state or family\nEXECUTION — processing the selected jobs\nTARDINESS — finishing after a due date\nREJECTION — leaving a job outside the schedule\n\nThe lowest feasible total wins. A job may be rejected when forcing it into the sequence would cost more.',
      'Uma programação candidata precisa equilibrar quatro componentes reais de custo:\n\nPREPARAÇÃO — mudar o estado ou a família da máquina\nEXECUÇÃO — processar os jobs selecionados\nATRASO — terminar depois do prazo\nREJEIÇÃO — deixar um job fora da programação\n\nVence o menor total viável. Um job pode ser rejeitado quando forçá-lo na sequência custaria mais.',
    ),
    { fill: P.paper, size: 10 },
  );
  formulaPanel(
    sheet,
    'H20:P22',
    `=${quoteSheet('_CONFIG')}!$B$17+${quoteSheet('_CONFIG')}!$B$18+${quoteSheet('_CONFIG')}!$B$19+${quoteSheet('_CONFIG')}!$B$20`,
    { fill: P.amberSoft, color: P.ink, bold: true, size: 22, align: 'center', numberFormat: '#,##0' },
  );
  textPanel(sheet, 'H23:P25', localized('OBJECTIVE = SETUP + EXECUTION + TARDINESS + REJECTION', 'OBJETIVO = PREPARAÇÃO + EXECUÇÃO + ATRASO + REJEIÇÃO'), { fill: P.paper, bold: true, align: 'center', size: 9 });

  section(sheet, 'A27:P28', localized('READ THE WORKBOOK', 'COMO LER A PLANILHA'), 'ink');
  const journey = [
    ['01', 'RESULT', 'RESULTADO', 'Start with the decision and its cost.', 'Comece pela decisão e por seu custo.'],
    ['02', 'SCHEDULE', 'PROGRAMAÇÃO', 'Inspect the sequence and timing.', 'Examine a sequência e os tempos.'],
    ['03', 'EXPERIMENT', 'EXPERIMENTO', 'Measure robustness across seeds.', 'Meça a robustez entre sementes.'],
    ['04', 'EVIDENCE', 'EVIDÊNCIAS', 'Trace instance, method and controls.', 'Rastreie a instância, o método e os controles.'],
  ];
  const blocks = [['A', 'D'], ['E', 'H'], ['I', 'L'], ['M', 'P']];
  journey.forEach(([number, titleEn, titlePt, copyEn, copyPt], index) => {
    const [left, right] = blocks[index];
    textPanel(sheet, `${left}30:${right}35`, localized(`${number}  ${titleEn}\n\n${copyEn}`, `${number}  ${titlePt}\n\n${copyPt}`), { fill: index === 0 ? P.tealSoft : P.paper, bold: true, size: 10 });
  });
  textPanel(sheet, 'A37:P39', localized(
    'Portfolio build: canonical Rust WebAssembly solver · Apps Script V8 orchestration · independent objective verification · protected batch writes · language-switching BI interface.',
    'Projeto de portfólio: solver canônico em Rust WebAssembly · orquestração em Apps Script V8 · verificação independente do objetivo · escritas em lote protegidas · interface de BI com troca de idioma.',
  ), { fill: P.pale, color: P.muted, align: 'center', italic: true, size: 9 });
  sheet.freezePanes.freezeRows(2);
}

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------


{
  const sheet = sheets.DASHBOARD;
  applyBase(sheet, 'A1:Q50');
  setWidths(sheet, Array.from({ length: 17 }, (_, index) => [String.fromCharCode(65 + index), index === 0 ? 48 : 62]), 55);
  titleRail(sheet, localized('RESULT', 'RESULTADO'), localized('The result, its historical context, and why.', 'O resultado, seu contexto histórico e o motivo.'), localized('Decision KPIs, objective anatomy, and convergence', 'KPIs de decisão, composição do objetivo e convergência'));
  kpi(sheet, ['A', 'C'], localized('BEST', 'MELHOR'), ref('_CONFIG', '$B$11'), localized('verified objective', 'objetivo verificado'), P.teal);
  kpi(sheet, ['D', 'G'], localized('Δ HISTORICAL', 'Δ HISTÓRICO'), `=IF(${quoteSheet('_CONFIG')}!$B$13="","",${quoteSheet('_CONFIG')}!$B$13/100)`, localized('negative is better', 'negativo é melhor'), P.green, '0.00%');
  kpi(sheet, ['H', 'K'], localized('MEDIAN', 'MEDIANA'), ref('_CONFIG', '$B$25'), localized('across equal budgets', 'entre orçamentos iguais'), P.blue);
  kpi(sheet, ['L', 'N'], localized('SCHEDULED', 'PROGRAMADOS'), ref('_CONFIG', '$B$14'), localized('jobs kept in sequence', 'jobs mantidos na sequência'), P.amber);
  kpi(sheet, ['O', 'Q'], localized('REJECTED', 'REJEITADOS'), ref('_CONFIG', '$B$15'), localized('jobs left outside', 'jobs deixados de fora'), P.red);

  section(sheet, 'A10:H11', localized('BEST-SO-FAR CONVERGENCE', 'CONVERGÊNCIA DO MELHOR ATÉ AGORA'), 'ink');
  section(sheet, 'J10:Q11', localized('OBJECTIVE ANATOMY', 'COMPOSIÇÃO DO OBJETIVO'), 'ink');

  const convergence = sheet.charts.add('line', { chartType: 'line', title: 'Best objective across equal-budget runs', hasLegend: false });
  const convergenceSeries = convergence.series.add('Best observed');
  convergenceSeries.categoryFormula = `${quoteSheet('_CHECKPOINTS')}!$A$2:$A$${checkpointEndRow}`;
  convergenceSeries.formula = `${quoteSheet('_CHECKPOINTS')}!$B$2:$B$${checkpointEndRow}`;
  convergenceSeries.fill = P.teal;
  convergence.title = 'Best objective across equal-budget runs';
  convergence.titleTextStyle.fontSize = 12;
  convergence.hasLegend = false;
  convergence.xAxis = { axisType: 'textAxis', textStyle: { fontSize: 8 } };
  convergence.yAxis = { numberFormatCode: '#,##0', textStyle: { fontSize: 8 } };
  convergence.setPosition('A12', 'H29');

  const composition = sheet.charts.add('bar', sheets._CHARTS.getRange('D1:E5'));
  composition.title = 'Cost contribution by component';
  composition.titleTextStyle.fontSize = 12;
  composition.hasLegend = false;
  composition.xAxis = { axisType: 'textAxis', textStyle: { fontSize: 9 } };
  composition.yAxis = { numberFormatCode: '#,##0', textStyle: { fontSize: 8 } };
  composition.setPosition('J12', 'Q29');

  section(sheet, 'A31:H32', localized('DECISION READOUT', 'LEITURA DA DECISÃO'), 'teal');
  sheet.getRange('A33:D39').formulas = [
    [localized('Metric', 'Métrica'), localized('Value', 'Valor'), localized('Context', 'Contexto'), localized('Signal', 'Sinal')],
    [localized('Historical reference', 'Referência histórica'), null, localized('MaScLib / 2015 comparison; see repository RESULTS.md; not an optimum claim', 'Comparação MaScLib / 2015; consulte RESULTS.md no repositório; não é uma afirmação de ótimo'), localized('benchmark', 'referência')],
    [localized('Objective delta', 'Delta do objetivo'), null, localized('Negative means the run improved on the historical reference', 'Um valor negativo indica que a rodada melhorou a referência histórica'), localized('quality', 'qualidade')],
    [localized('Makespan', 'Duração total'), null, localized('Completion time of the final scheduled job', 'Instante de conclusão do último job programado'), localized('capacity', 'capacidade')],
    [localized('Setup share', 'Parcela de preparação'), null, localized('Setup cost divided by total objective', 'Custo de preparação dividido pelo objetivo total'), localized('sequence', 'sequência')],
    [localized('Reference hit rate', 'Taxa de alcance da referência'), null, localized('Runs at or below the historical reference', 'Rodadas iguais ou melhores que a referência histórica'), localized('robustness', 'robustez')],
    [localized('Evaluations', 'Avaliações'), null, localized('Candidate schedules priced in the best run', 'Programações candidatas avaliadas na melhor rodada'), localized('search', 'busca')],
  ];
  sheet.getRange('B34:B39').formulas = [
    [ref('_CONFIG', '$B$12')],
    [`=IF(${quoteSheet('_CONFIG')}!$B$13="","",${quoteSheet('_CONFIG')}!$B$13/100)`],
    [ref('_CONFIG', '$B$16')],
    [`=${quoteSheet('_CONFIG')}!$B$17/${quoteSheet('_CONFIG')}!$B$11`],
    [`=IF(${quoteSheet('_STATS')}!$B$2<2,"",${quoteSheet('_STATS')}!$B$9)`],
    [ref('_CONFIG', '$B$22')],
  ];
  tableStyle(sheet.getRange('A33:H39'), { size: 9, wrap: true });
  tableHeader(sheet.getRange('A33:H33'), P.ink2);
  sheet.getRange('B34').format.numberFormat = '#,##0';
  sheet.getRange('B35').format.numberFormat = '0.00%';
  sheet.getRange('B36').format.numberFormat = '#,##0';
  sheet.getRange('B37:B38').format.numberFormat = '0.0%';
  sheet.getRange('B39').format.numberFormat = '#,##0';
  sheet.getRange('A33:A39').format.columnWidthPx = 145;
  sheet.getRange('B33:B39').format.columnWidthPx = 90;
  sheet.getRange('C33:C39').format.columnWidthPx = 215;
  sheet.getRange('D33:D39').format.columnWidthPx = 80;

  section(sheet, 'J31:Q32', localized('WHAT THIS RESULT SAYS', 'O QUE ESTE RESULTADO DIZ'), 'amber');
  textPanel(
    sheet,
    'J33:Q39',
    localized(
      'Read the objective beside its historical reference, not as an isolated score. A negative delta means the solver improved on that comparison point; zero matches it; a positive delta shows the remaining distance. The run distribution below then shows whether that quality is repeatable across seeds.',
      'Leia o objetivo junto de sua referência histórica, não como um número isolado. Um delta negativo indica que o solver melhorou esse ponto de comparação; zero indica igualdade; um delta positivo mostra a distância restante. A distribuição das rodadas mostra se essa qualidade se repete entre sementes.',
    ),
    { fill: P.paper, size: 10 },
  );
  textPanel(sheet, 'A42:Q44', localized(
    'Runtime is environment-contextual. Objective values, feasibility, and evaluation counts are portable; milliseconds and evaluations/second should only be compared within the same environment.',
    'O tempo de execução depende do ambiente. Valores do objetivo, viabilidade e contagens de avaliações são portáteis; compare milissegundos e avaliações por segundo apenas no mesmo ambiente.',
  ), { fill: P.pale, color: P.muted, italic: true, align: 'center', size: 9 });
  setRows(sheet, [[33, 26], [34, 34], [35, 34], [36, 30], [37, 30], [38, 34], [39, 34], [42, 24], [43, 24], [44, 24]], 'Q');
  sheet.freezePanes.freezeRows(2);
}

// ---------------------------------------------------------------------------
// SCHEDULE
// ---------------------------------------------------------------------------


{
  const sheet = sheets.SCHEDULE;
  applyBase(sheet, 'A1:AM640');
  setWidths(sheet, [
    ['A', 42], ['B', 52], ['C', 54], ['D', 72], ['E', 72], ['F', 72], ['G', 72],
    ...Array.from({ length: 32 }, (_, index) => {
      const colNumber = 8 + index;
      let n = colNumber;
      let letters = '';
      while (n) { n -= 1; letters = String.fromCharCode(65 + (n % 26)) + letters; n = Math.floor(n / 26); }
      return [letters, 25];
    }),
  ], 645);
  titleRail(sheet, localized('SCHEDULE', 'PROGRAMAÇÃO'), localized('The sequence is the decision.', 'A sequência é a decisão.'), localized('Compact Gantt plus a complete job-level audit trail', 'Gantt compacto e trilha de auditoria completa por job'), 'AM');
  textPanel(sheet, 'A4:AM5', localized(
    'Read left to right: each row is one scheduled job. Gray marks setup; color marks processing by family. The compact view shows the first 20 positions; the full verified table begins below.',
    'Leia da esquerda para a direita: cada linha representa um job programado. Cinza indica preparação; as cores indicam o processamento por família. A visualização compacta mostra as primeiras 20 posições; a tabela completa e verificada começa abaixo.',
  ), { fill: P.paper, size: 9, border: P.teal });

  sheet.getRange('A7:G7').formulas = [[localized('#', '#'), localized('JOB', 'JOB'), localized('FAMILY', 'FAMÍLIA'), localized('SETUP', 'PREPARAÇÃO'), localized('START', 'INÍCIO'), localized('FINISH', 'FIM'), localized('DUE', 'PRAZO')]];
  tableHeader(sheet.getRange('A7:G7'), P.ink2);
  const firstWindowFinish = `MAX(${quoteSheet('_SCHEDULE')}!$L$2:$L$21)`;
  const timelineFormulas = Array.from({ length: 32 }, (_, index) => `=IF(${firstWindowFinish}=0,"",ROUND(${index}*${firstWindowFinish}/(${quoteSheet('_STATE')}!$B$5-1),0))`);
  sheet.getRange('H7:AM7').formulas = [timelineFormulas];
  sheet.getRange('H7:AM7').format = {
    fill: P.ink,
    font: { name: 'Roboto Mono', size: 7, color: P.white },
    horizontalAlignment: 'center',
    textOrientation: 90,
    borders: { preset: 'inside', style: 'thin', color: '#41515A' },
  };
  setRows(sheet, [[7, 58]], 'AM');

  const ganttRows = 20;
  const metaFormulas = Array.from({ length: ganttRows }, (_, index) => {
    const rawRow = index + 2;
    return [
      blankSafeRef('_SCHEDULE', `A${rawRow}`), blankSafeRef('_SCHEDULE', `C${rawRow}`), blankSafeRef('_SCHEDULE', `D${rawRow}`),
      blankSafeRef('_SCHEDULE', `H${rawRow}`), blankSafeRef('_SCHEDULE', `J${rawRow}`), blankSafeRef('_SCHEDULE', `L${rawRow}`), blankSafeRef('_SCHEDULE', `F${rawRow}`),
    ];
  });
  sheet.getRange(`A8:G${7 + ganttRows}`).formulas = metaFormulas;
  tableStyle(sheet.getRange(`A8:G${7 + ganttRows}`), { size: 8, mono: true });
  sheet.getRange(`A8:G${7 + ganttRows}`).format.horizontalAlignment = 'center';
  const ganttFormulas = Array.from({ length: ganttRows }, (_, rowIndex) => {
    const sheetRow = rowIndex + 8;
    return Array.from({ length: 32 }, (_, colIndex) => {
      const colNumber = 8 + colIndex;
      let n = colNumber;
      let letters = '';
      while (n) { n -= 1; letters = String.fromCharCode(65 + (n % 26)) + letters; n = Math.floor(n / 26); }
      return `=IF($A${sheetRow}="","",IF(AND(${letters}$7>=$D${sheetRow},${letters}$7<$E${sheetRow}),"S",IF(AND(${letters}$7>=$E${sheetRow},${letters}$7<$F${sheetRow}),"F"&$C${sheetRow},"")))`;
    });
  });
  sheet.getRange(`H8:AM${7 + ganttRows}`).formulas = ganttFormulas;
  sheet.getRange(`H8:AM${7 + ganttRows}`).format = {
    fill: P.paper,
    font: { name: 'Roboto Mono', size: 1, color: P.paper },
    horizontalAlignment: 'center',
    borders: { preset: 'all', style: 'thin', color: P.grid },
  };
  const ganttRange = sheet.getRange(`H8:AM${7 + ganttRows}`);
  ganttRange.conditionalFormats.addCustom('=H8="S"', { fill: P.setup, font: { color: P.setup } });
  FAMILY_COLORS.forEach((color, family) => {
    ganttRange.conditionalFormats.addCustom(`=H8="F${family}"`, { fill: color, font: { color } });
  });
  setRows(sheet, Array.from({ length: ganttRows }, (_, index) => [index + 8, 18]), 'AM');

  section(sheet, 'A30:AM31', localized('COMPLETE VERIFIED SCHEDULE', 'PROGRAMAÇÃO COMPLETA E VERIFICADA'), 'teal');
  const scheduleHeaders = [
    ['Position', 'Posição'], ['Status', 'Status'], ['Job', 'Job'], ['Family', 'Família'], ['Release', 'Liberação'], ['Due', 'Prazo'], ['Hard deadline', 'Limite rígido'], ['Setup start', 'Início da preparação'], ['Setup time', 'Tempo de preparação'],
    ['Process start', 'Início do processamento'], ['Processing', 'Processamento'], ['Finish', 'Conclusão'], ['Late', 'Atraso'], ['Setup cost', 'Custo de preparação'], ['Execution', 'Execução'], ['Tardiness', 'Custo de atraso'], ['Rejection', 'Rejeição'], ['Contribution', 'Contribuição'], ['Feasible', 'Viável'],
  ];
  sheet.getRange('A33:S33').formulas = [scheduleHeaders.map(([en, pt]) => localized(en, pt))];
  tableHeader(sheet.getRange('A33:S33'), P.ink2);
  const fullScheduleFormulas = Array.from({ length: 600 }, (_, index) => Array.from({ length: 19 }, (__, col) => {
    const sourceCell = `${quoteSheet('_SCHEDULE')}!${columnName(col + 1)}${index + 2}`;
    if (col === 1) return `=IF(ISBLANK(${sourceCell}),"",IF(${quoteSheet('_CONFIG')}!$B$2="pt-BR",IF(${sourceCell}="scheduled","programado",IF(${sourceCell}="rejected","rejeitado",${sourceCell})),${sourceCell}))`;
    return blankSafeRef('_SCHEDULE', `${columnName(col + 1)}${index + 2}`);
  }));
  sheet.getRange('A34:S633').formulas = fullScheduleFormulas;
  tableStyle(sheet.getRange('A34:S633'), { size: 8, mono: true });
  sheet.getRange('E34:R633').format.numberFormat = '#,##0';
  sheet.getRange('S34:S633').conditionalFormats.addCustom('=$S34=TRUE', { fill: P.greenSoft, font: { color: P.green, bold: true } });
  // The bounded 600-row view remains a formula-backed formatted range. The
  // technical source is a native table; Google Sheets can add its native
  // table object after import without making XLSX rendering pathological.
  sheet.freezePanes.freezeRows(7);
  sheet.freezePanes.freezeColumns(3);
}

// ---------------------------------------------------------------------------
// EXPERIMENTS
// ---------------------------------------------------------------------------


{
  const sheet = sheets.EXPERIMENTS;
  applyBase(sheet, 'A1:Q55');
  setWidths(sheet, Array.from({ length: 17 }, (_, index) => [String.fromCharCode(65 + index), index === 0 ? 48 : 62]), 60);
  titleRail(sheet, localized('EXPERIMENTS', 'EXPERIMENTOS'), localized('One result is a run. Reliability is a distribution.', 'Um resultado é uma rodada. Confiabilidade é uma distribuição.'), localized('Equal-budget replications separate solution quality from seed luck', 'Repetições com o mesmo orçamento separam qualidade da solução de sorte na semente'));
  kpi(sheet, ['A', 'C'], localized('RUNS', 'RODADAS'), ref('_STATS', '$B$2'), localized('same configuration', 'mesma configuração'), P.teal);
  kpi(sheet, ['D', 'G'], localized('HIT RATE', 'TAXA DE ACERTO'), `=IF(${quoteSheet('_STATS')}!$B$2<2,"",${quoteSheet('_STATS')}!$B$9)`, localized('needs ≥2 runs', 'requer ≥2 rodadas'), P.green, '0.0%');
  kpi(sheet, ['H', 'K'], localized('MEDIAN', 'MEDIANA'), ref('_STATS', '$B$4'), localized('typical observed outcome', 'resultado típico observado'), P.blue);
  kpi(sheet, ['L', 'N'], localized('IQR', 'IQR'), `=IF(${quoteSheet('_STATS')}!$B$2<2,"",${quoteSheet('_STATS')}!$B$7)`, localized('needs ≥2 runs', 'requer ≥2 rodadas'), P.amber, '#,##0');
  kpi(sheet, ['O', 'Q'], localized('SAMPLE SD', 'DESVIO PADRÃO'), `=IF(${quoteSheet('_STATS')}!$B$2<2,"",${quoteSheet('_STATS')}!$B$8)`, localized('needs ≥2 runs', 'requer ≥2 rodadas'), P.purple, '#,##0.0');

  section(sheet, 'A10:H11', localized('OUTCOME BY SEED', 'RESULTADO POR SEMENTE'), 'ink');
  section(sheet, 'J10:Q11', localized('SEARCH ENVELOPE', 'ENVELOPE DA BUSCA'), 'ink');
  const outcomes = sheet.charts.add('bar', { chartType: 'bar', title: 'Objective by seed vs historical reference', hasLegend: true });
  const outcomeSeries = outcomes.series.add('objective');
  outcomeSeries.categoryFormula = `${quoteSheet('_RUNS')}!$B$2:$B$101`;
  outcomeSeries.formula = `${quoteSheet('_RUNS')}!$C$2:$C$101`;
  outcomeSeries.fill = P.teal;
  const referenceSeries = outcomes.series.add('historical reference');
  referenceSeries.categoryFormula = `${quoteSheet('_RUNS')}!$B$2:$B$101`;
  referenceSeries.formula = `${quoteSheet('_CHARTS')}!$I$2:$I$101`;
  referenceSeries.fill = P.amber;
  outcomes.title = 'Objective by seed vs historical reference';
  outcomes.titleTextStyle.fontSize = 12;
  outcomes.hasLegend = true;
  outcomes.xAxis = { axisType: 'textAxis', textStyle: { fontSize: 9 } };
  outcomes.yAxis = { numberFormatCode: '#,##0', textStyle: { fontSize: 8 } };
  outcomes.setPosition('A12', 'H29');

  const envelope = sheet.charts.add('line', { chartType: 'line', title: 'Best, median and worst objective by iteration', hasLegend: true });
  for (const [label, column, color] of [['best', 'L', P.teal], ['median', 'M', P.amber], ['worst', 'N', P.green]]) {
    const series = envelope.series.add(label);
    const sourceColumn = { L: 'B', M: 'D', N: 'G' }[column];
    series.categoryFormula = `${quoteSheet('_CHECKPOINTS')}!$A$2:$A$${checkpointEndRow}`;
    series.formula = `${quoteSheet('_CHECKPOINTS')}!$${sourceColumn}$2:$${sourceColumn}$${checkpointEndRow}`;
    series.fill = color;
  }
  envelope.title = 'Best, median and worst objective by iteration';
  envelope.titleTextStyle.fontSize = 12;
  envelope.hasLegend = true;
  envelope.xAxis = { axisType: 'textAxis', textStyle: { fontSize: 8 } };
  envelope.yAxis = { numberFormatCode: '#,##0', textStyle: { fontSize: 8 } };
  envelope.setPosition('J12', 'Q29');

  section(sheet, 'A31:Q32', localized('REPLICATION REGISTER', 'REGISTRO DE REPETIÇÕES'), 'teal');
  const headers = [
    ['Run', 'Rodada'], ['Seed', 'Semente'], ['Objective', 'Objetivo'], ['Gap %', 'Delta %'], ['Iterations', 'Iterações'], ['Evaluations', 'Avaliações'], ['Runtime ms*', 'Tempo ms*'], ['Eval/s*', 'Aval./s*'], ['Scheduled', 'Programados'], ['Rejected', 'Rejeitados'], ['Best', 'Melhor'],
  ];
  sheet.getRange('A34:K34').formulas = [headers.map(([en, pt]) => localized(en, pt))];
  tableHeader(sheet.getRange('A34:K34'), P.ink2);
  const experimentFormulas = Array.from({ length: 100 }, (_, index) => Array.from({ length: 11 }, (__, col) => {
    const sourceCell = `${columnName(col + 1)}${index + 2}`;
    if (col === 3) {
      const source = `${quoteSheet('_RUNS')}!${sourceCell}`;
      return `=IF(${source}="","",${source}/100)`;
    }
    return blankSafeRef('_RUNS', sourceCell);
  }));
  sheet.getRange('A35:K134').formulas = experimentFormulas;
  tableStyle(sheet.getRange('A35:K134'), { size: 8, mono: true });
  sheet.getRange('C35:C134').format.numberFormat = '#,##0';
  sheet.getRange('D35:D134').format.numberFormat = '0.00%';
  sheet.getRange('G35:G134').format.numberFormat = '0.0';
  sheet.getRange('H35:H134').format.numberFormat = '#,##0';
  sheet.getRange('K35:K134').conditionalFormats.addCustom('=$K35=TRUE', { fill: P.greenSoft, font: { color: P.green, bold: true } });
  // Kept as a bounded formula-backed view; `_RUNS` is the native source table.
  textPanel(sheet, 'M34:Q44', localized(
    'INTERPRETATION\n\nUse the hit rate to see how often an equal-budget run reaches or improves on the historical comparison point. Median and IQR describe the typical result and its central spread; sample SD exposes sensitivity to the random seed. Keep the budget and configuration fixed before comparing.',
    'INTERPRETAÇÃO\n\nUse a taxa de acerto para ver com que frequência uma rodada com o mesmo orçamento alcança ou melhora o ponto de comparação histórico. Mediana e IQR descrevem o resultado típico e sua dispersão central; o desvio-padrão amostral revela sensibilidade à semente aleatória. Mantenha o orçamento e a configuração fixos antes de comparar.',
  ), { fill: P.paper, size: 9 });
  textPanel(sheet, 'A47:Q49', localized(
    '* Runtime and evaluations/second are diagnostic, not universal benchmarks. Compare them only under the same runtime, hardware, and Apps Script quota context.',
    '* Tempo de execução e avaliações por segundo são diagnósticos, não benchmarks universais. Compare-os apenas no mesmo ambiente, hardware e contexto de cota do Apps Script.',
  ), { fill: P.pale, color: P.muted, italic: true, align: 'center', size: 9 });
  sheet.freezePanes.freezeRows(2);
}

// ---------------------------------------------------------------------------
// INSTANCE
// ---------------------------------------------------------------------------


{
  const sheet = sheets.INSTANCE;
  applyBase(sheet, 'A1:Q685');
  setWidths(sheet, Array.from({ length: 17 }, (_, index) => [String.fromCharCode(65 + index), index === 0 ? 48 : 62]), 690);
  titleRail(sheet, localized('INSTANCE', 'INSTÂNCIA'), localized('What reality becomes before the solver can reason.', 'Como a realidade é representada antes de o solver raciocinar.'), localized('Jobs, families, time windows, and costs translated into one-machine scheduling data', 'Jobs, famílias, janelas de tempo e custos traduzidos em dados de programação para uma máquina'));
  kpi(sheet, ['A', 'D'], localized('JOBS', 'JOBS'), ref('_STATE', '$B$2'), localized('decisions to place or reject', 'decisões de programar ou rejeitar'), P.teal);
  kpi(sheet, ['E', 'H'], localized('FAMILIES', 'FAMÍLIAS'), ref('_STATE', '$B$3'), localized('machine states / product groups', 'estados da máquina / grupos de produtos'), P.blue);
  kpi(sheet, ['I', 'L'], localized('HORIZON', 'HORIZONTE'), ref('_STATE', '$B$4'), localized('hard planning limit', 'limite rígido de planejamento'), P.amber);
  kpi(sheet, ['M', 'Q'], localized('INITIAL STATE', 'ESTADO INICIAL'), ref('_STATE', '$B$10'), localized('machine family before job 1', 'família da máquina antes do job 1'), P.purple);

  section(sheet, 'A10:H11', localized('WORKLOAD BY FAMILY', 'CARGA POR FAMÍLIA'), 'ink');
  section(sheet, 'J10:Q11', localized('TIME-WINDOW GEOMETRY', 'GEOMETRIA DAS JANELAS DE TEMPO'), 'ink');
  const workload = sheet.charts.add('bar', { chartType: 'bar', title: 'Processing workload by family', hasLegend: false });
  const workloadSeries = workload.series.add('processing time');
  workloadSeries.categoryFormula = `${quoteSheet('_CHARTS')}!$AE$2:$AE$12`;
  workloadSeries.formula = `${quoteSheet('_CHARTS')}!$AF$2:$AF$12`;
  workloadSeries.fill = P.teal;
  workload.title = 'Processing workload by family';
  workload.titleTextStyle.fontSize = 12;
  workload.hasLegend = true;
  workload.xAxis = { axisType: 'textAxis', textStyle: { fontSize: 9 } };
  workload.yAxis = { numberFormatCode: '#,##0', textStyle: { fontSize: 8 } };
  workload.setPosition('A12', 'H29');

  const timing = sheet.charts.add('scatter', { chartType: 'scatter', title: 'Due-date profile by job ID', hasLegend: false });
  const timingSeries = timing.series.add('jobs');
  timingSeries.categoryFormula = `${quoteSheet('_INSTANCE')}!$B$2:$B$601`;
  timingSeries.formula = `${quoteSheet('_INSTANCE')}!$F$2:$F$601`;
  timingSeries.fill = P.teal;
  timing.title = 'Due-date profile by job ID';
  timing.titleTextStyle.fontSize = 12;
  timing.hasLegend = false;
  timing.xAxis = { textStyle: { fontSize: 8 }, numberFormatCode: '#,##0' };
  timing.yAxis = { textStyle: { fontSize: 8 }, numberFormatCode: '#,##0' };
  timing.setPosition('J12', 'Q29');

  section(sheet, 'A31:H32', localized('WHAT THE ENGINE SEES', 'O QUE O MOTOR VÊ'), 'teal');
  textPanel(sheet, 'A33:H43', localized(
    'Each job carries a family, processing time and execution cost; a release time; a due date with a tardiness weight; a hard deadline; and a rejection cost. The sequence changes setup cost because moving between families changes the machine state.',
    'Cada job traz uma família, um tempo e um custo de processamento; um instante de liberação; um prazo com peso de atraso; um limite rígido; e um custo de rejeição. A sequência altera o custo de preparação porque a passagem entre famílias muda o estado da máquina.',
  ), { fill: P.paper, size: 10 });

  section(sheet, 'J31:Q32', localized('FAMILY PROFILE', 'PERFIL POR FAMÍLIA'), 'amber');
  sheet.getRange('J33:N33').formulas = [[localized('Family', 'Família'), localized('Jobs', 'Jobs'), localized('Proc. time', 'Tempo proc.'), localized('Exec. cost', 'Custo exec.'), localized('Reject exposure', 'Exposição à rejeição')]];
  tableHeader(sheet.getRange('J33:N33'), P.ink2);
  sheet.getRange('J34:N44').formulas = Array.from({ length: 11 }, (_, index) => Array.from({ length: 5 }, (__, col) => blankSafeRef('_CHARTS', `${columnName(16 + col)}${index + 2}`)));
  tableStyle(sheet.getRange('J34:N44'), { size: 8, mono: true });
  sheet.getRange('K34:N44').format.numberFormat = '#,##0';

  section(sheet, 'A46:Q47', localized('SEQUENCE-DEPENDENT TRANSITIONS', 'TRANSIÇÕES DEPENDENTES DA SEQUÊNCIA'), 'ink');
  section(sheet, 'A49:L49', localized('SETUP TIME MATRIX', 'MATRIZ DE TEMPO DE PREPARAÇÃO'), 'teal');
  sheet.getRange('A50:L61').formulas = Array.from({ length: 12 }, (_, row) => Array.from({ length: 12 }, (__, col) => {
    if (row === 0 && col === 0) return localized('From → To', 'De → Para');
    const source = `INDEX(${quoteSheet('_SETUPS')}!$A$1:$Y$12,${row + 1},${col + 1})`;
    return `=IF(${col + 1}<=MATCH("from_to_cost",${quoteSheet('_SETUPS')}!$A$1:$Y$1,0)-2,IF(ISBLANK(${source}),"",${source}),"")`;
  }));
  tableStyle(sheet.getRange('A50:L61'), { size: 8, mono: true });
  tableHeader(sheet.getRange('A50:L50'), P.blue);
  sheet.getRange('A50:A61').format = { fill: P.blueSoft, font: { name: 'Roboto Mono', size: 8, bold: true, color: P.ink }, horizontalAlignment: 'center' };
  sheet.getRange('B51:L61').conditionalFormats.add('colorScale', { colors: [P.paper, P.blueSoft, P.blue], thresholds: ['min', '50%', 'max'] });

  section(sheet, 'A64:L64', localized('SETUP COST MATRIX', 'MATRIZ DE CUSTO DE PREPARAÇÃO'), 'amber');
  sheet.getRange('A65:L76').formulas = Array.from({ length: 12 }, (_, row) => Array.from({ length: 12 }, (__, col) => {
    if (row === 0 && col === 0) return localized('From → To', 'De → Para');
    return `=IFERROR(INDEX(${quoteSheet('_SETUPS')}!$A$1:$Y$12,${row + 1},MATCH("from_to_cost",${quoteSheet('_SETUPS')}!$A$1:$Y$1,0)+${col}),"")`;
  }));
  tableStyle(sheet.getRange('A65:L76'), { size: 8, mono: true });
  tableHeader(sheet.getRange('A65:L65'), P.amber);
  sheet.getRange('A65:A76').format = { fill: P.amberSoft, font: { name: 'Roboto Mono', size: 8, bold: true, color: P.ink }, horizontalAlignment: 'center' };
  sheet.getRange('B66:L76').conditionalFormats.add('colorScale', { colors: [P.paper, P.amberSoft, P.amber], thresholds: ['min', '50%', 'max'] });
  textPanel(sheet, 'N49:Q76', localized(
    'HOW TO READ\n\nRows show the machine state before a transition; columns show the state required by the next job. Setup time consumes capacity. Setup cost adds to the objective. They remain separate because a transition may consume time, money, material, energy, or risk in different proportions.',
    'COMO LER\n\nAs linhas mostram o estado da máquina antes da transição; as colunas mostram o estado exigido pelo próximo job. O tempo de preparação consome capacidade. O custo de preparação entra no objetivo. Eles permanecem separados porque uma transição pode consumir tempo, dinheiro, material, energia ou risco em proporções diferentes.',
  ), { fill: P.paper, size: 9 });

  section(sheet, 'A79:Q80', localized('SOURCE JOB TABLE', 'TABELA-FONTE DE JOBS'), 'ink');
  const headers = [
    ['Internal ID', 'ID interno'], ['Job ID', 'ID do job'], ['Family', 'Família'], ['Processing time', 'Tempo de processamento'], ['Release', 'Liberação'], ['Due', 'Prazo'], ['Hard deadline', 'Limite rígido'], ['Tardiness weight', 'Peso do atraso'], ['Execution cost', 'Custo de execução'], ['Rejection cost', 'Custo de rejeição'],
  ];
  sheet.getRange('A82:J82').formulas = [headers.map(([en, pt]) => localized(en, pt))];
  tableHeader(sheet.getRange('A82:J82'), P.ink2);
  sheet.getRange('A83:J682').formulas = Array.from({ length: 600 }, (_, index) => Array.from({ length: 10 }, (__, col) => blankSafeRef('_INSTANCE', `${columnName(col + 1)}${index + 2}`)));
  tableStyle(sheet.getRange('A83:J682'), { size: 8, mono: true });
  sheet.getRange('D83:J682').format.numberFormat = '#,##0';
  // Keep the visible table as a formula-backed BI view so its headers can
  // switch language. `_INSTANCE` remains the native, filterable source table.
  textPanel(sheet, 'L82:Q90', localized(
    'MODEL NOTE\n\nThe raw table stays flat and machine-readable: one job per row, one variable per column. Select a different bundled instance in the control room and this data contract, the transition matrices, and every dependent view refresh together.',
    'NOTA DO MODELO\n\nA tabela bruta permanece plana e legível por máquina: um job por linha e uma variável por coluna. Selecione outra instância incluída na sala de controle, e este contrato de dados, as matrizes de transição e todas as visualizações dependentes serão atualizados em conjunto.',
  ), { fill: P.amberSoft, size: 9 });
  sheet.freezePanes.freezeRows(2);
}

// ---------------------------------------------------------------------------
// METHOD
// ---------------------------------------------------------------------------


{
  const sheet = sheets.METHOD;
  applyBase(sheet, 'A1:Q56');
  setWidths(sheet, Array.from({ length: 17 }, (_, index) => [String.fromCharCode(65 + index), index === 0 ? 48 : 62]), 60);
  titleRail(sheet, localized('METHOD', 'MÉTODO'), localized('Iterated Greedy: controlled disruption as a search engine.', 'Iterated Greedy: perturbação controlada como motor de busca.'), localized('A simple loop that explores a combinatorial space without enumerating every schedule', 'Um ciclo simples que explora um espaço combinatório sem enumerar todas as programações'));
  setRows(sheet, [[4, 32], [5, 32], [6, 32], [7, 32]], 'Q');
  textPanel(sheet, 'A4:Q7', localized(
    'Enumerating every order quickly becomes impractical: n jobs already imply n! permutations, before timing, rejection, and setup decisions. IG searches instead. It keeps a strong schedule, removes a small set, rebuilds under the real objective, and chooses the state that guides the next iteration.',
    'Enumerar todas as ordens rapidamente se torna impraticável: n jobs já implicam n! permutações, antes das decisões de tempo, rejeição e preparação. O IG realiza uma busca: preserva uma boa programação, remove um pequeno conjunto, reconstrói sob o objetivo real e escolhe o estado que orientará a próxima iteração.',
  ), { fill: P.paper, size: 10, border: P.teal });

  const steps = [
    ['01', 'CONSTRUCT', 'CONSTRUIR', 'Build a feasible starting schedule with real costs and constraints.', 'Crie uma programação inicial viável com custos e restrições reais.'],
    ['02', 'DESTROY', 'DESTRUIR', 'Remove d jobs. Randomness opens a different neighborhood.', 'Remova d jobs. A aleatoriedade abre uma vizinhança diferente.'],
    ['03', 'REBUILD', 'RECONSTRUIR', 'Reinsert jobs where the evaluated objective improves most.', 'Reinsira os jobs nas posições que mais melhoram o objetivo avaliado.'],
    ['04', 'ACCEPT', 'ACEITAR', 'Keep the best-ever schedule; choose the state that guides the next loop.', 'Preserve a melhor programação encontrada e escolha o estado que orientará o próximo ciclo.'],
  ];
  const ranges = ['A9:D19', 'E9:H19', 'I9:L19', 'M9:Q19'];
  steps.forEach(([number, titleEn, titlePt, copyEn, copyPt], index) => {
    textPanel(sheet, ranges[index], localized(`${number}\n${titleEn}\n\n${copyEn}`, `${number}\n${titlePt}\n\n${copyPt}`), { fill: index % 2 ? P.paper : P.tealSoft, bold: true, size: 10 });
  });

  section(sheet, 'A22:H23', localized('LIVE CONFIGURATION', 'CONFIGURAÇÃO ATUAL'), 'teal');
  for (let row = 24; row <= 29; row += 1) {
    sheet.mergeCells(`A${row}:B${row}`);
    sheet.mergeCells(`D${row}:G${row}`);
  }
  sheet.getRange('A24').formulas = [[localized('Parameter', 'Parâmetro')]];
  sheet.getRange('C24').formulas = [[localized('Value', 'Valor')]];
  sheet.getRange('D24').formulas = [[localized('Role', 'Função')]];
  sheet.getRange('H24').formulas = [[localized('Audit', 'Auditoria')]];
  const methodParameters = [
    ['Iterations', 'Iterações', ref('_CONFIG', '$B$7'), 'Equal search budget per seed', 'Mesmo orçamento de busca por semente', 'fixed', 'fixo'],
    ['Destroy size d', 'Tamanho de destruição d', ref('_CONFIG', '$B$8'), 'Jobs removed per iteration', 'Jobs removidos por iteração', 'fixed', 'fixo'],
    ['Acceptance', 'Aceitação', ref('_CONFIG', '$B$9'), 'State used to continue search', 'Estado usado para continuar a busca', 'declared', 'declarado'],
    ['Accepted ↔ rejected pass', 'Passo aceitos ↔ rejeitados', `=IF(${quoteSheet('_CONFIG')}!$B$10,IF(${quoteSheet('_CONFIG')}!$B$2="pt-BR","ligado","on"),IF(${quoteSheet('_CONFIG')}!$B$2="pt-BR","desligado","off"))`, 'Tests swaps after each rebuild', 'Testa trocas após cada reconstrução', 'declared', 'declarado'],
    ['Seeds', 'Sementes', ref('_CONFIG', '$B$24'), 'Independent replications', 'Repetições independentes', 'unique', 'únicas'],
  ];
  methodParameters.forEach(([labelEn, labelPt, formula, roleEn, rolePt, auditEn, auditPt], index) => {
    const row = index + 25;
    sheet.getRange(`A${row}`).formulas = [[localized(labelEn, labelPt)]];
    sheet.getRange(`C${row}`).formulas = [[formula]];
    sheet.getRange(`D${row}`).formulas = [[localized(roleEn, rolePt)]];
    sheet.getRange(`H${row}`).formulas = [[localized(auditEn, auditPt)]];
  });
  tableStyle(sheet.getRange('A24:H29'), { size: 9, wrap: true });
  tableHeader(sheet.getRange('A24:H24'), P.ink2);
  sheet.getRange('C25:C29').format = { fill: P.tealSoft, font: { name: 'Roboto Mono', size: 10, bold: true, color: P.ink }, horizontalAlignment: 'center' };
  setRows(sheet, [[24, 26], [25, 34], [26, 34], [27, 34], [28, 34], [29, 34]], 'Q');

  section(sheet, 'J22:Q23', localized('OBJECTIVE', 'OBJETIVO'), 'amber');
  textPanel(sheet, 'J24:Q29', localized(
    'MINIMIZE\n\nΣ setup + Σ execution + Σ weighted tardiness + Σ rejected-job cost\n\nsubject to release times, hard deadlines, machine state, and one-machine capacity.',
    'MINIMIZAR\n\nΣ preparação + Σ execução + Σ atraso ponderado + Σ custo dos jobs rejeitados\n\nsujeito a liberações, limites rígidos, estado da máquina e capacidade de uma máquina.',
  ), { fill: P.amberSoft, mono: true, bold: true, size: 10, align: 'center', vertical: 'center' });

  section(sheet, 'A32:H33', localized('REFERENCE PSEUDOCODE', 'PSEUDOCÓDIGO DE REFERÊNCIA'), 'ink');
  textPanel(sheet, 'A34:H46', localized(
    'current ← construct(instance)\nbest ← current\n\nrepeat for iteration budget:\n  removed, partial ← destroy(current, d, seed)\n  candidate ← reconstruct(partial, removed)\n  candidate.cost ← evaluate(candidate)\n\n  if candidate.cost < best.cost:\n    best ← candidate\n\n  current ← acceptance(current, candidate)\n\nreturn best',
    'atual ← construir(instância)\nmelhor ← atual\n\nrepetir pelo orçamento de iterações:\n  removidos, parcial ← destruir(atual, d, semente)\n  candidato ← reconstruir(parcial, removidos)\n  candidato.custo ← avaliar(candidato)\n\n  se candidato.custo < melhor.custo:\n    melhor ← candidato\n\n  atual ← aceitar(atual, candidato)\n\nretornar melhor',
  ), { fill: P.ink, color: '#E5EEF1', mono: true, size: 9, border: P.ink });

  section(sheet, 'J32:Q33', localized('WHY RANDOMNESS HELPS', 'POR QUE A ALEATORIEDADE AJUDA'), 'teal');
  textPanel(sheet, 'J34:Q46', localized(
    'Randomness is not decorative noise. It is the motor that chooses different jobs during destruction and, when enabled, guides accepted ↔ rejected swap tests. This helps the search leave one local pattern. Reproducible seeds make that exploration measurable.',
    'A aleatoriedade não é ruído decorativo. Ela é o motor que escolhe jobs diferentes durante a destruição e, quando habilitada, orienta os testes de troca entre aceitos e rejeitados. Isso ajuda a busca a sair de um padrão local. Sementes reproduzíveis tornam essa exploração mensurável.',
  ), { fill: P.paper, size: 10 });
  textPanel(sheet, 'A49:Q52', localized(
    'Scientific reading: report the distribution across seeds, use equal budgets, disclose the acceptance rule, keep the instance fixed, and compare objective quality separately from environment-dependent runtime.',
    'Leitura científica: reporte a distribuição entre sementes, use orçamentos iguais, declare a regra de aceitação, mantenha a instância fixa e compare a qualidade do objetivo separadamente do tempo de execução dependente do ambiente.',
  ), { fill: P.pale, color: P.muted, italic: true, align: 'center', size: 9 });
  sheet.freezePanes.freezeRows(2);
}

// ---------------------------------------------------------------------------
// ENGINEERING
// ---------------------------------------------------------------------------


{
  const sheet = sheets.ENGINEERING;
  applyBase(sheet, 'A1:Q62');
  setWidths(sheet, Array.from({ length: 17 }, (_, index) => [String.fromCharCode(65 + index), index === 0 ? 48 : 62]), 65);
  titleRail(sheet, localized('ENGINEERING', 'ENGENHARIA'), localized('A spreadsheet interface with a real solver behind it.', 'Uma interface de planilha com um solver real por trás.'), localized('Architecture, data lineage, controls, and reproducibility', 'Arquitetura, linhagem de dados, controles e reprodutibilidade'));

  section(sheet, 'A4:Q5', localized('DATA LINEAGE', 'LINHAGEM DE DADOS'), 'teal');
  const architecture = [
    ['01', 'CONTROL ROOM', 'SALA DE CONTROLE', 'Sidebar validates scenario, budget, and seeds.', 'A barra lateral valida cenário, orçamento e sementes.'],
    ['02', 'APPS SCRIPT V8', 'APPS SCRIPT V8', 'Orchestrates work and instantiates WebAssembly.', 'Orquestra o trabalho e instancia o WebAssembly.'],
    ['03', 'RUST WASM', 'RUST WASM', 'Runs the canonical fixed-point IG engine.', 'Executa o motor IG canônico com ponto fixo.'],
    ['04', 'INDEPENDENT EVALUATOR', 'AVALIADOR INDEPENDENTE', 'Reprices the returned order before writing.', 'Recalcula o custo da ordem retornada antes da escrita.'],
    ['05', 'LOCKED BATCH WRITE', 'ESCRITA EM LOTE BLOQUEADA', 'Updates technical tables once, under DocumentLock.', 'Atualiza as tabelas técnicas uma única vez, sob DocumentLock.'],
    ['06', 'BI LAYER', 'CAMADA DE BI', 'Formulas, tables, and charts refresh from the contract.', 'Fórmulas, tabelas e gráficos são atualizados a partir do contrato.'],
  ];
  const archRanges = ['A7:C15', 'D7:F15', 'G7:I15', 'J7:L15', 'M7:O15', 'P7:Q15'];
  architecture.forEach(([number, nameEn, namePt, detailEn, detailPt], index) => {
    textPanel(sheet, archRanges[index], localized(`${number}\n${nameEn}\n\n${detailEn}`, `${number}\n${namePt}\n\n${detailPt}`), { fill: index % 2 ? P.paper : P.tealSoft, bold: true, size: index === 5 ? 8 : 9, align: 'center', vertical: 'center' });
  });

  section(sheet, 'A18:H19', localized('TRUST CONTROLS', 'CONTROLES DE CONFIANÇA'), 'ink');
  for (let row = 20; row <= 29; row += 1) {
    sheet.mergeCells(`A${row}:B${row}`);
    sheet.mergeCells(`D${row}:F${row}`);
    sheet.mergeCells(`G${row}:H${row}`);
  }
  sheet.getRange('A20').formulas = [[localized('Control', 'Controle')]];
  sheet.getRange('C20').formulas = [[localized('Status', 'Status')]];
  sheet.getRange('D20').formulas = [[localized('Evidence', 'Evidência')]];
  sheet.getRange('G20').formulas = [[localized('Purpose', 'Finalidade')]];
  const trustRows = [
    ['Objective closes', 'Fechamento do objetivo', '4 cost components', '4 componentes de custo', 'No unpriced score', 'Nenhum valor sem custo'],
    ['Jobs accounted', 'Jobs contabilizados', 'scheduled + rejected', 'programados + rejeitados', 'No lost job', 'Nenhum job perdido'],
    ['Hard constraints', 'Restrições rígidas', 'feasible flag', 'indicador de viabilidade', 'No hidden infeasibility', 'Nenhuma inviabilidade oculta'],
    ['Unique jobs', 'Jobs únicos', 'duplicate scan', 'varredura de duplicatas', 'No duplicate decision', 'Nenhuma decisão duplicada'],
    ['Monotone best', 'Melhor monotônico', 'checkpoint audit', 'auditoria de checkpoints', 'Honest best-so-far', 'Melhor-até-agora honesto'],
    ['Equal budgets', 'Orçamentos iguais', 'per-run check', 'verificação por rodada', 'Fair seed comparison', 'Comparação justa entre sementes'],
    ['Unique seeds', 'Sementes únicas', 'duplicate scan', 'varredura de duplicatas', 'Independent replication', 'Repetição independente'],
    ['Historical reference', 'Referência histórica', 'catalog metadata', 'metadados do catálogo', 'Honest comparison', 'Comparação honesta'],
    ['Canonical engine', 'Motor canônico', 'engine contract', 'contrato do motor', 'Same solver core', 'Mesmo núcleo do solver'],
  ];
  trustRows.forEach(([controlEn, controlPt, evidenceEn, evidencePt, purposeEn, purposePt], index) => {
    const row = index + 21;
    sheet.getRange(`A${row}`).formulas = [[localized(controlEn, controlPt)]];
    const auditSource = `${quoteSheet('_AUDIT')}!D${index + 2}`;
    sheet.getRange(`C${row}`).formulas = [[`=IF(${quoteSheet('_CONFIG')}!$B$2="pt-BR",IF(${auditSource}="PASS","APROVADO","REPROVADO"),${auditSource})`]];
    sheet.getRange(`D${row}`).formulas = [[localized(evidenceEn, evidencePt)]];
    sheet.getRange(`G${row}`).formulas = [[localized(purposeEn, purposePt)]];
  });
  tableStyle(sheet.getRange('A20:H29'), { size: 8, wrap: true });
  tableHeader(sheet.getRange('A20:H20'), P.ink2);
  sheet.getRange('C21:C29').conditionalFormats.add('containsText', { text: 'PASS', format: { fill: P.greenSoft, font: { color: P.green, bold: true } } });
  sheet.getRange('C21:C29').conditionalFormats.add('containsText', { text: 'FAIL', format: { fill: P.redSoft, font: { color: P.red, bold: true } } });
  sheet.getRange('C21:C29').conditionalFormats.add('containsText', { text: 'APROVADO', format: { fill: P.greenSoft, font: { color: P.green, bold: true } } });
  sheet.getRange('C21:C29').conditionalFormats.add('containsText', { text: 'REPROVADO', format: { fill: P.redSoft, font: { color: P.red, bold: true } } });

  section(sheet, 'J18:Q19', localized('IMPLEMENTATION PROFILE', 'PERFIL DE IMPLEMENTAÇÃO'), 'amber');
  for (let row = 20; row <= 27; row += 1) {
    sheet.mergeCells(`J${row}:K${row}`);
    sheet.mergeCells(`L${row}:M${row}`);
    sheet.mergeCells(`N${row}:O${row}`);
    sheet.mergeCells(`P${row}:Q${row}`);
  }
  sheet.getRange('J20').formulas = [[localized('Attribute', 'Atributo')]];
  sheet.getRange('L20').formulas = [[localized('Value', 'Valor')]];
  sheet.getRange('N20').formulas = [[localized('Design choice', 'Decisão de projeto')]];
  sheet.getRange('P20').formulas = [[localized('Why', 'Motivo')]];
  const engineeringRows = [
    ['Solver', 'Solver', 'Rust WebAssembly', 'Rust WebAssembly', 'Rust → WASM', 'Rust → WASM', 'Portable canonical core', 'Núcleo canônico portátil'],
    ['Arithmetic', 'Aritmética', null, null, 'Fixed-point', 'Ponto fixo', 'Stable objective', 'Objetivo estável'],
    ['Payload', 'Carga', null, null, 'Embedded', 'Embutida', 'No runtime dependency', 'Sem dependência em execução'],
    ['Writes', 'Escritas', 'Batch only', 'Somente em lote', 'Technical tables', 'Tabelas técnicas', 'Quota-efficient', 'Uso eficiente da cota'],
    ['Concurrency', 'Concorrência', 'DocumentLock', 'DocumentLock', 'One commit at a time', 'Um commit por vez', 'No collisions', 'Sem colisões'],
    ['Authorization', 'Autorização', '@OnlyCurrentDoc', '@OnlyCurrentDoc', 'Workbook-scoped', 'Escopo da planilha', 'Least privilege', 'Privilégio mínimo'],
    ['Runtime note', 'Nota de execução', null, null, 'Contextual metric', 'Métrica contextual', 'No false benchmark', 'Sem benchmark enganoso'],
  ];
  engineeringRows.forEach(([attributeEn, attributePt, valueEn, valuePt, designEn, designPt, whyEn, whyPt], index) => {
    const row = index + 21;
    sheet.getRange(`J${row}`).formulas = [[localized(attributeEn, attributePt)]];
    if (valueEn != null) sheet.getRange(`L${row}`).formulas = [[localized(valueEn, valuePt)]];
    sheet.getRange(`N${row}`).formulas = [[localized(designEn, designPt)]];
    sheet.getRange(`P${row}`).formulas = [[localized(whyEn, whyPt)]];
  });
  sheet.getRange('L22').formulas = [[ref('_STATE', '$B$7')]];
  sheet.getRange('L23').formulas = [[ref('_STATE', '$B$8')]];
  sheet.getRange('L27').formulas = [[ref('_STATE', '$B$9')]];
  tableStyle(sheet.getRange('J20:Q27'), { size: 8, wrap: true });
  tableHeader(sheet.getRange('J20:Q20'), P.ink2);
  setRows(sheet, [[20, 26], ...Array.from({ length: 9 }, (_, index) => [index + 21, 30])], 'Q');

  section(sheet, 'A32:H33', localized('PUBLIC DEMO MODEL', 'MODELO DE DEMONSTRAÇÃO PÚBLICA'), 'teal');
  textPanel(sheet, 'A34:H43', localized(
    'Recommended distribution:\n\n1. Publish the master workbook as view-only.\n2. Keep a verified, prefilled example visible.\n3. Let visitors create their own copy.\n4. The copied bound script runs under the visitor’s authorization.\n5. Protecting or hiding technical tabs improves usability, but is not a security boundary.\n\nNever publish the master as a shared editor workspace: concurrent visitors would overwrite one another.',
    'Distribuição recomendada:\n\n1. Publique a planilha principal apenas para visualização.\n2. Mantenha visível um exemplo preenchido e verificado.\n3. Permita que os visitantes criem sua própria cópia.\n4. O script vinculado da cópia é executado com a autorização do visitante.\n5. Proteger ou ocultar abas técnicas melhora a usabilidade, mas não cria uma barreira de segurança.\n\nNunca publique a planilha principal como um espaço de edição compartilhado: visitantes simultâneos sobrescreveriam o trabalho uns dos outros.',
  ), { fill: P.paper, size: 9 });

  section(sheet, 'J32:Q33', localized('REPRODUCE', 'REPRODUZIR'), 'ink');
  textPanel(sheet, 'J34:Q43', localized(
    'The workbook ships with a deterministic, prefilled experiment. To reproduce any result, keep the same instance, iteration budget, destroy size, acceptance rule, accepted ↔ rejected swap setting, and seed list.\n\nObjective and order are reproducible. Runtime is environment-dependent.',
    'A planilha inclui um experimento determinístico preenchido. Para reproduzir qualquer resultado, mantenha a mesma instância, o orçamento de iterações, o tamanho de destruição, a regra de aceitação, a configuração da troca entre aceitos e rejeitados e a lista de sementes.\n\nO objetivo e a ordem são reproduzíveis. O tempo de execução depende do ambiente.',
  ), { fill: P.paper, size: 9 });

  section(sheet, 'A46:Q47', localized('ENGINEERING RECEIPT', 'RECIBO DE ENGENHARIA'), 'amber');
  for (let row = 49; row <= 55; row += 1) {
    sheet.mergeCells(`A${row}:B${row}`);
    sheet.mergeCells(`C${row}:D${row}`);
    sheet.mergeCells(`F${row}:H${row}`);
  }
  sheet.getRange('A49').formulas = [[localized('Evidence', 'Evidência')]];
  sheet.getRange('C49').formulas = [[localized('Value', 'Valor')]];
  sheet.getRange('E49').formulas = [[localized('Unit', 'Unidade')]];
  sheet.getRange('F49').formulas = [[localized('Interpretation', 'Interpretação')]];
  const receiptRows = [
    ['Engine payload', 'Carga do motor', ref('_STATE', '$B$8'), 'bytes', 'bytes', 'Embedded canonical WASM', 'WASM canônico embutido'],
    ['Fixed-point scale', 'Escala de ponto fixo', ref('_STATE', '$B$7'), '×', '×', 'Objective arithmetic precision', 'Precisão aritmética do objetivo'],
    ['Best-run evaluations', 'Avaliações da melhor rodada', ref('_CONFIG', '$B$22'), 'schedules', 'programações', 'Real candidate pricings', 'Avaliações reais de candidatos'],
    ['Mean evaluations/run', 'Média de avaliações/rodada', ref('_STATS', '$B$10'), 'schedules', 'programações', 'Search effort', 'Esforço de busca'],
    ['Mean runtime', 'Tempo médio', ref('_STATS', '$B$11'), 'ms*', 'ms*', 'Current environment only', 'Somente no ambiente atual'],
    ['Mean throughput', 'Vazão média', ref('_STATS', '$B$12'), 'eval/s*', 'aval./s*', 'Current environment only', 'Somente no ambiente atual'],
  ];
  receiptRows.forEach(([evidenceEn, evidencePt, formula, unitEn, unitPt, interpretationEn, interpretationPt], index) => {
    const row = index + 50;
    sheet.getRange(`A${row}`).formulas = [[localized(evidenceEn, evidencePt)]];
    sheet.getRange(`C${row}`).formulas = [[formula]];
    sheet.getRange(`E${row}`).formulas = [[localized(unitEn, unitPt)]];
    sheet.getRange(`F${row}`).formulas = [[localized(interpretationEn, interpretationPt)]];
  });
  tableStyle(sheet.getRange('A49:H55'), { size: 9, wrap: true });
  tableHeader(sheet.getRange('A49:H49'), P.ink2);
  sheet.getRange('C50:C53').format.numberFormat = '#,##0';
  sheet.getRange('C54:C55').format.numberFormat = '#,##0.0';
  setRows(sheet, [[49, 28], ...Array.from({ length: 6 }, (_, index) => [index + 50, 34])], 'Q');
  textPanel(sheet, 'J49:Q55', localized(
    'TOTAL QUALITY\n\nFast solver loop · zero cell I/O during search · independent re-evaluation · deterministic seeds · compact payload · language-switching UX · protected commit · auditable formulas · native charts and tables.',
    'QUALIDADE TOTAL\n\nCiclo rápido do solver · zero I/O de células durante a busca · reavaliação independente · sementes determinísticas · carga compacta · UX com troca de idioma · commit protegido · fórmulas auditáveis · gráficos e tabelas nativos.',
  ), { fill: P.ink, color: P.white, bold: true, align: 'center', vertical: 'center', size: 10, border: P.ink });
  sheet.freezePanes.freezeRows(2);
}

// Compact row heights on visible sheets.
for (const name of VISIBLE) {
  const sheet = sheets[name];
  sheet.getRange('A1:AM160').format.verticalAlignment = 'center';
}

// Workbook verification before export.
const dashboardCheck = await workbook.inspect({
  kind: 'table',
  range: `${quoteSheet('DASHBOARD')}!A1:Q44`,
  include: 'values,formulas',
  tableMaxRows: 14,
  tableMaxCols: 10,
  maxChars: 6000,
});
const auditCheck = await workbook.inspect({
  kind: 'table',
  range: `${quoteSheet('_AUDIT')}!A1:E10`,
  include: 'values,formulas',
  tableMaxRows: 12,
  tableMaxCols: 6,
  maxChars: 5000,
});
const formulaErrors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 300 },
  summary: 'final formula error scan',
  maxChars: 5000,
});

const renderRanges = {
  START: 'A1:P39',
  DASHBOARD: 'A1:Q44',
  SCHEDULE: 'A1:AM31',
  EXPERIMENTS: 'A1:Q49',
  INSTANCE: 'A1:Q76',
  METHOD: 'A1:Q52',
  ENGINEERING: 'A1:Q55',
};
const previewLanguage = process.env.IG_SHEETS_PREVIEW_LANGUAGE === 'pt-BR' ? 'pt-BR' : 'en';
const activePreviewDir = previewLanguage === 'pt-BR' ? path.join(previewDir, 'pt-BR') : previewDir;
await fs.mkdir(activePreviewDir, { recursive: true });
sheets._CONFIG.getRange('B2').values = [[previewLanguage]];
const previewFiles = [];
for (const [index, name] of VISIBLE.entries()) {
  const preview = await workbook.render({ sheetName: name, range: renderRanges[name], scale: 1, format: 'png' });
  const suffix = previewLanguage === 'pt-BR' ? '-pt' : '';
  const filename = `${String(index + 1).padStart(2, '0')}-${name.toLowerCase().replaceAll(' ', '-')}${suffix}.png`;
  const fullPath = path.join(activePreviewDir, filename);
  await fs.writeFile(fullPath, new Uint8Array(await preview.arrayBuffer()));
  previewFiles.push(fullPath);
}

// The distributed workbook always opens in English. Apps Script changes this
// selector and renames the visible tabs when the visitor chooses Portuguese.
sheets._CONFIG.getRange('B2').values = [['en']];
// Keep the rendered QA preview readable because the local renderer does not
// evaluate HYPERLINK, then install the real localized /copy action in the
// exported workbook for Excel and native Google Sheets.
sheets.START.getRange('A26').formulas = [[
  `=HYPERLINK("${runnableCopyUrl}",IF(${quoteSheet('_CONFIG')}!$B$2="pt-BR","CRIAR CÓPIA EXECUTÁVEL ↗  /copy OU ARQUIVO → FAZER UMA CÓPIA","CREATE RUNNABLE COPY ↗  /copy OR FILE → MAKE A COPY"))`,
]];
await fs.mkdir(path.dirname(outputPath), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
const normalized = spawnSync('python3', [path.join(here, 'normalize-workbook.py'), outputPath], {
  encoding: 'utf8',
});
if (normalized.status !== 0) {
  throw new Error(`Workbook metadata normalization failed: ${normalized.stderr || normalized.stdout}`);
}

console.log(JSON.stringify({
  outputPath,
  bytes: (await fs.stat(outputPath)).size,
  visibleSheets: VISIBLE.length,
  internalSheets: INTERNAL.length,
  previewLanguage,
  previewFiles,
  dashboardInspection: dashboardCheck.ndjson,
  auditInspection: auditCheck.ndjson,
  formulaErrorScan: formulaErrors.ndjson,
}, null, 2));
