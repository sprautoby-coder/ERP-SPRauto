/**
 * Api_Dashboard.gs — агрегация реальных данных для дашборда (v1.3)
 */

/**
 * Дашборд одним запросом: KPI/период + дебиторка для баннера.
 * Раньше клиент делал ДВА round-trip (getDashboardData + getDebtOrders) при
 * каждом открытии дашборда — теперь один. Сетевой round-trip к Apps Script
 * (~0.3–2с) — главная задержка, поэтому слияние ощутимо ускоряет старт.
 */
function getDashboardBundle(period) {
  return safeCall(function() {
    const dash = getDashboardData(period);
    const debt = getDebtOrders();
    return {
      dash: (dash && dash.ok) ? dash.data : null,
      debt: (debt && debt.ok) ? debt.data : [],
    };
  });
}

function getDashboardData(period) {
  return safeCall(function() {
    period = period || {};

    const orders   = readSheetAsObjects('DATABASE', 'ORDERS');
    const expenses = readSheetAsObjects('DATABASE', 'EXPENSES');

    // Уплачено по заказам — для остатка дебиторки
    const paidByOrder = {};
    try {
      readSheetAsObjects('DATABASE', 'PAYMENTS').forEach(function(p) {
        if (!p['ID']) return;
        const oid = String(p['Заказ ID']);
        paidByOrder[oid] = (paidByOrder[oid] || 0) + (Number(p['Сумма']) || 0);
      });
    } catch (e) {}

    // Фильтр по периоду
    const from = period.from ? new Date(period.from) : null;
    const to   = period.to   ? new Date(period.to)   : null;

    function inPeriod(dateVal) {
      if (!dateVal) return true;
      const d = parseDate__(dateVal);
      if (!d) return true;
      if (from && d < from) return false;
      if (to   && d > to)   return false;
      return true;
    }

    const filtered = orders.filter(function(o) {
      return o['ID'] && inPeriod(o['Дата']);
    });

    // KPI
    let revenue = 0, grossProfit = 0, materialCost = 0, expensesSum = 0;
    let inWork = 0, debtSum = 0, debtCount = 0;
    const byService = {};

    filtered.forEach(function(o) {
      const price  = Number(o['Стоимость заказа'])  || 0;
      const gross  = Number(o['Валовая прибыль'])    || 0;
      const mat    = Number(o['Итого материалы'])     || 0;
      const exp    = Number(o['Итого расходы'])       || 0;
      const status = o['Статус'] || '';
      const svc    = o['Услуга'] || 'Прочее';

      revenue     += price;
      grossProfit += gross;
      materialCost+= mat;

      if (status === 'В работе' || status === 'Новый') inWork++;

      // Дебиторка = остаток по неоплаченным/частичным (по «Статус оплаты», откат на legacy «Безнал»)
      if (status !== 'Отменён') {
        let payStatus = String(o['Статус оплаты'] || '').trim();
        if (!payStatus) {
          const bz = String(o['Безнал'] || '').trim();
          payStatus = (bz === 'Да' || bz === 'Нет') ? 'Оплачен' : bz === 'Частично' ? 'Частично' : 'Не оплачен';
        }
        if (payStatus !== 'Оплачен') {
          const paid = paidByOrder[String(o['ID'])] || 0;
          debtSum   += Math.max(0, price - paid);
          debtCount++;
        }
      }

      if (!byService[svc]) byService[svc] = { count: 0, revenue: 0, gross: 0 };
      byService[svc].count++;
      byService[svc].revenue += price;
      byService[svc].gross   += gross;
    });

    // Операционные расходы (из листа Расходы, кроме ЗП и налогов)
    const opExpCategories = ['Аренда','Коммунальные','Маркетинг','Транспорт','Материалы','Прочее','Инструмент'];
    expenses.forEach(function(e) {
      if (!e['ID']) return;
      if (!inPeriod(e['Дата'])) return;
      const cat = e['Категория'] || '';
      if (opExpCategories.indexOf(cat) >= 0) expensesSum += Number(e['Сумма']) || 0;
    });

    // Последние 8 заказов
    const recent = filtered
      .filter(function(o){ return o['Дата']; })
      .sort(function(a, b){ return compareDates__(b['Дата'], a['Дата']); })
      .slice(0, 8)
      .map(function(o){
        return {
          id:       o['ID'],
          contract: o['Номер договора'] || '',
          date:     o['Дата'] || '',
          client:   o['Клиент'] || '',
          phone:    o['Телефон'] || '',
          car:      o['Авто']   || '',
          plate:    o['Госномер'] || '',
          service:  o['Услуга'] || '',
          price:    Number(o['Стоимость заказа']) || 0,
          status:   o['Статус'] || '',
          beznal:   o['Безнал'] || '',
          payStatus: o['Статус оплаты'] || '',
          payType:   o['Тип оплаты'] || '',
        };
      });

    // Расходы по категориям (для графика)
    const expByCategory = {};
    expenses.forEach(function(e) {
      if (!e['ID'] || !inPeriod(e['Дата'])) return;
      const cat = e['Категория'] || 'Прочее';
      expByCategory[cat] = (expByCategory[cat] || 0) + (Number(e['Сумма']) || 0);
    });

    return {
      kpi: {
        revenue:     Math.round(revenue     * 100) / 100,
        grossProfit: Math.round(grossProfit * 100) / 100,
        netProfit:   Math.round((grossProfit - expensesSum) * 100) / 100,
        ordersCount: filtered.length,
        inWork:      inWork,
        debtSum:     Math.round(debtSum * 100) / 100,
        expenses:    Math.round(expensesSum * 100) / 100,
        avgCheck:    filtered.length ? Math.round(revenue / filtered.length) : 0,
      },
      byService:     byService,
      recentOrders:  recent,
      expByCategory: expByCategory,
    };
  });
}

/**
 * Быстрый список последних расходов для дашборда
 */
function getRecentExpenses(limit) {
  return safeCall(function() {
    limit = limit || 5;
    const all = readSheetAsObjects('DATABASE', 'EXPENSES');
    return all
      .filter(function(e){ return e['ID']; })
      .sort(function(a, b){ return compareDates__(b['Дата'], a['Дата']); })
      .slice(0, limit);
  });
}

function parseDate__(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const s = String(val);
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return new Date(s);
}

function compareDates__(a, b) {
  const da = parseDate__(a), db = parseDate__(b);
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return da - db;
}
