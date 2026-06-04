/**
 * Api_Materials.gs — справочник материалов и расходы по заказам (v1.3)
 *
 * Справочник материалов: плёнки, химия, расходники — с ценами и единицами измерения.
 * Расход материалов: строки привязанные к заказу (материал + кол-во + тип расход/остаток).
 * Расходы заказа: такси, арматура и прочее — произвольные строки с суммой.
 */

// ─── СПРАВОЧНИК МАТЕРИАЛОВ ───────────────────────────────────────────────────

/**
 * Получить все активные материалы (для выпадающего списка в UI).
 * @param {string} [serviceCode] — необязательно, фильтр по услуге ('PPF', 'Тонировка', ...)
 */
function getMaterials(serviceCode) {
  return safeCall(function() {
    const all = readSheetAsObjects('DATABASE', 'MATERIALS');
    return all.filter(function(m) {
      if (!m['ID']) return false;
      if (m['Активен'] === 'Нет') return false;
      if (serviceCode && m['Услуга'] !== 'Универсальная' && m['Услуга'] !== serviceCode) return false;
      return true;
    });
  });
}

/**
 * Создать материал в справочнике.
 */
function createMaterial(payload) {
  return safeCall(function() {
    if (!payload || !payload.name) throw new Error('Укажите название материала');
    if (!payload.unit)            throw new Error('Укажите единицу измерения');
    if (!payload.price)           throw new Error('Укажите цену');

    const sheet   = getTab('DATABASE', 'MATERIALS');
    const lastRow = sheet.getLastRow();
    const id      = 'МАТ-' + String(lastRow).padStart(4, '0');
    const tz      = Session.getScriptTimeZone();
    const now     = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const data = {
      'ID':            id,
      'Название':      payload.name,
      'Категория':     payload.category    || '',
      'Услуга':        payload.service     || 'Универсальная',
      'Единица':       payload.unit,
      'Цена':          Number(payload.price) || 0,
      'Ширина рулона': payload.unit === 'пм' ? (Number(payload.rollWidth) || CONFIG.DEFAULT_ROLL_WIDTH) : '',
      'Активен':       'Да',
      'Создан':        now,
      'Обновлён':      now,
    };

    sheet.appendRow(headers.map(function(h) { return data[h] !== undefined ? data[h] : ''; }));
    logActivity('Создал', 'Материал', id, '', payload.name);
    return { id: id, name: payload.name };
  });
}

/**
 * Обновить материал в справочнике.
 */
function updateMaterial(id, payload) {
  return safeCall(function() {
    const sheet   = getTab('DATABASE', 'MATERIALS');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx   = headers.indexOf('ID');
    const tz      = Session.getScriptTimeZone();
    const now     = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) !== String(id)) continue;

      const fields = {
        'Название':      payload.name,
        'Категория':     payload.category,
        'Услуга':        payload.service,
        'Единица':       payload.unit,
        'Цена':          payload.price !== undefined ? Number(payload.price) : undefined,
        'Ширина рулона': payload.rollWidth !== undefined ? Number(payload.rollWidth) : undefined,
        'Активен':       payload.active,
        'Обновлён':      now,
      };

      for (const [col, val] of Object.entries(fields)) {
        if (val === undefined) continue;
        const colIdx = headers.indexOf(col);
        if (colIdx >= 0) sheet.getRange(i + 1, colIdx + 1).setValue(val);
      }

      logActivity('Обновил', 'Материал', id, '', payload.name || '');
      return { id: id };
    }
    throw new Error('Материал не найден: ' + id);
  });
}

/**
 * Удалить (деактивировать) материал.
 */
function deactivateMaterial(id) {
  return updateMaterial(id, { active: 'Нет' });
}

/**
 * Полностью удалить материал из справочника (строку).
 */
function deleteMaterialRow(id) {
  return safeCall(function() {
    if (!id) throw new Error('Не указан ID материала');
    const sheet   = getTab('DATABASE', 'MATERIALS');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx   = headers.indexOf('ID');
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][idIdx]) === String(id)) {
        sheet.deleteRow(i + 1);
        logActivity('Удалил', 'Материал', id, '', '');
        return { id: id, deleted: true };
      }
    }
    throw new Error('Материал не найден: ' + id);
  });
}

