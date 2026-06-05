/**
 * Api_Documents.gs — генерация договоров и заказ-нарядов (v1.3)
 * Возвращает HTML-строку, которую браузер открывает на печать.
 */

/**
 * Получить полные данные заказа для печати документа.
 */
function getOrderForDocument(orderId) {
  return safeCall(function() {
    const orders = readSheetAsObjects('DATABASE', 'ORDERS');
    let order = null;
    for (let i = 0; i < orders.length; i++) {
      if (String(orders[i]['ID']) === String(orderId)) { order = orders[i]; break; }
    }
    if (!order) throw new Error('Заказ не найден: ' + orderId);

    // Материалы
    const matRows = readSheetAsObjects('DATABASE', 'ORDER_MATERIALS')
      .filter(function(r){ return String(r['Заказ ID']) === String(orderId); });
    // Расходы заказа
    const expRows = readSheetAsObjects('DATABASE', 'ORDER_EXPENSES')
      .filter(function(r){ return String(r['Заказ ID']) === String(orderId); });

    // Настройки компании
    const settings = {};
    readSheetAsObjects('DATABASE', 'SETTINGS').forEach(function(s){
      if (s['Ключ']) settings[s['Ключ']] = s['Значение'];
    });

    return {
      order:    order,
      materials: matRows,
      expenses:  expRows,
      company:   settings,
    };
  });
}

/**
 * Генерировать HTML договора для печати.
 */
function generateContractHtml(orderId) {
  return safeCall(function() {
    var d = getDocData_(orderId);
    var map = buildDocPlaceholders_(d);
    var body = fillTemplate_(contractTemplateHtml_(), map);
    return docWrap_('Договор ' + (map['Номер договора'] || ''), body);
  });
}

