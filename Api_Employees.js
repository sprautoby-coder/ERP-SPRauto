/**
 * Api_Employees.gs — работа с сотрудниками
 */

function getEmployees(onlyActive) {
  return safeCall(function() {
    var all = readSheetAsObjects('DATABASE', 'EMPLOYEES');
    if (!onlyActive) return all;
    return all.filter(function(e) {
      return e['Статус'] === 'Работает';
    });
  });
}

function getEmployee(id) {
  return safeCall(function() {
    var all = readSheetAsObjects('DATABASE', 'EMPLOYEES');
    for (var i = 0; i < all.length; i++) {
      if (String(all[i]['ID']) === String(id)) return all[i];
    }
    return null;
  });
}

function createEmployee(payload) {
  return safeCall(function() {
    if (!payload) throw new Error('Нет данных');
    if (!payload.fio) throw new Error('Не указано ФИО');
    if (!payload.position) throw new Error('Не указана должность');

    var sheet = getTab('DATABASE', 'EMPLOYEES');
    var lastRow = sheet.getLastRow();
    var id = 'СОТР-' + String(lastRow).padStart(5, '0');
    var tz = Session.getScriptTimeZone();
    var nowStr = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var data = {
      'ID': id,
      'ФИО': payload.fio || '',
      'Телефон': payload.phone || '',
      'Email': payload.email || '',
      'Основная должность': payload.position || '',
      'Доп. роли': '',
      'Направления': '',
      'Статус': 'Работает',
      'Дата приёма': nowStr,
      'Дата увольнения': '',
      'Базовая ставка': payload.baseSalary || 0,
      '% бонуса': payload.bonusPct || 0,
      'Аватар': '',
      'Заметки': payload.notes || '',
      'Создан': nowStr,
      'Обновлён': nowStr,
    };

    var row = headers.map(function(h) {
      return data[h] !== undefined ? data[h] : '';
    });
    sheet.appendRow(row);
    logActivity('Создал', 'Сотрудник', id, '', payload.fio);

    return {
      'ID': id,
      'ФИО': payload.fio,
      'Основная должность': payload.position,
      'Статус': 'Работает',
      'Базовая ставка': payload.baseSalary || 0,
      '% бонуса': payload.bonusPct || 0,
    };
  });
}

/**
 * Обновить данные сотрудника
 */
function updateEmployee(id, payload) {
  return safeCall(function() {
    var sheet = getTab('DATABASE', 'EMPLOYEES');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idIdx = headers.indexOf('ID');
    var tz = Session.getScriptTimeZone();
    var nowStr = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(id)) {
        var updates = {
          'ФИО': payload.fio,
          'Телефон': payload.phone || '',
          'Email': payload.email || '',
          'Основная должность': payload.position || '',
          'Базовая ставка': payload.baseSalary || 0,
          '% бонуса': payload.bonusPct || 0,
          'Заметки': payload.notes || '',
          'Обновлён': nowStr,
        };

        // Обновляем каждую колонку
        for (var key in updates) {
          var colIdx = headers.indexOf(key);
          if (colIdx >= 0) {
            sheet.getRange(i + 1, colIdx + 1).setValue(updates[key]);
          }
        }

        logActivity('Обновил', 'Сотрудник', id, '', payload.fio);
        return { id: id, updated: true };
      }
    }
    throw new Error('Сотрудник не найден: ' + id);
  });
}

/**
 * Изменить статус сотрудника
 */
function updateEmployeeStatus(id, newStatus) {
  return safeCall(function() {
    var sheet = getTab('DATABASE', 'EMPLOYEES');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idIdx = headers.indexOf('ID');
    var statusIdx = headers.indexOf('Статус');
    var updIdx = headers.indexOf('Обновлён');
    var tz = Session.getScriptTimeZone();
    var nowStr = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(id)) {
        var oldStatus = data[i][statusIdx];
        sheet.getRange(i + 1, statusIdx + 1).setValue(newStatus);
        if (updIdx >= 0) sheet.getRange(i + 1, updIdx + 1).setValue(nowStr);
        logActivity('Изменил статус', 'Сотрудник', id, oldStatus, newStatus);
        return { id: id, oldStatus: oldStatus, newStatus: newStatus };
      }
    }
    throw new Error('Сотрудник не найден: ' + id);
  });
}