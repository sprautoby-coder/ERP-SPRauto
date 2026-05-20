/**
 * Api_Orders.gs — работа с заказами
 * Читаем из существующего листа «Расчёт ОКЛЕЙКА» (не ломаем!)
 */

/**
 * Маппинг колонок: ключ приложения → название колонки в Расчёт ОКЛЕЙКА
 * Подкорректировать после анализа реальных заголовков!
 */
const ORDER_COLUMN_MAP = {
  id:              'Номер заказа',
  date:            'Дата',
  client:          'Клиент',
  auto:            'Авто',
  vin:             'VIN',
  service:         'Услуга',
  totalPrice:      'Стоимость заказа',
  paymentMethod:   'Безнал',
  grossProfit:     'Валовая прибыль',
  marginalProfit:  'Маржинальная прибыль',
};

/**
 * Получить список заказов
 * @param {Object} filter — { from, to, service, master, paymentMethod }
 */
function getOrders(filter) {
  return safeCall(() => {
    filter = filter || {};
    const sheet = getTab('RASCHET_OKLEYKA', 'RASCHET');
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const orders = data.slice(1).map(row => rowToOrder_(row, headers));
    
    // Применяем фильтры
    return orders.filter(o => {
      if (!o.id) return false; // пропускаем пустые строки
      if (filter.from && o.date && new Date(o.date) < new Date(filter.from)) return false;
      if (filter.to && o.date && new Date(o.date) > new Date(filter.to)) return false;
      if (filter.service && o.service !== filter.service) return false;
      return true;
    });
  });
}

/**
 * Маппинг строки → объект заказа
 */
function rowToOrder_(row, headers) {
  const order = {};
  for (const [key, columnName] of Object.entries(ORDER_COLUMN_MAP)) {
    const idx = headers.indexOf(columnName);
    if (idx >= 0) order[key] = row[idx];
  }
  return order;
}