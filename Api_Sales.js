/**
 * Api_Sales.gs — модуль «Продажи материалов» (перепродажа плёнки оптовикам/физлицам).
 *
 * Продажа = шапка (лист «Продажи») + позиции (лист «Позиции продаж»).
 * Клиент берётся из общего справочника «Клиенты» (тег «Оптовик»).
 * Оплата пишется в общий лист «Платежи» (Заказ ID = ID продажи) → приход
 * автоматически попадает в Кассу/ДДС (Нал → касса, Безнал → р/счёт).
 * Склад пока не списываем (заложено на будущее).
 */

function saleR2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Статус оплаты по сумме/оплате
function salePayStatus_(paid, total) {
  paid = Number(paid) || 0; total = Number(total) || 0;
  if (total > 0 && paid >= total - 0.001) return 'Оплачен';
  if (paid > 0) return 'Частично';
  return 'Не оплачен';
}

/**
 * Список продаж. filter.deleted=true → показать удалённые (корзина).
 */
function getSales(filter) {
  return safeCall(function() {
    filter = filter || {};
    var rows = readSheetAsObjects('DATABASE', 'SALES').filter(function(s) {
      if (!s['ID']) return false;
      var del = String(s['Удалён'] || '') === 'Да';
      return filter.deleted ? del : !del;
    });
    // Кол-во позиций по каждой продаже
    var cnt = {};
    readSheetAsObjects('DATABASE', 'SALE_ITEMS').forEach(function(i) {
      if (i['ID']) cnt[String(i['Продажа ID'])] = (cnt[String(i['Продажа ID'])] || 0) + 1;
    });
    rows.forEach(function(s) {
      s._total = Number(s['Итого']) || 0;
      s._paid  = Number(s['Оплачено']) || 0;
      s._debt  = saleR2_(s._total - s._paid);
      s._items = cnt[String(s['ID'])] || 0;
    });
    // Новые сверху (по ID — он инкрементный)
    rows.sort(function(a, b) { return String(b['ID']).localeCompare(String(a['ID'])); });
    return rows;
  });
}

/**
 * Полные данные продажи: шапка + позиции.
 */
function getSaleFull(saleId) {
  return safeCall(function() {
    if (!saleId) throw new Error('Не указан ID продажи');
    var head = readSheetAsObjects('DATABASE', 'SALES').filter(function(s) {
      return String(s['ID']) === String(saleId);
    })[0];
    if (!head) throw new Error('Продажа не найдена: ' + saleId);
    var items = readSheetAsObjects('DATABASE', 'SALE_ITEMS').filter(function(i) {
      return i['ID'] && String(i['Продажа ID']) === String(saleId);
    });
    head._total = Number(head['Итого']) || 0;
    head._paid  = Number(head['Оплачено']) || 0;
    head._debt  = saleR2_(head._total - head._paid);
    return { sale: head, items: items };
  });
}

/**
 * Создать продажу.
 * payload = { date, clientId, clientName, phone, payType, dueDate, comment,
 *             items:[{materialId,name,unit,qty,price}], paid }
 */
function createSale(payload) {
  return safeCall(function() {
    bumpDataVersion_();
    payload = payload || {};
    var items = (payload.items || []).filter(function(it) {
      return (String(it.name || '').trim() || it.materialId) && Number(it.qty) > 0;
    });
    if (!items.length) throw new Error('Добавьте хотя бы одну позицию с количеством');
    if (!payload.clientName && !payload.clientId) throw new Error('Укажите клиента');

    var tz  = Session.getScriptTimeZone();
    var now = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');
    var dateStr = payload.date || Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy');
    var payType = payload.payType || 'Нал';

    // Итого
    var total = 0;
    items.forEach(function(it) { total += (Number(it.qty) || 0) * (Number(it.price) || 0); });
    total = saleR2_(total);

    // Первичная оплата: Нал/Безнал → сразу вся сумма; Отсрочка/Рассрочка → предоплата (или 0)
    var paid;
    if (payload.paid !== undefined && payload.paid !== '') paid = saleR2_(Number(payload.paid) || 0);
    else paid = (payType === 'Нал' || payType === 'Безнал') ? total : 0;
    if (paid > total) paid = total;

    // ── Шапка продажи ──
    var sheet = getTab('DATABASE', 'SALES');
    var lastRow = sheet.getLastRow();
    var id = 'ПР-' + String(lastRow).padStart(5, '0');
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var head = {
      'ID': id, 'Дата': dateStr,
      'Клиент ID': payload.clientId || '', 'Клиент': payload.clientName || '',
      'Телефон': payload.phone || '', 'Способ оплаты': payType,
      'Итого': total, 'Оплачено': 0, 'Статус оплаты': 'Не оплачен',
      'Срок оплаты': payload.dueDate || '', 'Комментарий': payload.comment || '',
      'Удалён': '', 'Создан': now, 'Обновлён': now,
    };
    sheet.appendRow(headers.map(function(h) { return head[h] !== undefined ? head[h] : ''; }));

    // ── Позиции ──
    var itemSheet = getTab('DATABASE', 'SALE_ITEMS');
    var ih = itemSheet.getRange(1, 1, 1, itemSheet.getLastColumn()).getValues()[0];
    items.forEach(function(it, idx) {
      var sum = saleR2_((Number(it.qty) || 0) * (Number(it.price) || 0));
      var row = {
        'ID': id + '-П-' + String(idx + 1).padStart(2, '0'), 'Продажа ID': id,
        'Материал ID': it.materialId || '', 'Название': it.name || '',
        'Единица': it.unit || 'пог.м', 'Кол-во': Number(it.qty) || 0,
        'Цена': Number(it.price) || 0, 'Сумма': sum, 'Создан': now,
      };
      itemSheet.appendRow(ih.map(function(h) { return row[h] !== undefined ? row[h] : ''; }));
    });

    // ── Первичная оплата → лист «Платежи» (для Кассы/ДДС) ──
    if (paid > 0) {
      var method = (payType === 'Безнал') ? 'Безнал' : 'Нал';   // отсрочка/рассрочка-предоплата → наличными
      recordSalePayment_(id, paid, method, dateStr, payload.clientName || '');
    }
    recomputeSalePaid_(id);

    logActivity('Создал', 'Продажа', id, '', payload.clientName || '');
    return { id: id, total: total, paid: paid };
  });
}

