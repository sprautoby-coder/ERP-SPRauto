/**
 * Api_Payments.gs — частичные платежи и рассрочка (v1.3)
 *
 * Каждый заказ может иметь несколько платежей.
 * Лист: DATABASE → Платежи
 *
 * Статус оплаты заказа:
 * - Не оплачен  (Безнал='')        — дебиторка, 0 платежей
 * - Рассрочка   (Безнал='Частично') — есть платежи, но меньше суммы заказа
 * - Оплачен нал (Безнал='Нет')
 * - Оплачен б/н (Безнал='Да')
 */

/**
 * Получить все платежи по заказу.
 */
function getOrderPayments(orderId) {
  return safeCall(function() {
    const all = readSheetAsObjects('DATABASE', 'PAYMENTS');
    return all.filter(function(p){ return p['ID'] && String(p['Заказ ID']) === String(orderId); });
  });
}

/**
 * Добавить платёж по заказу.
 * @param {string} orderId
 * @param {Object} payload: { amount, payType ('Нал'|'Безнал'), date, comment }
 */
function addOrderPayment(orderId, payload) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!orderId) throw new Error('Не указан ID заказа');
    const amount = Number(payload.amount) || 0;
    if (!amount || amount <= 0) throw new Error('Укажите сумму платежа');

    const sheet   = getTab('DATABASE', 'PAYMENTS');
    const lastRow = sheet.getLastRow();
    const id      = 'ПЛТ-' + String(lastRow).padStart(5, '0');
    const tz      = Session.getScriptTimeZone();
    const now     = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');
    const today   = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    const data = {
      'ID':            id,
      'Заказ ID':      orderId,
      'Дата':          payload.date || today,
      'Сумма':         amount,
      'Способ оплаты': payload.payType || 'Нал',
      'Комментарий':   payload.comment || '',
      'Создан':        now,
    };

    sheet.appendRow(headers.map(function(h){ return data[h] !== undefined ? data[h] : ''; }));

    // Пересчитываем статус оплаты заказа
    updateOrderPaymentStatus_(orderId);

    logActivity('Платёж', 'Заказ', orderId, '', amount + ' Br — ' + (payload.payType||''));
    return { id: id, amount: amount };
  });
}

/**
 * Сменить способ оплаты платежа (Нал / Нал с чеком / Безнал) и пересчитать заказ.
 * Влияет на: касса/счёт (нал и нал с чеком → касса, безнал → счёт) и базу −15% для бонусов ЗП.
 */
function updatePaymentMethod(paymentId, method) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!paymentId) throw new Error('Не указан платёж');
    method = String(method || 'Нал');
    const sheet   = getTab('DATABASE', 'PAYMENTS');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx   = headers.indexOf('ID');
    const ordIdx  = headers.indexOf('Заказ ID');
    const mIdx    = headers.indexOf('Способ оплаты');
    if (mIdx < 0) throw new Error('Нет колонки «Способ оплаты»');
    let orderId = null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(paymentId)) {
        sheet.getRange(i + 1, mIdx + 1).setValue(method);
        orderId = String(data[i][ordIdx]);
        break;
      }
    }
    if (!orderId) throw new Error('Платёж не найден: ' + paymentId);
    updateOrderPaymentStatus_(orderId);   // пересчитает статус оплаты и финансы (−15% от официальных)
    return { id: paymentId, method: method, orderId: orderId };
  });
}

/**
 * Удалить платёж.
 */
function deleteOrderPayment(paymentId) {
  return safeCall(function() {
    bumpDataVersion_();
    const sheet   = getTab('DATABASE', 'PAYMENTS');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx   = headers.indexOf('ID');
    const ordIdx  = headers.indexOf('Заказ ID');
    let   orderId = null;

    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][idIdx]) === String(paymentId)) {
        orderId = String(data[i][ordIdx]);
        sheet.deleteRow(i + 1);
        break;
      }
    }
    if (orderId) updateOrderPaymentStatus_(orderId);
    return { id: paymentId };
  });
}

/**
 * Пересчитать статус оплаты заказа на основе всех платежей.
 * При полной оплате также сбрасывает «Срок оплаты».
 */
