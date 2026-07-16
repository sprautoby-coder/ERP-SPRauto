/**
 * Api_Import.gs — ВРЕМЕННЫЙ инструмент разового переноса заказов из внешних таблиц.
 * После завершения импорта этот файл можно удалить.
 */

// Исходные книги (Оклейка клиенты / Тонировка клиенты)
var IMPORT_SRC = {
  okleyka:   '1g1wrju0lWSg4eQPoEIafn6NmVSRZN_-DmIp5VAQhWCE',
  tonirovka: '1nF-5TFkTyaU0jWsMGShQBM_xvZsxnOjIUmbwnoy1cmo'
};

/**
 * Осмотр исходных таблиц: заголовки + первые строки (как отображаются в таблице).
 * Нужно, чтобы понять структуру и построить маппинг колонок → поля заказа.
 */
function inspectImportSheets() {
  return safeCall(function() {
    var out = {};
    Object.keys(IMPORT_SRC).forEach(function(key) {
      try {
        var ss    = SpreadsheetApp.openById(IMPORT_SRC[key]);
        var sheet = ss.getSheets()[0];
        var lastRow = Math.min(sheet.getLastRow(), 7);
        var lastCol = sheet.getLastColumn();
        var vals = (lastRow >= 1 && lastCol >= 1)
          ? sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues()
          : [];
        out[key] = {
          spreadsheet: ss.getName(),
          sheet:       sheet.getName(),
          totalRows:   sheet.getLastRow(),
          totalCols:   lastCol,
          headers:     vals[0] || [],
          sample:      vals.slice(1)
        };
      } catch (e) {
        out[key] = { error: e.message };
      }
    });
    return out;
  });
}
