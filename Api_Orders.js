/**
 * Api_Orders.gs — работа с заказами (v1.2)
 * Новые заказы хранятся в листе «Заказы» базы данных.
 * Исторические данные из «Расчёт ОКЛЕЙКА» не трогаем.
 */

// ─── РАСЧЁТ ПРИБЫЛИ ─────────────────────────────────────────────────────────

/**
 * Рассчитать финансовые показатели заказа по бизнес-формуле (v1.3).
 * Материалы и расходы передаются уже посчитанными суммами (из динамических строк).
 *
 * Валовая = Цена − Итого материалы − Итого расходы − (Тип оплаты=Безнал ? Цена×0.15 : 0)
 * Бонус менеджера = Валовая × 10% ÷ кол-во менеджеров
 * Бонус оклейщика = Валовая × 35% ÷ кол-во оклейщиков
 * Маржинальная = Валовая − сумма всех бонусов
 *
 * ВАЖНО: −15% теперь зависит ТОЛЬКО от «Тип оплаты» (условия, задаются персоналом
 * и редактируются в любой момент), а НЕ от статуса оплаты. Это единый источник истины.
 * Поддержан и legacy 'Да' для обратной совместимости со старыми вызовами.
 */
function calcOrderFinance_(price, materialCost, totalExpenses, payType, managersStr, mastersStr) {
  price          = Number(price)          || 0;
  materialCost   = Number(materialCost)   || 0;
  totalExpenses  = Number(totalExpenses)  || 0;

  var isBeznal       = (payType === 'Безнал' || payType === 'Да');
  var bezналDiscount = isBeznal ? price * 0.15 : 0;
  var grossProfit    = price - materialCost - totalExpenses - bezналDiscount;

  var managersCount = managersStr ? managersStr.split(',').filter(function(s){ return s.trim(); }).length : 0;
  var mastersCount  = mastersStr  ? mastersStr.split(',').filter(function(s){ return s.trim(); }).length  : 0;

  var managerBonusTotal = (managersCount > 0) ? grossProfit * 0.10 : 0;
  var masterBonusTotal  = (mastersCount  > 0) ? grossProfit * 0.35 : 0;

  var managerBonusEach  = (managersCount > 0) ? managerBonusTotal / managersCount : 0;
  var masterBonusEach   = (mastersCount  > 0) ? masterBonusTotal  / mastersCount  : 0;

  var marginalProfit = grossProfit - managerBonusTotal - masterBonusTotal;

  return {
    grossProfit:    round2(grossProfit),
    managerBonus:   round2(managerBonusEach),
    masterBonus:    round2(masterBonusEach),
    marginalProfit: round2(marginalProfit),
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

// ─── НОМЕР ДОГОВОРА ──────────────────────────────────────────────────────────

/**
 * Генерирует следующий номер договора.
 * Оклейка: 04/01-XXX, Тонировка: 12/01-XXX
 */
function generateContractNumber_(serviceCode) {
  // Префикс берём из каталога услуг (white-label), а не из хардкода
  var catalog = getServicesCatalog();
  var prefix  = '04/01-';
  for (var k = 0; k < catalog.length; k++) {
    if (catalog[k].code === serviceCode && catalog[k].contractPrefix) { prefix = catalog[k].contractPrefix; break; }
  }
  var sheet  = getTab('DATABASE', 'ORDERS');
  var lastRow = sheet.getLastRow();
  // Ищем максимальный порядковый номер среди уже выданных
  var maxNum = 0;
  if (lastRow > 1) {
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var numIdx  = headers.indexOf('Номер договора');
    if (numIdx >= 0) {
      for (var i = 1; i < data.length; i++) {
        var raw = String(data[i][numIdx] || '');
        if (raw.startsWith(prefix)) {
          var n = parseInt(raw.replace(prefix, ''), 10);
          if (!isNaN(n) && n > maxNum) maxNum = n;
        }
      }
    }
  }
  return prefix + String(maxNum + 1).padStart(3, '0');
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Получить список заказов с фильтрацией.
 * @param {Object} filter — { from, to, service, status, clientId, search }
 */
function getOrders(filter) {
  filter = filter || {};
  return safeCall(function() {
   return cachedRead_('orders:' + JSON.stringify(filter), 45, function() {
    var all = readSheetAsObjects('DATABASE', 'ORDERS');

    // Карта типа клиента (физ/юр) — для подсветки юрлиц (контроль дебиторки)
    var clientType = {};
    try {
      readSheetAsObjects('DATABASE', 'CLIENTS').forEach(function(c) {
        if (c['ID']) clientType[String(c['ID'])] = String(c['Тип'] || '');
      });
    } catch (e) { /* лист клиентов может отсутствовать */ }

    // Карта уплаченного по заказам — для прогресса рассрочки и остатка
    var paidByOrder = {};
    try {
      readSheetAsObjects('DATABASE', 'PAYMENTS').forEach(function(p) {
        if (!p['ID']) return;
        var oid = String(p['Заказ ID']);
        paidByOrder[oid] = (paidByOrder[oid] || 0) + (Number(p['Сумма']) || 0);
      });
    } catch (e) { /* лист платежей может отсутствовать */ }

    // Карта графика рассрочки — дата окончательного взноса по заказу
    var finalPayByOrder = {};
    try {
      readSheetAsObjects('DATABASE', 'SCHEDULE').forEach(function(s) {
        if (!s['ID']) return;
        var oid = String(s['Заказ ID']);
        var prev = finalPayByOrder[oid];
        if (!prev || (Number(s['№'])||0) >= prev.num) finalPayByOrder[oid] = { num: Number(s['№'])||0, date: s['Дата'] };
      });
    } catch (e) { /* лист графика может отсутствовать */ }

    return all.filter(function(o) {
      if (!o['ID']) return false;
      // Мягко удалённые: по умолчанию скрыты везде; в «Корзине» (filter.deleted) — наоборот, только они
      var isDeleted = String(o['Удалён'] || '') === 'Да';
      if (filter.deleted) { if (!isDeleted) return false; }
      else if (isDeleted) return false;
      if (filter.status  && o['Статус']  !== filter.status)  return false;
      if (filter.service && o['Услуга']  !== filter.service) return false;
      if (filter.clientId && String(o['Клиент ID']) !== String(filter.clientId)) return false;
      if (filter.from) {
        var d = parseDate_(o['Дата']);
        if (d && d < new Date(filter.from)) return false;
      }
      if (filter.to) {
        var d = parseDate_(o['Дата']);
        if (d && d > new Date(filter.to)) return false;
      }
      if (filter.search) {
        var q  = filter.search.toLowerCase();
        var cl = String(o['Клиент']   || '').toLowerCase();
        var ph = String(o['Телефон']  || '').toLowerCase();
        var av = String(o['Авто']     || '').toLowerCase();
        var gn = String(o['Госномер'] || '').toLowerCase();
        if (!cl.includes(q) && !ph.includes(q) && !av.includes(q) && !gn.includes(q)) return false;
      }
      return true;
    }).map(function(o) {
      // Обогащаем служебными полями (с префиксом _ чтобы не путать с колонками листа)
      var price = Number(o['Стоимость заказа']) || 0;
      var paid  = round2(paidByOrder[String(o['ID'])] || 0);
      o._clientType = clientType[String(o['Клиент ID'])] || '';
      // Если статус оплаты пуст (старые строки) — выводим из legacy «Безнал»
      if (!String(o['Статус оплаты'] || '').trim()) {
        var bz = String(o['Безнал'] || '').trim();
        o['Статус оплаты'] = (bz === 'Да' || bz === 'Нет') ? 'Оплачен'
                            : bz === 'Частично' ? 'Частично' : 'Не оплачен';
      }
      // Заказ помечен «Оплачен» без записей о платежах (старый) — считаем полностью оплаченным
      if (o['Статус оплаты'] === 'Оплачен' && paid < price) paid = price;
      o._paid       = paid;
      o._remaining  = round2(Math.max(0, price - paid));
      o._nextPay    = o['Срок оплаты'] || '';
      o._finalPay   = (finalPayByOrder[String(o['ID'])] || {}).date || '';
      return o;
    });
   });
  });
}

/**
 * Получить один заказ по ID.
 */
function getOrder(id) {
  return safeCall(function() {
    var all = readSheetAsObjects('DATABASE', 'ORDERS');
    for (var i = 0; i < all.length; i++) {
      if (String(all[i]['ID']) === String(id)) return all[i];
    }
    return null;
  });
}

/**
 * Создать новый заказ (v1.3).
 * @param {Object} payload
 *   Обязательные: price, service
 *   Клиент: clientId, clientName, clientPhone
 *   Авто: car, plate, vin
 *   Оплата: beznal ('Да'/'Нет'/'' для дебиторки)
 *   Персонал: manager, masters (строка через запятую)
 *   Даты: dueDate
 *   Материалы: materials (массив строк, см. saveOrderMaterials)
 *   Расходы: expenses (массив строк, см. saveOrderExpenses)
 *   Прочее: notes
 */
function createOrder(payload) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!payload)         throw new Error('Нет данных');
    // Цена 0 допустима (напр. заказ из записи — сумму впишут в воронке позже)
    if (payload.price === undefined || payload.price === null || payload.price === '') throw new Error('Укажите стоимость заказа');
    if (!payload.service) throw new Error('Укажите услугу');

    // Авто-привязка клиента: если ID не передан — ищем по телефону/имени, иначе создаём карточку.
    // Защищено: при любой ошибке заказ всё равно создаётся (clientId остаётся пустым).
    if (!payload.clientId) {
      payload.clientId = ensureClientForOrder_(payload);
    }

    const sheet    = getTab('DATABASE', 'ORDERS');
    const lastRow  = sheet.getLastRow();
    const id       = 'ЗАК-' + String(lastRow).padStart(5, '0');
    const tz       = Session.getScriptTimeZone();
    const nowStr   = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');
    const todayStr = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy');

    // Сохраняем строки материалов и расходов, получаем итоговые суммы
    let totalMaterialCost = 0;
    let totalExpenses      = 0;

    if (payload.materials && payload.materials.length > 0) {
      const matResult = saveOrderMaterials(id, payload.materials);
      if (matResult.ok) totalMaterialCost = matResult.data.totalMaterialCost;
    }
    if (payload.expenses && payload.expenses.length > 0) {
      const expResult = saveOrderExpenses(id, payload.expenses);
      if (expResult.ok) totalExpenses = expResult.data.totalExpenses;
    }

    // payType — это УСЛОВИЯ оплаты: 'Нал' | 'Безнал' | 'Отсрочка' | 'Рассрочка' | '' (пока не ясно).
    // Они задают −15% (если Безнал) и могут редактироваться позже. На статус оплаты не влияют.
    const payType     = payload.payType || payload.beznal || '';

    const finance       = calcOrderFinance_(payload.price, totalMaterialCost, totalExpenses, payType, payload.manager, payload.masters);
    const contractNum   = generateContractNumber_(payload.service);
    // «Услуга» — все выбранные услуги через запятую (основная + доп.), номер договора — по основной
    const codes         = (payload.serviceCodes && payload.serviceCodes.length) ? payload.serviceCodes : [payload.service];
    const serviceName   = codes.map(function(c){ return getServiceName_(c); }).filter(String).join(', ') || getServiceName_(payload.service);
    const headers       = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    const defaultStatus = getDefaultStatusName_();

    const data = {
      'ID':                    id,
      'Номер договора':        contractNum,
      'Дата':                  todayStr,
      'Дата выполнения':       payload.dueDate || '',
      'Статус':                defaultStatus,
      'Клиент ID':             payload.clientId   || '',
      'Клиент':                payload.clientName  || '',
      'Телефон':               payload.clientPhone || '',
      'Авто':                  payload.car   || '',
      'Госномер':              payload.plate || '',
      'VIN':                   payload.vin   || '',
      'Услуга':                serviceName,
      'Комплекс':              payload.complex       || '',
      'Элементы':              payload.elements      || '',
      'Кол-во элементов':      payload.elementsCount || '',
      'Стоимость заказа':      payload.price,
      'Тип оплаты':            payType,
      'Статус оплаты':         'Не оплачен',   // факт оплаты узнаём позже, при платеже
      'Безнал':                '',             // legacy-зеркало: пусто = ещё не оплачен
      'Срок оплаты':           payload.duePayDate || '',
      'Менеджер':              payload.manager || '',
      'Оклейщики':             payload.masters || '',
      'Администратор':         payload.admin || '',
      'Итого материалы':       totalMaterialCost,
      'Итого расходы':         totalExpenses,
      'Валовая прибыль':       finance.grossProfit,
      'Бонус менеджера':       finance.managerBonus,
      'Бонус оклейщика':       finance.masterBonus,
      'Маржинальная прибыль':  finance.marginalProfit,
      'Заметки':               payload.notes || '',
      'Проверено':             'Нет',
      'Создан':                nowStr,
      'Обновлён':              nowStr,
    };

    sheet.appendRow(headers.map(function(h) { return data[h] !== undefined ? data[h] : ''; }));

    if (payload.clientId) {
      updateClientOrderStats_(payload.clientId, payload.price, todayStr);
    }

    logActivity('Создал', 'Заказ', id, '', contractNum + ' — ' + (payload.clientName || ''));

    return { id: id, contractNumber: contractNum, status: defaultStatus, finance: finance };
  });
}