function updateOrderPaymentStatus_(orderId) {
  const payments = readSheetAsObjects('DATABASE', 'PAYMENTS')
    .filter(function(p){ return String(p['Заказ ID']) === String(orderId); });

  const oSheet   = getTab('DATABASE', 'ORDERS');
  const oData    = oSheet.getDataRange().getValues();
  const oHeaders = oData[0];
  const idIdx    = oHeaders.indexOf('ID');
  const priceIdx = oHeaders.indexOf('Стоимость заказа');
  const statIdx  = oHeaders.indexOf('Статус оплаты');
  const bzIdx    = oHeaders.indexOf('Безнал');
  const dueIdx   = oHeaders.indexOf('Срок оплаты');
  const updIdx   = oHeaders.indexOf('Обновлён');

  let orderPrice = 0;
  let orderRow   = -1;

  for (let i = 1; i < oData.length; i++) {
    if (String(oData[i][idIdx]) === String(orderId)) {
      orderPrice = Number(oData[i][priceIdx]) || 0;
      orderRow   = i + 1;
      break;
    }
  }

  if (orderRow < 0) return;

  const totalPaid = payments.reduce(function(s, p){ return s + (Number(p['Сумма'])||0); }, 0);
  const tz  = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

  // Авторитетный статус оплаты
  let newStatus;
  let legacyBeznal; // зеркало для обратной совместимости (старые читатели)
  if (totalPaid <= 0) {
    newStatus    = 'Не оплачен';
    legacyBeznal = '';
  } else if (totalPaid >= orderPrice) {
    newStatus = 'Оплачен';
    // Способ для legacy-зеркала — по преобладающему типу платежей
    const beznalSum = payments
      .filter(function(p){ return p['Способ оплаты'] === 'Безнал'; })
      .reduce(function(s, p){ return s + (Number(p['Сумма'])||0); }, 0);
    legacyBeznal = beznalSum >= orderPrice * 0.5 ? 'Да' : 'Нет';
    // При полной оплате сбрасываем срок следующего платежа
    if (dueIdx >= 0) oSheet.getRange(orderRow, dueIdx + 1).setValue('');
  } else {
    newStatus    = 'Частично';
    legacyBeznal = 'Частично';
  }

  if (statIdx >= 0) oSheet.getRange(orderRow, statIdx + 1).setValue(newStatus);
  if (bzIdx  >= 0)  oSheet.getRange(orderRow, bzIdx  + 1).setValue(legacyBeznal);
  if (updIdx >= 0)  oSheet.getRange(orderRow, updIdx + 1).setValue(now);

  // Если есть график рассрочки — отметить оплаченные взносы и выставить дату следующего
  try { updateScheduleProgress_(orderId); } catch (e) {}

  // Пересчитать финансы: база −15% для бонусов зависит от суммы официальных
  // платежей (безнал + нал с чеком), которая изменилась после этого платежа.
  try { recalcOrderFinance(orderId); } catch (e) {}
}

// ─── УПРАВЛЕНИЕ СРОКОМ ОПЛАТЫ ────────────────────────────────────────────────

/**
 * Установить или сбросить срок оплаты для заказа.
 * @param {string} orderId
 * @param {string} dueDate — 'YYYY-MM-DD', 'dd.MM.yyyy' или '' чтобы сбросить
 */
function setOrderDueDate(orderId, dueDate) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!orderId) throw new Error('Не указан ID заказа');

    const sheet   = getTab('DATABASE', 'ORDERS');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx   = headers.indexOf('ID');
    const dueIdx  = headers.indexOf('Срок оплаты');
    const updIdx  = headers.indexOf('Обновлён');

    if (dueIdx < 0) throw new Error('Колонка "Срок оплаты" не найдена. Запустите addDueDateColumn() в Setup.js');

    // Нормализуем: YYYY-MM-DD → dd.MM.yyyy
    let dueDateStr = '';
    if (dueDate) {
      const m = String(dueDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) dueDateStr = m[3] + '.' + m[2] + '.' + m[1];
      else   dueDateStr = String(dueDate).trim();
    }

    const tz  = Session.getScriptTimeZone();
    const now = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) !== String(orderId)) continue;
      sheet.getRange(i + 1, dueIdx + 1).setValue(dueDateStr);
      if (updIdx >= 0) sheet.getRange(i + 1, updIdx + 1).setValue(now);
      logActivity('Срок оплаты', 'Заказ', orderId, '', dueDateStr || 'сброшен');
      return { orderId: orderId, dueDate: dueDateStr };
    }
    throw new Error('Заказ не найден: ' + orderId);
  });
}

