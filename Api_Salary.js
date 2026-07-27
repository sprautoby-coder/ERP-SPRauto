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

    const cancelledSet = getCancelledStatusSet_();
    const orders = readSheetAsObjects('DATABASE', 'ORDERS')
      .filter(function(o){
        if (!o['ID']) return false;
        if (!o['Статус'] || cancelledSet[o['Статус']]) return false;
        if (from || to) {
          const d = parseSalDate_(o['Дата']);
          if (from && d && d < new Date(from)) return false;
          if (to   && d && d > new Date(to))   return false;
        }
        return true;
      });

    // Уже выданная зарплата за период: расходы категорий с флагом «Вычитать из ЗП»
    // (напр. «Зарплата»), привязанные к сотруднику. «Зарплата за предыдущий период»
    // сюда НЕ входит — она гасит долг прошлого периода и текущий бонус не уменьшает.
    const deductSet  = getSalaryDeductCategorySet_();
    const paidByEmp  = {};
    readSheetAsObjects('DATABASE', 'EXPENSES').forEach(function(e){
      if (!e['ID']) return;
      if (!deductSet[String(e['Категория'] || '').trim()]) return;
      const empId = String(e['Связан с сотрудником'] || '').trim();
      if (!empId) return;
      if (from || to) {
        const d = parseSalDate_(e['Дата']);
        if (from && d && d < new Date(from)) return;
        if (to   && d && d > new Date(to))   return;
      }
      paidByEmp[empId] = (paidByEmp[empId] || 0) + (Number(e['Сумма']) || 0);
    });

    // Глобальные ставки бонусов из Настроек (менеджер/мастер/администратор)
    const rates = getBonusRates_();

    const result = employees.map(function(emp) {
      const name   = emp['ФИО'] || '';
      const salary = Number(emp['Базовая ставка']) || 0;
      const pct    = Number(emp['% бонуса'])       || 0;

      let managerBonus = 0;
      let masterBonus  = 0;
      let adminBonus   = 0;
      let orderCount   = 0;
      const ordersList = [];

      orders.forEach(function(o) {
        const managers    = splitNames_(o['Менеджер'] || '');
        const masters     = splitNames_(o['Оклейщики'] || '');
        const admins      = splitNames_(o['Администратор'] || '');
        // Команда тонировки: своя (или по умолчанию как в оклейке)
        const tintMasters  = splitNames_(o['Тонировщики'] || '');
        const tintManagers = splitNames_(String(o['Менеджер тонировки'] || '').trim() || o['Менеджер'] || '');
        const tintAdmins   = splitNames_(String(o['Администратор тонировки'] || '').trim() || o['Администратор'] || '');
        const gross       = Number(o['Валовая прибыль']) || 0;
        const price       = Number(o['Стоимость заказа']) || 0;
        // Валовая делится по доле цены: тонировка ← своя часть, оклейка ← остальное.
        const tintPrice   = Number(o['Стоимость тонировки']) || 0;
        const tintGross   = price > 0 ? gross * (tintPrice / price) : 0;
        const wrapGross   = gross - tintGross;
        let involved   = false;
        let orderBonus = 0;
        const roles    = [];

        // Оклейка (со своей части)
        if (managers.indexOf(name) >= 0) { const b = managers.length > 0 ? wrapGross * (rates.manager / 100) / managers.length : 0; managerBonus += b; orderBonus += b; roles.push('Менеджер'); involved = true; }
        if (masters.indexOf(name)  >= 0) { const b = masters.length  > 0 ? wrapGross * (rates.master  / 100) / masters.length  : 0; masterBonus  += b; orderBonus += b; roles.push('Оклейщик'); involved = true; }
        if (admins.indexOf(name)   >= 0) { const b = admins.length   > 0 ? wrapGross * (rates.admin   / 100) / admins.length   : 0; adminBonus   += b; orderBonus += b; roles.push('Администратор'); involved = true; }
        // Тонировка (со своей части)
        if (tintManagers.indexOf(name) >= 0) { const b = tintManagers.length > 0 ? tintGross * (rates.manager / 100) / tintManagers.length : 0; managerBonus += b; orderBonus += b; roles.push('Менеджер (тонировка)'); involved = true; }
        if (tintMasters.indexOf(name)  >= 0) { const b = tintMasters.length  > 0 ? tintGross * (rates.master  / 100) / tintMasters.length  : 0; masterBonus  += b; orderBonus += b; roles.push('Тонировщик'); involved = true; }
        if (tintAdmins.indexOf(name)   >= 0) { const b = tintAdmins.length   > 0 ? tintGross * (rates.admin   / 100) / tintAdmins.length   : 0; adminBonus   += b; orderBonus += b; roles.push('Администратор (тонировка)'); involved = true; }
        if (involved) {
          orderCount++;
          const materials  = Number(o['Итого материалы']) || 0;
          const expenses   = Number(o['Итого расходы'])   || 0;
          const beznalDisc = Math.max(0, price - materials - expenses - gross);   // −15% (безнал/нал с чеком)
          ordersList.push({
            id:        o['ID'],
            contract:  o['Номер договора'] || '',
            date:      o['Дата'] || '',
            client:    o['Клиент'] || '',
            service:   o['Услуга'] || '',
            car:       o['Авто'] || '',
            price:     price,
            materials: round2Sal_(materials),
            expenses:  round2Sal_(expenses),
            beznal:    round2Sal_(beznalDisc),
            gross:     gross,
            bonus:     round2Sal_(orderBonus),
            roles:     roles.join(', '),
          });
        }
      });

      const totalBonus  = round2Sal_(managerBonus + masterBonus + adminBonus);
      const salaryPaid  = round2Sal_(paidByEmp[String(emp['ID'])] || 0);   // уже выдано за период
      return {
        id:           emp['ID'],
        name:         name,
        position:     emp['Основная должность'] || '',
        baseSalary:   salary,
        bonusPct:     pct,
        managerBonus: round2Sal_(managerBonus),
        masterBonus:  round2Sal_(masterBonus),
        adminBonus:   round2Sal_(adminBonus),
        totalBonus:   totalBonus,
        salaryPaid:   salaryPaid,
        // К выплате = ставка + бонус − уже выданная ЗП; может быть отрицательным (переплата)
        total:        round2Sal_(salary + totalBonus - salaryPaid),
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