/**
 * Пересчитать финансы заказа после изменения материалов или расходов.
 * Вызывается из UI когда пользователь обновляет строки материалов/расходов.
 */
function recalcOrderFinance(orderId) {
  return safeCall(function() {
    bumpDataVersion_();
    const sheet   = getTab('DATABASE', 'ORDERS');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx   = headers.indexOf('ID');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) !== String(orderId)) continue;

      const rowData = {};
      headers.forEach(function(h, j) { rowData[h] = data[i][j]; });

      // Считаем суммы из дочерних листов.
      // Берём ВСЕ строки (и расход, и остаток): у остатка Стоимость отрицательная,
      // поэтому сумма = расход − остаток (нетто израсходованной плёнки).
      const matRows = readSheetAsObjects('DATABASE', 'ORDER_MATERIALS')
        .filter(function(r) { return String(r['Заказ ID']) === String(orderId); });
      const expRows = readSheetAsObjects('DATABASE', 'ORDER_EXPENSES')
        .filter(function(r) { return String(r['Заказ ID']) === String(orderId); });

      const totalMat = matRows.reduce(function(s, r) { return s + (Number(r['Стоимость']) || 0); }, 0);
      const totalExp = expRows.reduce(function(s, r) { return s + (Number(r['Сумма'])     || 0); }, 0);

      const finance = calcOrderFinance_(
        rowData['Стоимость заказа'], totalMat, totalExp,
        rowData['Тип оплаты'], rowData['Менеджер'], rowData['Оклейщики']
      );

      const tz  = Session.getScriptTimeZone();
      const now = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

      const update = {
        'Итого материалы':      round2(totalMat),
        'Итого расходы':        round2(totalExp),
        'Валовая прибыль':      finance.grossProfit,
        'Бонус менеджера':      finance.managerBonus,
        'Бонус оклейщика':      finance.masterBonus,
        'Маржинальная прибыль': finance.marginalProfit,
        'Обновлён':             now,
      };

      for (const [col, val] of Object.entries(update)) {
        const colIdx = headers.indexOf(col);
        if (colIdx >= 0) sheet.getRange(i + 1, colIdx + 1).setValue(val);
      }

      return { orderId: orderId, finance: finance, totalMat: round2(totalMat), totalExp: round2(totalExp) };
    }
    throw new Error('Заказ не найден: ' + orderId);
  });
}

