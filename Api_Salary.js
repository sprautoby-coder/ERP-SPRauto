/**
 * Api_Salary.gs — расчёт заработной платы и бонусов (v1.3)
 *
 * Логика:
 * Для каждого сотрудника собираем заказы за период,
 * где он упомянут как менеджер или мастер.
 * Бонус = сумма его долей валовой прибыли по всем заказам.
 * Итого к выплате = базовая ставка + бонус.
 */

function calcSalaryForPeriod(from, to) {
  return safeCall(function() {
    const employees = readSheetAsObjects('DATABASE', 'EMPLOYEES')
      .filter(function(e){ return e['ID'] && e['Статус'] === 'Работает'; });

    const orders = readSheetAsObjects('DATABASE', 'ORDERS')
      .filter(function(o){
        if (!o['ID']) return false;
        if (!o['Статус'] || o['Статус'] === 'Отменён') return false;
        if (from || to) {
          const d = parseSalDate_(o['Дата']);
          if (from && d && d < new Date(from)) return false;
          if (to   && d && d > new Date(to))   return false;
        }
        return true;
      });

    const result = employees.map(function(emp) {
      const name   = emp['ФИО'] || '';
      const salary = Number(emp['Базовая ставка']) || 0;
      const pct    = Number(emp['% бонуса'])       || 0;

      let managerBonus = 0;
      let masterBonus  = 0;
      let orderCount   = 0;
      const ordersList = [];

      orders.forEach(function(o) {
        const managers = splitNames_(o['Менеджер'] || '');
        const masters  = splitNames_(o['Оклейщики'] || '');
        const gross    = Number(o['Валовая прибыль']) || 0;
        const price    = Number(o['Стоимость заказа']) || 0;
        let involved   = false;

        if (managers.indexOf(name) >= 0) {
          const share = managers.length > 0 ? gross * 0.10 / managers.length : 0;
          managerBonus += share;
          involved = true;
        }
        if (masters.indexOf(name) >= 0) {
          const share = masters.length > 0 ? gross * 0.35 / masters.length : 0;
          masterBonus += share;
          involved = true;
        }
        if (involved) {
          orderCount++;
          ordersList.push({
            id:       o['ID'],
            contract: o['Номер договора'] || '',
            date:     o['Дата'] || '',
            client:   o['Клиент'] || '',
            price:    price,
            gross:    gross,
          });
        }
      });

      const totalBonus = round2Sal_(managerBonus + masterBonus);
      return {
        id:           emp['ID'],
        name:         name,
        position:     emp['Основная должность'] || '',
        baseSalary:   salary,
        bonusPct:     pct,
        managerBonus: round2Sal_(managerBonus),
        masterBonus:  round2Sal_(masterBonus),
        totalBonus:   totalBonus,
        total:        round2Sal_(salary + totalBonus),
        orderCount:   orderCount,
        orders:       ordersList,
      };
    });

    const grandTotal = result.reduce(function(s, r){ return s + r.total; }, 0);
    return { employees: result, grandTotal: round2Sal_(grandTotal), from: from, to: to };
  });
}

function splitNames_(str) {
  if (!str) return [];
  return str.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
}

function parseSalDate_(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const m = String(val).match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? new Date(+m[3], +m[2]-1, +m[1]) : null;
}

function round2Sal_(n) { return Math.round(Number(n)*100)/100; }
