/**
 * Api_Certificates.gs — подарочные сертификаты (предоплаченный номинал).
 *
 * Логика:
 *  - ПРОДАЖА сертификата → деньги поступают в кассу (платёж Нал/Безнал с Заказ ID = ID сертификата).
 *    Создаётся запись сертификата с остатком = номинал.
 *  - ПОГАШЕНИЕ (оплата услуги) → платёж по заказу способом «Сертификат» (в кассу НЕ идёт),
 *    остаток сертификата уменьшается. Частичное/полное — на любую сумму ≤ остаток и ≤ долг.
 *  - Выручка признаётся при оказании услуги (заказ), продажа сертификата — аванс (не выручка услуг).
 */

/** Лист «Сертификаты» (создаётся при первом обращении). */
function certSheet_() {
  var parent = getTab('DATABASE', 'PAYMENTS').getParent();
  var sh = parent.getSheetByName('Сертификаты');
  if (!sh) {
    sh = parent.insertSheet('Сертификаты');
    sh.getRange(1, 1, 1, 10).setValues([[
      'ID', 'Номинал', 'Остаток', 'Покупатель', 'Телефон',
      'Дата продажи', 'Способ продажи', 'Статус', 'Комментарий', 'Создан'
    ]]);
  }
  return sh;
}

function readCerts_() {
  var sh = certSheet_();
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var o = {}; headers.forEach(function(h, j){ o[h] = data[i][j]; });
    if (o['ID']) out.push(o);
  }
  return out;
}

/** Список сертификатов (для UI). */
function getCertificates(activeOnly) {
  return safeCall(function() {
    var list = readCerts_().map(function(c){
      return {
        id: c['ID'], nominal: Number(c['Номинал']) || 0, remaining: Number(c['Остаток']) || 0,
        buyer: c['Покупатель'] || '', phone: c['Телефон'] || '',
        date: c['Дата продажи'] || '', method: c['Способ продажи'] || '',
        status: c['Статус'] || '', comment: c['Комментарий'] || ''
      };
    });
    if (activeOnly) list = list.filter(function(c){ return c.remaining > 0.001 && c.status !== 'Аннулирован'; });
    // Новые сверху
    list.reverse();
    return list;
  });
}

/** Продать сертификат: запись + поступление денег в кассу (платёж на ID сертификата). */
function sellCertificate(payload) {
  return safeCall(function() {
    bumpDataVersion_();
    payload = payload || {};
    var nominal = Number(payload.nominal) || 0;
    if (nominal <= 0) throw new Error('Укажите номинал сертификата');
    var method = payload.method || 'Нал';   // Нал / Нал с чеком / Безнал

    var sh = certSheet_();
    var tz = Session.getScriptTimeZone();
    var now = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');
    var today = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy');
    var id = 'СЕРТ-' + String(sh.getLastRow()).padStart(4, '0');
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var row = {
      'ID': id, 'Номинал': nominal, 'Остаток': nominal,
      'Покупатель': payload.buyer || '', 'Телефон': payload.phone || '',
      'Дата продажи': today, 'Способ продажи': method, 'Статус': 'Активен',
      'Комментарий': payload.comment || '', 'Создан': now
    };
    sh.appendRow(headers.map(function(h){ return row[h] !== undefined ? row[h] : ''; }));

    // Деньги в кассу: платёж с «Заказ ID» = ID сертификата (не привязан к заказу-услуге)
    var pSheet = getTab('DATABASE', 'PAYMENTS');
    var pHeaders = pSheet.getRange(1, 1, 1, pSheet.getLastColumn()).getValues()[0];
    var pid = 'ПЛТ-' + String(pSheet.getLastRow()).padStart(5, '0');
    var pdata = {
      'ID': pid, 'Заказ ID': id, 'Дата': today, 'Сумма': nominal,
      'Способ оплаты': method,
      'Комментарий': 'Продажа сертификата ' + id + (payload.buyer ? ' — ' + payload.buyer : ''),
      'Создан': now
    };
    pSheet.appendRow(pHeaders.map(function(h){ return pdata[h] !== undefined ? pdata[h] : ''; }));

    logActivity('Продажа сертификата', 'Сертификат', id, '', nominal + ' Br');
    return { id: id, nominal: nominal };
  });
}

/** Погасить сертификат в счёт оплаты заказа (в кассу НЕ идёт). */
function redeemCertificateForOrder(orderId, certId, amount, comment) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!orderId) throw new Error('Не указан заказ');
    amount = Number(amount) || 0;
    if (amount <= 0) throw new Error('Укажите сумму списания');

    var sh = certSheet_();
    var data = sh.getDataRange().getValues();
    var headers = data[0];
    var idIdx = headers.indexOf('ID');
    var remIdx = headers.indexOf('Остаток');
    var stIdx = headers.indexOf('Статус');
    var row = -1, rem = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(certId)) { row = i + 1; rem = Number(data[i][remIdx]) || 0; break; }
    }
    if (row < 0) throw new Error('Сертификат не найден: ' + certId);
    if (amount > rem + 0.001) throw new Error('На сертификате только ' + rem + ' Br');

    // Платёж по заказу способом «Сертификат» — помечает заказ оплаченным, но в кассу не попадает
    var pSheet = getTab('DATABASE', 'PAYMENTS');
    var pHeaders = pSheet.getRange(1, 1, 1, pSheet.getLastColumn()).getValues()[0];
    var tz = Session.getScriptTimeZone();
    var now = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');
    var today = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy');
    var pid = 'ПЛТ-' + String(pSheet.getLastRow()).padStart(5, '0');
    var pdata = {
      'ID': pid, 'Заказ ID': orderId, 'Дата': today, 'Сумма': amount,
      'Способ оплаты': 'Сертификат',
      'Комментарий': 'Оплата сертификатом ' + certId + (comment ? ' — ' + comment : ''),
      'Создан': now
    };
    pSheet.appendRow(pHeaders.map(function(h){ return pdata[h] !== undefined ? pdata[h] : ''; }));

    // Уменьшаем остаток сертификата
    var newRem = Math.round((rem - amount) * 100) / 100;
    sh.getRange(row, remIdx + 1).setValue(newRem);
    if (stIdx >= 0 && newRem <= 0.001) sh.getRange(row, stIdx + 1).setValue('Погашен');

    updateOrderPaymentStatus_(orderId);
    logActivity('Оплата сертификатом', 'Заказ', orderId, '', amount + ' Br (' + certId + ')');
    return { remaining: newRem, orderId: orderId, certId: certId };
  });
}