/**
 * Редактировать существующий заказ (v1.5).
 * payload: { clientName, clientPhone, car, plate, vin, service, price,
 *             payType, duePayDate, dueDate, manager, masters, notes }
 */
function updateOrder(id, payload) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!id) throw new Error('Нет ID заказа');
    if (!payload) throw new Error('Нет данных для обновления');

    const sheet   = getTab('DATABASE', 'ORDERS');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx   = headers.indexOf('ID');
    const tz      = Session.getScriptTimeZone();
    const nowStr  = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) !== String(id)) continue;

      const row = {};
      headers.forEach(function(h, j) { row[h] = data[i][j]; });

      const setCell = function(col, val) {
        if (val === undefined || val === null) return;
        const idx = headers.indexOf(col);
        if (idx >= 0) sheet.getRange(i + 1, idx + 1).setValue(val);
      };

      // Текстовые поля
      if (payload.clientName  !== undefined) setCell('Клиент',          payload.clientName);
      if (payload.clientPhone !== undefined) setCell('Телефон',         payload.clientPhone);
      if (payload.car         !== undefined) setCell('Авто',            payload.car);
      if (payload.plate       !== undefined) setCell('Госномер',        payload.plate);
      if (payload.vin         !== undefined) setCell('VIN',             payload.vin);
      // Поля для документов (если колонки добавлены миграцией addOrderDocColumns)
      if (payload.year             !== undefined) setCell('Год выпуска',        payload.year);
      if (payload.mileage          !== undefined) setCell('Пробег',            payload.mileage);
      if (payload.lightTransmission!== undefined) setCell('Светопропускаемость', payload.lightTransmission);
      if (payload.elements         !== undefined) setCell('Элементы',          payload.elements);
      if (payload.signatory        !== undefined) setCell('Подписант',         payload.signatory);
      if (payload.attorney         !== undefined) setCell('Доверенность',      payload.attorney);
      if (payload.passport         !== undefined) setCell('Паспорт',           payload.passport);
      if (payload.workStart        !== undefined) setCell('Дата начала работ',    payload.workStart);
      if (payload.workEnd          !== undefined) setCell('Дата окончания работ', payload.workEnd);
      if (payload.passportIssued   !== undefined) setCell('Паспорт выдан',        payload.passportIssued);
      if (payload.address          !== undefined) setCell('Адрес',               payload.address);
      if (payload.elementsCount    !== undefined) setCell('Кол-во элементов',     payload.elementsCount);
      if (payload.complex          !== undefined) setCell('Комплекс',            payload.complex);
      if (payload.dueDate     !== undefined) setCell('Дата выполнения', payload.dueDate);
      if (payload.duePayDate  !== undefined) setCell('Срок оплаты',     payload.duePayDate);
      if (payload.notes       !== undefined) setCell('Заметки',         payload.notes);
      if (payload.manager     !== undefined) setCell('Менеджер',        payload.manager);
      if (payload.masters     !== undefined) setCell('Оклейщики',       payload.masters);
      if (payload.admin       !== undefined) setCell('Администратор',   payload.admin);

      if (payload.service !== undefined) {
        setCell('Услуга', getServiceName_(payload.service));
      }

      // Тип оплаты (условия) — редактируется свободно. Статус оплаты НЕ трогаем:
      // он меняется только платежами (addOrderPayment / updateOrderPaymentStatus_).
      if (payload.payType !== undefined) {
        setCell('Тип оплаты', payload.payType);
      }

      // Пересчёт финансов при изменении цены, условий оплаты или персонала
      const needsRecalc = payload.price !== undefined || payload.payType !== undefined
                       || payload.manager !== undefined || payload.masters !== undefined;
      let financeResult = null;
      if (needsRecalc) {
        const price      = payload.price   !== undefined ? Number(payload.price)  : Number(row['Стоимость заказа']) || 0;
        const payType    = payload.payType !== undefined ? payload.payType         : String(row['Тип оплаты'] || '');
        const manager    = payload.manager !== undefined ? payload.manager         : String(row['Менеджер']   || '');
        const masters    = payload.masters !== undefined ? payload.masters         : String(row['Оклейщики']  || '');
        const matCost    = Number(row['Итого материалы']) || 0;
        const expCost    = Number(row['Итого расходы'])   || 0;
        financeResult    = calcOrderFinance_(price, matCost, expCost, payType, manager, masters);

        if (payload.price !== undefined) setCell('Стоимость заказа', price);
        setCell('Валовая прибыль',      financeResult.grossProfit);
        setCell('Бонус менеджера',      financeResult.managerBonus);
        setCell('Бонус оклейщика',      financeResult.masterBonus);
        setCell('Маржинальная прибыль', financeResult.marginalProfit);
      }

      setCell('Обновлён', nowStr);
      logActivity('Редактировал', 'Заказ', id, '', '');
      return { id: id, finance: financeResult };
    }
    throw new Error('Заказ не найден: ' + id);
  });
}

