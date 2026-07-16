/**
 * Api_Import.gs — ВРЕМЕННЫЙ инструмент разового переноса заказов из внешних таблиц.
 * После завершения импорта этот файл можно удалить.
 */

// Исходные книги (Оклейка клиенты / Тонировка клиенты)
var IMPORT_SRC = {
  okleyka:   '1g1wrju0lWSg4eQPoEIafn6NmVSRZN_-DmIp5VAQhWCE',
  tonirovka: '1nF-5TFkTyaU0jWsMGShQBM_xvZsxnOjIUmbwnoy1cmo'
};

/**
 * Осмотр исходных таблиц: заголовки + первые строки (как отображаются в таблице).
 * Нужно, чтобы понять структуру и построить маппинг колонок → поля заказа.
 */
function inspectImportSheets() {
  return safeCall(function() {
    var out = {};
    Object.keys(IMPORT_SRC).forEach(function(key) {
      try {
        var ss    = SpreadsheetApp.openById(IMPORT_SRC[key]);
        var sheet = ss.getSheets()[0];
        var lastRow = Math.min(sheet.getLastRow(), 7);
        var lastCol = sheet.getLastColumn();
        var vals = (lastRow >= 1 && lastCol >= 1)
          ? sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues()
          : [];
        out[key] = {
          spreadsheet: ss.getName(),
          sheet:       sheet.getName(),
          totalRows:   sheet.getLastRow(),
          totalCols:   lastCol,
          headers:     vals[0] || [],
          sample:      vals.slice(1)
        };
      } catch (e) {
        out[key] = { error: e.message };
      }
    });
    return out;
  });
}

// ─── РАЗОВЫЙ ИМПОРТ ЗАКАЗОВ ───────────────────────────────────────────────────

var IMPORT_FROM_STR = '10.07.2026';                 // импортируем только заказы с этой даты
var IMPORT_FROM_DATE = new Date(2026, 6, 10);       // 10 июля 2026 (месяц 6 = июль)