// ─── ДЕБИТОРКА + РАССРОЧКА ───────────────────────────────────────────────────

/**
 * Получить все долговые заказы (Безнал='' или 'Частично') с обогащёнными данными.
 * Используется страницей «Дебиторка».
 * Возвращает массив, отсортированный: просроченные → срок ближайший → без срока.
 */
function getDebtOrders() {
  return safeCall(function() {
   return cachedRead_('debt', 45, function() {
    const orders   = readSheetAsObjects('DATABASE', 'ORDERS');
    const payments = readSheetAsObjects('DATABASE', 'PAYMENTS');
    const today    = new Date();
    today.setHours(0, 0, 0, 0);

    // Суммируем уже уплаченное по каждому заказу
    const paidByOrder = {};
    payments.forEach(function(p) {
      if (!p['ID']) return;
      const oid = String(p['Заказ ID']);
      paidByOrder[oid] = (paidByOrder[oid] || 0) + (Number(p['Сумма']) || 0);
    });

    const result = [];
    const cancelledSet = getCancelledStatusSet_();

    orders.forEach(function(o) {
      if (!o['ID'] || String(o['Удалён'] || '') === 'Да' || cancelledSet[o['Статус']]) return; // мягко удалённые не учитываем

      // Статус оплаты с откатом на legacy «Безнал» для старых строк
      let payStatus = String(o['Статус оплаты'] || '').trim();
      if (!payStatus) {
        const bz = String(o['Безнал'] || '').trim();
        payStatus = (bz === 'Да' || bz === 'Нет') ? 'Оплачен' : bz === 'Частично' ? 'Частично' : 'Не оплачен';
      }
      if (payStatus === 'Оплачен') return; // долга нет

      const beznal = payStatus === 'Частично' ? 'Частично' : '';

      const price     = Number(o['Стоимость заказа']) || 0;
      const paid      = Math.round((paidByOrder[String(o['ID'])] || 0) * 100) / 100;
      const remaining = Math.round(Math.max(0, price - paid) * 100) / 100;

      // Разбираем срок оплаты (dd.MM.yyyy)
      const dueDateRaw = String(o['Срок оплаты'] || '').trim();
      let dueDate = null;
      if (dueDateRaw) {
        const m = dueDateRaw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
        if (m) { dueDate = new Date(+m[3], +m[2] - 1, +m[1]); dueDate.setHours(0, 0, 0, 0); }
      }

      let daysUntilDue = null;
      if (dueDate) daysUntilDue = Math.ceil((dueDate - today) / 86400000);

      // Дней с момента создания заказа
      let daysOpen = null;
      const dm = String(o['Дата'] || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
      if (dm) {
        const od = new Date(+dm[3], +dm[2] - 1, +dm[1]);
        od.setHours(0, 0, 0, 0);
        daysOpen = Math.floor((today - od) / 86400000);
      }

      result.push({
        id:          String(o['ID']),
        contract:    o['Номер договора'] || '',
        date:        o['Дата'] || '',
        client:      o['Клиент'] || '',
        phone:       o['Телефон'] || '',
        car:         (o['Авто'] || '') + (o['Госномер'] ? ' · ' + o['Госномер'] : ''),
        service:     o['Услуга'] || '',
        orderStatus: o['Статус'] || '',
        price:       price,
        paid:        paid,
        remaining:   remaining,
        dueDate:     dueDateRaw,
        daysUntilDue: daysUntilDue,
        isOverdue:   dueDate !== null && daysUntilDue < 0,
        daysOpen:    daysOpen,
        beznal:      beznal,
        payStatus:   payStatus,
        payType:     o['Тип оплаты'] || '',
      });
    });

    // Сортировка: просроченные → срок скоро → без срока (по возрасту долга)
    result.sort(function(a, b) {
      const aHas = !!a.dueDate;
      const bHas = !!b.dueDate;
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      if (aHas && bHas) return a.daysUntilDue - b.daysUntilDue;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return (b.daysOpen || 0) - (a.daysOpen || 0);
    });

    return result;
   });
  });
}

/**
 * Получить сводку по платежам заказа.
 */
function getOrderPaymentSummary(orderId) {
  return safeCall(function() {
    const payments = readSheetAsObjects('DATABASE', 'PAYMENTS')
      .filter(function(p){ return p['ID'] && String(p['Заказ ID']) === String(orderId); });

    const total = payments.reduce(function(s, p){ return s + (Number(p['Сумма'])||0); }, 0);
    const lastPayment = payments.length > 0
      ? payments.sort(function(a,b){ return String(b['Дата']).localeCompare(String(a['Дата'])); })[0]
      : null;

    return {
      payments:    payments,
      totalPaid:   Math.round(total * 100) / 100,
      lastDate:    lastPayment ? lastPayment['Дата'] : null,
      lastAmount:  lastPayment ? Number(lastPayment['Сумма']) : 0,
      count:       payments.length,
    };
  });
}

// ─── ГРАФИК ПЛАТЕЖЕЙ (РАССРОЧКА) ─────────────────────────────────────────────

/**
 * Получить график платежей по заказу (отсортирован по № взноса).
 */
function getPaymentSchedule(orderId) {
  return safeCall(function() {
    try {
      return readSheetAsObjects('DATABASE', 'SCHEDULE')
        .filter(function(r){ return r['ID'] && String(r['Заказ ID']) === String(orderId); })
        .sort(function(a, b){ return (Number(a['№'])||0) - (Number(b['№'])||0); });
    } catch (e) { return []; }
  });
}

/**
 * Авто-разбивка остатка на равные ежемесячные взносы.
 * @param {string} orderId
 * @param {Object} payload: { months, startDate ('YYYY-MM-DD' или 'dd.MM.yyyy') }
 */
function createInstallmentPlan(orderId, payload) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!orderId) throw new Error('Не указан заказ');
    const months = Math.max(1, parseInt(payload.months, 10) || 0);

    // Остаток = цена − уже уплачено
    const orders = readSheetAsObjects('DATABASE', 'ORDERS');
    let price = 0;
    for (let i = 0; i < orders.length; i++) {
      if (String(orders[i]['ID']) === String(orderId)) { price = Number(orders[i]['Стоимость заказа']) || 0; break; }
    }
    let paid = 0;
    try { readSheetAsObjects('DATABASE', 'PAYMENTS').forEach(function(p){ if (String(p['Заказ ID']) === String(orderId)) paid += Number(p['Сумма']) || 0; }); } catch (e) {}
    const remaining = Math.round(Math.max(0, price - paid) * 100) / 100;
    if (remaining <= 0) throw new Error('Остаток уже оплачен — график не нужен');

    // Стартовая дата
    let start;
    const iso = String(payload.startDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) start = new Date(+iso[1], +iso[2] - 1, +iso[3]);
    else {
      const ru = String(payload.startDate || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
      start = ru ? new Date(+ru[3], +ru[2] - 1, +ru[1]) : new Date();
    }

    // Равные суммы; последний взнос добирает копейки
    const per = Math.floor(remaining / months * 100) / 100;
    const amounts = [];
    let acc = 0;
    for (let k = 0; k < months; k++) {
      if (k < months - 1) { amounts.push(per); acc += per; }
      else amounts.push(Math.round((remaining - acc) * 100) / 100);
    }

    clearPaymentSchedule_(orderId);
    const sheet   = getTab('DATABASE', 'SCHEDULE');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const tz  = Session.getScriptTimeZone();
    const now = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    for (let j = 0; j < months; j++) {
      const d  = new Date(start.getFullYear(), start.getMonth() + j, start.getDate());
      const ds = Utilities.formatDate(d, tz, 'dd.MM.yyyy');
      const row = {
        'ID': orderId + '-Г-' + String(j + 1).padStart(2, '0'),
        'Заказ ID': orderId, '№': j + 1, 'Дата': ds, 'Сумма': amounts[j], 'Оплачен': 'Нет', 'Создан': now,
      };
      sheet.appendRow(headers.map(function(h){ return row[h] !== undefined ? row[h] : ''; }));
    }

    logActivity('График рассрочки', 'Заказ', orderId, '', months + ' взносов по ~' + per);
    updateScheduleProgress_(orderId); // отметит уже покрытые взносы и выставит «Срок оплаты»
    return { months: months, remaining: remaining, perPayment: per };
  });
}

