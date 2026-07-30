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
        color:           /^#[0-9a-fA-F]{3,8}$/.test(String(x.color)) ? String(x.color) : '#4da6ff',
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

// ─── СТАТУСЫ ЗАКАЗОВ / «ВОРОНКИ» КАНБАНА (white-label) ───────────────────────

/**
 * Эффективный список статусов-«воронок»: переопределение из ORDER_STATUSES_JSON,
 * иначе дефолт CONFIG.ORDER_STATUSES. Формат: [{id,name,color,cancelled}].
 */
function getOrderStatuses() {
  try {
    var sheet = getTab('DATABASE', 'SETTINGS');
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (var i = 0; i < data.length; i++) {
        if (data[i][0] === 'ORDER_STATUSES_JSON' && data[i][1]) {
          var arr = JSON.parse(data[i][1]);
          if (Array.isArray(arr) && arr.length) return arr;
        }
      }
    }
  } catch (e) { /* битый JSON или нет настройки — дефолт */ }
  return CONFIG.ORDER_STATUSES;
}

/** Имена статусов, помеченных «отменён» (исключаются из выручки/ДДС/ЗП). */
function getCancelledStatusNames_() {
  try {
    var names = getOrderStatuses().filter(function(s){ return s && s.cancelled; })
      .map(function(s){ return String(s.name); });
    return names.length ? names : ['Отменён'];
  } catch (e) { return ['Отменён']; }
}

/** Множество имён «отменённых» статусов — для быстрой проверки в циклах. */
function getCancelledStatusSet_() {
  var set = {};
  getCancelledStatusNames_().forEach(function(n){ set[n] = true; });
  return set;
}

/** Множество имён «завершённых» статусов (done) — не считаются «в работе». */
function getDoneStatusSet_() {
  var set = {};
  try {
    getOrderStatuses().forEach(function(s){ if (s && s.done) set[String(s.name)] = true; });
  } catch (e) {}
  return set;
}

/** Множество статусов, с которых начинается дебиторка: «Готов» и позже (не отменён).
 *  Заказы «Новый»/«В работе» долгом НЕ считаются. */
function getReceivableStatusSet_() {
  var set = {};
  try {
    var list = getOrderStatuses();
    var readyIdx = -1;
    for (var i = 0; i < list.length; i++) { if (String(list[i].name) === 'Готов') readyIdx = i; }
    list.forEach(function(s, i){
      if (!s || s.cancelled) return;
      if ((readyIdx >= 0 && i >= readyIdx) || s.done) set[String(s.name)] = true;
    });
  } catch (e) {}
  return set;
}

/** Имя статуса по умолчанию для нового заказа (первая воронка). */
function getDefaultStatusName_() {
  var list = getOrderStatuses();
  return (list[0] && list[0].name) ? list[0].name : 'Новый';
}

/** Имя статуса «в работе» (явное «В работе» или вторая незавершённая стадия). */
function getInWorkStatusName_() {
  try {
    var list = getOrderStatuses();
    for (var i = 0; i < list.length; i++) { if (list[i] && String(list[i].name) === 'В работе') return 'В работе'; }
    var flow = list.filter(function(s){ return s && !s.done && !s.cancelled; });
    if (flow.length >= 2) return String(flow[1].name);   // 1-я обычно «Новый», 2-я — «в работе»
  } catch (e) {}
  return 'В работе';
}

/** Имя «завершённого» статуса (первый с done:true, обычно «Выдан»). */
function getCompletedStatusName_() {
  try {
    var list = getOrderStatuses();
    for (var i = 0; i < list.length; i++) { if (list[i] && list[i].done) return String(list[i].name); }
  } catch (e) {}
  return 'Выдан';
}

/**
 * Сохранить список статусов-«воронок».
 * payload = { list: [{id,name,color,cancelled}], renames: [{from,to}] }
 * Переименования/удаления применяются к существующим заказам (чтобы не осиротели)
 * и к ручному порядку канбана.
 */
function saveOrderStatuses(payload) {
  return safeCall(function() {
    payload = payload || {};
    var list = payload.list;
    if (!Array.isArray(list)) throw new Error('Неверный формат воронок');

    var seen = {};
    var clean = [];
    list.forEach(function(x){
      if (!x) return;
      var name = String(x.name || '').trim();
      if (!name) return;
      var key = name.toLowerCase();
      if (seen[key]) throw new Error('Повторяющееся название воронки: «' + name + '»');
      seen[key] = true;
      clean.push({
        id:    String(x.id || name).slice(0, 40),
        name:  name,
        color: /^#[0-9a-fA-F]{3,8}$/.test(String(x.color)) ? String(x.color) : '#6c8ebf',
        cancelled: !!x.cancelled,
        done:      !!x.done,
      });
    });
    if (!clean.length) throw new Error('Нужна хотя бы одна воронка');

    var validNames = {};
    clean.forEach(function(s){ validNames[s.name] = true; });
    var fallback = clean[0].name;

    var renameMap = {};
    (payload.renames || []).forEach(function(r){
      if (r && r.from && r.to && r.from !== r.to) renameMap[String(r.from)] = String(r.to);
    });

    // Переносим существующие заказы (переименование + осиротевшие → в первую воронку)
    applyStatusReassign_(renameMap, validNames, fallback);
    // Обновляем ключи ручного порядка канбана
    remapKanbanOrderKeys_(renameMap, validNames, fallback);

    saveSetting('ORDER_STATUSES_JSON', JSON.stringify(clean), 'Статусы заказов / воронки', 'Заказы');
    bumpDataVersion_();
    return { count: clean.length, statuses: clean };
  });
}

/** Перенести статусы существующих заказов по карте переименований и удалений. */
function applyStatusReassign_(renameMap, validNames, fallback) {
  var sheet = getTab('DATABASE', 'ORDERS');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = headers.indexOf('Статус');
  if (col < 0) return;
  var range = sheet.getRange(2, col + 1, lastRow - 1, 1);
  var vals = range.getValues();
  var changed = false;
  for (var i = 0; i < vals.length; i++) {
    var cur = String(vals[i][0] || '');
    if (!cur) continue;
    var next = renameMap[cur] || cur;
    if (!validNames[next]) next = fallback;   // удалённая воронка → первая
    if (next !== cur) { vals[i][0] = next; changed = true; }
  }
  if (changed) range.setValues(vals);
}

/** Обновить ключи (статусы) в ручном порядке канбана после переименований/удалений. */
function remapKanbanOrderKeys_(renameMap, validNames, fallback) {
  try {
    var order = getKanbanOrder();
    var out = {};
    Object.keys(order).forEach(function(st){
      var to = renameMap[st] || st;
      if (!validNames[to]) to = fallback;
      out[to] = (out[to] || []).concat(order[st] || []);
    });
    saveKanbanOrder(out);
  } catch (e) { /* порядок канбана не критичен */ }
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
    ['manager_bonus_pct', '10',       'Бонус менеджера, %',    'Бонусы'],
    ['master_bonus_pct',  '35',       'Бонус мастера, %',      'Бонусы'],
    ['admin_bonus_pct',   '5',        'Бонус администратора, %','Бонусы'],
    ['cycle_day_1',       '5',        'День 1-го цикла ЗП',   'Циклы'],
    ['cycle_day_2',       '20',       'День 2-го цикла ЗП',   'Циклы']
  ];
  sheet.getRange(2, 1, defaults.length, 4).setValues(defaults);
}