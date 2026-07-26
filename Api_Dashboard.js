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
  period = period || {};
  return safeCall(function() {
   return cachedRead_('dash:' + JSON.stringify(period), 45, function() {
    const orders   = readSheetAsObjects('DATABASE', 'ORDERS');
    const expenses = readSheetAsObjects('DATABASE', 'EXPENSES');

    // Уплачено по заказам — для остатка дебиторки
    const paidByOrder = {};
    const methodsByOrder = {};
    try {
      readSheetAsObjects('DATABASE', 'PAYMENTS').forEach(function(p) {
        if (!p['ID']) return;
        const oid = String(p['Заказ ID']);
        paidByOrder[oid] = (paidByOrder[oid] || 0) + (Number(p['Сумма']) || 0);
        const m = String(p['Способ оплаты'] || '').trim();
        if (m) { (methodsByOrder[oid] = methodsByOrder[oid] || {})[m] = true; }
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
      if (!o['ID'] || String(o['Удалён'] || '') === 'Да') return false;   // мягко удалённые не учитываем
      return inPeriod(o['Дата']);
    });

    // KPI
    let revenue = 0, grossProfit = 0, materialCost = 0, expensesSum = 0;
    let inWork = 0, inWorkSum = 0, debtSum = 0, debtCount = 0;
    const byService = {};
    const cancelledSet = getCancelledStatusSet_();
    const doneSet = getDoneStatusSet_();
    const receivableSet = getReceivableStatusSet_();   // дебиторка с «Готов» и позже

    filtered.forEach(function(o) {
      const price  = Number(o['Стоимость заказа'])  || 0;
      const gross  = Number(o['Валовая прибыль'])    || 0;
      const mat    = Number(o['Итого материалы'])     || 0;
      const status = o['Статус'] || '';
      const svc    = o['Услуга'] || 'Прочее';
      if (cancelledSet[status]) return;   // отменённые в деньгах не учитываем

      const payType = String(o['Тип оплаты'] || '').trim();
      let payStatus = String(o['Статус оплаты'] || '').trim();
      if (!payStatus) {
        const bz = String(o['Безнал'] || '').trim();
        payStatus = (bz === 'Да' || bz === 'Нет') ? 'Оплачен' : bz === 'Частично' ? 'Частично' : 'Не оплачен';
      }
      const paidFull    = payStatus === 'Оплачен';
      const arrangement = (payType === 'Отсрочка' || payType === 'Рассрочка');   // отсрочка/рассрочка

      // Выручка = оплаченные + отсрочка/рассрочка (признанная). Иначе — «В работе» (расчёт не произошёл).
      if (paidFull || arrangement) {
        revenue     += price;
        grossProfit += gross;
        materialCost+= mat;
      } else {
        inWorkSum   += price;   // заказ вбит, но оплата ещё не проведена
      }

      if (!doneSet[status]) inWork++;

      // Дебиторка = остаток по неоплаченным: готовые (работа выполнена) + отсрочка/рассрочка
      if (!paidFull && (receivableSet[status] || arrangement)) {
        const paid = paidByOrder[String(o['ID'])] || 0;
        debtSum   += Math.max(0, price - paid);
        debtCount++;
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
          payMethod: (function(){
            var ms = Object.keys(methodsByOrder[String(o['ID'])] || {});
            if (ms.length === 1) return ms[0];
            if (ms.length > 1)   return 'Смешанная';
            var t = String(o['Тип оплаты'] || '').trim();
            return (t === 'Отсрочка' || t === 'Рассрочка') ? t : '';
          })(),
          verified:  String(o['Проверено'] || '') === 'Да',
        };
      });

    // Расходы по категориям (для графика)
    const expByCategory = {};
    expenses.forEach(function(e) {
      if (!e['ID'] || !inPeriod(e['Дата'])) return;
      const cat = e['Категория'] || 'Прочее';
      expByCategory[cat] = (expByCategory[cat] || 0) + (Number(e['Сумма']) || 0);
    });

    // Касса — текущий остаток (всё время). Расчётный счёт (безнал) — ЗА ВЫБРАННЫЙ ПЕРИОД.
    let kassaBalance = 0, bankBalance = 0;
    try { kassaBalance = getKassaBalance_(); } catch (e) {}
    try {
      let bIn = 0, bOut = 0;
      readSheetAsObjects('DATABASE', 'PAYMENTS').forEach(function(p){ if (p['ID'] && String(p['Способ оплаты']) === 'Безнал' && inPeriod(p['Дата'])) bIn += Number(p['Сумма']) || 0; });   // на счёт приходит полная сумма (−15% — только база для бонусов ЗП)
      expenses.forEach(function(e){ if (e['ID'] && String(e['Способ оплаты'] || '') === 'Безнал' && inPeriod(e['Дата'])) bOut += Number(e['Сумма']) || 0; });
      bankBalance = bIn - bOut;
    } catch (e) {}

    return {
      kpi: {
        revenue:     Math.round(revenue     * 100) / 100,
        grossProfit: Math.round(grossProfit * 100) / 100,
        netProfit:   Math.round((grossProfit - expensesSum) * 100) / 100,
        ordersCount: filtered.length,
        inWork:      inWork,
        inWorkSum:   Math.round(inWorkSum * 100) / 100,
        debtSum:     Math.round(debtSum * 100) / 100,
        expenses:    Math.round(expensesSum * 100) / 100,
        avgCheck:    filtered.length ? Math.round(revenue / filtered.length) : 0,
        kassaBalance: Math.round(kassaBalance * 100) / 100,
        bankBalance:  Math.round(bankBalance * 100) / 100,
      },
      byService:     byService,
      recentOrders:  recent,
      expByCategory: expByCategory,
      reconcile:     (function(){ try { return getBalancesBreakdown_(); } catch (e) { return null; } })(),
    };
   });
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