/**
 * Удалить все материалы (очистить справочник) — оставляет заголовок.
 * Полезно после кривого импорта. Возвращает число удалённых строк.
 */
function clearAllMaterials() {
  return safeCall(function() {
    const sheet   = getTab('DATABASE', 'MATERIALS');
    const lastRow = sheet.getLastRow();
    const n = lastRow - 1;
    if (n > 0) sheet.deleteRows(2, n);
    logActivity('Очистил справочник', 'Материалы', '', '', String(n));
    return { deleted: Math.max(0, n) };
  });
}

// ─── РАСХОД МАТЕРИАЛОВ ПО ЗАКАЗУ ────────────────────────────────────────────

/**
 * Получить все строки расхода материалов по заказу.
 */
function getOrderMaterials(orderId) {
  return safeCall(function() {
    const all = readSheetAsObjects('DATABASE', 'ORDER_MATERIALS');
    return all.filter(function(row) {
      return row['ID'] && String(row['Заказ ID']) === String(orderId);
    });
  });
}

/**
 * Сохранить строки расхода материалов для заказа (полная замена).
 * @param {string} orderId
 * @param {Array}  lines — массив объектов:
 *   { materialId, name, unit, qty, rollWidth, pricePerSqm, type }
 *   type = 'расход' | 'остаток'
 */
function saveOrderMaterials(orderId, lines) {
  return safeCall(function() {
    if (!orderId) throw new Error('Не указан ID заказа');
    lines = lines || [];

    const sheet   = getTab('DATABASE', 'ORDER_MATERIALS');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const orderIdIdx = headers.indexOf('Заказ ID');

    // Удаляем старые строки этого заказа (с конца, чтобы не сбить индексы)
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][orderIdIdx]) === String(orderId)) {
        sheet.deleteRow(i + 1);
      }
    }

    // Записываем новые строки
    const tz  = Session.getScriptTimeZone();
    const now = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');
    let   totalMaterialCost = 0;

    lines.forEach(function(line, idx) {
      const id         = orderId + '-М-' + String(idx + 1).padStart(2, '0');
      const qty        = Number(line.qty)         || 0;
      const rollWidth  = Number(line.rollWidth)    || CONFIG.DEFAULT_ROLL_WIDTH;
      const price      = Number(line.pricePerSqm) || 0;
      const unit       = line.unit || 'пм';
      const type       = line.type === 'остаток' ? 'остаток' : 'расход';

      // Перевод в м²
      const qtySqm = (unit === 'пм') ? round2_(qty * rollWidth) : round2_(qty);
      // Стоимость: расход — со знаком «+», остаток — со знаком «−» (вычитается из расхода).
      // Кусок, оставшийся пригодным после оклейки, не считается израсходованным.
      const cost   = round2_(qtySqm * price) * (type === 'остаток' ? -1 : 1);

      totalMaterialCost += cost;

      const row = headers.map(function(h) {
        const map = {
          'ID':            id,
          'Заказ ID':      orderId,
          'Материал ID':   line.materialId || '',
          'Название':      line.name        || '',
          'Единица':       unit,
          'Кол-во':        qty,
          'Ширина рулона': unit === 'пм' ? rollWidth : '',
          'Кол-во м²':     qtySqm,
          'Цена за м²':    price,
          'Тип':           type,
          'Стоимость':     cost,
          'Создан':        now,
        };
        return map[h] !== undefined ? map[h] : '';
      });
      sheet.appendRow(row);
    });

    return { totalMaterialCost: round2_(totalMaterialCost), linesCount: lines.length };
  });
}

// ─── РАСХОДЫ ПО ЗАКАЗУ ───────────────────────────────────────────────────────

/**
 * Получить все строки расходов по заказу.
 */
function getOrderExpenses(orderId) {
  return safeCall(function() {
    const all = readSheetAsObjects('DATABASE', 'ORDER_EXPENSES');
    return all.filter(function(row) {
      return row['ID'] && String(row['Заказ ID']) === String(orderId);
    });
  });
}

/**
 * Сохранить строки расходов для заказа (полная замена).
 * @param {string} orderId
 * @param {Array}  lines — массив объектов: { name, amount }
 */
