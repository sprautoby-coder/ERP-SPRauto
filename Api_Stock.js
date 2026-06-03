/**
 * Api_Stock.gs — склад: остатки материалов (плёнки и расходники).
 *
 * Остаток хранится прямо в справочнике материалов (колонка «Остаток»), а каждое
 * изменение пишется в лист «Движение материалов» (приход / списание / коррекция).
 * Это держит одну точку правды по материалу и даёт полную историю движений.
 *
 * Авто-списание расхода при закрытии заказа сознательно НЕ включено в v1 —
 * требует решения по единицам измерения и идемпотентности (обсуждается отдельно).
 */

// ─── ЧТЕНИЕ ──────────────────────────────────────────────────────────────────

/** Список материалов с остатками + сводка по складу. */
function getStockList() {
  return safeCall(function() {
    var list = readSheetAsObjects('DATABASE', 'MATERIALS')
      .filter(function(m) { return m['ID'] && String(m['Активен']) !== 'Нет'; })
      .map(function(m) {
        var stock = Number(m['Остаток']) || 0;
        var min   = Number(m['Мин. остаток']) || 0;
        return {
          id:       m['ID'],
          name:     m['Название'] || '',
          category: m['Категория'] || '',
          unit:     m['Единица'] || 'шт',
          price:    Number(m['Цена']) || 0,
          stock:    round2(stock),
          min:      round2(min),
          low:      min > 0 && stock <= min,
          value:    round2(stock * (Number(m['Цена']) || 0)),  // стоимость остатка
        };
      });
    var lowCount = list.filter(function(x){ return x.low; }).length;
    var totalValue = list.reduce(function(a, x){ return a + x.value; }, 0);
    return { items: list, count: list.length, lowCount: lowCount, totalValue: round2(totalValue) };
  });
}

/** История последних движений по материалу (по умолчанию 30). */
function getStockMoves(materialId, limit) {
  return safeCall(function() {
    materialId = String(materialId || '');
    limit = limit || 30;
    var moves = readSheetAsObjects('DATABASE', 'MAT_MOVES')
      .filter(function(r) { return String(r['Материал ID']) === materialId; });
    return moves.slice(-limit).reverse();
  });
}

// ─── ИЗМЕНЕНИЕ ───────────────────────────────────────────────────────────────

/** Приход на склад (+qty). */
function stockReceipt(materialId, qty, comment) {
  return safeCall(function() {
    qty = Number(qty) || 0;
    if (qty <= 0) throw new Error('Количество должно быть больше 0');
    return applyStockMove_(materialId, qty, 'Приход', comment, '');
  });
}

/** Ручное списание со склада (−qty). */
function stockWriteoff(materialId, qty, comment, orderId) {
  return safeCall(function() {
    qty = Number(qty) || 0;
    if (qty <= 0) throw new Error('Количество должно быть больше 0');
    return applyStockMove_(materialId, -qty, 'Списание', comment, orderId || '');
  });
}

/** Коррекция: выставить точный остаток (разница уходит в движение). */
function stockAdjust(materialId, newQty, comment) {
  return safeCall(function() {
    newQty = Number(newQty) || 0;
    var cur = getMaterialStock_(materialId).stock;
    var delta = round2(newQty - cur);
    return applyStockMove_(materialId, delta, 'Коррекция', comment, '');
  });
}

// ─── ВНУТРЕННЕЕ ──────────────────────────────────────────────────────────────

/** Найти строку материала и индексы нужных колонок. */
function getMaterialStock_(materialId) {
  materialId = String(materialId || '');
  var sheet = getTab('DATABASE', 'MATERIALS');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol    = headers.indexOf('ID');
  var stockCol = headers.indexOf('Остаток');
  var nameCol  = headers.indexOf('Название');
  var updCol   = headers.indexOf('Обновлён');
  if (stockCol < 0) throw new Error('Нет колонки «Остаток» — запустите Мастер первого запуска');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === materialId) {
      return {
        sheet: sheet, row: i + 1,
        stockCol: stockCol + 1, updCol: updCol >= 0 ? updCol + 1 : -1,
        stock: Number(data[i][stockCol]) || 0,
        name: data[i][nameCol] || '',
      };
    }
  }
  throw new Error('Материал не найден: ' + materialId);
}

/** Применить движение: обновить остаток в справочнике + записать в журнал движений. */
function applyStockMove_(materialId, delta, type, comment, orderId) {
  var info = getMaterialStock_(materialId);
  var newStock = round2(info.stock + delta);
  info.sheet.getRange(info.row, info.stockCol).setValue(newStock);
  if (info.updCol > 0) info.sheet.getRange(info.row, info.updCol).setValue(new Date());

  appendRowByObject('DATABASE', 'MAT_MOVES', {
    'ID':            getNextId('DATABASE', 'MAT_MOVES', 'MOV'),
    'Материал ID':   materialId,
    'Название':      info.name,
    'Тип':           type,
    'Кол-во':        round2(delta),
    'Остаток после': newStock,
    'Комментарий':   comment || '',
    'Заказ ID':      orderId || '',
    'Создан':        new Date(),
  });
  logActivity('Склад: ' + type, 'Материал', materialId, '', String(delta));
  return { id: materialId, name: info.name, stock: newStock, delta: round2(delta), type: type };
}
