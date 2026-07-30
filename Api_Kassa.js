/**
 * Api_Kassa.gs — КАССА (наличные): ежедневный инструмент кассира.
 *
 * Заменяет ручную таблицу «Касса за день». ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ, без
 * параллельного журнала (чтобы не двоить данные):
 *   ПРИХОД  = наличные ПЛАТЕЖИ по заказам (лист «Платежи», Способ='Нал')
 *   РАСХОД  = наличные РАСХОДЫ (лист «Расходы», Способ='Нал') — сюда же
 *             падают авансы ЗП, изъятия директора, мелкие траты из кассы.
 *   БЕЗНАЛ  = безналичные платежи (в кассу НЕ идут, показываются справочно).
 *
 * Остаток наличных в кассе СЕЙЧАС:
 *   Деньги в кассе = kassa_start + kassa_adjust
 *                    + Σ(нал-приход с даты отсчёта)
 *                    − Σ(нал-расход с даты отсчёта)
 * где:
 *   kassa_start      — начальный остаток на дату начала учёта (настройка),
 *   kassa_start_date — дата начала учёта (операции до неё не считаются),
 *   kassa_adjust     — накопленная корректировка от «пересчёта кассы»
 *                      (фиксирует неучтённый дрейф; см. reconcileKassa).
 *
 * Для конкретного дня:
 *   БЫЛО          = остаток на начало дня (kassa_start+adjust + движения до дня)
 *   КАССА ЗА ДЕНЬ = приход дня − расход дня
 *   ИТОГО         = БЫЛО + КАССА ЗА ДЕНЬ
 */

// ─── ПАРСИНГ ДАТ ─────────────────────────────────────────────────────────────

/** Дата операции (день, без времени). Понимает Date, 'dd.MM.yyyy[ HH:mm]', 'YYYY-MM-DD'. */
function parseKassaDay_(val) {
  if (!val) return null;
  if (val instanceof Date) { var d = new Date(val); d.setHours(0, 0, 0, 0); return d; }
  var s = String(val).trim();
  var ru = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (ru) return new Date(+ru[3], +ru[2] - 1, +ru[1]);
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  var d2 = new Date(s);
  if (!isNaN(d2)) { d2.setHours(0, 0, 0, 0); return d2; }
  return null;
}

/** Время операции 'HH:mm' для сортировки/показа: из 'Создан' (dd.MM.yyyy HH:mm) или 'Дата'. */
function kassaTime_(created, date) {
  var s = String(created || '').match(/(\d{2}):(\d{2})/);
  if (s) return s[1] + ':' + s[2];
  var s2 = String(date || '').match(/(\d{2}):(\d{2})/);
  return s2 ? s2[1] + ':' + s2[2] : '';
}

/** Нормализовать вход даты к 'dd.MM.yyyy' (ключ дня). Пусто → сегодня. */
function kassaDayKey_(dateStr) {
  var d = dateStr ? parseKassaDay_(dateStr) : new Date();
  if (!d || isNaN(d)) d = new Date();
  var tz = Session.getScriptTimeZone();
  return Utilities.formatDate(d, tz, 'dd.MM.yyyy');
}

function kr_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ─── ЧТЕНИЕ КАССЫ ────────────────────────────────────────────────────────────

/**
 * Состояние кассы на конкретный день (по умолчанию — сегодня).
 * @param {string} dateStr 'dd.MM.yyyy' | 'YYYY-MM-DD' | '' (сегодня)
 */
