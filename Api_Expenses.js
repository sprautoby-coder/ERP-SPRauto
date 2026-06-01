/**
 * Api_Expenses.gs — учёт операционных расходов (v1.3)
 * Лист: DATABASE → EXPENSES
 */

function getExpenses(filter) {
  return safeCall(function() {
    const all = readSheetAsObjects('DATABASE', 'EXPENSES');
    filter = filter || {};
    return all.filter(function(e) {
      if (!e['ID']) return false;
      if (filter.category && e['Категория'] !== filter.category) return false;
      if (filter.from) {
        const d = parseExpDate_(e['Дата']);
        if (d && d < new Date(filter.from)) return false;
      }
      if (filter.to) {
        const d = parseExpDate_(e['Дата']);
        if (d && d > new Date(filter.to)) return false;
      }
      if (filter.search) {
        const q = filter.search.toLowerCase();
        const desc = String(e['Описание'] || '').toLowerCase();
        const cat  = String(e['Категория'] || '').toLowerCase();
        if (!desc.includes(q) && !cat.includes(q)) return false;
      }
      return true;
    });
  });
}

function createExpense(payload) {
  return safeCall(function() {
    if (!payload.amount) throw new Error('Укажите сумму');
    if (!payload.category) throw new Error('Укажите категорию');

    const sheet   = getTab('DATABASE', 'EXPENSES');
    const lastRow = sheet.getLastRow();
    const id      = 'РАС-' + String(lastRow).padStart(5, '0');
    const tz      = Session.getScriptTimeZone();
    const now     = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm');
    const today   = Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    const data = {
      'ID':                   id,
      'Дата':                 payload.date || today,
      'Категория':            payload.category,
      'Описание':             payload.description || '',
      'Сумма':                Number(payload.amount),
      'Валюта':               'BYN',
      'Способ оплаты':        payload.payMethod || 'Нал',
      'Связан с заказом':     payload.orderId || '',
      'Связан с сотрудником': payload.employeeId || '',
      'Кто внёс':             payload.author || '',
      'Комментарий':          payload.comment || '',
      'Создан':               now,
    };

    sheet.appendRow(headers.map(function(h) { return data[h] !== undefined ? data[h] : ''; }));
    logActivity('Создал', 'Расход', id, '', payload.category + ' ' + payload.amount + ' Br');
    return { id: id };
  });
}

function deleteExpense(id) {
  return safeCall(function() {
    const sheet   = getTab('DATABASE', 'EXPENSES');
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx   = headers.indexOf('ID');
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][idIdx]) === String(id)) {
        sheet.deleteRow(i + 1);
        logActivity('Удалил', 'Расход', id, '', '');
        return { id: id };
      }
    }
    throw new Error('Расход не найден: ' + id);
  });
}

function getExpensesStats() {
  return safeCall(function() {
    const all = readSheetAsObjects('DATABASE', 'EXPENSES');
    const byCategory = {};
    let total = 0;
    all.forEach(function(e) {
      if (!e['ID']) return;
      const cat = e['Категория'] || 'Прочее';
      const sum = Number(e['Сумма']) || 0;
      byCategory[cat] = (byCategory[cat] || 0) + sum;
      total += sum;
    });
    return { total: Math.round(total * 100) / 100, byCategory: byCategory };
  });
}

function parseExpDate_(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const s = String(val);
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return new Date(s);
}
