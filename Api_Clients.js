/**
 * Api_Clients.gs — работа с клиентами (v1.1)
 * Физические и юридические лица + их автомобили
 */

// ─── КЛИЕНТЫ ────────────────────────────────────────────────────────────────

/**
 * Получить список клиентов
 * @param {Object} filter — { search, type, status }
 */
function getClients(filter) {
  return safeCall(function() {
    var all = readSheetAsObjects('DATABASE', 'CLIENTS');
    filter = filter || {};
    
    return all.filter(function(c) {
      // Фильтр по типу (физ/юр)
      if (filter.type && c['Тип'] !== filter.type) return false;
      // Фильтр по статусу
      if (filter.status && c['Статус'] !== filter.status) return false;
      // Поиск по имени или телефону
      if (filter.search) {
        var q = filter.search.toLowerCase();
        var name = String(c['Имя'] || '').toLowerCase();
        var phone = String(c['Телефон'] || '').toLowerCase();
        if (!name.includes(q) && !phone.includes(q)) return false;
      }
      return true;
    });
  });
}

/**
 * Получить одного клиента по ID
 */
function getClient(id) {
  return safeCall(function() {
    var all = readSheetAsObjects('DATABASE', 'CLIENTS');
    for (var i = 0; i < all.length; i++) {
      if (String(all[i]['ID']) === String(id)) return all[i];
    }
    return null;
  });
}

/**
 * Создать клиента
 * @param {Object} payload
 *   Общие: type ('физ'/'юр'), phone, email, leadSource, notes
 *   Физ. лицо: name (ФИО), passport
 *   Юр. лицо: name (название), unp, legalAddress, bankDetails, director, contactPerson
 */
function createClient(payload) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!payload) throw new Error('Нет данных');
    if (!payload.name) throw new Error('Укажите имя или название организации');
    if (!payload.type) throw new Error('Укажите тип клиента (физ/юр)');
    
    var sheet = getTab('DATABASE', 'CLIENTS');
    var lastRow = sheet.getLastRow();
    var id = 'КЛ-' + String(lastRow).padStart(5, '0');
    var tz = Session.getScriptTimeZone();
    var nowStr = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');
    
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    var data = {
      'ID':                id,
      'Тип':               payload.type,
      'Имя':               payload.name,
      'Телефон':           payload.phone || '',
      'Email':             payload.email || '',
      'Паспорт':           payload.passport || '',
      'УНП':               payload.unp || '',
      'Юр. адрес':         payload.legalAddress || '',
      'Почтовый адрес':    payload.postalAddress || '',
      'Банк. реквизиты':   payload.bankDetails || '',
      'Директор':          payload.director || '',
      'Контактное лицо':   payload.contactPerson || '',
      'Источник лида':     payload.leadSource || '',
      'Заметки':           payload.notes || '',
      'Оптовик':           payload.wholesale ? 'Да' : 'Нет',
      'Статус':            'Активен',
      'Всего заказов':     0,
      'Сумма заказов':     0,
      'Последний заказ':   '',
      'Создан':            nowStr,
      'Обновлён':          nowStr,
    };
    
    var row = headers.map(function(h) {
      return data[h] !== undefined ? data[h] : '';
    });
    sheet.appendRow(row);
    logActivity('Создал', 'Клиент', id, '', payload.name);
    
    return {
      'ID': id,
      'Тип': payload.type,
      'Имя': payload.name,
      'Телефон': payload.phone || '',
      'Статус': 'Активен',
    };
  });
}

/**
 * Обновить данные клиента
 */