// (старый генератор договора — оставлен как референс, не вызывается)
function generateContractHtmlLegacy_(orderId) {
  return safeCall(function() {
    const resp = getOrderForDocument(orderId);
    if (!resp.ok) throw new Error(resp.error);
    const d = resp.data;
    const o = d.order;
    const c = d.company;

    const isOkleyka = /оклейка|ppf/i.test(o['Услуга'] || '');
    const prefix    = isOkleyka ? '04/01' : '12/01';
    const contract  = o['Номер договора'] || prefix + '-???';

    const companyName = c['company_name'] || 'ИП Иванов И.И.';
    const companyUnp  = c['unp'] || '';
    const companyAddr = c['address'] || '';
    const companyPhone= c['phone'] || '';

    const clientName  = o['Клиент']   || '___________________';
    const clientPhone = o['Телефон']  || '';
    const carModel    = o['Авто']     || '___________________';
    const carPlate    = o['Госномер'] || '___________________';
    const vin         = o['VIN']      || '';
    const price       = Number(o['Стоимость заказа']) || 0;
    // Способ оплаты в договоре — по согласованным УСЛОВИЯМ (Тип оплаты),
    // с откатом на legacy «Безнал» для старых заказов.
    let payType = String(o['Тип оплаты'] || '').trim();
    if (!payType) {
      const bz = String(o['Безнал'] || '').trim();
      payType = bz === 'Да' ? 'Безнал' : bz === 'Нет' ? 'Нал' : '';
    }
    const date        = o['Дата'] || formatToday_();

    // Материалы (только расход)
    const matRows = d.materials.filter(function(m){ return m['Тип'] === 'расход'; });

    let matHtml = '';
    matRows.forEach(function(m, i) {
      const qty  = Number(m['Кол-во']) || 0;
      const unit = m['Единица'] || 'пм';
      const qSqm = Number(m['Кол-во м²']) || 0;
      const cost = Number(m['Стоимость']) || 0;
      matHtml += '<tr><td>' + (i+1) + '</td><td>' + (m['Название']||'') + '</td>' +
        '<td>' + qty + ' ' + unit + (unit==='пм' ? ' ('+qSqm+' м²)' : '') + '</td>' +
        '<td style="text-align:right">' + cost.toFixed(2) + ' Br</td></tr>';
    });

    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<title>Договор ' + contract + '</title>' +
      '<style>body{font-family:Arial,sans-serif;font-size:12px;margin:20mm 15mm;color:#000}' +
      'h2{text-align:center;font-size:14px}h3{font-size:12px}' +
      'table{width:100%;border-collapse:collapse;margin:8px 0}' +
      'td,th{border:1px solid #999;padding:4px 6px}th{background:#f0f0f0}' +
      '.sign{display:inline-block;width:45%;vertical-align:top}' +
      '.sign-line{border-bottom:1px solid #000;margin:30px 0 4px;min-width:200px}' +
      '@media print{button{display:none}}' +
      '</style></head><body>' +
      '<div style="text-align:right;margin-bottom:8px">' +
        '<button onclick="window.print()" style="padding:6px 16px;cursor:pointer">Распечатать</button>' +
      '</div>' +
      '<h2>ДОГОВОР ' + (isOkleyka ? 'НА ОКАЗАНИЕ УСЛУГ ПО ОКЛЕЙКЕ' : 'НА ОКАЗАНИЕ УСЛУГ ПО ТОНИРОВКЕ') + '</h2>' +
      '<h2>№ ' + contract + '</h2>' +
      '<p style="text-align:right">г. Минск, ' + date + '</p>' +
      '<p><b>' + companyName + '</b>' + (companyUnp ? ', УНП ' + companyUnp : '') +
        ', именуемый в дальнейшем «Исполнитель», с одной стороны, и ' +
        '<b>' + clientName + '</b>' + (clientPhone ? ' (тел. ' + clientPhone + ')' : '') +
        ', именуемый в дальнейшем «Заказчик», с другой стороны, заключили настоящий договор о нижеследующем:</p>' +
      '<h3>1. ПРЕДМЕТ ДОГОВОРА</h3>' +
      '<p>Исполнитель обязуется выполнить работы по ' + (isOkleyka ? 'оклейке защитной плёнкой' : 'тонировке стёкол') +
        ' автомобиля <b>' + carModel + '</b>, гос. номер <b>' + carPlate + '</b>' +
        (vin ? ', VIN: ' + vin : '') + '.</p>' +
      (matRows.length ? '<h3>1.1. Используемые материалы</h3>' +
        '<table><thead><tr><th>#</th><th>Материал</th><th>Количество</th><th>Стоимость</th></tr></thead>' +
        '<tbody>' + matHtml + '</tbody></table>' : '') +
      '<h3>2. СТОИМОСТЬ И ПОРЯДОК ОПЛАТЫ</h3>' +
      '<p>Стоимость работ составляет <b>' + price.toFixed(2) + ' ('+numToWords_(price)+') белорусских рублей</b>.' +
        (payType === 'Безнал'    ? ' Оплата производится безналичным расчётом на расчётный счёт Исполнителя.' :
         payType === 'Нал'       ? ' Оплата производится наличными денежными средствами в кассу Исполнителя.' :
         payType === 'Рассрочка' ? ' Оплата производится в рассрочку согласно согласованному графику платежей.' :
         payType === 'Отсрочка'  ? ' Оплата производится с отсрочкой платежа в согласованный сторонами срок.' :
         ' Оплата производится в течение 3 рабочих дней с момента подписания акта выполненных работ.') + '</p>' +
      '<h3>3. СРОКИ ВЫПОЛНЕНИЯ РАБОТ</h3>' +
      '<p>Срок выполнения работ согласовывается с Заказчиком в индивидуальном порядке.</p>' +
      '<h3>4. ГАРАНТИИ</h3>' +
      '<p>Исполнитель предоставляет гарантию на выполненные работы сроком <b>12 месяцев</b> со дня подписания акта.</p>' +
      '<h3>5. РЕКВИЗИТЫ И ПОДПИСИ</h3>' +
      '<div style="display:flex;justify-content:space-between;margin-top:20px">' +
        '<div class="sign"><b>Исполнитель:</b><br>' + companyName + '<br>' +
          (companyUnp ? 'УНП: ' + companyUnp + '<br>' : '') +
          (companyAddr ? companyAddr + '<br>' : '') +
          (companyPhone ? 'Тел: ' + companyPhone : '') +
          '<div class="sign-line"></div><small>подпись / расшифровка</small></div>' +
        '<div class="sign"><b>Заказчик:</b><br>' + clientName + '<br>' +
          (clientPhone ? 'Тел: ' + clientPhone : '') +
          '<div class="sign-line"></div><small>подпись / расшифровка</small></div>' +
      '</div>' +
      '</body></html>';

    return html;
  });
}