/**
 * Сохранить график рассрочки с ручными суммами/датами (перезаписывает целиком).
 * @param {string} orderId
 * @param {Array} rows [{ date:'YYYY-MM-DD'|'dd.MM.yyyy', amount:Number }]
 * Оплаченные взносы пересчитываются автоматически (updateScheduleProgress_).
 */
function saveInstallmentSchedule(orderId, rows) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!orderId) throw new Error('Не указан заказ');
    rows = (rows || []).filter(function(r){ return r && (Number(r.amount) || 0) > 0; });
    if (!rows.length) throw new Error('Добавьте хотя бы один взнос с суммой');

    clearPaymentSchedule_(orderId);
    const sheet   = getTab('DATABASE', 'SCHEDULE');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const tz  = Session.getScriptTimeZone();
    const now = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    rows.forEach(function(r, i) {
      let ds = String(r.date || '');
      const iso = ds.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) ds = iso[3] + '.' + iso[2] + '.' + iso[1];   // ISO → dd.MM.yyyy
      const row = {
        'ID': orderId + '-Г-' + String(i + 1).padStart(2, '0'),
        'Заказ ID': orderId, '№': i + 1, 'Дата': ds,
        'Сумма': Math.round((Number(r.amount) || 0) * 100) / 100, 'Оплачен': 'Нет', 'Создан': now,
      };
      sheet.appendRow(headers.map(function(h){ return row[h] !== undefined ? row[h] : ''; }));
    });

    updateScheduleProgress_(orderId);
    return { count: rows.length };
  });
}

