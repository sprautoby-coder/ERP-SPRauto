/**
 * Api_Appointments.gs — календарь записей клиентов.
 *
 * Запись = клиент + услуга + мастер на конкретные дату/время. Даёт наглядную
 * занятость мастеров на день и план работы. Хранится в листе «Записи».
 */

// ─── ЧТЕНИЕ ──────────────────────────────────────────────────────────────────

/** Записи на конкретный день (dd.MM.yyyy), отсортированные по времени. */
function getAppointments(dateStr) {
  return safeCall(function() {
    dateStr = String(dateStr || '').trim();
    var list = readSheetAsObjects('DATABASE', 'APPOINTMENTS')
      .filter(function(a) { return a['ID'] && String(a['Дата']) === dateStr; })
      .map(appointmentToClient_);
    list.sort(function(a, b){ return (a.time || '').localeCompare(b.time || ''); });
    return list;
  });
}

/** Записи за диапазон дат включительно (для будущего недельного вида). */
function getAppointmentsRange(fromStr, toStr) {
  return safeCall(function() {
    var from = parseDmy_(fromStr), to = parseDmy_(toStr);
    var list = readSheetAsObjects('DATABASE', 'APPOINTMENTS')
      .filter(function(a) {
        if (!a['ID']) return false;
        var d = parseDmy_(a['Дата']);
        return d && (!from || d >= from) && (!to || d <= to);
      })
      .map(appointmentToClient_);
    list.sort(function(a, b){
      return (a.date || '').split('.').reverse().join('').localeCompare((b.date || '').split('.').reverse().join('')) ||
             (a.time || '').localeCompare(b.time || '');
    });
    return list;
  });
}

// ─── ИЗМЕНЕНИЕ ───────────────────────────────────────────────────────────────

/** Создать запись. */
function createAppointment(payload) {
  return safeCall(function() {
    payload = payload || {};
    var date = String(payload.date || '').trim();
    var time = String(payload.time || '').trim();
    if (!date) throw new Error('Не указана дата');
    if (!time) throw new Error('Не указано время');
    if (!String(payload.client || '').trim()) throw new Error('Не указан клиент');

    var rec = {
      'ID':           getNextId('DATABASE', 'APPOINTMENTS', 'APT'),
      'Дата':         date,
      'Время':        time,
      'Длительность': Number(payload.duration) || 60,
      'Клиент':       String(payload.client || '').trim(),
      'Телефон':      String(payload.phone || '').trim(),
      'Авто':         String(payload.car || '').trim(),
      'Услуга':       String(payload.service || '').trim(),
      'Мастер':       String(payload.master || '').trim(),
      'Статус':       'Запланирована',
      'Заказ ID':     '',
      'Комментарий':  String(payload.comment || '').trim(),
      'Создан':       new Date(),
    };
    appendRowByObject('DATABASE', 'APPOINTMENTS', rec);
    logActivity('Создание записи', 'Запись', rec['ID'], '', rec['Клиент'] + ' ' + date + ' ' + time);
    return appointmentToClient_(rec);
  });
}

/** Обновить поля записи (дата/время/мастер/услуга/длительность/комментарий). */
function updateAppointment(id, fields) {
  return safeCall(function() {
    fields = fields || {};
    var map = {
      date: 'Дата', time: 'Время', duration: 'Длительность', client: 'Клиент',
      phone: 'Телефон', car: 'Авто', service: 'Услуга', master: 'Мастер', comment: 'Комментарий',
    };
    var patch = {};
    Object.keys(fields).forEach(function(k){ if (map[k]) patch[map[k]] = fields[k]; });
    return updateAppointmentRow_(id, patch);
  });
}

/** Сменить статус записи: Запланирована / Пришёл / Отменена. */
function setAppointmentStatus(id, status) {
  return safeCall(function() {
    var allowed = ['Запланирована', 'Пришёл', 'Отменена'];
    if (allowed.indexOf(status) < 0) throw new Error('Неизвестный статус');
    return updateAppointmentRow_(id, { 'Статус': status });
  });
}

/** Удалить запись. */
function deleteAppointment(id) {
  return safeCall(function() {
    id = String(id || '');
    var sheet = getTab('DATABASE', 'APPOINTMENTS');
    var data = sheet.getDataRange().getValues();
    var idCol = data[0].indexOf('ID');
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === id) { sheet.deleteRow(i + 1); return { deleted: true }; }
    }
    return { deleted: false };
  });
}

/** Привязать запись к созданному заказу и отметить, что клиент пришёл. */
function linkAppointmentOrder(id, orderId) {
  return safeCall(function() {
    return updateAppointmentRow_(id, { 'Заказ ID': String(orderId || ''), 'Статус': 'Пришёл' });
  });
}

// ─── ВСПОМОГАТЕЛЬНЫЕ ─────────────────────────────────────────────────────────

function appointmentToClient_(a) {
  return {
    id:       a['ID'],
    date:     a['Дата'] || '',
    time:     a['Время'] || '',
    duration: Number(a['Длительность']) || 60,
    client:   a['Клиент'] || '',
    phone:    a['Телефон'] || '',
    car:      a['Авто'] || '',
    service:  a['Услуга'] || '',
    master:   a['Мастер'] || '',
    status:   a['Статус'] || 'Запланирована',
    orderId:  a['Заказ ID'] || '',
    comment:  a['Комментарий'] || '',
  };
}

/** Обновить строку записи по ID набором {Колонка: значение}. */
function updateAppointmentRow_(id, patch) {
  id = String(id || '');
  var sheet = getTab('DATABASE', 'APPOINTMENTS');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf('ID');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === id) {
      Object.keys(patch).forEach(function(col) {
        var c = headers.indexOf(col);
        if (c >= 0) sheet.getRange(i + 1, c + 1).setValue(patch[col]);
      });
      var obj = {};
      headers.forEach(function(h, j){ obj[h] = (patch[h] !== undefined) ? patch[h] : data[i][j]; });
      return appointmentToClient_(obj);
    }
  }
  throw new Error('Запись не найдена: ' + id);
}

/** Разбор dd.MM.yyyy → Date (00:00). */
function parseDmy_(s) {
  var m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  var d = new Date(+m[3], +m[2] - 1, +m[1]);
  d.setHours(0, 0, 0, 0);
  return d;
}
