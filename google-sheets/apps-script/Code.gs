/**
 * IG Scheduling Lab — bound Google Sheets application.
 *
 * @OnlyCurrentDoc
 */

function onOpen() {
  IG_addMenu_(IG_currentLanguage_());
}

function IG_uiCopy_(language) {
  return language === 'pt-BR' ? {
    open: 'Abrir painel de controle',
    install: 'Instalar / atualizar botão do dashboard',
    verify: 'Verificar engine incorporado',
    about: 'Sobre esta pasta de trabalho',
    language: 'Idioma',
    english: 'English',
    portuguese: 'Português (Brasil)',
    buttonAlt: 'Abrir o painel de controle do IG Scheduling Lab',
    buttonToast: 'Botão instalado sobre INÍCIO!K7:O9.',
    busy: 'Outra atualização da pasta de trabalho ainda está em andamento.',
    runWritten: 'Execução verificada gravada no dashboard.',
    experimentWritten: 'Experimento verificado gravado no dashboard.',
    experimentRange: 'Um experimento requer de 1 a 64 execuções.',
    sameInstanceBudget: 'Todas as execuções do experimento devem usar a mesma instância e o mesmo orçamento de iterações.',
    sameAlgorithm: 'Todas as execuções do experimento devem usar a mesma configuração do algoritmo.',
    uniqueSeeds: 'As sementes do experimento devem ser únicas.',
    verifiedTitle: 'Engine verificado',
    verifiedBody: 'O WebAssembly em Rust foi carregado. A conferência independente do objetivo fechou em {cost} após {evaluations} avaliações de candidatos.',
    failedTitle: 'Falha na verificação',
    aboutBody: 'Uma experiência nativa de BI no Google Sheets, apoiada pelo engine canônico Iterated Greedy em Rust executado como WebAssembly. Toda programação exibida é recalculada de forma independente antes da gravação.',
  } : {
    open: 'Open control panel',
    install: 'Install / refresh dashboard button',
    verify: 'Verify embedded engine',
    about: 'About this workbook',
    language: 'Language',
    english: 'English',
    portuguese: 'Português (Brasil)',
    buttonAlt: 'Open the IG Scheduling Lab control panel',
    buttonToast: 'Dashboard button installed over START!K7:O9.',
    busy: 'Another workbook update is still in progress.',
    runWritten: 'Verified run written to the dashboard.',
    experimentWritten: 'Verified experiment written to the dashboard.',
    experimentRange: 'An experiment requires 1 to 64 runs.',
    sameInstanceBudget: 'Every experiment run must use the same instance and iteration budget.',
    sameAlgorithm: 'Every experiment run must use the same algorithm configuration.',
    uniqueSeeds: 'Experiment seeds must be unique.',
    verifiedTitle: 'Engine verified',
    verifiedBody: 'Rust WebAssembly loaded successfully. Independent objective check closed at {cost} after {evaluations} candidate evaluations.',
    failedTitle: 'Verification failed',
    aboutBody: 'A native Google Sheets BI experience backed by the canonical Rust Iterated Greedy engine running as embedded WebAssembly. Every displayed schedule is independently repriced before it is written.',
  };
}

function IG_addMenu_(language) {
  var copy = IG_uiCopy_(language);
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (error) {
    // Direct editor executions have no container UI. The underlying action
    // should still complete; onOpen will rebuild the localized menu later.
    return false;
  }
  var languageMenu = ui.createMenu(copy.language)
    .addItem(copy.english, 'setIgLanguageEnglish')
    .addItem(copy.portuguese, 'setIgLanguagePortuguese');
  ui
    .createMenu('IG Scheduler')
    .addItem(copy.open, 'showIgSidebar')
    .addItem(copy.install, 'installIgButtons')
    .addSubMenu(languageMenu)
    .addSeparator()
    .addItem(copy.verify, 'verifyIgEngine')
    .addSeparator()
    .addItem(copy.about, 'showIgAbout')
    .addToUi();
  return true;
}