/**
 * Удалить график платежей заказа.
 */
function deletePaymentSchedule(orderId) {
  return safeCall(function() {
    bumpDataVersion_();
    clearPaymentSchedule_(orderId);
    setOrderDueDateRaw_(orderId, '');
    return { orderId: orderId };
  });
}

function clearPaymentSchedule_(orderId) {
  let sheet;
  try { sheet = getTab('DATABASE', 'SCHEDULE'); } catch (e) { return; }
  const data   = sheet.getDataRange().getValues();
  const ordIdx = data[0].indexOf('Заказ ID');
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][ordIdx]) === String(orderId)) sheet.deleteRow(i + 1);
  }
}

/**
 * Отметить в графике оплаченные взносы (по сумме всех платежей) и
 * выставить «Срок оплаты» заказа = дата ближайшего НЕоплаченного взноса.
 */
function updateScheduleProgress_(orderId) {
  let sheet;
  try { sheet = getTab('DATABASE', 'SCHEDULE'); } catch (e) { return; }
  const data   = sheet.getDataRange().getValues();
  const H       = data[0];
  const ordIdx  = H.indexOf('Заказ ID');
  const numIdx  = H.indexOf('№');
  const sumIdx  = H.indexOf('Сумма');
  const paidIdx = H.indexOf('Оплачен');
  const dateIdx = H.indexOf('Дата');

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][ordIdx]) === String(orderId)) {
      rows.push({ i: i, num: Number(data[i][numIdx]) || 0, sum: Number(data[i][sumIdx]) || 0, date: data[i][dateIdx] });
    }
  }
  if (!rows.length) return;
  rows.sort(function(a, b){ return a.num - b.num; });

  let paid = 0;
  try { readSheetAsObjects('DATABASE', 'PAYMENTS').forEach(function(p){ if (String(p['Заказ ID']) === String(orderId)) paid += Number(p['Сумма']) || 0; }); } catch (e) {}

  let acc = 0;
  let nextDate = '';
  rows.forEach(function(r) {
    acc += r.sum;
    const isPaid = paid >= acc - 0.01;
    sheet.getRange(r.i + 1, paidIdx + 1).setValue(isPaid ? 'Да' : 'Нет');
    if (!isPaid && !nextDate) nextDate = r.date;
  });

  setOrderDueDateRaw_(orderId, nextDate); // '' если все взносы покрыты
}

/**
 * Записать «Срок оплаты» заказа напрямую (без нормализации).
 */
function setOrderDueDateRaw_(orderId, dateStr) {
  const sheet = getTab('DATABASE', 'ORDERS');
  const data  = sheet.getDataRange().getValues();
  const H      = data[0];
  const idIdx  = H.indexOf('ID');
  const dueIdx = H.indexOf('Срок оплаты');
  if (dueIdx < 0) return;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(orderId)) {
      sheet.getRange(i + 1, dueIdx + 1).setValue(dateStr || '');
      return;
    }
  }
}
