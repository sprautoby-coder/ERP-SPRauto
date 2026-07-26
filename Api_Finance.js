/**
 * Api_Finance.gs — расширенный финансовый отчёт для собственника.
 * Единым запросом: выручка (нал/безнал), P&L-цепочка (валовая→маржинальная→чистая),
 * дебиторка, расходы, ФОТ, материалы, остатки кассы/счёта, изъятия, по услугам.
 */
function getFinanceReport(period) {
  period = period || {};
  return safeCall(function() {
    return cachedRead_('finrep:' + JSON.stringify(period), 45, function() {
      var from = period.from ? new Date(period.from) : null;
      var to   = period.to   ? new Date(period.to)   : null;
      function inP(v) {
        if (!v) return true;
        var d = parseDate__(v); if (!d) return true;
        if (from && d < from) return false;
        if (to   && d > to)   return false;
        return true;
      }
      var r2 = function(n){ return Math.round((Number(n) || 0) * 100) / 100; };

      var orders   = readSheetAsObjects('DATABASE', 'ORDERS').filter(function(o){ return o['ID'] && String(o['Удалён'] || '') !== 'Да'; });
      var payments = readSheetAsObjects('DATABASE', 'PAYMENTS');
      var expenses = readSheetAsObjects('DATABASE', 'EXPENSES');
      var cancelledSet = getCancelledStatusSet_();

      // Уплачено по заказам (всё время) — для остатка дебиторки
      var paidByOrder = {};
      payments.forEach(function(p){ if (!p['ID']) return; var k = String(p['Заказ ID']); paidByOrder[k] = (paidByOrder[k] || 0) + (Number(p['Сумма']) || 0); });

      // ── Заказы периода: выручка, валовая, материалы, затраты, безнал-комиссия, услуги, авто ──
      var revenue = 0, gross = 0, marginal = 0, matCost = 0, ordExp = 0, beznalFee = 0;
      var cars = {}, byService = {};
      var foCount = 0;
      orders.forEach(function(o) {
        if (!inP(o['Дата']) || cancelledSet[o['Статус'] || '']) return;
        foCount++;
        var price = Number(o['Стоимость заказа']) || 0;
        var g     = Number(o['Валовая прибыль'])   || 0;
        var mg    = Number(o['Маржинальная прибыль']) || g;
        var mat   = Number(o['Итого материалы'])   || 0;
        var exp   = Number(o['Итого расходы'])      || 0;
        revenue += price; gross += g; marginal += mg; matCost += mat; ordExp += exp;
        if (String(o['Тип оплаты'] || '') === 'Безнал') beznalFee += price * 0.15;
        var plate = String(o['Госномер'] || '').trim(); if (plate) cars[plate] = 1;
        var svc = o['Услуга'] || 'Прочее';
        if (!byService[svc]) byService[svc] = { count: 0, revenue: 0, gross: 0 };
        byService[svc].count++; byService[svc].revenue += price; byService[svc].gross += g;
      });
      var bonuses = gross - marginal;   // начисленные бонусы (менеджер+мастер+админ)

      // ── Поступления периода: нал / безнал (из платежей) ──
      var payNal = 0, payBeznal = 0;
      payments.forEach(function(p) {
        if (!p['ID'] || !inP(p['Дата'])) return;
        var a = Number(p['Сумма']) || 0;
        if (String(p['Способ оплаты']) === 'Безнал') payBeznal += a; else payNal += a;
      });
      var payTotal = payNal + payBeznal;

      // ── Расходы периода по категориям ──
      var expByCat = {}, opTotal = 0, fot = 0, taxes = 0, withdrawals = 0;
      var expList = [];
      expenses.forEach(function(e) {
        if (!e['ID'] || !inP(e['Дата'])) return;
        var cat = e['Категория'] || 'Прочее';
        var a   = Number(e['Сумма']) || 0;
        expByCat[cat] = (expByCat[cat] || 0) + a;
        if (cat === 'Изъятие владельца') withdrawals += a;
        else opTotal += a;                          // операционные = всё, кроме изъятия владельца
        if (cat === 'Зарплата' || cat === 'Бонусы') fot += a;
        if (cat === 'Налоги') taxes += a;
        expList.push({ date: e['Дата'] || '', category: cat, desc: e['Описание'] || '', amount: a, payMethod: e['Способ оплаты'] || 'Нал' });
      });
      expList.sort(function(a, b){ return compareDates__(b.date, a.date); });

      var netProfit = gross - opTotal;               // чистая = валовая − операционные расходы

      // ── Дебиторка (заказы периода с остатком) ──
      var debtSum = 0, debtList = [];
      orders.forEach(function(o) {
        if (!inP(o['Дата']) || cancelledSet[o['Статус'] || '']) return;
        var payStatus = String(o['Статус оплаты'] || '').trim();
        if (!payStatus) {
          var bz = String(o['Безнал'] || '').trim();
          payStatus = (bz === 'Да' || bz === 'Нет') ? 'Оплачен' : (bz === 'Частично' ? 'Частично' : 'Не оплачен');
        }
        if (payStatus === 'Оплачен') return;
        var price = Number(o['Стоимость заказа']) || 0;
        var paid  = paidByOrder[String(o['ID'])] || 0;
        var rem   = Math.max(0, price - paid);
        if (rem <= 0) return;
        debtSum += rem;
        debtList.push({ id: o['ID'], contract: o['Номер договора'] || '', date: o['Дата'] || '',
          client: o['Клиент'] || '', car: o['Авто'] || '', service: o['Услуга'] || '',
          price: r2(price), paid: r2(paid), remaining: r2(rem), dueDate: o['Срок оплаты'] || '', payType: o['Тип оплаты'] || '' });
      });
      debtList.sort(function(a, b){ return b.remaining - a.remaining; });

      // ── Остатки касса / расчётный счёт (всё время) ──
      var kassaBalance = 0, bankBalance = 0;
      try { kassaBalance = getKassaBalance_(); } catch (e) {}
      try {
        var bIn = 0, bOut = 0;
        payments.forEach(function(p){ if (!p['ID']) return; if (String(p['Способ оплаты']) === 'Безнал') bIn += (Number(p['Сумма']) || 0) * 0.85; });   // безнал −15%
        expenses.forEach(function(e){ if (!e['ID']) return; if (String(e['Способ оплаты'] || '') === 'Безнал') bOut += Number(e['Сумма']) || 0; });
        bankBalance = bIn - bOut;
      } catch (e) {}

      return {
        revenue: r2(revenue), revenueNal: r2(payNal), revenueBeznal: r2(payBeznal),
        beznalPct: payTotal ? Math.round(payBeznal / payTotal * 100) : 0,
        materialCost: r2(matCost), materialPct: revenue ? Math.round(matCost / revenue * 100) : 0,
        orderExpenses: r2(ordExp), beznalFee: r2(beznalFee),
        grossProfit: r2(gross), grossPct: revenue ? Math.round(gross / revenue * 100) : 0,
        bonuses: r2(bonuses), marginalProfit: r2(marginal),
        opExpenses: r2(opTotal), opByCategory: expByCat, netProfit: r2(netProfit),
        netPct: revenue ? Math.round(netProfit / revenue * 100) : 0,
        fot: r2(fot), fotPct: revenue ? Math.round(fot / revenue * 100) : 0,
        taxes: r2(taxes), withdrawals: r2(withdrawals),
        debtSum: r2(debtSum), debtCount: debtList.length, debtList: debtList,
        ordersCount: foCount, carsCount: Object.keys(cars).length,
        avgCheck: foCount ? Math.round(revenue / foCount) : 0,
        byService: byService,
        kassaBalance: r2(kassaBalance), bankBalance: r2(bankBalance),
        expList: expList
      };
    });
  });
}
