/**
 * Api_Expenses.gs — учёт операционных расходов (v1.3)
 * Лист: DATABASE → EXPENSES
 */

function getExpenses(filter) {
  return safeCall(function() {
    filter = filter || {};
    return cachedRead_('expenses:' + JSON.stringify(filter), 60, function() {
    const all = readSheetAsObjects('DATABASE', 'EXPENSES');
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
  });
}

function createExpense(payload) {
  return safeCall(function() {
    bumpDataVersion_();
    if (!payload.amount) throw new Error('Укажите сумму');
    if (!payload.category) throw new Error('Укажите категорию');

    const sheet   = getTab('DATABASE', 'EXPENSES');
    const id      = generateExpenseId_(sheet);
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
    bumpDataVersion_();
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

// Гарантированно уникальный ID расхода (РАС-NNNNN): max существующий номер +1,
// пропуская занятые. Не зависит от числа строк — устойчив к удалениям и коллизиям.
function generateExpenseId_(sheet) {
  var data  = sheet.getDataRange().getValues();
  var idIdx = data[0].indexOf('ID');
  var used  = {};
  var maxN  = 0;
  for (var i = 1; i < data.length; i++) {
    var v = String((idIdx >= 0 ? data[i][idIdx] : '') || '');
    if (v) used[v] = true;
    var m = v.match(/(\d+)\s*$/);
    if (m) { var n = parseInt(m[1], 10); if (n > maxN) maxN = n; }
  }
  var next = maxN + 1, id;
  do { id = 'РАС-' + String(next).padStart(5, '0'); next++; } while (used[id]);
  return id;
}

// ─── КАТЕГОРИИ РАСХОДОВ (лист «Категории расходов», редактируются в Настройках) ───

// Гарантирует наличие листа категорий и первичное заполнение по сиду из Config.
function ensureExpenseCategoriesSheet_() {
  var book  = openBook('DATABASE');
  var name  = CONFIG.TABS.EXPENSE_CAT;
  var sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, 3).setValues([['Категория', 'Вычитать из ЗП', 'Порядок']])
      .setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff');
  }
  if (sheet.getLastRow() < 2) {
    var deduct = {};
    (CONFIG.EXPENSE_CATEGORIES_SALARY_DEDUCT || []).forEach(function(n){ deduct[n] = true; });
    var seed = (CONFIG.EXPENSE_CATEGORIES || []).map(function(nm, i){
      return [nm, deduct[nm] ? 'Да' : '', (i + 1) * 10];
    });
    if (seed.length) sheet.getRange(2, 1, seed.length, 3).setValues(seed);
  }
  return sheet;
}

// Каталог категорий: [{ name, deduct }] — отсортирован по колонке «Порядок».
function getExpenseCategoriesCatalog() {
  var sheet = ensureExpenseCategoriesSheet_();
  var data  = sheet.getDataRange().getValues();
  var out   = [];
  for (var i = 1; i < data.length; i++) {
    var nm = String(data[i][0] || '').trim();
    if (!nm) continue;
    out.push({ name: nm, deduct: String(data[i][1] || '').trim() === 'Да', order: Number(data[i][2]) || 0 });
  }
  out.sort(function(a, b){ return a.order - b.order; });
  return out;
}

// Множество названий категорий, вычитаемых из ЗП (флаг «Вычитать из ЗП» = Да).
function getSalaryDeductCategorySet_() {
  var set = {};
  try {
    getExpenseCategoriesCatalog().forEach(function(c){ if (c.deduct) set[c.name] = true; });
  } catch (e) { /* лист может быть недоступен */ }
  return set;
}

// Безопасный вариант для initApp: при любой ошибке чтения/создания листа
// отдаёт статический список из Config, чтобы запуск приложения не падал.
function getExpenseCategoriesSafe_() {
  try {
    return getExpenseCategoriesCatalog();
  } catch (e) {
    var deduct = {};
    (CONFIG.EXPENSE_CATEGORIES_SALARY_DEDUCT || []).forEach(function(n){ deduct[n] = true; });
    return (CONFIG.EXPENSE_CATEGORIES || []).map(function(nm){
      return { name: nm, deduct: !!deduct[nm] };
    });
  }
}

// Клиентский эндпоинт: список категорий.
function getExpenseCategories() {
  return safeCall(function(){ return getExpenseCategoriesCatalog(); });
}

function addExpenseCategory(payload) {
  return safeCall(function(){
    bumpDataVersion_();
    var name = String((payload && payload.name) || '').trim();
    if (!name) throw new Error('Укажите название категории');
    var sheet = ensureExpenseCategoriesSheet_();
    var data  = sheet.getDataRange().getValues();
    var maxOrder = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').trim().toLowerCase() === name.toLowerCase())
        throw new Error('Такая категория уже есть: ' + name);
      maxOrder = Math.max(maxOrder, Number(data[i][2]) || 0);
    }
    sheet.appendRow([name, (payload && payload.deduct) ? 'Да' : '', maxOrder + 10]);
    logActivity('Создал', 'Категория расхода', name, '', (payload && payload.deduct) ? 'вычитать из ЗП' : '');
    return { name: name };
  });
}

function updateExpenseCategory(payload) {
  return safeCall(function(){
    bumpDataVersion_();
    var oldName = String((payload && payload.oldName) || '').trim();
    var newName = String((payload && payload.newName) || oldName).trim();
    if (!oldName) throw new Error('Не указана категория');
    if (!newName) throw new Error('Укажите название категории');
    var sheet = ensureExpenseCategoriesSheet_();
    var data  = sheet.getDataRange().getValues();
    var rowNum = -1;
    for (var i = 1; i < data.length; i++) {
      var nm = String(data[i][0] || '').trim();
      if (nm.toLowerCase() === oldName.toLowerCase()) rowNum = i + 1;
      else if (nm.toLowerCase() === newName.toLowerCase()) throw new Error('Такая категория уже есть: ' + newName);
    }
    if (rowNum < 0) throw new Error('Категория не найдена: ' + oldName);
    sheet.getRange(rowNum, 1).setValue(newName);
    sheet.getRange(rowNum, 2).setValue((payload && payload.deduct) ? 'Да' : '');
    // Переименование — синхронно правим уже записанные расходы этой категории
    var moved = (newName !== oldName) ? renameExpenseCategoryInExpenses_(oldName, newName) : 0;
    logActivity('Изменил', 'Категория расхода', oldName, oldName, newName + (moved ? (' (расходов: ' + moved + ')') : ''));
    return { name: newName, movedExpenses: moved };
  });
}

function deleteExpenseCategory(name) {
  return safeCall(function(){
    bumpDataVersion_();
    name = String(name || '').trim();
    if (!name) throw new Error('Не указана категория');
    var sheet = ensureExpenseCategoriesSheet_();
    var data  = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0] || '').trim().toLowerCase() === name.toLowerCase()) {
        sheet.deleteRow(i + 1);
        logActivity('Удалил', 'Категория расхода', name, '', '');
        return { name: name };
      }
    }
    throw new Error('Категория не найдена: ' + name);
  });
}

// Переименовать категорию во всех уже записанных расходах (лист EXPENSES).
function renameExpenseCategoryInExpenses_(oldName, newName) {
  var sheet = getTab('DATABASE', 'EXPENSES');
  var data  = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;
  var idx = data[0].indexOf('Категория');
  if (idx < 0) return 0;
  var n = 0;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx]).trim() === oldName) { sheet.getRange(i + 1, idx + 1).setValue(newName); n++; }
  }
  return n;
}
