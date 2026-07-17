/**
 * Api_Import.gs — ВРЕМЕННЫЙ инструмент разового переноса заказов из внешних таблиц.
 * После завершения импорта этот файл можно удалить.
 */

// Исходные книги (Оклейка клиенты / Тонировка клиенты / Расчёт оклейки — оплаты)
var IMPORT_SRC = {
  okleyka:   '1g1wrju0lWSg4eQPoEIafn6NmVSRZN_-DmIp5VAQhWCE',
  tonirovka: '1nF-5TFkTyaU0jWsMGShQBM_xvZsxnOjIUmbwnoy1cmo',
  raschet:   '1054JIozquIipA2Vhu6v6nv8NS0Q61aVUiBpUirtW_sU'
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
        var lastRow = Math.min(sheet.getLastRow(), 12);
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

// Администратор во ВСЕХ импортируемых заказах
var IMPORT_ADMIN = 'Папкович Игорь Иванович';
// Короткое имя из расчёта → полное ФИО сотрудника (должно совпадать с карточкой в «Сотрудники»)
var MANAGER_MAP = {
  'игорь':   'Папкович Игорь Иванович',
  'егор':    'Озолов Егор Вячеславович',
  'татьяна': 'Татьяна Милош'
};
// Короткое имя мастера (оклейщика) → фрагмент ФИО для поиска в «Сотрудники».
// ВАЖНО: мастер «Егор» = Еромин (НЕ Озолов — тот менеджер). «Саня»/«Леха» — как есть.
var MASTER_MAP = {
  'виталик': 'Витал',    // Волков Виталий
  'артем':   'Артё',     // Жуковский Артём
  'артём':   'Артё',
  'антон':   'Антон',    // Завгородний Антон
  'миша':    'Михаил',   // Карпук Михаил
  'егор':    'Еромин',   // мастер Егор = Еромин
  'саня':    'Саня',     // литеральный сотрудник
  'леха':    'Леха',     // литеральный
  'лёха':    'Лёха'
};

// Правило менеджера: если в расчёте есть не-Игорь (Егор/Татьяна) — менеджер он;
// если только Игорь — менеджер Папкович. Нераспознанное имя возвращаем как есть.
function mapManager_(raw) {
  var toks = String(raw || '').toLowerCase().split(/[,\s]+/).map(function(t){ return t.trim(); }).filter(Boolean);
  var other = [], hasIgor = false;
  toks.forEach(function(t) {
    if (t === 'и') return;
    if (t === 'игорь') { hasIgor = true; return; }
    if (MANAGER_MAP[t]) other.push(MANAGER_MAP[t]);
  });
  if (other.length) return other.join(', ');
  if (hasIgor)       return MANAGER_MAP['игорь'];
  return String(raw || '').trim();
}

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
    // Собираем строки обеих услуг и сортируем по дате — заказы создаются в хронологическом порядке
    var items = [];
    collectTint_(items);
    collectPPF_(items);
    items.sort(function(a, b) { return a.dateObj - b.dateObj; });
    items.forEach(function(it) {
      var out = it.service === 'TINT' ? res.tint : res.ppf;
      out.matched++;
      importRow_(out, it.payload, dryRun, limit, existing);
    });
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

function collectTint_(items) {
  var sheet = SpreadsheetApp.openById(IMPORT_SRC.tonirovka).getSheets()[0];
  var vals  = sheet.getDataRange().getDisplayValues();   // заголовок — строка 0, данные с 1
  for (var r = 1; r < vals.length; r++) {
    var row  = vals[r];
    var name = String(row[2] || '').trim();
    var dstr = String(row[13] || '').trim();
    var d    = parseImpDate_(dstr);
    if (!name || !d || d < IMPORT_FROM_DATE) continue;
    var film = String(row[14] || '').trim(), light = String(row[15] || '').trim();
    items.push({ service: 'TINT', dateObj: d, payload: {
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
      admin:          IMPORT_ADMIN,
      notes:          ('Плёнка: ' + film + (light ? (', светопропускаемость ' + light + '%') : '')).trim() + ' [импорт]',
      payType:        ''
    }});
  }
}

function collectPPF_(items) {
  var sheet = SpreadsheetApp.openById(IMPORT_SRC.okleyka).getSheets()[0];
  var vals  = sheet.getDataRange().getDisplayValues();   // заголовок — строка 2 (индекс 2), данные с 3
  for (var r = 3; r < vals.length; r++) {
    var row   = vals[r];
    var name  = String(row[2] || '').trim();
    var start = String(row[15] || '').trim();            // Начало выполнения работ = дата заказа
    var d     = parseImpDate_(start);
    if (!name || !d || d < IMPORT_FROM_DATE) continue;
    var els   = String(row[14] || '').trim();
    var extra = String(row[24] || '').trim();
    if (extra) els = (els ? els + ', ' : '') + extra;
    var film  = String(row[19] || '').trim();
    var extraWork = String(row[25] || '').trim();
    var lead  = String(row[21] || '').trim();
    var note  = (film ? 'Использовано плёнки: ' + film + '. ' : '') +
                (extraWork ? 'Доп. работы: ' + extraWork + '. ' : '') +
                (lead ? 'Лид: ' + lead + '. ' : '') + '[импорт]';
    items.push({ service: 'PPF', dateObj: d, payload: {
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
      admin:          IMPORT_ADMIN,
      notes:          note,
      payType:        ''
    }});
  }
}

// ─── ШАГ 2: ОПЛАТЫ / ПЕРСОНАЛ / ЗАТРАТЫ ИЗ РАСЧЁТНОЙ ТАБЛИЦЫ ──────────────────

function fmtImpD_(d) { return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd.MM.yyyy') : ''; }
// Грубое совпадение марки: первое слово одной строки — префикс первого слова другой
function brandMatch_(a, b) {
  var f = function(s){ return String(s || '').toLowerCase().replace(/[^a-zа-я0-9 ]/gi, ' ').trim().split(/\s+/)[0] || ''; };
  var na = f(a), nb = f(b);
  if (!na || !nb) return false;
  return na.indexOf(nb) === 0 || nb.indexOf(na) === 0;
}

/**
 * Сопоставить импортированные заказы со строками «Расчёт ОКЛЕЙКА» и подтянуть:
 * нал/безнал + РЕАЛЬНЫЙ платёж (на всю сумму), менеджер, оклейщики, такси, арматура.
 * Матч по: услуга + стоимость (точно) + дата (±10 дней) + марка (тай-брейк).
 * @param {Object} opts { dryRun:boolean (по умолч. true) }
 * Идемпотентно: обрабатываются только импортированные и ещё НЕ оплаченные заказы.
 */
function matchPaymentsFromRaschet(opts) {
  opts = opts || {};
  var dryRun = (opts.dryRun !== false);
  return safeCall(function() {
    bumpDataVersion_();   // читаем заказы живьём, мимо кэша (свежесозданные должны быть видны все)
    // 1) Строки расчёта с датой ≥ 10.07.2026
    var rv = SpreadsheetApp.openById(IMPORT_SRC.raschet).getSheets()[0].getDataRange().getDisplayValues();
    var raschet = [];
    for (var i = 1; i < rv.length; i++) {
      var row = rv[i];
      var d   = parseImpDate_(row[1]);
      var price = parseImpNum_(row[5]);
      if (!d || d < IMPORT_FROM_DATE || !price) continue;
      var svc = String(row[4] || '').toLowerCase();
      raschet.push({
        used:     false,
        service:  /тонир/.test(svc) ? 'TINT' : 'PPF',
        price:    price,
        date:     d,
        car:      String(row[2] || '').trim(),
        beznal:   /да/i.test(String(row[21] || '').trim()),
        manager:  String(row[23] || '').trim(),
        masters:  String(row[24] || '').trim(),
        taxi:     parseImpNum_(row[19]),
        armatura: parseImpNum_(row[20])
      });
    }

    // 2) Импортированные и ещё не оплаченные заказы
    var allOrders = readSheetAsObjects('DATABASE', 'ORDERS');
    var imported  = allOrders.filter(function(o){ return o['ID'] && String(o['Заметки'] || '').indexOf('[импорт]') >= 0; });
    var orders    = imported.filter(function(o) {
      return String(o['Статус оплаты'] || '') !== 'Оплачен' && String(o['Удалён'] || '') !== 'Да';
    });

    var res = { dryRun: dryRun, matched: [], unmatched: [], applied: 0, errors: [],
                totalOrders:  allOrders.length,
                totalImported: imported.length,
                importedPaid:  imported.filter(function(o){ return String(o['Статус оплаты'] || '') === 'Оплачен'; }).length,
                importedDeleted: imported.filter(function(o){ return String(o['Удалён'] || '') === 'Да'; }).length,
                candidateCount: orders.length, raschetCount: raschet.length };

    orders.forEach(function(o) {
      var svc   = /Тонир/i.test(String(o['Услуга'] || '')) ? 'TINT' : 'PPF';
      var price = Number(o['Стоимость заказа']) || 0;
      var od    = parseImpDate_(o['Дата']);
      var od2   = parseImpDate_(o['Дата выполнения']);
      var best = null, bestScore = 1e9;
      raschet.forEach(function(rr) {
        if (rr.used || rr.service !== svc) return;
        if (Math.abs(rr.price - price) > 0.5) return;         // стоимость — точно
        if (!brandMatch_(o['Авто'], rr.car)) return;          // марка авто ОБЯЗАТЕЛЬНА
        var diff = 1e9;
        if (od)  diff = Math.min(diff, Math.abs(rr.date - od)  / 86400000);
        if (od2) diff = Math.min(diff, Math.abs(rr.date - od2) / 86400000);
        if (diff > 10) return;                                // дата — окно ±10 дней
        if (diff < bestScore) { bestScore = diff; best = rr; }
      });
      if (best) {
        best.used = true;
        res.matched.push({
          order:   { id: o['ID'], contract: o['Номер договора'], client: o['Клиент'], car: o['Авто'], price: price, date: o['Дата'] },
          raschet: { car: best.car, price: best.price, date: fmtImpD_(best.date),
                     payType: best.beznal ? 'Безнал' : 'Нал',
                     manager: mapManager_(best.manager), managerRaw: best.manager,
                     masters: best.masters, taxi: best.taxi, armatura: best.armatura },
          _apply:  best
        });
      } else {
        res.unmatched.push({ id: o['ID'], contract: o['Номер договора'], client: o['Клиент'],
                             car: o['Авто'], service: svc, price: price, date: o['Дата'] });
      }
    });

    if (!dryRun) {
      res.matched.forEach(function(m) {
        try { applyRaschetMatch_(m.order.id, m._apply, m.order.price, m.order.date); res.applied++; }
        catch (e) { res.errors.push((m.order.contract || m.order.id) + ': ' + e.message); }
      });
    }
    res.matched.forEach(function(m) { delete m._apply; });
    res.matchedCount   = res.matched.length;
    res.unmatchedCount = res.unmatched.length;
    return res;
  });
}

// Применить одну пару: затраты + персонал + пересчёт + реальный платёж
function applyRaschetMatch_(orderId, rr, price, orderDate) {
  var exps = [];
  if (rr.taxi > 0)     exps.push({ name: 'Такси',    amount: rr.taxi });
  if (rr.armatura > 0) exps.push({ name: 'Арматура', amount: rr.armatura });
  if (exps.length) saveOrderExpenses(orderId, exps);          // заменяет расходы заказа
  updateOrder(orderId, { payType: rr.beznal ? 'Безнал' : 'Нал', masters: rr.masters, manager: mapManager_(rr.manager), admin: IMPORT_ADMIN });
  recalcOrderFinance(orderId);                                 // валовая/бонусы с учётом затрат и мастеров
  if (Number(price) > 0) {
    addOrderPayment(orderId, { amount: Number(price), payType: rr.beznal ? 'Безнал' : 'Нал',
                               date: orderDate || '', comment: 'Оплата (импорт из расчёта)' });
  }
}

/**
 * Удалить все импортированные заказы (в «Заметки» есть [импорт]) вместе со
 * связанными материалами/расходами/платежами/графиком. Для чистого переимпорта.
 */
function deleteImportedOrders() {
  return safeCall(function() {
    bumpDataVersion_();
    var sheet    = getTab('DATABASE', 'ORDERS');
    var data     = sheet.getDataRange().getValues();
    var headers  = data[0];
    var notesIdx = headers.indexOf('Заметки');
    var idIdx    = headers.indexOf('ID');
    if (notesIdx < 0 || idIdx < 0) throw new Error('Нет колонок ID/Заметки в листе Заказы');
    var ids = [], removed = 0;
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][notesIdx] || '').indexOf('[импорт]') >= 0) {
        ids.push(String(data[i][idIdx]));
        sheet.deleteRow(i + 1);
        removed++;
      }
    }
    var idset = {}; ids.forEach(function(x){ idset[x] = true; });
    ['ORDER_MATERIALS', 'ORDER_EXPENSES', 'PAYMENTS', 'SCHEDULE'].forEach(function(tab) {
      try {
        var s = getTab('DATABASE', tab);
        var d = s.getDataRange().getValues();
        var oidIdx = d[0].indexOf('Заказ ID');
        if (oidIdx < 0) return;
        for (var j = d.length - 1; j >= 1; j--) {
          if (idset[String(d[j][oidIdx])]) s.deleteRow(j + 1);
        }
      } catch (e) {}
    });
    logActivity('Удалены импортированные заказы: ' + removed, 'Заказ', '', '', '');
    return { removed: removed };
  });
}

