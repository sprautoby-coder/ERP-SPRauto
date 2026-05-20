/**
 * Utils.gs — общие хелперы
 */

/**
 * Генерация ID с префиксом
 */
function generateId(prefix, num) {
  return prefix + '-' + String(num).padStart(5, '0');
}

/**
 * Следующий ID для сущности
 */
function getNextId(bookKey, tabKey, prefix) {
  var sheet = getTab(bookKey, tabKey);
  var lastRow = sheet.getLastRow();
  return generateId(prefix, lastRow);
}

/**
 * Читает лист как массив объектов.
 * ВАЖНО: конвертирует Date в строку — иначе google.script.run
 * не может передать объект в браузер (возвращает null).
 */
function readSheetAsObjects(bookKey, tabKey) {
  var sheet = getTab(bookKey, tabKey);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var range = sheet.getDataRange().getValues();
  var headers = range[0];
  var tz = Session.getScriptTimeZone();

  var result = [];
  for (var i = 1; i < range.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var val = range[i][j];
      if (val instanceof Date) {
        val = val.getTime() > 0
          ? Utilities.formatDate(val, tz, 'dd.MM.yyyy')
          : '';
      }
      obj[headers[j]] = val;
    }
    result.push(obj);
  }
  return result;
}

/**
 * Записать новую строку по объекту.
 * Ключи объекта = заголовки колонок.
 */
function appendRowByObject(bookKey, tabKey, data) {
  var sheet = getTab(bookKey, tabKey);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function(h) {
    var val = data[h] !== undefined ? data[h] : '';
    return val;
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

/**
 * Форматирование числа как валюты
 */
function formatCurrency(num, currency) {
  currency = currency || CONFIG.DEFAULT_CURRENCY;
  var cfg = null;
  for (var i = 0; i < CONFIG.CURRENCIES.length; i++) {
    if (CONFIG.CURRENCIES[i].code === currency) {
      cfg = CONFIG.CURRENCIES[i];
      break;
    }
  }
  var symbol = cfg ? cfg.symbol : 'Br';
  return Math.round(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ' + symbol;
}

/**
 * Запись действия в журнал
 */
function logActivity(action, objectType, objectId, oldValue, newValue, comment) {
  try {
    var sheet = getTab('DATABASE', 'ACTIVITY_LOG');
    var user = '';
    try { user = Session.getActiveUser().getEmail(); } catch(e) {}
    sheet.appendRow([
      new Date(),
      user,
      action,
      objectType,
      String(objectId || ''),
      String(oldValue || '').substring(0, 200),
      String(newValue || '').substring(0, 200),
      String(comment || '')
    ]);
  } catch(e) {
    Logger.log('logActivity failed: ' + e.message);
  }
}

/**
 * Безопасная обёртка — ловит ошибки и возвращает {ok, data/error}.
 * ВАЖНО: рекурсивно конвертирует Date в строку перед возвратом.
 */
function safeCall(fn) {
  try {
    var result = fn();
    return { ok: true, data: sanitizeForClient_(result) };
  } catch(e) {
    Logger.log('safeCall ERROR: ' + e.message + '\n' + e.stack);
    return { ok: false, error: e.message };
  }
}

/**
 * Рекурсивно конвертирует Date объекты в строки.
 * Без этого google.script.run возвращает null клиенту.
 */
function sanitizeForClient_(obj) {
  if (obj === null || obj === undefined) return obj;

  if (obj instanceof Date) {
    try {
      return obj.getTime() > 0
        ? Utilities.formatDate(obj, Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm')
        : '';
    } catch(e) {
      return '';
    }
  }

  if (Array.isArray(obj)) {
    return obj.map(function(item) {
      return sanitizeForClient_(item);
    });
  }

  if (typeof obj === 'object') {
    var clean = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      clean[key] = sanitizeForClient_(obj[key]);
    }
    return clean;
  }

  return obj;
}