function showIgSidebar() {
  var output = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('IG Scheduling Lab');
  SpreadsheetApp.getUi().showSidebar(output);
}

function installIgButtons() {
  var language = IG_currentLanguage_();
  var copy = IG_uiCopy_(language);
  var startSheet = IG_viewSheet_('start');
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error(copy.busy);
  try {
    var marker = 'IG_CONTROL_PANEL_BUTTON';
    var matching = startSheet.getImages().filter(function(image) {
      return image.getAltTextTitle() === marker;
    });
    var button = matching.shift();
    matching.forEach(function(image) { image.remove(); });
    if (!button) {
      var transparentPng = Utilities.newBlob(
        Utilities.base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='),
        'image/png',
        'ig-control-panel.png',
      );
      button = startSheet.insertImage(transparentPng, 11, 7);
    }
    var width = 0;
    var height = 0;
    for (var column = 11; column <= 15; column += 1) width += startSheet.getColumnWidth(column);
    for (var row = 7; row <= 9; row += 1) height += startSheet.getRowHeight(row);
    button
      .setAnchorCell(startSheet.getRange(7, 11))
      .setAnchorCellXOffset(0)
      .setAnchorCellYOffset(0)
      .setWidth(width)
      .setHeight(height)
      .setAltTextTitle(marker)
      .setAltTextDescription(copy.buttonAlt)
      .assignScript('showIgSidebar');
    SpreadsheetApp.flush();
    SpreadsheetApp.getActive().toast(copy.buttonToast, 'IG Scheduler', 5);
    return { sheet: startSheet.getName(), range: 'K7:O9', script: 'showIgSidebar' };
  } finally {
    lock.releaseLock();
  }
}

function igGetBootstrap() {
  return {
    language: IG_currentLanguage_(),
    catalog: IG_catalogRows_(),
    engine: {
      implementation: 'Rust WebAssembly',
      wasmBytes: IG_PAYLOAD.wasmBytes,
      catalogEntries: IG_PAYLOAD.catalogEntries,
      fixedPointScale: 10,
    },
    defaults: {
      instance: IG_DEFAULT_INSTANCE,
      seed: 1,
      runCount: 10,
      accept: 'current',
      checkpointCount: 40,
    },
  };
}

async function igComputeRun(config) {
  return IG_signRunResult_(await IG_computeRun_(config));
}

function igCommitSingle(result) {
  return IG_commitSingle_(result);
}

function igCommitExperiment(payload) {
  return IG_commitExperiment_(payload);
}

function igSetLanguage(language) {
  return IG_setLanguage_(language);
}

function setIgLanguageEnglish() {
  return IG_setLanguage_('en');
}

function setIgLanguagePortuguese() {
  return IG_setLanguage_('pt-BR');
}

async function verifyIgEngine() {
  var copy = IG_uiCopy_(IG_currentLanguage_());
  try {
    var result = await IG_computeRun_({
      instance: 'NCOS_01',
      seed: 1,
      iterationBudget: 10,
      d: 2,
      accept: 'current',
      permute: true,
      checkpointCount: 5,
    });
    var message = copy.verifiedBody
      .replace('{cost}', result.bestCost)
      .replace('{evaluations}', result.evaluations);
    var notification = IG_notify_(copy.verifiedTitle, message, 8);
    return {
      verified: true,
      cost: result.bestCost,
      evaluations: result.evaluations,
      message: message,
      notification: notification,
    };
  } catch (error) {
    IG_notify_(copy.failedTitle, String(error && error.message ? error.message : error), 8);
    throw error;
  }
}

function IG_notify_(title, message, seconds) {
  try {
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (spreadsheet) {
      spreadsheet.toast(message, title, seconds || 5);
      return 'toast';
    }
  } catch (error) {
    // A direct editor or API execution may not expose an active spreadsheet UI.
  }
  console.log(title + ': ' + message);
  return 'log';
}

function showIgAbout() {
  var copy = IG_uiCopy_(IG_currentLanguage_());
  SpreadsheetApp.getUi().alert(
    'IG Scheduling Lab',
    copy.aboutBody,
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}