/**
 * Заменить короткие имена мастеров (оклейщиков) в импортированных заказах на полные
 * ФИО из «Сотрудники» — чтобы бонусы попадали в Расчёт ЗП по людям.
 * Резолв по фрагменту (см. MASTER_MAP) с поиском точного ФИО в базе. Мастер «Егор» = Еромин.
 * @param {Object} opts { dryRun:boolean (по умолч. true) }
 */
function remapImportedMasters(opts) {
  opts = opts || {};
  var dryRun = (opts.dryRun !== false);
  return safeCall(function() {
    bumpDataVersion_();
    var emps = readSheetAsObjects('DATABASE', 'EMPLOYEES')
      .map(function(e){ return String(e['ФИО'] || '').trim(); }).filter(Boolean);
    var norm = function(s){ return String(s || '').toLowerCase().replace(/ё/g, 'е'); };
    var resolve = function(tok) {
      var key  = norm(tok).trim();                 // ё→е, чтобы «артём»/«артем» ловились одинаково
      var frag = MASTER_MAP[key];
      if (!frag) return tok;                       // неизвестное имя — оставляем как есть
      var f = norm(frag);
      for (var i = 0; i < emps.length; i++) {
        if (norm(emps[i]).indexOf(f) >= 0) return emps[i];
      }
      return tok;                                  // сотрудник не найден — не трогаем
    };
    var sheet    = getTab('DATABASE', 'ORDERS');
    var data     = sheet.getDataRange().getValues();
    var headers  = data[0];
    var notesIdx = headers.indexOf('Заметки');
    var mIdx     = headers.indexOf('Оклейщики');
    var idIdx    = headers.indexOf('ID');
    if (mIdx < 0) throw new Error('Нет колонки «Оклейщики»');
    var changes = [], updated = 0;
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][notesIdx] || '').indexOf('[импорт]') < 0) continue;
      var cur = String(data[r][mIdx] || '').trim();
      if (!cur) continue;
      var mapped = cur.split(',').map(function(t){ return resolve(t.trim()); }).join(', ');
      if (mapped !== cur) {
        changes.push({ id: String(data[r][idIdx]), from: cur, to: mapped });
        if (!dryRun) { sheet.getRange(r + 1, mIdx + 1).setValue(mapped); updated++; }
      }
    }
    // Имена мастеров не влияют на СУММУ бонуса (она по количеству), пересчёт не нужен.
    return { dryRun: dryRun, changedCount: changes.length, updated: updated, samples: changes.slice(0, 50) };
  });
}

