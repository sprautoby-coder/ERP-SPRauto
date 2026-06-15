/**
 * Api_Settings.gs — настройки white-label
 */

function getSettings() {
  return safeCall(function() {
    var sheet = getTab('DATABASE', 'SETTINGS');
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};
    var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    var result = {};
    data.forEach(function(row) {
      if (row[0]) result[row[0]] = row[1];
    });
    return result;
  });
}

function saveSetting(key, value, description, category) {
  return safeCall(function() {
    bumpDataVersion_();
    var sheet = getTab('DATABASE', 'SETTINGS');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        return { key: key, value: value };
      }
    }
    sheet.appendRow([key, value, description || '', category || 'Общие']);
    return { key: key, value: value };
  });
}

/**
 * Эффективный каталог услуг (white-label): берёт переопределение из настройки
 * SERVICES_JSON, иначе — дефолт CONFIG.SERVICES. Используется в config и нумерации.
 */
function getServicesCatalog() {
  try {
    var sheet = getTab('DATABASE', 'SETTINGS');
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (var i = 0; i < data.length; i++) {
        if (data[i][0] === 'SERVICES_JSON' && data[i][1]) {
          var arr = JSON.parse(data[i][1]);
          if (Array.isArray(arr) && arr.length) return arr;
        }
      }
    }
  } catch (e) { /* битый JSON или нет настройки — дефолт */ }
  return CONFIG.SERVICES;
}

/** Сохранить пользовательский каталог услуг (white-label). */
function saveServicesCatalog(list) {
  return safeCall(function() {
    if (!Array.isArray(list)) throw new Error('Неверный формат каталога услуг');
    var clean = list.filter(function(x){ return x && String(x.name || '').trim(); }).map(function(x){
      return {
        code:            String(x.code || x.name).toUpperCase().replace(/\s+/g, '_').slice(0, 16),
        name:            String(x.name).trim(),
        icon:            x.icon || '🔧',
        active:          x.active !== false,
        contractPrefix:  String(x.contractPrefix || '').trim(),
        calcType:        x.calcType || 'fixed',
        bonusPoolPct:    Number(x.bonusPoolPct) || 35,
        managerBonusPct: Number(x.managerBonusPct) || 10,
      };
    });
    if (!clean.length) throw new Error('Каталог услуг не может быть пустым');
    saveSetting('SERVICES_JSON', JSON.stringify(clean), 'Каталог услуг (white-label)', 'Услуги');
    bumpDataVersion_();
    return { count: clean.length, services: clean };
  });
}

/**
 * Эффективный каталог комплексов оклейки (white-label): берёт переопределение из
 * настройки COMPLEXES_JSON, иначе — дефолт CONFIG.COMPLEXES. Используется в карточке
 * заказа (селектор комплекса) и при печати документов.
 */
function getComplexesCatalog() {
  try {
    var sheet = getTab('DATABASE', 'SETTINGS');
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (var i = 0; i < data.length; i++) {
        if (data[i][0] === 'COMPLEXES_JSON' && data[i][1]) {
          var arr = JSON.parse(data[i][1]);
          if (Array.isArray(arr) && arr.length) return arr;
        }
      }
    }
  } catch (e) { /* битый JSON или нет настройки — дефолт */ }
  return CONFIG.COMPLEXES;
}

/** Сохранить пользовательский каталог комплексов оклейки (white-label). */
function saveComplexesCatalog(list) {
  return safeCall(function() {
    if (!Array.isArray(list)) throw new Error('Неверный формат каталога комплексов');
    var clean = list.filter(function(x){ return x && String(x.name || '').trim(); }).map(function(x){
      var els = Array.isArray(x.els)
        ? x.els
        : String(x.els || '').split('\n');
      els = els.map(function(s){ return String(s).trim(); }).filter(function(s){ return s; });
      return {
        name:  String(x.name).trim(),
        price: Number(x.price) || 0,
        els:   els,
      };
    });
    if (!clean.length) throw new Error('Каталог комплексов не может быть пустым');
    saveSetting('COMPLEXES_JSON', JSON.stringify(clean), 'Комплексы оклейки (white-label)', 'Услуги');
    bumpDataVersion_();
    return { count: clean.length, complexes: clean };
  });
}

