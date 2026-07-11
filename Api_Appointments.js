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
    var day = parseDmy_(dateStr);
    var list = readSheetAsObjects('DATABASE', 'APPOINTMENTS')
      .filter(function(a) {
        if (!a['ID']) return false;
        if (String(a['Дата']) === dateStr) return true;
        // многодневная запись — показываем в каждый день диапазона
        var s = parseDmy_(a['Дата']), e = parseDmy_(a['Дата окончания'] || a['Дата']);
        return day && s && e && e > s && day >= s && day <= e;
      })
      .map(appointmentToClient_);
    list.sort(function(a, b){ return (a.time || '').localeCompare(b.time || ''); });
    return enrichAppointments_(list);
  });
}

/**
 * Обогатить записи состоянием связанного заказа:
 *  workState = 'none' (нет заказа) | 'inwork' (в работе) | 'done' (заказ оплачен).
 *  orderStatus — воронка заказа. Нужно для «в работе / выполнено» в календаре.
 */
function enrichAppointments_(list) {
  var linked = list.filter(function(a){ return a.orderId; });
  if (!linked.length) { list.forEach(function(a){ a.workState = 'none'; }); return list; }
  var orders = readSheetAsObjects('DATABASE', 'ORDERS');
  var map = {};
  orders.forEach(function(o){ if (o['ID']) map[String(o['ID'])] = o; });
  list.forEach(function(a){
    if (!a.orderId) { a.workState = 'none'; return; }
    var o = map[String(a.orderId)];
    if (!o) { a.workState = 'inwork'; a.orderStatus = ''; return; }
    a.orderStatus = o['Статус'] || '';
    var pay = String(o['Статус оплаты'] || '').trim();
    if (!pay) {
      var bz = String(o['Безнал'] || '').trim();
      pay = (bz === 'Да' || bz === 'Нет') ? 'Оплачен' : (bz === 'Частично' ? 'Частично' : 'Не оплачен');
    }
    a.workState = (pay === 'Оплачен') ? 'done' : 'inwork';
  });
  return list;
}

/** Записи за диапазон дат включительно (для будущего недельного вида). */
function getAppointmentsRange(fromStr, toStr) {
  return safeCall(function() {
    var from = parseDmy_(fromStr), to = parseDmy_(toStr);
    var list = readSheetAsObjects('DATABASE', 'APPOINTMENTS')
      .filter(function(a) {
        if (!a['ID']) return false;
        var s = parseDmy_(a['Дата']); if (!s) return false;
        var e = parseDmy_(a['Дата окончания'] || a['Дата']) || s;
        // запись пересекает период (учитывает многодневные)
        return (!to || s <= to) && (!from || e >= from);
      })
      .map(appointmentToClient_);
    list.sort(function(a, b){
      return (a.date || '').split('.').reverse().join('').localeCompare((b.date || '').split('.').reverse().join('')) ||
             (a.time || '').localeCompare(b.time || '');
    });
    return enrichAppointments_(list);
  });
}

// ─── ИЗМЕНЕНИЕ ───────────────────────────────────────────────────────────────