/**
 * Генерировать HTML заказ-наряда.
 */
function generateOrderNaradHtml(orderId) {
  return safeCall(function() {
    const resp = getOrderForDocument(orderId);
    if (!resp.ok) throw new Error(resp.error);
    const d = resp.data;
    const o = d.order;
    const c = d.company;

    const companyName  = c['company_name'] || 'СПРauto';
    const contract     = o['Номер договора'] || '';
    const date         = o['Дата'] || formatToday_();
    const clientName   = o['Клиент']   || '';
    const clientPhone  = o['Телефон']  || '';
    const carModel     = o['Авто']     || '';
    const carPlate     = o['Госномер'] || '';
    const service      = o['Услуга']   || '';
    const price        = Number(o['Стоимость заказа']) || 0;
    const manager      = o['Менеджер'] || '';
    const masters      = o['Оклейщики'] || '';
    const gross        = Number(o['Валовая прибыль']) || 0;
    const matCost      = Number(o['Итого материалы']) || 0;
    const expCost      = Number(o['Итого расходы'])   || 0;

    const matRows = d.materials;
    let matHtml = '';
    matRows.forEach(function(m, i) {
      const qty  = Number(m['Кол-во']) || 0;
      const unit = m['Единица'] || '';
      const qSqm = Number(m['Кол-во м²']) || 0;
      const cost = Number(m['Стоимость']) || 0;
      const type = m['Тип'] || '';
      matHtml += '<tr style="' + (type==='остаток'?'color:#999':'') + '">' +
        '<td>' + (i+1) + '</td>' +
        '<td>' + (m['Название']||'') + '</td>' +
        '<td style="text-align:center">' + qty + ' ' + unit + '</td>' +
        '<td style="text-align:center">' + (unit==='пм' ? qSqm.toFixed(2) : qty) + ' м²</td>' +
        '<td style="text-align:center">' + (Number(m['Цена за м²'])||0).toFixed(2) + '</td>' +
        '<td style="text-align:right;font-weight:' + (type==='расход'?'bold':'normal') + '">' +
          (type==='остаток' ? 'остаток' : cost.toFixed(2) + ' Br') + '</td>' +
        '</tr>';
    });

    const expRows = d.expenses;
    let expHtml = '';
    expRows.forEach(function(e) {
      expHtml += '<tr><td>' + (e['Название']||'') + '</td>' +
        '<td style="text-align:right">' + (Number(e['Сумма'])||0).toFixed(2) + ' Br</td></tr>';
    });

    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<title>Заказ-наряд ' + contract + '</title>' +
      '<style>body{font-family:Arial,sans-serif;font-size:11px;margin:15mm 10mm;color:#000}' +
      'h2{text-align:center;font-size:13px;margin:4px 0}h3{font-size:11px;margin:8px 0 4px;border-bottom:1px solid #ccc;padding-bottom:2px}' +
      'table{width:100%;border-collapse:collapse;margin:4px 0}' +
      'td,th{border:1px solid #bbb;padding:3px 5px}th{background:#f5f5f5;font-size:10px}' +
      '.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin:6px 0}' +
      '.info-row{display:flex;gap:6px;font-size:11px}.info-label{color:#555;min-width:90px}' +
      '.fin-row{display:flex;justify-content:space-between;padding:2px 0;font-size:11px}' +
      '.fin-total{font-weight:bold;border-top:1px solid #000;padding-top:4px}' +
      '.sign-area{display:flex;justify-content:space-between;margin-top:16px}' +
      '.sign-box{width:45%}.sign-line{border-bottom:1px solid #000;margin:20px 0 3px}' +
      '@media print{.no-print{display:none}}</style>' +
      '</head><body>' +
      '<div class="no-print" style="margin-bottom:8px">' +
        '<button onclick="window.print()" style="padding:6px 16px;cursor:pointer;margin-right:8px">Распечатать</button>' +
        '<button onclick="window.close()" style="padding:6px 16px;cursor:pointer">Закрыть</button>' +
      '</div>' +
      '<h2>' + companyName.toUpperCase() + '</h2>' +
      '<h2>ЗАКАЗ-НАРЯД № ' + contract + '</h2>' +
      '<p style="text-align:right;margin:2px 0">Дата: ' + date + '</p>' +

      '<h3>Клиент и автомобиль</h3>' +
      '<div class="info-grid">' +
        infoRow_('Клиент:', clientName) +
        infoRow_('Телефон:', clientPhone) +
        infoRow_('Автомобиль:', carModel) +
        infoRow_('Госномер:', carPlate) +
        infoRow_('Услуга:', service) +
        infoRow_('Менеджер:', manager) +
        infoRow_('Мастер(а):', masters) +
      '</div>' +

      '<h3>Расход материалов</h3>' +
      (matRows.length ?
        '<table><thead><tr><th>#</th><th>Материал</th><th>Кол-во</th><th>м²</th><th>Цена/м²</th><th>Стоимость</th></tr></thead>' +
        '<tbody>' + matHtml + '</tbody></table>' :
        '<p style="color:#999">Материалы не указаны</p>') +

      (expRows.length ?
        '<h3>Дополнительные расходы</h3>' +
        '<table><thead><tr><th>Статья</th><th style="text-align:right">Сумма</th></tr></thead>' +
        '<tbody>' + expHtml + '</tbody></table>' : '') +

      '<h3>Финансовый итог</h3>' +
      '<div style="max-width:280px;margin-left:auto">' +
        finRow_('Стоимость работ:', price.toFixed(2) + ' Br') +
        finRow_('Материалы:', matCost.toFixed(2) + ' Br') +
        finRow_('Расходы:', expCost.toFixed(2) + ' Br') +
        finRow_('Валовая прибыль:', gross.toFixed(2) + ' Br', true) +
      '</div>' +

      '<div class="sign-area">' +
        '<div class="sign-box"><b>Исполнитель:</b>' +
          '<div class="sign-line"></div><small>подпись / ' + (manager||'__________') + '</small></div>' +
        '<div class="sign-box"><b>Заказчик:</b>' +
          '<div class="sign-line"></div><small>подпись / ' + (clientName||'__________') + '</small></div>' +
      '</div>' +
      '</body></html>';

    return html;
  });
}

