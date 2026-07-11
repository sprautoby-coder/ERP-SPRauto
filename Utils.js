/**
 * Utils.gs — общие хелперы
 */

// ─── СЕРВЕРНЫЙ КЭШ ЧТЕНИЙ (CacheService) С ВЕРСИОННОЙ ИНВАЛИДАЦИЕЙ ─────────────
// Тяжёлые read-эндпоинты (getOrders, дашборд, дебиторка) кэшируются между запросами.
// Любая запись данных вызывает bumpDataVersion_() → версия меняется → все старые
// ключи кэша становятся недостижимыми (мгновенная инвалидация, без устаревания).
// TTL — лишь подстраховка/уборка. Если результат > лимита CacheService — просто не кэшируется.

function _dataVersion_() {
  var c = CacheService.getScriptCache();
  var v = c.get('dataVersion');
  if (!v) { v = '1'; c.put('dataVersion', v, 21600); }
  return v;
}

// Флаг «этот запрос меняет данные» — сбрасывается на старте каждого исполнения
// (глобалы в Apps Script не живут между запросами). В таких запросах читаем листы
// ЖИВЬЁМ (мимо кэша), чтобы исключить любое устаревание внутри операции записи.
var _CACHE_BYPASS = false;

/** Сбросить весь серверный кэш чтений (вызывать в КАЖДОЙ функции, меняющей данные). */
function bumpDataVersion_() {
  _CACHE_BYPASS = true;   // дальше в этом запросе — только живые чтения
  try {
    var c = CacheService.getScriptCache();
    var v = parseInt(c.get('dataVersion') || '0', 10) + 1;
    c.put('dataVersion', String(v), 21600);
  } catch (e) { /* кэш недоступен — не критично */ }
}

/**
 * Вернуть данные из кэша по ключу или вычислить и закэшировать.
 * @param {string} key      — логический ключ (версия добавляется автоматически)
 * @param {number} ttl      — секунды (по умолчанию 45)
 * @param {Function} producer — функция, возвращающая JSON-сериализуемые данные
 */
function cachedRead_(key, ttl, producer) {
  var c;
  try { c = CacheService.getScriptCache(); } catch (e) { return producer(); }
  var ck = key + ':v' + _dataVersion_();
  var hit = c.get(ck);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var data = producer();
  try { c.put(ck, JSON.stringify(data), ttl || 45); } catch (e) { /* > лимита — не кэшируем */ }
  return data;
}

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
  // Кэш чтения листа (между запросами). В запросах с записью (_CACHE_BYPASS)
  // и при сбое кэша — читаем живьём. Ключ версионный → инвалидируется bumpDataVersion_.
  var cache = null, ckey = null;
  if (!_CACHE_BYPASS) {
    try {
      cache = CacheService.getScriptCache();
      ckey  = 'rs:' + bookKey + ':' + tabKey + ':v' + _dataVersion_();
      var hit = cache.get(ckey);
      if (hit) { try { return JSON.parse(hit); } catch (e) {} }
    } catch (e) { cache = null; }
  }

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
        // Google Sheets хранит «время суток» как дату 1899-12-30 (getTime()<0).
        // Раньше такие значения превращались в '' — время записей терялось. Теперь:
        //  год ≤ 1900 → это время → 'HH:mm'; иначе → дата 'dd.MM.yyyy'.
        val = (val.getFullYear() <= 1900)
          ? Utilities.formatDate(val, tz, 'HH:mm')
          : Utilities.formatDate(val, tz, 'dd.MM.yyyy');
      }
      obj[headers[j]] = val;
    }
    result.push(obj);
  }
  if (cache && ckey) { try { cache.put(ckey, JSON.stringify(result), 30); } catch (e) { /* > лимита — не кэшируем */ } }
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