function getKassa(dateStr) {
  return safeCall(function() {
   return cachedRead_('kassa:' + kassaDayKey_(dateStr), 60, function() {
    var dayKey  = kassaDayKey_(dateStr);
    var day     = parseKassaDay_(dayKey);
    var settings = getKassaSettings_();
    var startDate = settings.startDate ? parseKassaDay_(settings.startDate) : null;

    var orders   = readSheetAsObjects('DATABASE', 'ORDERS');
    var payments = readSheetAsObjects('DATABASE', 'PAYMENTS');
    var expenses = readSheetAsObjects('DATABASE', 'EXPENSES');

    var orderById = {};
    orders.forEach(function(o){ if (o['ID']) orderById[String(o['ID'])] = o; });

    // База: начальный остаток + корректировка
    var base = kr_(settings.start + settings.adjust);

    var beforeIn = 0, beforeOut = 0;   // движения ДО просматриваемого дня (для БЫЛО)
    var dayOps = [];
    var dayIn = 0, dayOut = 0, dayBeznal = 0;
    var allTimeIn = 0, allTimeOut = 0; // для «Деньги в кассе сейчас»

    function inScope(d) { return d && (!startDate || d >= startDate); }

    // ПРИХОД и БЕЗНАЛ из платежей
    payments.forEach(function(p) {
      if (!p['ID']) return;
      if (String(p['Способ оплаты']) === 'Сертификат') return;   // погашение сертификата — деньги в кассу НЕ идут (пришли при продаже)
      var d = parseKassaDay_(p['Дата']);
      if (!inScope(d)) return;
      var amount = Number(p['Сумма']) || 0;
      var isBeznal = String(p['Способ оплаты']) === 'Безнал';
      var oid = String(p['Заказ ID'] || '');
      var o = orderById[oid] || {};
      var carPart = o['Авто'] || o['Клиент'] || '';
      var desc = (oid ? 'ID ' + oid + ' ' : '') + carPart + (o['Услуга'] ? ' | ' + o['Услуга'] : '');
      desc = desc.trim() || (p['Комментарий'] || 'Платёж');

      if (!isBeznal) {
        allTimeIn += amount;
        if (d < day) beforeIn += amount;
        else if (+d === +day) {
          dayIn += amount;
          dayOps.push({ time: kassaTime_(p['Создан'], p['Дата']), type: 'приход', amount: kr_(amount), sign: '+', desc: desc, orderId: oid });
        }
      } else if (+d === +day) {
        dayBeznal += amount;
        dayOps.push({ time: kassaTime_(p['Создан'], p['Дата']), type: 'безнал', amount: kr_(amount), sign: 'бн', desc: desc, orderId: oid });
      }
    });

    // РАСХОД из наличных расходов
    expenses.forEach(function(e) {
      if (!e['ID']) return;
      var pay = e['Способ оплаты'] || 'Нал';
      if (pay === 'Безнал') return;           // безнал-расходы кассы не касаются
      var d = parseKassaDay_(e['Дата']);
      if (!inScope(d)) return;
      var amount = Number(e['Сумма']) || 0;
      var desc = e['Описание'] || e['Комментарий'] || e['Категория'] || 'Расход';
      allTimeOut += amount;
      if (d < day) beforeOut += amount;
      else if (+d === +day) {
        dayOut += amount;
        dayOps.push({ time: kassaTime_(e['Создан'], e['Дата']), type: 'расход', amount: kr_(amount), sign: '-', desc: desc, expenseId: e['ID'], category: e['Категория'] || '' });
      }
    });

    dayOps.sort(function(a, b){ return String(a.time).localeCompare(String(b.time)); });

    var opening = kr_(base + beforeIn - beforeOut);
    var closing = kr_(opening + dayIn - dayOut);
    var balanceNow = kr_(base + allTimeIn - allTimeOut);

    return {
      date:        dayKey,
      isToday:     dayKey === kassaDayKey_(''),
      opening:     opening,           // БЫЛО
      dayIn:       kr_(dayIn),
      dayOut:      kr_(dayOut),
      dayNet:      kr_(dayIn - dayOut), // КАССА ЗА ДЕНЬ
      dayBeznal:   kr_(dayBeznal),
      closing:     closing,           // ИТОГО на конец дня
      balanceNow:  balanceNow,        // деньги в кассе прямо сейчас
      operations:  dayOps,
      startDate:   settings.startDate,
      startBalance: settings.start,
    };
   });
  });
}

/** Текущий остаток наличных (для дашборда/прочих модулей). Число. */
/**
 * Касса за ПЕРИОД [fromStr..toStr]: остаток на начало периода, приход/расход нал
 * за период, безнал за период, остаток на конец периода + операции с датами.
 */