function saveOrderExpenses(orderId, lines) {
  return safeCall(function() {
    if (!orderId) throw new Error('Не указан ID заказа');
    lines = lines || [];

    const sheet      = getTab('DATABASE', 'ORDER_EXPENSES');
    const data       = sheet.getDataRange().getValues();
    const headers    = data[0];
    const orderIdIdx = headers.indexOf('Заказ ID');

    // Удаляем старые строки этого заказа
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][orderIdIdx]) === String(orderId)) {
        sheet.deleteRow(i + 1);
      }
    }

    const tz  = Session.getScriptTimeZone();
    const now = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');
    let totalExpenses = 0;

    lines.forEach(function(line, idx) {
      const id     = orderId + '-Р-' + String(idx + 1).padStart(2, '0');
      const amount = Number(line.amount) || 0;
      totalExpenses += amount;

      const row = headers.map(function(h) {
        const map = {
          'ID':       id,
          'Заказ ID': orderId,
          'Название': line.name || '',
          'Сумма':    amount,
          'Создан':   now,
        };
        return map[h] !== undefined ? map[h] : '';
      });
      sheet.appendRow(row);
    });

    return { totalExpenses: round2_(totalExpenses), linesCount: lines.length };
  });
}

/**
 * Получить полные данные заказа с материалами и расходами.
 * Используется при открытии карточки заказа.
 */
function getOrderFull(orderId) {
  return safeCall(function() {
    const all = readSheetAsObjects('DATABASE', 'ORDERS');
    let order = null;
    for (let i = 0; i < all.length; i++) {
      if (String(all[i]['ID']) === String(orderId)) { order = all[i]; break; }
    }
    if (!order) throw new Error('Заказ не найден: ' + orderId);

    const matResp = getOrderMaterials(orderId);
    const expResp = getOrderExpenses(orderId);

    order.materials = matResp.ok ? matResp.data : [];
    order.expenses  = expResp.ok ? expResp.data : [];

    // Платежи и остаток (для блока оплаты в карточке)
    const payResp = getOrderPaymentSummary(orderId);
    const price   = Number(order['Стоимость заказа']) || 0;
    order.payments = (payResp.ok && payResp.data.payments) ? payResp.data.payments : [];
    let actualPaid = (payResp.ok ? payResp.data.totalPaid : 0) || 0;

    // Статус оплаты с откатом на legacy «Безнал»
    if (!String(order['Статус оплаты'] || '').trim()) {
      const bz = String(order['Безнал'] || '').trim();
      order['Статус оплаты'] = (bz === 'Да' || bz === 'Нет') ? 'Оплачен' : bz === 'Частично' ? 'Частично' : 'Не оплачен';
    }

    // Если заказ помечен «Оплачен», но записей о платежах нет (старый заказ из
    // прошлой системы) — показываем его как полностью оплаченный, чтобы блок оплаты
    // не противоречил статусу.
    if (order['Статус оплаты'] === 'Оплачен' && actualPaid < price) {
      actualPaid = price;
    }
    order._paid      = Math.round(actualPaid * 100) / 100;
    order._remaining = Math.round(Math.max(0, price - actualPaid) * 100) / 100;

    // График рассрочки (плановые взносы)
    const schResp = getPaymentSchedule(orderId);
    order.schedule = (schResp.ok && schResp.data) ? schResp.data : [];
    order._nextPay  = order['Срок оплаты'] || '';
    order._finalPay = order.schedule.length ? order.schedule[order.schedule.length - 1]['Дата'] : '';

    // Тип клиента (физ/юр) для карточки
    order._clientType = '';
    if (order['Клиент ID']) {
      try {
        const clients = readSheetAsObjects('DATABASE', 'CLIENTS');
        for (let k = 0; k < clients.length; k++) {
          if (String(clients[k]['ID']) === String(order['Клиент ID'])) {
            order._clientType = String(clients[k]['Тип'] || '');
            break;
          }
        }
      } catch (e) {}
    }
    return order;
  });
}

/**
 * Получить список часто используемых расходов для автодополнения.
 */
function getOrderExpenseHints() {
  return safeCall(function() {
    return CONFIG.ORDER_EXPENSE_HINTS;
  });
}

// ─── ИМПОРТ ИЗ РАСЧЁТ ОКЛЕЙКА ───────────────────────────────────────────────