function infoRow_(label, value) {
  return '<div class="info-row"><span class="info-label">' + label + '</span><span><b>' + (value||'—') + '</b></span></div>';
}

function finRow_(label, value, bold) {
  return '<div class="fin-row' + (bold?' fin-total':'') + '"><span>' + label + '</span><span>' + value + '</span></div>';
}

function formatToday_() {
  const d = new Date();
  return ('0'+d.getDate()).slice(-2) + '.' + ('0'+(d.getMonth()+1)).slice(-2) + '.' + d.getFullYear();
}

// ════════════════════════════════════════════════════════════════════════════
//  ДВИЖОК ДОКУМЕНТОВ (плейсхолдеры {{...}} → данные заказа, white-label)
// ════════════════════════════════════════════════════════════════════════════

/** Собрать данные для документа: заказ + клиент + реквизиты компании + материалы. */
function getDocData_(orderId) {
  var orders = readSheetAsObjects('DATABASE', 'ORDERS');
  var order = null;
  for (var i = 0; i < orders.length; i++) {
    if (String(orders[i]['ID']) === String(orderId)) { order = orders[i]; break; }
  }
  if (!order) throw new Error('Заказ не найден: ' + orderId);

  var materials = readSheetAsObjects('DATABASE', 'ORDER_MATERIALS')
    .filter(function(r){ return String(r['Заказ ID']) === String(orderId) && r['Тип'] === 'расход'; });

  var client = {};
  if (order['Клиент ID']) {
    var cs = readSheetAsObjects('DATABASE', 'CLIENTS');
    for (var k = 0; k < cs.length; k++) {
      if (String(cs[k]['ID']) === String(order['Клиент ID'])) { client = cs[k]; break; }
    }
  }
  // Реквизиты компании — позиционным чтением (ключ→значение), надёжно
  var sResp = getSettings();
  var company = (sResp && sResp.ok) ? sResp.data : {};
  return { order: order, client: client, company: company, materials: materials };
}

