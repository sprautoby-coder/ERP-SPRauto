/**
 * Api_Staff.gs — «Мои заказы» для мастеров: вход по PIN + личный список нарядов.
 * (Этап 1 диспетчера работ; Telegram-уведомления — следующим этапом.)
 */

/** Вход сотрудника по имени + PIN. Если PIN ещё не задан — задаём при первом входе. */
function staffLogin(name, pin) {
  return safeCall(function() {
    name = String(name || '').trim();
    pin  = String(pin || '').trim();
    if (!name) throw new Error('Выберите себя из списка');
    if (!pin)  throw new Error('Введите PIN');

    var sheet = getTab('DATABASE', 'EMPLOYEES');
    ensureColumns_(sheet, ['PIN']);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idIdx = headers.indexOf('ID');
    var fioIdx = headers.indexOf('ФИО');
    var pinIdx = headers.indexOf('PIN');
    var stIdx  = headers.indexOf('Статус');
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][fioIdx] || '').trim() !== name) continue;
      if (stIdx >= 0 && String(data[i][stIdx] || '') === 'Уволен') throw new Error('Сотрудник не активен');
      var curPin = String(data[i][pinIdx] || '').trim();
      if (!curPin) {                              // первый вход — устанавливаем PIN
        sheet.getRange(i + 1, pinIdx + 1).setValue(pin);
        return { id: data[i][idIdx], name: name, firstTime: true };
      }
      if (curPin !== pin) throw new Error('Неверный PIN');
      return { id: data[i][idIdx], name: name, firstTime: false };
    }
    throw new Error('Сотрудник не найден: ' + name);
  });
}

/** Сбросить/задать PIN сотрудника (для директора). */
function setEmployeePin(empId, pin) {
  return safeCall(function() {
    var sheet = getTab('DATABASE', 'EMPLOYEES');
    ensureColumns_(sheet, ['PIN']);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idIdx = headers.indexOf('ID');
    var pinIdx = headers.indexOf('PIN');
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(empId)) {
        sheet.getRange(i + 1, pinIdx + 1).setValue(String(pin || ''));
        return { id: empId };
      }
    }
    throw new Error('Сотрудник не найден');
  });
}

/** Список активных сотрудников (имена) — для экрана входа. */
function getStaffNames() {
  return safeCall(function() {
    return readSheetAsObjects('DATABASE', 'EMPLOYEES')
      .filter(function(e){ return e['ID'] && String(e['Статус'] || '') !== 'Уволен'; })
      .map(function(e){ return String(e['ФИО'] || '').trim(); })
      .filter(Boolean);
  });
}

/** Наряды сотрудника: активные заказы, где он назначен (оклейщик/тонировщик/менеджер/админ). */
function getMyStaffOrders(name) {
  return safeCall(function() {
    name = String(name || '').trim();
    if (!name) return [];
    var cancelledSet = getCancelledStatusSet_();
    var doneSet = getDoneStatusSet_();
    var has = function(field, o){
      return String(o[field] || '').split(',').map(function(s){ return s.trim(); }).indexOf(name) >= 0;
    };
    var orders = readSheetAsObjects('DATABASE', 'ORDERS').filter(function(o){
      if (!o['ID']) return false;
      var st = String(o['Статус'] || '');
      if (cancelledSet[st]) return false;         // отменённые не показываем
      if (doneSet[st]) return false;              // выданные (завершённые) — тоже (только активная работа)
      return has('Оклейщики', o) || has('Тонировщики', o) || has('Менеджер', o) || has('Администратор', o) ||
             has('Менеджер тонировки', o) || has('Администратор тонировки', o);
    });
    return orders.map(function(o){
      var roles = [];
      if (has('Оклейщики', o))  roles.push('Оклейщик');
      if (has('Тонировщики', o)) roles.push('Тонировщик');
      if (has('Менеджер', o) || has('Менеджер тонировки', o)) roles.push('Менеджер');
      if (has('Администратор', o) || has('Администратор тонировки', o)) roles.push('Администратор');
      return {
        id: o['ID'], contract: o['Номер договора'] || o['ID'],
        car: o['Авто'] || '', plate: o['Госномер'] || '', vin: o['VIN'] || '',
        service: o['Услуга'] || '', status: o['Статус'] || '',
        elements: String(o['Элементы'] || ''), complex: o['Комплекс'] || '',
        film: o['Пленка'] || '', light: (o['Светопропускаемость'] == null ? '' : o['Светопропускаемость']),
        due: o['Дата выполнения'] || o['Дата окончания работ'] || '',
        date: o['Дата'] || '', notes: o['Заметки'] || '',
        roles: roles.join(', ')
      };
    }).sort(function(a, b){ return String(a.due).localeCompare(String(b.due)); });
  });
}

/** Смена статуса заказа мастером из «Мои заказы» (переиспользует updateOrderStatus). */
function staffSetOrderStatus(orderId, status) {
  return updateOrderStatus(orderId, status);
}