function updateClient(id, payload) {
  return safeCall(function() {
    bumpDataVersion_();
    var sheet = getTab('DATABASE', 'CLIENTS');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idIdx = headers.indexOf('ID');
    var tz = Session.getScriptTimeZone();
    var nowStr = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');
    
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(id)) {
        var updates = {
          'Имя':             payload.name || data[i][headers.indexOf('Имя')],
          'Телефон':         payload.phone || '',
          'Email':           payload.email || '',
          'Паспорт':         payload.passport || '',
          'УНП':             payload.unp || '',
          'Юр. адрес':       payload.legalAddress || '',
          'Почтовый адрес':  payload.postalAddress || '',
          'Банк. реквизиты': payload.bankDetails || '',
          'Директор':        payload.director || '',
          'Контактное лицо': payload.contactPerson || '',
          'Источник лида':   payload.leadSource || '',
          'Заметки':         payload.notes || '',
          'Обновлён':        nowStr,
        };
        if (payload.wholesale !== undefined) updates['Оптовик'] = payload.wholesale ? 'Да' : 'Нет';
        
        for (var key in updates) {
          var colIdx = headers.indexOf(key);
          if (colIdx >= 0) {
            sheet.getRange(i + 1, colIdx + 1).setValue(updates[key]);
          }
        }
        
        logActivity('Обновил', 'Клиент', id, '', payload.name);
        return { id: id, updated: true };
      }
    }
    throw new Error('Клиент не найден: ' + id);
  });
}

/**
 * Поиск клиента по номеру телефона (для быстрого поиска при создании заказа)
 */
function findClientByPhone(phone) {
  return safeCall(function() {
    if (!phone) return null;
    var clean = phone.replace(/\D/g, '');
    var all = readSheetAsObjects('DATABASE', 'CLIENTS');
    for (var i = 0; i < all.length; i++) {
      var clientPhone = String(all[i]['Телефон'] || '').replace(/\D/g, '');
      if (clientPhone && clientPhone.endsWith(clean.slice(-7))) {
        return all[i];
      }
    }
    return null;
  });
}

// ─── АВТОМОБИЛИ ─────────────────────────────────────────────────────────────

/**
 * Получить автомобили клиента
 */
function getClientVehicles(clientId) {
  return safeCall(function() {
    var all = readSheetAsObjects('DATABASE', 'VEHICLES');
    return all.filter(function(v) {
      return String(v['Клиент ID']) === String(clientId);
    });
  });
}

/**
 * Добавить автомобиль клиенту
 */
function createVehicle(payload) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!payload.clientId) throw new Error('Не указан ID клиента');
    if (!payload.brand) throw new Error('Укажите марку автомобиля');
    
    var sheet = getTab('DATABASE', 'VEHICLES');
    var lastRow = sheet.getLastRow();
    var id = 'АВТ-' + String(lastRow).padStart(5, '0');
    var tz = Session.getScriptTimeZone();
    var nowStr = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');
    
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    var data = {
      'ID':          id,
      'Клиент ID':   payload.clientId,
      'Марка':       payload.brand || '',
      'Модель':      payload.model || '',
      'Год':         payload.year || '',
      'Госномер':    payload.plate || '',
      'VIN':         payload.vin || '',
      'Цвет':        payload.color || '',
      'Заметки':     payload.notes || '',
      'Создан':      nowStr,
    };
    
    var row = headers.map(function(h) {
      return data[h] !== undefined ? data[h] : '';
    });
    sheet.appendRow(row);
    logActivity('Добавил авто', 'Автомобиль', id, '', payload.brand + ' ' + payload.model);
    
    return { 'ID': id, 'Марка': payload.brand, 'Модель': payload.model };
  });
}

/**
 * Получить клиента вместе с его автомобилями (для карточки клиента)
 */
function getClientWithVehicles(clientId) {
  return safeCall(function() {
    var clientResp = getClient(clientId);
    if (!clientResp.ok || !clientResp.data) throw new Error('Клиент не найден');
    
    var vehiclesResp = getClientVehicles(clientId);
    var vehicles = vehiclesResp.ok ? vehiclesResp.data : [];
    
    return {
      client: clientResp.data,
      vehicles: vehicles,
    };
  });
}