/**
 * Переключить флаг верификации данных заказа (v1.5).
 * Возвращает { id, verified: true/false }
 */
function toggleOrderVerification(id) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!id) throw new Error('Нет ID заказа');

    const sheet   = getTab('DATABASE', 'ORDERS');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx   = headers.indexOf('ID');
    const verIdx  = headers.indexOf('Проверено');
    const updIdx  = headers.indexOf('Обновлён');
    const tz      = Session.getScriptTimeZone();
    const nowStr  = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    if (verIdx < 0) throw new Error('Колонка «Проверено» не найдена — запустите addPaymentColumns()');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) !== String(id)) continue;
      const current  = String(data[i][verIdx] || '');
      const newVal   = (current === 'Да') ? 'Нет' : 'Да';
      sheet.getRange(i + 1, verIdx + 1).setValue(newVal);
      if (updIdx >= 0) sheet.getRange(i + 1, updIdx + 1).setValue(nowStr);
      logActivity(newVal === 'Да' ? 'Проверил данные' : 'Снял проверку', 'Заказ', id, '', '');
      return { id: id, verified: newVal === 'Да' };
    }
    throw new Error('Заказ не найден: ' + id);
  });
}

/**
 * Изменить статус заказа. Допустимые статусы берутся из настраиваемых воронок.
 */