/** Фамилия + инициалы: «Иванов Иван Иванович» → «Иванов И.И.» */
function surnameInitials_(fio) {
  var p = String(fio || '').trim().split(/\s+/);
  if (!p[0]) return fio || '';
  var s = p[0];
  if (p[1]) s += ' ' + p[1].charAt(0).toUpperCase() + '.';
  if (p[2]) s += p[2].charAt(0).toUpperCase() + '.';
  return s;
}

/** Дата прописью: «02.04.2026» → «02 апреля 2026 г.» */
function dateLong_(dateStr) {
  var m = String(dateStr || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  var d = m ? new Date(+m[3], +m[2] - 1, +m[1]) : new Date();
  var months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return ('0' + d.getDate()).slice(-2) + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ' г.';
}

/** Приблизительное склонение ФИО в родительный падеж (с ручной правкой как fallback). */
function genitiveFio_(fio) {
  var p = String(fio || '').trim().split(/\s+/);
  if (!p[0]) return fio || '';
  var last = p[0], first = p[1] || '', patr = p[2] || '';
  var female = /(вна|чна)$/i.test(patr) || /(ова|ева|ина|ская|ая)$/i.test(last);
  function gl(s){ if(!s) return s;
    if(female){ if(/(ова|ева|ина)$/i.test(s)) return s+'ой'.slice(0); // Иванова→Ивановой
      if(/ская$/i.test(s)) return s.slice(0,-2)+'ой'; if(/ая$/i.test(s)) return s.slice(0,-2)+'ой';
      return s; }
    if(/(ов|ев|ин|ын)$/i.test(s)) return s+'а';
    if(/(ий|ый|ой)$/i.test(s)) return s.slice(0,-2)+'ого';
    if(/[бвгджзйклмнпрстфхцчшщ]$/i.test(s)) return s+'а';
    if(/я$/i.test(s)) return s.slice(0,-1)+'и'; if(/а$/i.test(s)) return s.slice(0,-1)+'ы';
    return s; }
  function gf(s){ if(!s) return s;
    if(female){ if(/я$/i.test(s)) return s.slice(0,-1)+'и'; if(/а$/i.test(s)) return s.slice(0,-1)+'ы'; return s; }
    if(/й$/i.test(s)) return s.slice(0,-1)+'я'; if(/я$/i.test(s)) return s.slice(0,-1)+'и';
    if(/а$/i.test(s)) return s.slice(0,-1)+'ы'; if(/ь$/i.test(s)) return s.slice(0,-1)+'я';
    if(/[бвгджзклмнпрстфхцчшщ]$/i.test(s)) return s+'а'; return s; }
  function gp(s){ if(!s) return s;
    if(female){ if(/на$/i.test(s)) return s.slice(0,-2)+'ны'; return s; }
    if(/ич$/i.test(s)) return s+'а'; return s; }
  return [gl(last), gf(first), gp(patr)].filter(Boolean).join(' ');
}

/** Карта подстановок {{...}} → значение. Реквизиты — из настроек, дефолт «САНПРОТЕКТ». */
function buildDocPlaceholders_(d) {
  var o = d.order, c = d.client, co = d.company;
  var fio   = o['Клиент'] || c['ФИО'] || c['Название организации'] || '';
  var price = Number(o['Стоимость заказа']) || 0;
  var auto  = String(o['Авто'] || '').trim();
  var marka = auto.split(/\s+/)[0] || '';
  var model = auto.split(/\s+/).slice(1).join(' ');
  var film  = (d.materials[0] || {})['Название'] || '';
  var usedFilm = d.materials.reduce(function(s, m){ return s + (Number(m['Кол-во']) || 0); }, 0);
  var get = function(k, def){ return (co[k] != null && co[k] !== '') ? co[k] : def; };
  return {
    'Номер договора':  o['Номер договора'] || '',
    'Дата':            o['Дата'] || formatToday_(),
    'Дата прописью':   dateLong_(o['Дата']),
    'Дата выдачи авто': o['Дата выполнения'] || '',
    'Начало выполнения работ': o['Дата'] || formatToday_(),
    'ФИО':             fio,
    'Фамилия И.О.':    surnameInitials_(fio),
    'ФИО род.':        c['ФИО род.'] || c['ФИО родительный'] || genitiveFio_(fio),
    'Паспорт':         c['Паспорт'] || '',
    'Марка авто':      marka,
    'Модель':          model,
    'Гос.номер':       o['Госномер'] || '',
    'VIN':             o['VIN'] || '',
    'Год выпуска':     o['Год выпуска'] || c['Год выпуска'] || '',
    'Пробег':          o['Пробег'] || '',
    'Пленка':          film,
    'Светопр-ть':      o['Светопропускаемость'] || '',
    'Использовано пленки': usedFilm || '',
    'Элементы для оклейки': o['Элементы'] || o['Услуга'] || '',
    'Сумма':           price.toFixed(2),
    'Сумма прописью':  numToWords_(price),
    'Стоимость работ': price.toFixed(2),
    'Стоимость работ прописью': numToWords_(price),
    // Реквизиты Исполнителя (white-label; дефолт — реальные данные САНПРОТЕКТ)
    'Компания':   get('company_name', 'Общество с ограниченной ответственностью «САНПРОТЕКТ»'),
    'УНП':        get('unp', '391413250'),
    'Юр.адрес':   get('legal_address', '223043, Минская обл., Минский р-н, Папернянский с/с, д. Цнянка, ул. Дзержинского, 44'),
    'Почт.адрес': get('postal_address', '220138, а/я 35, г. Минск'),
    'Р/с':        get('bank_account', 'BY87BLNB30120000490087000933'),
    'Банк':       get('bank_name', "ОАО «БНБ-БАНК», код BLNBBY2X"),
    'Директор':   get('director', 'Котляров И.В.'),
    'Директор род.': genitiveFio_(get('director', 'Котляров И.В.')),
    'Гарантия мес': get('warranty_months', '120'),
    'Телефон':    get('phone', '+375172525569, +375291090001'),
  };
}

/** Заменить {{плейсхолдеры}}; отсутствующие → линия для ручного заполнения. */
function fillTemplate_(html, map) {
  return html.replace(/\{\{\s*([^}]+?)\s*\}\}/g, function(_, key) {
    var v = map[key.trim()];
    return (v === undefined || v === null || v === '') ? '<span class="blank"></span>' : String(v);
  });
}