/**
 * Ручной порядок карточек на канбан-доске заказов.
 * Хранится как { "<Статус>": ["orderId1","orderId2",...], ... } в настройке KANBAN_ORDER_JSON.
 * Используется для сортировки колонок (drag&drop расстановка пользователя).
 */
function getKanbanOrder() {
  try {
    var sheet = getTab('DATABASE', 'SETTINGS');
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (var i = 0; i < data.length; i++) {
        if (data[i][0] === 'KANBAN_ORDER_JSON' && data[i][1]) {
          var obj = JSON.parse(data[i][1]);
          if (obj && typeof obj === 'object') return obj;
        }
      }
    }
  } catch (e) { /* битый JSON или нет настройки — пустой порядок */ }
  return {};
}

/** Сохранить ручной порядок карточек канбана. map = { статус: [orderId,...] }. */
function saveKanbanOrder(map) {
  return safeCall(function() {
    if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('Неверный формат порядка');
    var clean = {};
    Object.keys(map).forEach(function(status){
      var arr = map[status];
      if (Array.isArray(arr)) clean[status] = arr.map(function(x){ return String(x); }).filter(Boolean);
    });
    saveSetting('KANBAN_ORDER_JSON', JSON.stringify(clean), 'Порядок карточек канбана', 'Заказы');
    // НЕ зовём bumpDataVersion_ — это только UI-порядок, не влияет на финансовые чтения из кэша
    return { ok: true };
  });
}

function saveSettings(settings) {
  return safeCall(function() {
    var keys = Object.keys(settings);
    var saved = 0;
    keys.forEach(function(key) {
      var resp = saveSetting(key, settings[key]);
      if (resp && resp.ok) saved++;
    });
    return { saved: saved, total: keys.length };
  });
}

function getBrandSettings() {
  return safeCall(function() {
    var sheet = getTab('DATABASE', 'SETTINGS');
    var lastRow = sheet.getLastRow();
    var settings = {};
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
      data.forEach(function(row) {
        if (row[0]) settings[row[0]] = row[1];
      });
    }
    return {
      companyName:   settings['company_name']   || 'SPRauto',
      companySlogan: settings['company_slogan']  || 'Детейлинг',
      logoDataUrl:   settings['logo_dataurl']    || CONFIG.DEFAULT_LOGO || '',
      accentColor:   settings['accent_color']    || '#00B8D4',
      currency:      settings['currency']        || 'BYN',
      language:      settings['language']        || 'ru'
    };
  });
}

function initDefaultSettings_() {
  var sheet = getTab('DATABASE', 'SETTINGS');
  if (sheet.getLastRow() > 1) return;
  var defaults = [
    ['company_name',      'SPRauto',  'Название компании',     'Компания'],
    ['company_slogan',    'Детейлинг','Слоган',                'Компания'],
    ['logo_dataurl',      '',         'Логотип (data URL)',     'Компания'],
    ['accent_color',      '#00B8D4',  'Цвет интерфейса',       'Дизайн'],
    ['currency',          'BYN',      'Валюта',                'Регион'],
    ['language',          'ru',       'Язык',                  'Регион'],
    ['bonus_pool_pct',    '35',       '% фонда бонусов',      'Бонусы'],
    ['manager_bonus_pct', '5',        '% менеджеру',           'Бонусы'],
    ['cycle_day_1',       '5',        'День 1-го цикла ЗП',   'Циклы'],
    ['cycle_day_2',       '20',       'День 2-го цикла ЗП',   'Циклы']
  ];
  sheet.getRange(2, 1, defaults.length, 4).setValues(defaults);
}