/** Создать запись. */
function createAppointment(payload) {
  return safeCall(function() {
    bumpDataVersion_();
    payload = payload || {};
    var date = String(payload.date || '').trim();
    var time = String(payload.time || '').trim();
    if (!date) throw new Error('Не указана дата');
    if (!time) throw new Error('Не указано время');
    if (!String(payload.client || '').trim()) throw new Error('Не указан клиент');

    var endDate = String(payload.endDate || '').trim() || date;
    var endTime = String(payload.endTime || '').trim();
    var duration = Number(payload.duration) || 0;
    if (!duration) duration = computeAptDuration_(date, time, endDate, endTime);
    if (!endTime)  endTime  = addMinutesToTime_(time, duration || 60);

    var rec = {
      'ID':              getNextId('DATABASE', 'APPOINTMENTS', 'APT'),
      'Дата':            date,
      'Время':           time,
      'Дата окончания':  endDate,
      'Время окончания': endTime,
      'Длительность':    duration || 60,
      'Клиент':          String(payload.client || '').trim(),
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
    bumpDataVersion_();
    fields = fields || {};
    var map = {
      date: 'Дата', time: 'Время', endDate: 'Дата окончания', endTime: 'Время окончания',
      duration: 'Длительность', client: 'Клиент',
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
    bumpDataVersion_();
    var allowed = ['Запланирована', 'Пришёл', 'Отменена'];
    if (allowed.indexOf(status) < 0) throw new Error('Неизвестный статус');
    return updateAppointmentRow_(id, { 'Статус': status });
  });
}

/** Удалить запись. */
function deleteAppointment(id) {
  return safeCall(function() {
    bumpDataVersion_();
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
    bumpDataVersion_();
    return updateAppointmentRow_(id, { 'Заказ ID': String(orderId || ''), 'Статус': 'Пришёл' });
  });
}

/**
 * Перенести запись в воронку канбана: создаёт заказ (цена 0 — заполнят позже)
 * в выбранной воронке statusName и привязывает к нему запись. Запись после этого
 * показывается «в работе», а когда заказ будет оплачен — «выполнено».
 */
function createOrderFromAppointment(aptId, statusName) {
  return safeCall(function() {
    bumpDataVersion_();
    aptId = String(aptId || '');
    var apts = readSheetAsObjects('DATABASE', 'APPOINTMENTS');
    var apt = null;
    for (var i = 0; i < apts.length; i++) { if (String(apts[i]['ID']) === aptId) { apt = apts[i]; break; } }
    if (!apt) throw new Error('Запись не найдена');
    if (apt['Заказ ID']) throw new Error('Запись уже перенесена в заказ ' + apt['Заказ ID']);

    var code = getServiceCodeByName_(apt['Услуга']) || apt['Услуга'] || '';
    var res = createOrder({
      service:     code,
      clientName:  apt['Клиент'] || '',
      clientPhone: apt['Телефон'] || '',
      car:         apt['Авто'] || '',
      price:       0,                      // сумму впишут в карточке заказа
      masters:     apt['Мастер'] || '',
      notes:       'Из записи ' + aptId + (apt['Комментарий'] ? ' · ' + apt['Комментарий'] : ''),
    });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Не удалось создать заказ');
    var orderId = res.data.id;

    // ставим выбранную воронку (если задана и допустима)
    if (statusName) { try { updateOrderStatus(orderId, statusName); } catch (e) {} }
    // привязываем запись → она станет «в работе»
    updateAppointmentRow_(aptId, { 'Заказ ID': orderId, 'Статус': 'Пришёл' });

    return { orderId: orderId, contractNumber: res.data.contractNumber, status: statusName || '' };
  });
}

// ─── ВСПОМОГАТЕЛЬНЫЕ ─────────────────────────────────────────────────────────

/** Нормализовать дату из ячейки Sheets (Date/строка) → 'dd.MM.yyyy'. */
function normDate_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return ('0'+v.getDate()).slice(-2) + '.' + ('0'+(v.getMonth()+1)).slice(-2) + '.' + v.getFullYear();
  }
  return String(v).trim();
}
/** Нормализовать время из ячейки Sheets (Date/доля суток/строка) → 'HH:mm'. */
function normTime_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return ('0'+v.getHours()).slice(-2) + ':' + ('0'+v.getMinutes()).slice(-2);
  }
  var s = String(v).trim();
  var m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return ('0'+m[1]).slice(-2) + ':' + m[2];
  var n = Number(s);
  if (!isNaN(n) && n > 0 && n < 1) {   // доля суток (Sheets time as number)
    var mins = Math.round(n * 24 * 60);
    return ('0'+Math.floor(mins/60)).slice(-2) + ':' + ('0'+(mins%60)).slice(-2);
  }
  return s;
}

function appointmentToClient_(a) {
  return {
    id:       a['ID'],
    date:     normDate_(a['Дата']),
    time:     normTime_(a['Время']),
    endDate:  normDate_(a['Дата окончания'] || a['Дата']),
    endTime:  normTime_(a['Время окончания']),
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

/** Длительность в минутах для однодневной записи (иначе 60 как заглушка). */
function computeAptDuration_(date, time, endDate, endTime) {
  if (!time || !endTime || String(date) !== String(endDate)) return 60;
  var sm = timeToMin_(time), em = timeToMin_(endTime);
  if (sm == null || em == null) return 60;
  return Math.max(15, em - sm);
}
/** 'HH:mm' → минуты. */
function timeToMin_(t) {
  var m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
/** Прибавить минуты к 'HH:mm' в пределах суток. */
function addMinutesToTime_(time, mins) {
  var sm = timeToMin_(time); if (sm == null) return time;
  var v = Math.min(23 * 60 + 59, sm + (Number(mins) || 0));
  return ('0' + Math.floor(v / 60)).slice(-2) + ':' + ('0' + (v % 60)).slice(-2);
}

/** Разбор dd.MM.yyyy → Date (00:00). */
function parseDmy_(s) {
  var m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  var d = new Date(+m[3], +m[2] - 1, +m[1]);
  d.setHours(0, 0, 0, 0);
  return d;
}