/** Обёртка печатного документа: общий CSS + кнопка «Печать». */
function docWrap_(title, bodyHtml) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + title + '</title><style>' +
    'body{font-family:"Times New Roman",serif;font-size:12.5px;line-height:1.4;color:#000;margin:18mm 16mm}' +
    'h2{text-align:center;font-size:14px;margin:4px 0}h3{font-size:12.5px;margin:10px 0 4px}' +
    'table{width:100%;border-collapse:collapse;margin:6px 0}td,th{border:1px solid #000;padding:4px 6px;font-size:11.5px;vertical-align:top}th{background:#eee}' +
    '.blank{display:inline-block;min-width:130px;border-bottom:1px solid #000}' +
    '.right{text-align:right}.center{text-align:center}.muted{font-size:10px;color:#444}' +
    '.sign{display:flex;justify-content:space-between;margin-top:24px}.sign-line{display:inline-block;min-width:180px;border-bottom:1px solid #000}' +
    '.page-break{page-break-before:always}.bar{display:flex;justify-content:space-between}' +
    '@media print{.noprint{display:none}}' +
    '</style></head><body>' +
    '<div class="noprint" style="text-align:right;margin-bottom:8px"><button onclick="window.print()" style="padding:8px 20px;font-size:13px;cursor:pointer">🖨 Распечатать</button></div>' +
    bodyHtml + '</body></html>';
}