function updateOrderStatus(id, status) {
  return safeCall(function() {
    bumpDataVersion_();
    var allowed = getOrderStatuses().map(function(s){ return s.name; });
    if (allowed.indexOf(status) < 0) throw new Error('Недопустимый статус: ' + status);

    var sheet   = getTab('DATABASE', 'ORDERS');
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var idIdx   = headers.indexOf('ID');
    var stIdx   = headers.indexOf('Статус');
    var updIdx  = headers.indexOf('Обновлён');
    var tz      = Session.getScriptTimeZone();
    var nowStr  = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(id)) {
        sheet.getRange(i + 1, stIdx + 1).setValue(status);
        sheet.getRange(i + 1, updIdx + 1).setValue(nowStr);
        logActivity('Статус → ' + status, 'Заказ', id, '', '');
        return { id: id, status: status };
      }
    }
    throw new Error('Заказ не найден: ' + id);
  });
}

// ─── УДАЛЕНИЕ ЗАКАЗОВ (гибрид: мягкое скрытие + полное удаление из «Корзины») ───

// Гарантирует наличие колонки в листе Заказы; возвращает её 0-based индекс
function ensureOrderColumn_(sheet, name) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idx = headers.indexOf(name);
  if (idx >= 0) return idx;
  var lastCol = sheet.getLastColumn();
  sheet.insertColumnAfter(lastCol);
  sheet.getRange(1, lastCol + 1).setValue(name)
    .setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff');
  return lastCol;   // индекс новой колонки (0-based) = старое число столбцов
}