/**
 * Прочитать уникальные плёнки из таблицы "Расчёт ОКЛЕЙКА" и добавить в справочник.
 * Пропускает плёнки, которые уже есть в справочнике (по названию).
 * Возвращает { added, skipped, errors }.
 */
function importMaterialsFromRaschet() {
  return safeCall(function() {
    // Читаем существующий справочник — чтобы не дублировать
    const existing = readSheetAsObjects('DATABASE', 'MATERIALS');
    const existingNames = {};
    existing.forEach(function(m) {
      if (m['Название']) existingNames[m['Название'].toLowerCase().trim()] = true;
    });

    // Читаем таблицу расчётов
    const raschetBook  = openBook('RASCHET_OKLEYKA');
    const raschetSheet = raschetBook.getSheets()[0]; // первый лист
    const data         = raschetSheet.getDataRange().getValues();
    if (data.length < 2) return { added: 0, skipped: 0 };

    const headers = data[0].map(function(h) { return String(h).trim(); });

    // Ищем колонки с плёнкой и ценой — пробуем разные варианты названий
    const filmIdx  = findColIdx_(headers, ['Плёнка','Пленка','Материал','Film','плёнка','пленка']);
    const priceIdx = findColIdx_(headers, ['Цена/м²','Цена м²','Стоимость м²','Цена за м²','Цена','Price','цена']);

    if (filmIdx < 0) throw new Error('Не найдена колонка с плёнкой. Колонки: ' + headers.join(', '));

    // Собираем уникальные плёнки
    const films = {}; // name → { price, count }
    for (let i = 1; i < data.length; i++) {
      const raw = String(data[i][filmIdx] || '').trim();
      if (!raw) continue;

      // Парсим название и цену из строки вида "Spectroll E15 (65 Br/м²)" или просто "Spectroll E15"
      let name  = raw;
      let price = 0;

      const matchInline = raw.match(/^(.+?)\s*\((\d+[\d.,]*)\s*(?:Br|br|руб|BYN)?[\/]?(?:м²|м2|кв\.м)?\)$/);
      if (matchInline) {
        name  = matchInline[1].trim();
        price = parseFloat(matchInline[2].replace(',', '.')) || 0;
      } else if (priceIdx >= 0) {
        price = Number(data[i][priceIdx]) || 0;
      }

      const key = name.toLowerCase();
      if (!films[key]) films[key] = { name: name, price: price, count: 1 };
      else {
        films[key].count++;
        // Берём максимальную встреченную цену если она больше
        if (price > films[key].price) films[key].price = price;
      }
    }

    // Добавляем в справочник
    const matSheet = getTab('DATABASE', 'MATERIALS');
    const matHeaders = matSheet.getRange(1, 1, 1, matSheet.getLastColumn()).getValues()[0];
    const tz  = Session.getScriptTimeZone();
    const now = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    let added   = 0;
    let skipped = 0;
    let lastRow = matSheet.getLastRow();

    Object.values(films).forEach(function(film) {
      if (existingNames[film.name.toLowerCase().trim()]) { skipped++; return; }

      lastRow++;
      const id = 'МАТ-' + String(lastRow - 1).padStart(4, '0');
      const data = {
        'ID':            id,
        'Название':      film.name,
        'Категория':     'PPF плёнка',
        'Услуга':        'PPF',
        'Единица':       'пм',
        'Цена':          film.price || '',
        'Ширина рулона': 1.52,
        'Активен':       'Да',
        'Создан':        now,
        'Обновлён':      now,
      };
      matSheet.appendRow(matHeaders.map(function(h) { return data[h] !== undefined ? data[h] : ''; }));
      added++;
    });

    logActivity('Импорт', 'Материалы', '', '', 'Добавлено: ' + added + ', пропущено: ' + skipped);
    return { added: added, skipped: skipped };
  });
}

function findColIdx_(headers, variants) {
  for (let i = 0; i < variants.length; i++) {
    const idx = headers.findIndex(function(h) { return h.toLowerCase().includes(variants[i].toLowerCase()); });
    if (idx >= 0) return idx;
  }
  return -1;
}

// ─── ВСПОМОГАТЕЛЬНЫЕ ────────────────────────────────────────────────────────

function round2_(n) {
  return Math.round(Number(n) * 100) / 100;
}