function getKassaRange(fromStr, toStr) {
  return safeCall(function() {
    var from = parseKassaDay_(kassaDayKey_(fromStr));
    var to   = parseKassaDay_(kassaDayKey_(toStr));
    var settings  = getKassaSettings_();
    var startDate = settings.startDate ? parseKassaDay_(settings.startDate) : null;

    var orders   = readSheetAsObjects('DATABASE', 'ORDERS');
    var payments = readSheetAsObjects('DATABASE', 'PAYMENTS');
    var expenses = readSheetAsObjects('DATABASE', 'EXPENSES');
    var orderById = {};
    orders.forEach(function(o){ if (o['ID']) orderById[String(o['ID'])] = o; });

    var base = kr_(settings.start + settings.adjust);
    function inScope(d){ return d && (!startDate || d >= startDate); }

    var beforeIn = 0, beforeOut = 0, inSum = 0, outSum = 0, beznal = 0, allIn = 0, allOut = 0;
    var ops = [];

    payments.forEach(function(p) {
      if (!p['ID']) return;
      if (String(p['Способ оплаты']) === 'Сертификат') return;   // погашение сертификата — не касса
      var d = parseKassaDay_(p['Дата']); if (!inScope(d)) return;
      var amount = Number(p['Сумма']) || 0;
      var isBez  = String(p['Способ оплаты']) === 'Безнал';
      var oid = String(p['Заказ ID'] || ''); var o = orderById[oid] || {};
      var carPart = o['Авто'] || o['Клиент'] || '';
      var desc = (oid ? 'ID ' + oid + ' ' : '') + carPart + (o['Услуга'] ? ' | ' + o['Услуга'] : '');
      desc = desc.trim() || (p['Комментарий'] || 'Платёж');
      if (!isBez) {
        allIn += amount;
        if (d < from) beforeIn += amount;
        else if (d <= to) { inSum += amount; ops.push({ date: kassaDayKey_(p['Дата']), time: kassaTime_(p['Создан'], p['Дата']), type: 'приход', amount: kr_(amount), sign: '+', desc: desc, orderId: oid }); }
      } else if (d >= from && d <= to) {
        beznal += amount;
        ops.push({ date: kassaDayKey_(p['Дата']), time: kassaTime_(p['Создан'], p['Дата']), type: 'безнал', amount: kr_(amount), sign: 'бн', desc: desc, orderId: oid });
      }
    });
    expenses.forEach(function(e) {
      if (!e['ID']) return;
      if ((e['Способ оплаты'] || 'Нал') === 'Безнал') return;
      var d = parseKassaDay_(e['Дата']); if (!inScope(d)) return;
      var amount = Number(e['Сумма']) || 0;
      var desc = e['Описание'] || e['Комментарий'] || e['Категория'] || 'Расход';
      allOut += amount;
      if (d < from) beforeOut += amount;
      else if (d <= to) { outSum += amount; ops.push({ date: kassaDayKey_(e['Дата']), time: kassaTime_(e['Создан'], e['Дата']), type: 'расход', amount: kr_(amount), sign: '-', desc: desc, expenseId: e['ID'], category: e['Категория'] || '' }); }
    });

    ops.sort(function(a, b) {
      var ka = String(a.date).split('.').reverse().join(''), kb = String(b.date).split('.').reverse().join('');
      if (ka !== kb) return ka.localeCompare(kb);
      return String(a.time).localeCompare(String(b.time));
    });

    var opening = kr_(base + beforeIn - beforeOut);
    var closing = kr_(opening + inSum - outSum);
    return {
      isRange:    true,
      fromDate:   kassaDayKey_(fromStr),
      toDate:     kassaDayKey_(toStr),
      opening:    opening,
      dayIn:      kr_(inSum),
      dayOut:     kr_(outSum),
      dayNet:     kr_(inSum - outSum),
      dayBeznal:  kr_(beznal),
      closing:    closing,
      balanceNow: kr_(base + allIn - allOut),
      operations: ops,
      startDate:  settings.startDate
    };
  });
}