// Найти строку заказа по ID; возвращает { rowNum, headers, data } или null
function findOrderRow_(sheet, id) {
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx   = headers.indexOf('ID');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(id)) return { rowNum: i + 1, headers: headers, row: data[i] };
  }
  return null;
}

/** Мягкое удаление: заказ помечается «Удалён»=Да и пропадает со всех досок/списков (обратимо). */
function softDeleteOrder(id) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!id) throw new Error('Не указан заказ');
    var sheet = getTab('DATABASE', 'ORDERS');
    var delIdx = ensureOrderColumn_(sheet, 'Удалён');
    var found = findOrderRow_(sheet, id);
    if (!found) throw new Error('Заказ не найден: ' + id);
    sheet.getRange(found.rowNum, delIdx + 1).setValue('Да');
    logActivity('Заказ удалён (скрыт)', 'Заказ', id, '', '');
    return { id: id, deleted: true };
  });
}

/** Восстановить мягко удалённый заказ (снять флаг «Удалён»). */
function restoreOrder(id) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!id) throw new Error('Не указан заказ');
    var sheet = getTab('DATABASE', 'ORDERS');
    var delIdx = ensureOrderColumn_(sheet, 'Удалён');
    var found = findOrderRow_(sheet, id);
    if (!found) throw new Error('Заказ не найден: ' + id);
    sheet.getRange(found.rowNum, delIdx + 1).setValue('');
    logActivity('Заказ восстановлен', 'Заказ', id, '', '');
    return { id: id, deleted: false };
  });
}

