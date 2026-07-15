function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle('SPRauto ERP')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function initApp() {
  return safeCall(function() {
    var brand = {
      companyName: 'SPRauto',
      companySlogan: 'Детейлинг',
      logoDataUrl: '',
      accentColor: '#00B8D4',
      currency: 'BYN',
      language: 'ru'
    };
    try {
      var br = getBrandSettings();
      if (br && br.ok && br.data) brand = br.data;
    } catch(e) {}

    var empResp = getEmployees(true);
    var employees = (empResp && empResp.ok) ? empResp.data : [];

    // Авто-починка дублей ID заказов (наследие старой генерации) — молча, безопасно
    try { autoFixOrderIdsIfNeeded_(); } catch (e) {}

    return {
      brand: brand,
      config: {
        mode: CONFIG.MODE,
        appName: CONFIG.APP_NAME,
        version: CONFIG.VERSION,
        positions: CONFIG.POSITIONS,
        services: getServicesCatalog(),
        complexes: getComplexesCatalog(),
        orderStatuses: getOrderStatuses(),
        kanbanOrder: getKanbanOrder(),
        currencies: CONFIG.CURRENCIES,
        expenseCategories: getExpenseCategoriesSafe_(),
        inventoryCategories: CONFIG.INVENTORY_CATEGORIES,
        bonusRates: getBonusRates_(),
        leadSources: CONFIG.LEAD_SOURCES
      },
      employees: employees
    };
  });
}

function getClientConfig() {
  return {
    mode: CONFIG.MODE,
    appName: CONFIG.APP_NAME,
    version: CONFIG.VERSION,
    positions: CONFIG.POSITIONS,
    services: CONFIG.SERVICES,
    currencies: CONFIG.CURRENCIES,
    expenseCategories: getExpenseCategoriesSafe_(),
    inventoryCategories: CONFIG.INVENTORY_CATEGORIES,
    bonusRates: getBonusRates_()
  };
}