/**
 * Принять оплату по продаже.
 * payload = { amount, method:'Нал'|'Безнал', date }
 */
function addSalePayment(saleId, payload) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!saleId) throw new Error('Не указан ID продажи');
    payload = payload || {};
    var amount = saleR2_(Number(payload.amount) || 0);
    if (amount <= 0) throw new Error('Укажите сумму оплаты');
    var tz = Session.getScriptTimeZone();
    var dateStr = payload.date || Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy');
    var method = (payload.method === 'Безнал') ? 'Безнал' : 'Нал';

    // подпись — имя клиента из шапки
    var head = readSheetAsObjects('DATABASE', 'SALES').filter(function(s){ return String(s['ID']) === String(saleId); })[0];
    recordSalePayment_(saleId, amount, method, dateStr, head ? (head['Клиент'] || '') : '');
    var res = recomputeSalePaid_(saleId);
    logActivity('Оплата', 'Продажа', saleId, '', String(amount));
    return res;
  });
}

// Записать платёж продажи в общий лист «Платежи» (Заказ ID = ID продажи)
function recordSalePayment_(saleId, amount, method, dateStr, clientName) {
  var sheet = getTab('DATABASE', 'PAYMENTS');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var tz = Session.getScriptTimeZone();
  var now = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');
  var pid = saleId + '-О-' + Utilities.formatDate(new Date(), tz, 'HHmmss');
  var row = {
    'ID': pid, 'Заказ ID': saleId, 'Дата': dateStr, 'Сумма': saleR2_(amount),
    'Способ оплаты': method, 'Комментарий': 'Продажа' + (clientName ? ': ' + clientName : ''), 'Создан': now,
  };
  sheet.appendRow(headers.map(function(h) { return row[h] !== undefined ? row[h] : ''; }));
}

// Пересчитать «Оплачено»/«Статус оплаты» продажи из фактических платежей
function recomputeSalePaid_(saleId) {
  var paid = 0;
  readSheetAsObjects('DATABASE', 'PAYMENTS').forEach(function(p) {
    if (String(p['Заказ ID']) === String(saleId)) paid += Number(p['Сумма']) || 0;
  });
  paid = saleR2_(paid);
  var sheet = getTab('DATABASE', 'SALES');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx = headers.indexOf('ID');
  var paidIdx = headers.indexOf('Оплачено');
  var statusIdx = headers.indexOf('Статус оплаты');
  var totalIdx = headers.indexOf('Итого');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) !== String(saleId)) continue;
    var total = Number(data[i][totalIdx]) || 0;
    var status = salePayStatus_(paid, total);
    if (paidIdx >= 0) sheet.getRange(i + 1, paidIdx + 1).setValue(paid);
    if (statusIdx >= 0) sheet.getRange(i + 1, statusIdx + 1).setValue(status);
    return { paid: paid, total: total, status: status, debt: saleR2_(total - paid) };
  }
  throw new Error('Продажа не найдена: ' + saleId);
}

// Мягкое удаление / восстановление (в Корзину)
function softDeleteSale(saleId) { return setSaleDeleted_(saleId, 'Да'); }
function restoreSale(saleId)    { return setSaleDeleted_(saleId, ''); }

function setSaleDeleted_(saleId, val) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!saleId) throw new Error('Не указан ID продажи');
    var sheet = getTab('DATABASE', 'SALES');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idIdx = headers.indexOf('ID');
    var delIdx = headers.indexOf('Удалён');
    if (delIdx < 0) throw new Error('Нет колонки «Удалён» — запустите Мастер настройки');
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(saleId)) {
        sheet.getRange(i + 1, delIdx + 1).setValue(val);
        logActivity(val === 'Да' ? 'Удалил' : 'Восстановил', 'Продажа', saleId, '', '');
        return { id: saleId, deleted: val === 'Да' };
      }
    }
    throw new Error('Продажа не найдена: ' + saleId);
  });
}