function getKassaBalance_() {
  var settings = getKassaSettings_();
  var startDate = settings.startDate ? parseKassaDay_(settings.startDate) : null;
  function inScope(d) { return d && (!startDate || d >= startDate); }
  var inSum = 0, outSum = 0;
  readSheetAsObjects('DATABASE', 'PAYMENTS').forEach(function(p) {
    if (!p['ID'] || String(p['Способ оплаты']) === 'Безнал') return;
    if (String(p['Способ оплаты']) === 'Сертификат') return;   // погашение сертификата — не касса
    if (inScope(parseKassaDay_(p['Дата']))) inSum += Number(p['Сумма']) || 0;
  });
  readSheetAsObjects('DATABASE', 'EXPENSES').forEach(function(e) {
    if (!e['ID'] || (e['Способ оплаты'] || 'Нал') === 'Безнал') return;
    if (inScope(parseKassaDay_(e['Дата']))) outSum += Number(e['Сумма']) || 0;
  });
  return kr_(settings.start + settings.adjust + inSum - outSum);
}

/**
 * Разбивка остатков для сверки на дашборде: начало + приход − расход = сейчас,
 * отдельно наличные (касса) и безнал (счёт). Наличные — с даты старта кассы;
 * безнал — за всё время (на счёт приходит полная сумма, без −15%).
 */
function getBalancesBreakdown_() {
  var settings = getKassaSettings_();
  var startDate = settings.startDate ? parseKassaDay_(settings.startDate) : null;
  function inScope(d) { return d && (!startDate || d >= startDate); }
  var nalIn = 0, nalOut = 0, bezIn = 0, bezOut = 0;
  readSheetAsObjects('DATABASE', 'PAYMENTS').forEach(function(p) {
    if (!p['ID']) return;
    if (String(p['Способ оплаты']) === 'Сертификат') return;   // погашение сертификата — не касса
    var amt = Number(p['Сумма']) || 0;
    if (String(p['Способ оплаты']) === 'Безнал') { bezIn += amt; }
    else if (inScope(parseKassaDay_(p['Дата']))) { nalIn += amt; }
  });
  readSheetAsObjects('DATABASE', 'EXPENSES').forEach(function(e) {
    if (!e['ID']) return;
    var amt = Number(e['Сумма']) || 0;
    if ((e['Способ оплаты'] || 'Нал') === 'Безнал') { bezOut += amt; }
    else if (inScope(parseKassaDay_(e['Дата']))) { nalOut += amt; }
  });
  var nalOpen = settings.start + settings.adjust;
  return {
    nal:    { opening: kr_(nalOpen), inSum: kr_(nalIn), outSum: kr_(nalOut), closing: kr_(nalOpen + nalIn - nalOut) },
    beznal: { opening: 0,            inSum: kr_(bezIn), outSum: kr_(bezOut), closing: kr_(bezIn - bezOut) },
  };
}

function getKassaSettings_() {
  return {
    start:     Number(getSettingValue_('kassa_start')) || 0,
    adjust:    Number(getSettingValue_('kassa_adjust')) || 0,
    startDate: String(getSettingValue_('kassa_start_date') || '').trim(),
  };
}

// ─── РАСХОД ИЗ КАССЫ (быстрое добавление) ────────────────────────────────────

/**
 * Быстрый наличный расход из кассы. Пишется в лист «Расходы» (Способ='Нал').
 * @param {Object} payload { amount, kind, employeeId, employeeName, comment, date }
 *   kind: 'Аванс' | 'Изъятие' | 'Прочее' (и любой текст → категория «Прочее»)
 */
function addKassaExpense(payload) {
  return safeCall(function() {
    payload = payload || {};
    var amount = Number(payload.amount) || 0;
    if (amount <= 0) throw new Error('Укажите сумму расхода');

    var kind = String(payload.kind || 'Прочее');
    var category, desc;
    if (kind === 'Аванс') {
      category = 'Зарплата';
      desc = 'Аванс ЗП' + (payload.employeeName ? ' — ' + payload.employeeName : '') +
             (payload.comment ? ' (' + payload.comment + ')' : '');
    } else if (kind === 'Изъятие') {
      category = 'Изъятие владельца';
      desc = 'Изъятие из кассы' + (payload.comment ? ' — ' + payload.comment : '');
    } else {
      category = 'Прочее';
      desc = payload.comment || 'Расход из кассы';
    }

    var resp = createExpense({
      amount:     amount,
      category:   category,
      description: desc,
      payMethod:  'Нал',
      employeeId: payload.employeeId || '',
      date:       payload.date || '',
      comment:    payload.comment || '',
      author:     payload.author || '',
    });
    if (resp && resp.ok === false) throw new Error(resp.error);
    return { id: (resp && resp.data ? resp.data.id : ''), kind: kind, amount: amount };
  });
}

