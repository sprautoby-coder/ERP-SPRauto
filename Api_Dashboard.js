/**
 * Api_Dashboard.gs — агрегация данных для дашборда
 */

/**
 * Главная функция получения данных для дашборда
 */
function getDashboardData(period) {
  return safeCall(() => {
    period = period || {};
    
    // Заказы за период
    const ordersResp = getOrders({ from: period.from, to: period.to });
    const orders = ordersResp.ok ? ordersResp.data : [];
    
    // Считаем KPI
    const revenue = orders.reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0);
    const ordersCount = orders.length;
    const avgCheck = ordersCount ? Math.round(revenue / ordersCount) : 0;
    
    // По направлениям
    const ppfOrders = orders.filter(o => /оклейка/i.test(String(o.service || '')));
    const tintOrders = orders.filter(o => /тонировк/i.test(String(o.service || '')));
    
    // Последние заказы (для виджета)
    const recentOrders = orders
      .filter(o => o.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 6);
    
    // Сотрудники
    const employeesResp = getEmployees(true);
    const employees = employeesResp.ok ? employeesResp.data : [];
    
    return {
      period: { from: period.from, to: period.to },
      kpi: {
        revenue: revenue,
        ordersCount: ordersCount,
        avgCheck: avgCheck,
        // Чистая прибыль пока берём из существующей логики или ставим заглушку
        netProfit: 0,
        debtTotal: 0,
        expenses: 0,
      },
      directions: {
        ppf: { count: ppfOrders.length, revenue: ppfOrders.reduce((s, o) => s + (Number(o.totalPrice) || 0), 0) },
        tint: { count: tintOrders.length, revenue: tintOrders.reduce((s, o) => s + (Number(o.totalPrice) || 0), 0) },
      },
      recentOrders: recentOrders,
      employees: employees,
      cycle: {
        // заглушка: цикл из листа «Циклы расчёта»
        number: 14,
        openedAt: new Date(2026, 4, 5),
        plannedClose: new Date(2026, 4, 20),
        accruedSalary: 12800,
        cashBox: 8200,
      },
    };
  });
}