/**
 * Диагностика: строки «Расчёт ОКЛЕЙКА» (≥10.07), под которые НЕТ заказа.
 * Матч по услуга+стоимость+марка+дата(±10). Показывает недостающие работы —
 * из-за них бонусы в ЗП меньше, чем в расчёте.
 */
function raschetGapReport() {
  return safeCall(function() {
    bumpDataVersion_();
    var rv = SpreadsheetApp.openById(IMPORT_SRC.raschet).getSheets()[0].getDataRange().getDisplayValues();
    var raschet = [];
    for (var i = 1; i < rv.length; i++) {
      var row = rv[i], d = parseImpDate_(row[1]), price = parseImpNum_(row[5]);
      if (!d || d < IMPORT_FROM_DATE || !price) continue;
      raschet.push({
        service:  /тонир/.test(String(row[4] || '').toLowerCase()) ? 'TINT' : 'PPF',
        price: price, date: d, car: String(row[2] || '').trim(),
        manager: String(row[23] || '').trim(), masters: String(row[24] || '').trim(), used: false
      });
    }
    var orders = readSheetAsObjects('DATABASE', 'ORDERS').filter(function(o) {
      if (!o['ID'] || String(o['Удалён'] || '') === 'Да') return false;
      var d = parseImpDate_(o['Дата']); return d && d >= IMPORT_FROM_DATE;
    });
    orders.forEach(function(o) {
      var svc = /Тонир/i.test(String(o['Услуга'] || '')) ? 'TINT' : 'PPF';
      var price = Number(o['Стоимость заказа']) || 0;
      var od = parseImpDate_(o['Дата']), od2 = parseImpDate_(o['Дата выполнения']);
      for (var i = 0; i < raschet.length; i++) {
        var rr = raschet[i];
        if (rr.used || rr.service !== svc) continue;
        if (Math.abs(rr.price - price) > 0.5) continue;
        if (!brandMatch_(o['Авто'], rr.car)) continue;
        var diff = 1e9;
        if (od)  diff = Math.min(diff, Math.abs(rr.date - od)  / 86400000);
        if (od2) diff = Math.min(diff, Math.abs(rr.date - od2) / 86400000);
        if (diff > 10) continue;
        rr.used = true; break;
      }
    });
    var gaps = raschet.filter(function(rr){ return !rr.used; }).map(function(rr) {
      return { service: rr.service, car: rr.car, price: rr.price, date: fmtImpD_(rr.date),
               manager: rr.manager, masters: rr.masters };
    });
    return { raschetTotal: raschet.length, ordersTotal: orders.length, gapCount: gaps.length, gaps: gaps };
  });
}
