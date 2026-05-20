/**
 * Api_Settings.gs — настройки white-label
 */

function getSettings() {
  return safeCall(function() {
    var sheet = getTab('DATABASE', 'SETTINGS');
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};
    var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    var result = {};
    data.forEach(function(row) {
      if (row[0]) result[row[0]] = row[1];
    });
    return result;
  });
}

function saveSetting(key, value, description, category) {
  return safeCall(function() {
    var sheet = getTab('DATABASE', 'SETTINGS');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        return { key: key, value: value };
      }
    }
    sheet.appendRow([key, value, description || '', category || 'Общие']);
    return { key: key, value: value };
  });
}

function saveSettings(settings) {
  return safeCall(function() {
    var keys = Object.keys(settings);
    var saved = 0;
    keys.forEach(function(key) {
      var resp = saveSetting(key, settings[key]);
      if (resp && resp.ok) saved++;
    });
    return { saved: saved, total: keys.length };
  });
}

function getBrandSettings() {
  return safeCall(function() {
    var sheet = getTab('DATABASE', 'SETTINGS');
    var lastRow = sheet.getLastRow();
    var settings = {};
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
      data.forEach(function(row) {
        if (row[0]) settings[row[0]] = row[1];
      });
    }
    return {
      companyName:   settings['company_name']   || 'SPRauto',
      companySlogan: settings['company_slogan']  || 'Детейлинг',
      logoDataUrl:   settings['logo_dataurl']    || CONFIG.DEFAULT_LOGO || '',
      accentColor:   settings['accent_color']    || '#00B8D4',
      currency:      settings['currency']        || 'BYN',
      language:      settings['language']        || 'ru'
    };
  });
}

function initDefaultSettings_() {
  var sheet = getTab('DATABASE', 'SETTINGS');
  if (sheet.getLastRow() > 1) return;
  var defaults = [
    ['company_name',      'SPRauto',  'Название компании',     'Компания'],
    ['company_slogan',    'Детейлинг','Слоган',                'Компания'],
    ['logo_dataurl',      '',         'Логотип (data URL)',     'Компания'],
    ['accent_color',      '#00B8D4',  'Цвет интерфейса',       'Дизайн'],
    ['currency',          'BYN',      'Валюта',                'Регион'],
    ['language',          'ru',       'Язык',                  'Регион'],
    ['bonus_pool_pct',    '35',       '% фонда бонусов',      'Бонусы'],
    ['manager_bonus_pct', '5',        '% менеджеру',           'Бонусы'],
    ['cycle_day_1',       '5',        'День 1-го цикла ЗП',   'Циклы'],
    ['cycle_day_2',       '20',       'День 2-го цикла ЗП',   'Циклы']
  ];
  sheet.getRange(2, 1, defaults.length, 4).setValues(defaults);
}