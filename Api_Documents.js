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