// Парсер даты дд.мм.гггг → Date (или null)
function parseImpDate_(s) {
  var m = String(s || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}
// Парсер суммы: "2 520" / "7,00" / "300" → число
function parseImpNum_(s) {
  var n = parseFloat(String(s || '').replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
// Ключ для защиты от повторного создания (идемпотентность при повторном запуске)
function impKey_(name, plate, date, price) {
  return [String(name || '').trim().toLowerCase(), String(plate || '').trim().toLowerCase(),
          String(date || '').trim(), parseImpNum_(price)].join('|');
}

/**
 * Резервная копия листа «Заказы» перед импортом.
 */
function backupOrdersSheet() {
  return safeCall(function() {
    var book = openBook('DATABASE');
    var src  = book.getSheetByName(CONFIG.TABS.ORDERS);
    if (!src) throw new Error('Лист «Заказы» не найден');
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
    var copy  = src.copyTo(book).setName('Заказы_BACKUP_' + stamp);
    return { name: copy.getName() };
  });
}

/**
 * Импорт заказов из внешних таблиц (оклейка/тонировка) с датой ≥ 10.07.2026.
 * @param {Object} opts { dryRun:boolean (по умолч. true — только предпросмотр), limit:number }
 * Идемпотентно: повторный запуск пропускает уже созданные (совпадение клиент+госномер+дата+сумма).
 */
function importOrders(opts) {
  opts = opts || {};
  var dryRun = (opts.dryRun !== false);   // по умолчанию безопасный предпросмотр
  var limit  = Number(opts.limit) || 0;   // 0 = без ограничения
  return safeCall(function() {
    // Уже существующие заказы — чтобы не дублировать
    var existing = {};
    try {
      readSheetAsObjects('DATABASE', 'ORDERS').forEach(function(o) {
        existing[impKey_(o['Клиент'], o['Госномер'], o['Дата'], o['Стоимость заказа'])] = true;
      });
    } catch (e) {}

    var res = {
      fromDate: IMPORT_FROM_STR, dryRun: dryRun,
      tint: { matched: 0, created: 0, skipped: 0, samples: [], errors: [] },
      ppf:  { matched: 0, created: 0, skipped: 0, samples: [], errors: [] }
    };
    importTint_(res.tint, dryRun, limit, existing);
    importPPF_(res.ppf,  dryRun, limit, existing);
    res.totalMatched = res.tint.matched + res.ppf.matched;
    res.totalCreated = res.tint.created + res.ppf.created;
    res.totalSkipped = res.tint.skipped + res.ppf.skipped;
    return res;
  });
}

// Общая обработка одной строки: dedup, лимит, предпросмотр/создание
function importRow_(out, payload, dryRun, limit, existing) {
  var key = impKey_(payload.clientName, payload.plate, payload.orderDate, payload.price);
  if (existing[key]) { out.skipped++; return; }
  if (out.samples.length < 3) out.samples.push(payload);
  if (dryRun) return;
  if (limit && out.created >= limit) return;
  try {
    var resp = createOrder(payload);
    if (resp && resp.ok) { out.created++; existing[key] = true; }
    else out.errors.push((payload.clientName || '?') + ': ' + (resp ? resp.error : 'нет ответа'));
  } catch (e) { out.errors.push((payload.clientName || '?') + ': ' + e.message); }
}

function importTint_(out, dryRun, limit, existing) {
  var sheet = SpreadsheetApp.openById(IMPORT_SRC.tonirovka).getSheets()[0];
  var vals  = sheet.getDataRange().getDisplayValues();   // заголовок — строка 0, данные с 1
  for (var r = 1; r < vals.length; r++) {
    var row  = vals[r];
    var name = String(row[2] || '').trim();
    var dstr = String(row[13] || '').trim();
    var d    = parseImpDate_(dstr);
    if (!name || !d || d < IMPORT_FROM_DATE) continue;
    out.matched++;
    var film = String(row[14] || '').trim(), light = String(row[15] || '').trim();
    importRow_(out, {
      orderDate:      dstr,
      service:        'TINT',
      clientType:     'физ',
      clientName:     name,
      clientPhone:    String(row[7] || '').trim(),
      car:            (String(row[8] || '').trim() + ' ' + String(row[9] || '').trim()).trim(),
      plate:          String(row[12] || '').trim(),
      vin:            String(row[10] || '').trim(),
      year:           String(row[11] || '').trim(),
      price:          parseImpNum_(row[16]),
      lightTransmission: light,
      signatory:      String(row[4] || '').trim(),
      passport:       String(row[5] || '').trim(),
      passportIssued: String(row[6] || '').trim(),
      notes:          ('Плёнка: ' + film + (light ? (', светопропускаемость ' + light + '%') : '')).trim() + ' [импорт]',
      payType:        ''
    }, dryRun, limit, existing);
  }
}

function importPPF_(out, dryRun, limit, existing) {
  var sheet = SpreadsheetApp.openById(IMPORT_SRC.okleyka).getSheets()[0];
  var vals  = sheet.getDataRange().getDisplayValues();   // заголовок — строка 2 (индекс 2), данные с 3
  for (var r = 3; r < vals.length; r++) {
    var row   = vals[r];
    var name  = String(row[2] || '').trim();
    var start = String(row[15] || '').trim();            // Начало выполнения работ = дата заказа
    var d     = parseImpDate_(start);
    if (!name || !d || d < IMPORT_FROM_DATE) continue;
    out.matched++;
    var els   = String(row[14] || '').trim();
    var extra = String(row[24] || '').trim();
    if (extra) els = (els ? els + ', ' : '') + extra;
    var film  = String(row[19] || '').trim();
    var extraWork = String(row[25] || '').trim();
    var lead  = String(row[21] || '').trim();
    var note  = (film ? 'Использовано плёнки: ' + film + '. ' : '') +
                (extraWork ? 'Доп. работы: ' + extraWork + '. ' : '') +
                (lead ? 'Лид: ' + lead + '. ' : '') + '[импорт]';
    importRow_(out, {
      orderDate:      start,
      dueDate:        String(row[16] || '').trim(),       // Дата выдачи → Дата выполнения
      service:        'PPF',
      clientType:     'физ',
      clientName:     name,
      clientPhone:    String(row[7] || '').trim(),
      car:            (String(row[8] || '').trim() + ' ' + String(row[9] || '').trim()).trim(),
      plate:          String(row[12] || '').trim(),
      vin:            String(row[10] || '').trim(),
      year:           String(row[11] || '').trim(),
      mileage:        String(row[13] || '').trim(),
      price:          parseImpNum_(row[17]),
      elements:       els,
      elementsCount:  String(row[20] || '').trim(),
      complex:        String(row[23] || '').trim(),
      masters:        String(row[22] || '').trim(),
      signatory:      String(row[4] || '').trim(),
      passport:       String(row[5] || '').trim(),
      passportIssued: String(row[6] || '').trim(),
      notes:          note,
      payType:        ''
    }, dryRun, limit, existing);
  }
}