// Удалить все строки листа, где колонка colName == value (снизу вверх)
function deleteRowsByValue_(tabKey, colName, value) {
  var sheet = getTab('DATABASE', tabKey);
  var data  = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;
  var idx = data[0].indexOf(colName);
  if (idx < 0) return 0;
  var removed = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idx]) === String(value)) { sheet.deleteRow(i + 1); removed++; }
  }
  return removed;
}

/** Полное удаление: строка заказа + связанные платежи и график рассрочки. Необратимо. */
function hardDeleteOrder(id) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!id) throw new Error('Не указан заказ');
    var sheet = getTab('DATABASE', 'ORDERS');
    var found = findOrderRow_(sheet, id);
    if (!found) throw new Error('Заказ не найден: ' + id);
    // Каскад: удаляем платежи и график этого заказа (защищённо — листов может не быть)
    var pays = 0, sched = 0;
    try { pays  = deleteRowsByValue_('PAYMENTS', 'Заказ ID', id); } catch (e) {}
    try { sched = deleteRowsByValue_('SCHEDULE', 'Заказ ID', id); } catch (e) {}
    sheet.deleteRow(found.rowNum);
    logActivity('Заказ удалён НАВСЕГДА (платежей: ' + pays + ', взносов: ' + sched + ')', 'Заказ', id, '', '');
    return { id: id, payments: pays, schedule: sched };
  });
}

/**
 * Получить сводку для дашборда заказов.
 */
function getOrdersStats() {
  return safeCall(function() {
    var all = readSheetAsObjects('DATABASE', 'ORDERS');

    // Уплачено по заказам — чтобы дебиторка была остатком, а не всей суммой
    var paidByOrder = {};
    try {
      readSheetAsObjects('DATABASE', 'PAYMENTS').forEach(function(p) {
        if (!p['ID']) return;
        var oid = String(p['Заказ ID']);
        paidByOrder[oid] = (paidByOrder[oid] || 0) + (Number(p['Сумма']) || 0);
      });
    } catch (e) {}

    var totalCount   = 0;
    var totalRevenue = 0;
    var inWork       = 0;
    var debtCount    = 0;
    var debtSum      = 0;
    var cancelledSet = getCancelledStatusSet_();
    var doneSet = getDoneStatusSet_();

    all.forEach(function(o) {
      if (!o['ID']) return;
      totalCount++;
      var price = Number(o['Стоимость заказа']) || 0;
      totalRevenue += price;
      if (!cancelledSet[o['Статус']] && !doneSet[o['Статус']]) inWork++;
      if (cancelledSet[o['Статус']]) return;

      // Статус оплаты с откатом на legacy «Безнал»
      var st = String(o['Статус оплаты'] || '').trim();
      if (!st) {
        var bz = String(o['Безнал'] || '').trim();
        st = (bz === 'Да' || bz === 'Нет') ? 'Оплачен' : bz === 'Частично' ? 'Частично' : 'Не оплачен';
      }
      if (st !== 'Оплачен') {
        var paid = paidByOrder[String(o['ID'])] || 0;
        debtCount++;
        debtSum += Math.max(0, price - paid);
      }
    });

    return {
      totalCount:   totalCount,
      totalRevenue: round2(totalRevenue),
      avgCheck:     totalCount > 0 ? round2(totalRevenue / totalCount) : 0,
      inWork:       inWork,
      debtCount:    debtCount,
      debtSum:      round2(debtSum),
    };
  });
}