// ─── НАСТРОЙКА НАЧАЛЬНОГО ОСТАТКА ────────────────────────────────────────────

/**
 * Задать начальный остаток кассы и дату начала учёта.
 * Сбрасывает накопленную корректировку (новая точка отсчёта).
 */
function setKassaStart(amount, dateStr) {
  return safeCall(function() {
    var start = Number(amount) || 0;
    var dk = dateStr ? kassaDayKey_(dateStr) : kassaDayKey_('');
    saveSetting('kassa_start', String(start), 'Начальный остаток кассы', 'Касса');
    saveSetting('kassa_start_date', dk, 'Дата начала учёта кассы', 'Касса');
    saveSetting('kassa_adjust', '0', 'Корректировка кассы (пересчёт)', 'Касса');
    bumpDataVersion_();
    logActivity('Начальный остаток', 'Касса', '', '', start + ' Br с ' + dk);
    return { start: start, startDate: dk };
  });
}

/**
 * Пересчёт (инвентаризация) кассы: вводим фактически посчитанные наличные.
 * Подгоняем kassa_adjust так, чтобы расчётный остаток совпал с фактом.
 * Расхождение фиксируется в журнале (недостача/излишек).
 */
function reconcileKassa(actualAmount) {
  return safeCall(function() {
    var actual = Number(actualAmount);
    if (isNaN(actual)) throw new Error('Укажите фактическую сумму в кассе');

    var current = getKassaBalance_();
    var settings = getKassaSettings_();
    var delta = kr_(actual - current);          // насколько факт расходится с расчётом
    var newAdjust = kr_(settings.adjust + delta);

    saveSetting('kassa_adjust', String(newAdjust), 'Корректировка кассы (пересчёт)', 'Касса');
    bumpDataVersion_();
    logActivity('Пересчёт кассы', 'Касса', '', String(current), String(actual),
      (delta === 0 ? 'сходится' : (delta < 0 ? 'недостача ' : 'излишек ') + Math.abs(delta) + ' Br'));
    return { actual: actual, wasComputed: current, delta: delta, balance: actual };
  });
}

// ─── ОТЧЁТ ДЛЯ TELEGRAM ──────────────────────────────────────────────────────

/** Сформировать текст отчёта по кассе за день (формат как в ручной таблице). */
function buildKassaReportText_(dateStr) {
  var resp = getKassa(dateStr);
  var k = (resp && resp.ok) ? resp.data : null;
  if (!k) return '';
  var rub = function(n){ return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('ru') + 'р.'; };
  var lines = [];
  lines.push(k.date.slice(0, 5));                       // «13.06»
  lines.push('БЫЛО: ' + rub(k.opening));
  k.operations.forEach(function(op) {
    if (op.type === 'расход')      lines.push('-' + rub(op.amount) + ' ' + op.desc);
    else if (op.type === 'безнал') lines.push('БЕЗНАЛ ' + rub(op.amount) + ' ' + op.desc);
    else                           lines.push('+' + rub(op.amount) + ' ' + op.desc);
  });
  lines.push('ИТОГО: ' + rub(k.dayNet));
  lines.push('КАССА: ' + rub(k.closing));
  return lines.join('\n');
}

/** Вернуть текст отчёта (для копирования в UI). */
function getKassaReportText(dateStr) {
  return safeCall(function() { return { text: buildKassaReportText_(dateStr) }; });
}

/** Отправить отчёт по кассе в Telegram (нужны telegram_bot_token + telegram_chat_id). */
function sendKassaReport(dateStr) {
  return safeCall(function() {
    var text = buildKassaReportText_(dateStr);
    if (!text) throw new Error('Нет данных по кассе за этот день');
    var token  = String(getSettingValue_('telegram_bot_token') || '').trim();
    var chatId = String(getSettingValue_('telegram_chat_id') || '').trim();
    if (!token || !chatId) throw new Error('Не настроен Telegram (бот-токен и chat_id в Настройках)');
    sendTelegram_(token, chatId, text);
    logActivity('Отчёт кассы', 'Касса', '', '', 'Telegram ' + kassaDayKey_(dateStr));
    return { sent: true, text: text };
  });
}
