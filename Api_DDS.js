/**
 * Api_DDS.gs — Движение Денежных Средств (v1.3)
 *
 * Приход = фактические ПЛАТЕЖИ (лист Платежи): Нал → касса, Безнал → р/счёт (−15%)
 * Расход = лист EXPENSES
 * Дебиторка = непогашенный остаток заказов со «Статус оплаты» ≠ Оплачен
 *
 * Структура ДДС:
 * + Поступления от клиентов (нал + безнал)
 * - Расходы (операционные, ЗП, налоги...)
 * = Остаток кассы
 */

/**
 * ДДС — три отдельных потока:
 * 1. КАССА        = Нал от клиентов − наличные расходы
 * 2. РАСЧ. СЧЁТ   = Безнал от клиентов (−15% комиссия) − безналичные расходы
 * 3. ДЕБИТОРКА    = Заказы где Безнал='' (ещё не поступило)
 */
function getDDS(from, to) {
  return safeCall(function() {
    const orders   = readSheetAsObjects('DATABASE', 'ORDERS');
    const expenses = readSheetAsObjects('DATABASE', 'EXPENSES');
    const payments = readSheetAsObjects('DATABASE', 'PAYMENTS');

    function inPeriod(dateVal) {
      if (!from && !to) return true;
      const d = parseDdsDate_(dateVal);
      if (!d) return true;
      if (from && d < new Date(from)) return false;
      if (to   && d > new Date(to))   return false;
      return true;
    }

    const nalRows    = [];   // в кассу
    const beznalRows = [];   // на р/счёт
    const debtRows   = [];   // дебиторка
    const expNalRows = [];   // расходы наличными
    const expBnkRows = [];   // расходы безналично
    let totalNal = 0, totalBeznal = 0, totalBeznalNet = 0, totalDebt = 0;
    let expNal   = 0, expBnk = 0;

    // Карта заказов для подписи платежей
    const orderById = {};
    orders.forEach(function(o){ if (o['ID']) orderById[String(o['ID'])] = o; });

    // Уплачено по каждому заказу — для расчёта остатка дебиторки
    const paidByOrder = {};

    // ПРИХОД = фактические платежи (нал → касса, безнал → р/счёт −15%)
    payments.forEach(function(p) {
      if (!p['ID']) return;
      const oid    = String(p['Заказ ID']);
      const amount = Number(p['Сумма']) || 0;
      paidByOrder[oid] = (paidByOrder[oid] || 0) + amount;
      if (!inPeriod(p['Дата'])) return;
      const o    = orderById[oid] || {};
      const desc = (o['Клиент']||'') + ' — ' + (o['Номер договора']||oid||'');
      if (String(p['Способ оплаты']) === 'Безнал') {
        const fee = r_(amount * 0.15);
        const net = r_(amount - fee);
        totalBeznal    += amount;
        totalBeznalNet += net;
        beznalRows.push({ date: p['Дата'], desc: desc, amount: amount, fee: fee, net: net, id: oid });
      } else {
        totalNal += amount;
        nalRows.push({ date: p['Дата'], desc: desc, amount: amount, id: oid });
      }
    });

    // ДЕБИТОРКА = непогашенный остаток по неоплаченным/частичным заказам
    const cancelledSet = getCancelledStatusSet_();
    orders.forEach(function(o) {
      if (!o['ID'] || !inPeriod(o['Дата'])) return;
      const status = o['Статус'] || '';
      if (cancelledSet[status]) return;

      let payStatus = String(o['Статус оплаты'] || '').trim();
      if (!payStatus) {
        const bz = String(o['Безнал'] || '').trim();
        payStatus = (bz === 'Да' || bz === 'Нет') ? 'Оплачен' : bz === 'Частично' ? 'Частично' : 'Не оплачен';
      }
      if (payStatus === 'Оплачен') return;

      const price     = Number(o['Стоимость заказа']) || 0;
      const paid      = paidByOrder[String(o['ID'])] || 0;
      const remaining = r_(Math.max(0, price - paid));
      if (remaining <= 0) return;
      const desc = (o['Клиент']||'') + ' — ' + (o['Номер договора']||o['ID']||'');
      totalDebt += remaining;
      debtRows.push({ date: o['Дата'], desc: desc, amount: remaining, status: status, id: o['ID'] });
    });

    // Расходы: разбиваем по способу оплаты
    expenses.forEach(function(e) {
      if (!e['ID'] || !inPeriod(e['Дата'])) return;
      const sum = Number(e['Сумма']) || 0;
      const cat = e['Категория'] || 'Прочее';
      const pay = e['Способ оплаты'] || 'Нал';
      const row = { date: e['Дата'], category: cat, desc: e['Описание'] || '', amount: sum };
      if (pay === 'Безнал') { expBnk += sum; expBnkRows.push(row); }
      else                  { expNal += sum; expNalRows.push(row); }
    });

    const kassaBalance = r_(totalNal - expNal);
    const bankBalance  = r_(totalBeznalNet - expBnk);

    function sortByDate(arr) {
      return arr.sort(function(a, b){ return compareDdsDate_(a.date, b.date); });
    }

    return {
      summary: {
        // Касса
        totalNal:       r_(totalNal),
        expNal:         r_(expNal),
        kassaBalance:   kassaBalance,
        // Расчётный счёт
        totalBeznal:    r_(totalBeznal),
        totalBeznalNet: r_(totalBeznalNet),
        expBnk:         r_(expBnk),
        bankBalance:    bankBalance,
        // Дебиторка
        totalDebt:      r_(totalDebt),
        debtCount:      debtRows.length,
        // Итого
        totalBalance:   r_(kassaBalance + bankBalance),
      },
      nalRows:    sortByDate(nalRows),
      beznalRows: sortByDate(beznalRows),
      debtRows:   sortByDate(debtRows),
      expNalRows: sortByDate(expNalRows),
      expBnkRows: sortByDate(expBnkRows),
    };
  });
}

/**
 * Полная оплата заказа — создаёт платёж на полную сумму.
 * payType = 'Нал' (нал в кассу) или 'Безнал' (на р/счёт)
 */
function markOrderPaid(orderId, payType) {
  return safeCall(function() {
    if (payType !== 'Нал' && payType !== 'Безнал') throw new Error('Неверный тип оплаты');

    // Получаем сумму заказа
    const orders = readSheetAsObjects('DATABASE', 'ORDERS');
    let price = 0;
    for (let i = 0; i < orders.length; i++) {
      if (String(orders[i]['ID']) === String(orderId)) {
        price = Number(orders[i]['Стоимость заказа']) || 0;
        break;
      }
    }

    // Уже оплаченное
    const paid = readSheetAsObjects('DATABASE', 'PAYMENTS')
      .filter(function(p){ return String(p['Заказ ID']) === String(orderId); })
      .reduce(function(s, p){ return s + (Number(p['Сумма'])||0); }, 0);

    const remaining = Math.max(0, price - paid);
    if (remaining <= 0) throw new Error('Заказ уже полностью оплачен');

    // Записываем платёж на оставшуюся сумму
    return addOrderPayment(orderId, { amount: remaining, payType: payType });
  });
}

function parseDdsDate_(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const m = String(val).match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? new Date(+m[3], +m[2]-1, +m[1]) : null;
}

function compareDdsDate_(a, b) {
  const da = parseDdsDate_(a), db = parseDdsDate_(b);
  if (!da && !db) return 0;
  if (!da) return -1;
  if (!db) return 1;
  return da - db;
}

function r_(n) { return Math.round(Number(n)*100)/100; }