// ─── ВСПОМОГАТЕЛЬНЫЕ ────────────────────────────────────────────────────────

function getServiceName_(code) {
  var catalog = getServicesCatalog();
  for (var i = 0; i < catalog.length; i++) {
    if (catalog[i].code === code) return catalog[i].name;
  }
  return code;
}

/** Найти код услуги по её названию (для переноса записи в заказ). '' если не найдено. */
function getServiceCodeByName_(name) {
  var catalog = getServicesCatalog();
  var n = String(name || '').trim().toLowerCase();
  if (!n) return '';
  for (var i = 0; i < catalog.length; i++) {
    if (String(catalog[i].name || '').trim().toLowerCase() === n) return catalog[i].code;
  }
  return '';
}

function parseDate_(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  var s = String(val);
  // Формат dd.MM.yyyy
  var m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return new Date(m[3], m[2] - 1, m[1]);
  return new Date(s);
}

/**
 * Найти или создать клиента для заказа. Возвращает ID клиента или '' при неудаче.
 * Поиск: по телефону (цифры), затем по точному имени. Если нет — создаёт карточку (физ).
 * Полностью защищено try/catch — никогда не ломает создание заказа.
 */
function ensureClientForOrder_(payload) {
  try {
    var name = String(payload.clientName || '').trim();
    if (!name) return '';
    var phone = String(payload.clientPhone || '').trim();
    var clients = readSheetAsObjects('DATABASE', 'CLIENTS');

    // 1) по телефону
    var clean = phone.replace(/\D/g, '');
    if (clean) {
      for (var i = 0; i < clients.length; i++) {
        var cp = String(clients[i]['Телефон'] || '').replace(/\D/g, '');
        if (cp && cp === clean) return clients[i]['ID'];
      }
    }
    // 2) по точному имени
    for (var j = 0; j < clients.length; j++) {
      if (String(clients[j]['Имя'] || '').trim().toLowerCase() === name.toLowerCase()) {
        return clients[j]['ID'];
      }
    }
    // 3) создаём новую карточку (тип и реквизиты — из формы заказа)
    var type = (String(payload.clientType || '') === 'юр') ? 'юр' : 'физ';
    var newClient = { type: type, name: name, phone: phone };
    if (type === 'юр') {
      newClient.unp          = payload.unp || '';
      newClient.director     = payload.director || '';
      newClient.legalAddress = payload.legalAddress || '';
      newClient.postalAddress= payload.postalAddress || '';
      newClient.bankDetails  = payload.bankDetails || '';
    }
    var res = createClient(newClient);
    return (res && res.ok && res.data && res.data['ID']) ? res.data['ID'] : '';
  } catch (e) {
    Logger.log('ensureClientForOrder_ ошибка: ' + e.message);
    return '';
  }
}

/**
 * Обновить счётчики «Всего заказов», «Сумма заказов», «Последний заказ» у клиента.
 */
function updateClientOrderStats_(clientId, price, dateStr) {
  try {
    var sheet   = getTab('DATABASE', 'CLIENTS');
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var idIdx   = headers.indexOf('ID');
    var cntIdx  = headers.indexOf('Всего заказов');
    var sumIdx  = headers.indexOf('Сумма заказов');
    var lastIdx = headers.indexOf('Последний заказ');
    var updIdx  = headers.indexOf('Обновлён');
    var tz      = Session.getScriptTimeZone();
    var nowStr  = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(clientId)) {
        if (cntIdx  >= 0) sheet.getRange(i+1, cntIdx+1).setValue((Number(data[i][cntIdx]) || 0) + 1);
        if (sumIdx  >= 0) sheet.getRange(i+1, sumIdx+1).setValue((Number(data[i][sumIdx]) || 0) + Number(price));
        if (lastIdx >= 0) sheet.getRange(i+1, lastIdx+1).setValue(dateStr);
        if (updIdx  >= 0) sheet.getRange(i+1, updIdx+1).setValue(nowStr);
        break;
      }
    }
  } catch(e) {
    Logger.log('updateClientOrderStats_ ошибка: ' + e.message);
  }
}