/** Шаблон: ДОГОВОР + Протокол согласования цены + Акт выполненных работ (САНПРОТЕКТ). */
function contractTemplateHtml_() {
  return `
  <h2>ДОГОВОР № {{Номер договора}}</h2>
  <div class="bar"><span>г. Минск</span><span>{{Дата прописью}}</span></div>
  <p>{{Компания}}, именуемое в дальнейшем «Исполнитель», в лице директора {{Директор род.}}, действующего на основании Устава, с одной стороны, и <b>{{ФИО}}</b>, паспорт серии {{Паспорт}}, именуемый в дальнейшем «Заказчик», заключили настоящий договор о нижеследующем:</p>

  <h3>1. Предмет договора</h3>
  <p>1.1. Исполнитель по настоящему договору обязуется выполнить работы по установке плёнки {{Пленка}} {{Светопр-ть}} на автомобиль {{Марка авто}} {{Модель}}, гос. номер {{Гос.номер}}, VIN {{VIN}}, а Заказчик обязуется принять результат выполненных работ и оплатить их стоимость.</p>
  <p>1.2. Сроки выполнения работ:<br>начало выполнения работ: {{Дата}} г.<br>окончание выполнения работ: {{Дата выдачи авто}} г.</p>

  <h3>2. Цена договора</h3>
  <p>2.1. Цена выполненных работ согласовывается сторонами в Протоколе согласования цены.</p>
  <p>2.2. Стоимость работ по настоящему договору составляет <b>{{Сумма}} руб. 00 коп.</b> ({{Сумма прописью}}).</p>
  <p>2.3. Цена договора, предусмотренная п.2.2., является предварительной и может быть изменена в ходе выполнения работ в связи с изменением объёма производимых работ. Окончательная стоимость выполненных работ отражается в Акте приёма-передачи выполненных работ, который является неотъемлемой частью настоящего договора.</p>

  <h3>3. Права и обязанности сторон</h3>
  <p>3.1. Исполнитель обязуется:</p>
  <p>3.1.1. Выполнить работы с надлежащим качеством в сроки, предусмотренные п.1.2. настоящего Договора, и сдать их результат Заказчику с одновременным подписанием Акта сдачи-приёмки выполненных работ.</p>
  <p>3.1.2. Выполнить работы, предусмотренные п.1.1. настоящего договора, используя материал Исполнителя. Количество материала отражается в Протоколе согласования цены и согласовывается сторонами до начала выполнения работ.</p>
  <p>3.2. Заказчик обязуется:</p>
  <p>3.2.1. Произвести оплату 50% стоимости до начала работ, а оставшуюся часть в момент подписания Акта сдачи-приёмки выполненных работ путём передачи наличных денег уполномоченному представителю Исполнителя, с одновременным оформлением бланка строгой отчётности, второй экземпляр которого передаётся Заказчику.</p>

  <h3>4. Ответственность сторон</h3>
  <p>4.1. За ненадлежащее исполнение своих обязательств по настоящему договору стороны несут ответственность в соответствии с действующим законодательством Республики Беларусь.</p>

  <h3>5. Гарантийное обслуживание</h3>
  <p>5.1. Срок гарантийного обслуживания на результаты выполненных по настоящему договору работ составляет {{Гарантия мес}} месяцев с даты подписания Акта приёмки-сдачи выполненных работ.</p>
  <p>5.2. В случае обнаружения недостатков в результатах выполненной работы в течение гарантийного срока Заказчик вправе требовать от Исполнителя безвозмездного их устранения в сроки, согласованные с Заказчиком.</p>

  <h3>6. Порядок разрешения споров</h3>
  <p>6.1. Все споры, возникающие из настоящего договора, разрешаются Сторонами в порядке переговоров. В случае невозможности — спор передаётся на рассмотрение в судебные инстанции в порядке, установленном действующим законодательством.</p>

  <h3>7. Срок действия договора</h3>
  <p>7.1. Настоящий договор вступает в силу с момента его подписания и действует до полного исполнения сторонами принятых на себя обязательств.</p>

  <h3>8. Заключительные положения</h3>
  <p>8.1. Настоящий договор составлен в двух экземплярах, имеющих одинаковую юридическую силу, по одному для каждой из сторон.</p>

  <h3>9. Адреса, банковские реквизиты и подписи сторон</h3>
  <table><tr>
    <td style="width:50%"><b>Исполнитель:</b><br>{{Компания}}<br>УНП: {{УНП}}<br>Р/сч: {{Р/с}} в {{Банк}}<br>Юр. адрес: {{Юр.адрес}}<br>Почтовый адрес: {{Почт.адрес}}<br>Тел./факс: {{Телефон}}<br><br>Директор _____________ {{Директор}}<br>М.П.</td>
    <td style="width:50%"><b>Заказчик:</b><br>{{ФИО}}<br>Паспорт: {{Паспорт}}<br><br><br><br>_____________ / {{Фамилия И.О.}}</td>
  </tr></table>

  <!-- ПРОТОКОЛ СОГЛАСОВАНИЯ ЦЕНЫ -->
  <div class="page-break"></div>
  <h2>Протокол согласования цены</h2>
  <p>от «{{Дата}}» г. к договору № {{Номер договора}} от {{Дата}} г. между {{Компания}} и {{ФИО}}.</p>
  <table>
    <thead><tr><th>№ п/п</th><th>Наименование услуги</th><th>Количество</th><th>Цена, руб. (с НДС)</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>{{Элементы для оклейки}}</td><td>{{Использовано пленки}}</td><td class="right">{{Сумма}} р.</td></tr>
    </tbody>
  </table>
  <p>Внесена предоплата за услуги: {{Сумма прописью}}</p>
  <div class="sign"><span>Директор ___________ {{Директор}}</span><span>Заказчик ___________ / {{Фамилия И.О.}}</span></div>

  <!-- АКТ ВЫПОЛНЕННЫХ РАБОТ -->
  <div class="page-break"></div>
  <h2>АКТ ВЫПОЛНЕННЫХ РАБОТ</h2>
  <div class="bar"><span>г. Минск</span><span>{{Дата выдачи авто}}</span></div>
  <p>{{Компания}} в лице директора {{Директор род.}}, именуемое в дальнейшем «Исполнитель», с одной стороны, и <b>{{ФИО}}</b>, именуемый в дальнейшем «Заказчик», с другой стороны, составили настоящий акт о том, что в соответствии с условиями договора № {{Номер договора}} от {{Дата}} г. Исполнитель выполнил следующую работу: установка плёнки {{Пленка}} {{Светопр-ть}} на автомобиль {{Марка авто}} {{Модель}}, VIN {{VIN}}.</p>
  <p>Сроки проведения работ: {{Дата выдачи авто}}.</p>
  <p>Работа выполнена в полном объёме. Заказчик к качеству и объёму работ претензий не имеет.</p>
  <p>Стоимость выполненных работ составляет: <b>{{Сумма}} руб. 00 коп.</b></p>
  <div class="sign"><span>Исполнитель _____________ / {{Директор}}</span><span>Заказчик _____________ / {{Фамилия И.О.}}</span></div>
  `;
}

function numToWords_(n) {
  // Упрощённый вариант для целых рублей
  const int = Math.floor(n);
  const dec = Math.round((n - int) * 100);
  const units = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять'];
  const tens  = ['','десять','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
  const hunds = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
  const teens = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
  const thous = ['','одна тысяча','две тысячи','три тысячи','четыре тысячи'];

  if (int === 0) return 'ноль';
  let result = '';
  const th = Math.floor(int / 1000);
  const rem = int % 1000;
  if (th > 0 && th < 5) result += thous[th] + ' ';
  else if (th >= 5) result += units[th] + ' тысяч ';
  const h = Math.floor(rem / 100);
  const t = Math.floor((rem % 100) / 10);
  const u = rem % 10;
  if (h) result += hunds[h] + ' ';
  if (t === 1) { result += teens[u] + ' '; }
  else { if (t) result += tens[t] + ' '; if (u) result += units[u] + ' '; }
  return result.trim() + (dec > 0 ? ' ' + dec + ' коп.' : '');
}
