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
function generateContractHtml(orderId, service) {
  return safeCall(function() {
    var d = getDocData_(orderId);
    var map = buildDocPlaceholders_(d, service);
    var isLegal = String(d.client['Тип'] || '') === 'юр' || String(d.order['_clientType'] || '') === 'юр';
    var byProxy = isLegal && String(d.order['Подписант'] || '').trim() !== '';
    var body = fillTemplate_(contractTemplateHtml_(isLegal, byProxy), map);
    // Блок рассрочки (график платежей) — вставляем в готовый текст вместо токена (пусто, если не рассрочка)
    body = body.replace('<!--RASSROCHKA_BLOCK-->', map['_rassrochkaBlock'] || '');
    return docWrap_('Договор ' + (map['Номер договора'] || '') + docSvcSuffix_(service), body, map['Логотип'], true);
  });
}

/** Отдельный Акт выполненных работ (без договора) — для закрытия заказа. */
function generateActHtml(orderId, service) {
  return safeCall(function() {
    var d = getDocData_(orderId);
    var map = buildDocPlaceholders_(d, service);
    var isLegal = String(d.client['Тип'] || '') === 'юр' || String(d.order['_clientType'] || '') === 'юр';
    var byProxy = isLegal && String(d.order['Подписант'] || '').trim() !== '';
    var body = fillTemplate_(actBodyHtml_(isLegal, byProxy, false), map);
    return docWrap_('Акт ' + (map['Номер договора'] || '') + docSvcSuffix_(service), body, map['Логотип'], true);
  });
}

/** Суффикс названия документа по услуге (для отдельных документов мультиуслуги). */
function docSvcSuffix_(service) {
  if (service === 'tint') return ' · Тонировка';
  if (service === 'wrap') return ' · Оклейка';
  return '';
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
function generateOrderNaradHtml(orderId, service) {
  return safeCall(function() {
    var d = getDocData_(orderId);
    var map = buildDocPlaceholders_(d, service);
    var tintPrice = Number(d.order['Стоимость тонировки']) || 0;
    var fullPrice = Number(d.order['Стоимость заказа']) || 0;
    var isTint, price;
    if (service === 'tint')      { isTint = true;  price = tintPrice > 0 ? tintPrice : fullPrice; }
    else if (service === 'wrap') { isTint = false; price = tintPrice > 0 ? Math.max(0, fullPrice - tintPrice) : fullPrice; }
    else                         { isTint = /тонир|tint/i.test(d.order['Услуга'] || ''); price = fullPrice; }
    var esc = function(s){ return String(s == null ? '' : s).replace(/"/g, '&quot;'); };

    // Плёнка (расход) — редактируемые строки
    var films = d.materials.filter(function(m){ return String(m['Тип']||'расход') === 'расход'; });
    if (!films.length) films = [{ 'Название':'', 'Кол-во':0, 'Цена за м²':0 }];
    var filmRows = films.map(function(m){
      var qty = Number(m['Кол-во'])||0, pr = Number(m['Цена за м²'])||0;
      return '<tr class="nf-film"><td>' + (m['Название']||'') + '</td><td class="center">пог. м</td>' +
        '<td class="right"><input class="de nf-q" value="' + qty + '"></td>' +
        '<td class="right"><input class="de nf-p" value="' + pr + '"></td>' +
        '<td class="right nf-c">' + (Math.round(qty*pr*100)/100).toFixed(2) + '</td></tr>';
    }).join('');
    var rashCost = d.expenses.reduce(function(s,e){ return s + (Number(e['Сумма'])||0); }, 0);

    var works = isTint
      ? '<tr><td>1</td><td>Установка тонировочной плёнки</td><td class="center">да</td><td></td></tr>' +
        '<tr><td>2</td><td>Разборка на элементы, сборка автомобиля</td><td></td><td></td></tr>' +
        '<tr><td>3</td><td>Мойка, сушка автомобиля</td><td></td><td></td></tr>'
      : '<tr><td>1</td><td>Оклейка антигравийной плёнкой: ' + (map['Элементы для оклейки']||'') + '</td><td class="center">да</td><td></td></tr>' +
        '<tr><td>2</td><td>Разборка на элементы оклейки</td><td></td><td></td></tr>' +
        '<tr><td>3</td><td>Сборка автомобиля</td><td></td><td></td></tr>' +
        '<tr><td>4</td><td>Мойка, сушка автомобиля</td><td></td><td></td></tr>' +
        '<tr><td>5</td><td>Полировка элементов кузова</td><td></td><td></td></tr>';

    var body =
      '<div class="editbar noprint">✎ Поля можно поправить прямо здесь — «Работ», «Материалов» и «Всего» пересчитаются сами. Затем нажмите «Распечатать».</div>' +
      '<div class="muted">' + map['Компания'] + '<br>УНП: ' + map['УНП'] + ' · ' + map['Юр.адрес'] + '<br>(наименование и местонахождение исполнителя)</div>' +
      '<div class="bar" style="margin-top:6px"><span></span><span>' + (map['Дата ru']||'') + '</span></div>' +
      '<h2>ЗАКАЗ-НАРЯД ' + (map['Номер договора']? '№ '+map['Номер договора'] : '') + '</h2>' +
      '<p><b>Заказчик:</b> ' + map['ФИО'] + ', паспорт ' + (map['Паспорт']||'____') + '</p>' +
      '<h3>1. Общие сведения</h3>' +
      '<table>' +
        '<tr><th style="width:38%">Владелец автомобиля</th><td>' + map['ФИО'] + '</td></tr>' +
        '<tr><th>Марка автомобиля</th><td>' + map['Марка авто'] + '</td></tr>' +
        '<tr><th>Модель</th><td>' + map['Модель'] + '</td></tr>' +
        '<tr><th>Регистрационный номер</th><td>' + map['Гос.номер'] + '</td></tr>' +
        '<tr><th>VIN либо номер кузова</th><td>' + map['VIN'] + '</td></tr>' +
        '<tr><th>Год выпуска</th><td>' + map['Год выпуска'] + '</td></tr>' +
        (isTint ? '' : '<tr><th>Пробег</th><td>' + map['Пробег'] + '</td></tr>') +
      '</table>' +
      '<h3>2. Выполненные работы</h3>' +
      '<table><thead><tr><th style="width:34px">№</th><th>Наименование</th><th style="width:120px">Норматив времени, ДА/НЕТ</th><th style="width:96px">руб.</th></tr></thead><tbody>' +
        works +
        '<tr><td colspan="3" class="right"><b>Итого стоимость работ</b></td><td class="right"><b><span id="nf-works">0</span></b></td></tr>' +
      '</tbody></table>' +
      '<h3>3. Материалы исполнителя, оплачиваемые заказчиком</h3>' +
      '<table><thead><tr><th>Наименование</th><th style="width:70px">Ед. изм.</th><th style="width:74px">Кол-во</th><th style="width:80px">Цена, руб.</th><th style="width:96px">Стоимость, руб.</th></tr></thead><tbody>' +
        filmRows +
        '<tr><td>Расходные материалы, инструменты</td><td class="center">—</td><td></td><td></td><td class="right"><input class="de" id="nf-rash" value="' + (Math.round(rashCost*100)/100) + '"></td></tr>' +
        '<tr><td colspan="4" class="right"><b>Итого материалов</b></td><td class="right"><b><span id="nf-mat">0</span></b></td></tr>' +
      '</tbody></table>' +
      '<table style="margin-top:8px"><tr><th style="width:25%">Стоимость работ</th><th style="width:25%">Материалов</th><th style="width:25%">Всего к оплате</th><th>НДС</th></tr>' +
      '<tr><td class="right"><span id="nf-works2">0</span> р.</td><td class="right"><span id="nf-mat2">0</span> р.</td>' +
      '<td class="right"><b><input class="de" id="nf-total" value="' + price + '"> р.</b></td><td class="center">Без НДС</td></tr></table>' +
      '<p>Общая стоимость прописью: <b><span id="nf-words"></span></b></p>' +
      '<div class="sign" style="margin-top:12px"><span>Заказ оформил: _____________ / ' + map['Заказ оформил'] + '</span></div>' +
      '<p style="margin-top:14px;font-size:9.5pt">С объёмом и стоимостью заказа согласен, с правилами оказания услуг ознакомлен. Претензий по качеству выполненных работ не имею, автомобиль получил.</p>' +
      '<div class="sign"><span>_____________ / ' + map['Фамилия И.О.'] + '<br><span class="muted">(подпись заказчика)</span></span><span>' + (map['Дата сдачи кратко']||'') + '</span></div>' +
      naradRecalcScript_();

    return docWrap_('Заказ-наряд ' + (map['Номер договора'] || '') + docSvcSuffix_(service), body, map['Логотип'], true);
  });
}

/** Встроенный скрипт пересчёта наряда (выполняется в окне печати). Защита от минусов. */
function naradRecalcScript_() {
  return '<script>' +
    'function n2w(n){n=Math.round(n);' +
    'var o=["","один","два","три","четыре","пять","шесть","семь","восемь","девять","десять","одиннадцать","двенадцать","тринадцать","четырнадцать","пятнадцать","шестнадцать","семнадцать","восемнадцать","девятнадцать"];' +
    'var t=["","","двадцать","тридцать","сорок","пятьдесят","шестьдесят","семьдесят","восемьдесят","девяносто"];' +
    'var h=["","сто","двести","триста","четыреста","пятьсот","шестьсот","семьсот","восемьсот","девятьсот"];' +
    'function tri(n,f){var s="",H=Math.floor(n/100),r=n%100,T=Math.floor(r/10),O=r%10;if(H)s+=h[H]+" ";if(r<20&&r>0){var w=o[r];if(f&&r==1)w="одна";if(f&&r==2)w="две";s+=w+" ";}else{if(T)s+=t[T]+" ";if(O){var w2=o[O];if(f&&O==1)w2="одна";if(f&&O==2)w2="две";s+=w2+" ";}}return s;}' +
    'function pl(n,a){var x=n%10,y=n%100;if(x==1&&y!=11)return a[0];if(x>=2&&x<=4&&(y<10||y>=20))return a[1];return a[2];}' +
    'var M=Math.floor(n/1e6),T2=Math.floor(n%1e6/1e3),R=n%1e3,w="";' +
    'if(M)w+=tri(M,false)+pl(M,["миллион","миллиона","миллионов"])+" ";if(T2)w+=tri(T2,true)+pl(T2,["тысяча","тысячи","тысяч"])+" ";if(R||(!M&&!T2))w+=tri(R,false);' +
    'w=(w.trim()||"ноль");var res=w+" "+pl(n,["рубль","рубля","рублей"])+" 00 копеек";return res.charAt(0).toUpperCase()+res.slice(1);}' +
    'function nrecalc(){var tot=parseFloat((document.getElementById("nf-total")||{}).value)||0;var mat=0;' +
    'document.querySelectorAll(".nf-film").forEach(function(r){var q=parseFloat(r.querySelector(".nf-q").value)||0;var p=parseFloat(r.querySelector(".nf-p").value)||0;var c=Math.round(q*p*100)/100;r.querySelector(".nf-c").textContent=c.toFixed(2);mat+=c;});' +
    'mat+=parseFloat((document.getElementById("nf-rash")||{}).value)||0;' +
    'var matShown=Math.min(mat,tot);var works=Math.max(0,tot-matShown);' +  // защита от минусов (вариант А)
    'function set(id,v){var e=document.getElementById(id);if(e)e.textContent=v;}' +
    'set("nf-mat",matShown.toFixed(2));set("nf-mat2",matShown.toFixed(2));set("nf-works",works.toFixed(2));set("nf-works2",works.toFixed(2));set("nf-words",n2w(tot));}' +
    'document.addEventListener("input",nrecalc);nrecalc();' +
    '</script>';
}

/** Карта работ мастеру (чек-лист комплексов и элементов оклейки). */
function generateWorkCardHtml(orderId) {
  return safeCall(function() {
    var d = getDocData_(orderId);
    var map = buildDocPlaceholders_(d);
    map['Мастера'] = d.order['Оклейщики'] || d.order['Менеджер'] || '';
    var body = fillTemplate_(workCardTemplateHtml_(), map);
    return docWrap_('Карта работ ' + (map['Номер договора'] || ''), body, map['Логотип'], true);
  });
}

function workCardTemplateHtml_() {
  var cb = function(label){ return '<div style="display:inline-block;width:48%;margin:2px 0">☐ ' + label + '</div>'; };
  var extra = ['Полировка','Тонировка','Шумоизоляция','Керамическое покрытие'].map(cb).join('');
  return `
  <h2>КАРТА РАБОТ ПО ОКЛЕЙКЕ АВТОМОБИЛЯ № {{Номер договора}}</h2>
  <table>
    <tr><th style="width:25%">Автомобиль</th><td>{{Марка авто}} {{Модель}}</td><th style="width:18%">Стоимость</th><td>{{Сумма}} руб.</td></tr>
    <tr><th>Мастера</th><td>{{Мастера}}</td><th>Плановая выдача</th><td>{{Дата выдачи авто}}</td></tr>
  </table>

  <h3>Информация об автомобиле и клиенте</h3>
  <table>
    <tr><th style="width:25%">Дата приёма авто</th><td>{{Дата}}</td><th style="width:18%">Гос. номер</th><td>{{Гос.номер}}</td></tr>
    <tr><th>Имя клиента</th><td>{{ФИО}}</td><th>Телефон</th><td>{{Телефон клиента}}</td></tr>
  </table>

  <h3>Выбранный комплекс: {{Комплекс}}</h3>
  <h3>Элементы для оклейки</h3>
  <div style="line-height:1.7">{{Элементы чеклист}}<br>☐ Другое: <span class="blank" style="min-width:300px"></span></div>
  <h3>Дополнительные работы</h3>
  <div>` + extra + `<div style="margin-top:4px">☐ Другое: <span class="blank" style="min-width:300px"></span></div></div>

  <h3>Примечания мастеру</h3>
  <div style="border-bottom:1px solid #000;height:22px;margin:6px 0"></div>
  <div style="border-bottom:1px solid #000;height:22px;margin:6px 0"></div>
  <div style="border-bottom:1px solid #000;height:22px;margin:6px 0"></div>
  `;
}

// (старый генератор заказ-наряда — оставлен как референс, не вызывается)
function generateOrderNaradHtmlLegacy_(orderId) {
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
  var expenses = readSheetAsObjects('DATABASE', 'ORDER_EXPENSES')
    .filter(function(r){ return String(r['Заказ ID']) === String(orderId); });
  // График рассрочки (плановые взносы) — для договора с графиком платежей
  var schedule = [];
  try {
    schedule = readSheetAsObjects('DATABASE', 'SCHEDULE')
      .filter(function(r){ return String(r['Заказ ID']) === String(orderId); })
      .sort(function(a, b){ return (Number(a['№']) || 0) - (Number(b['№']) || 0); });
  } catch (e) { /* лист графика может отсутствовать */ }
  // Реквизиты компании — позиционным чтением (ключ→значение), надёжно
  var sResp = getSettings();
  var company = (sResp && sResp.ok) ? sResp.data : {};
  return { order: order, client: client, company: company, materials: materials, expenses: expenses, schedule: schedule };
}

/**
 * Юридически корректный блок «Порядок оплаты (рассрочка)» с графиком платежей.
 * Вставляется в договор как подпункты раздела 2 (Цена договора).
 * Берёт реальные взносы из графика (SCHEDULE); если графика ещё нет — печатает
 * пустые строки для ручного заполнения (документ редактируемый).
 */
function buildRassrochkaSection_(d, totalPrice) {
  var rows = (d.schedule || []);
  var tableRows = '';
  var sum = 0;
  rows.forEach(function(r, i){
    var n   = r['№'] || (i + 1);
    var dt  = String(r['Дата'] || '').trim();
    var amt = Number(r['Сумма']) || 0;
    sum += amt;
    tableRows += '<tr><td class="center">' + n + '</td><td class="center">' + (dt || '____________') +
      '</td><td class="right">' + amt.toFixed(2) + ' руб.</td><td>' + numToWords_(amt) + '</td></tr>';
  });
  if (!rows.length) {
    for (var i = 0; i < 3; i++) {
      tableRows += '<tr><td class="center">' + (i + 1) +
        '</td><td class="center">____________</td><td class="right">____________</td><td>____________</td></tr>';
    }
  }
  var totalVal = rows.length ? sum : totalPrice;
  return '' +
    '<p>2.4. Оплата стоимости работ, указанной в п.2.2, производится Заказчиком в <b>рассрочку</b> ' +
    'согласно графику платежей, установленному настоящим пунктом. При оплате в рассрочку условия п.3.2.1 ' +
    'настоящего договора о порядке предоплаты не применяются.</p>' +
    '<table><thead><tr><th style="width:70px">№ платежа</th><th style="width:110px">Срок оплаты</th>' +
    '<th style="width:110px">Сумма</th><th>Сумма прописью</th></tr></thead>' +
    '<tbody>' + tableRows + '</tbody>' +
    '<tfoot><tr><td class="right" colspan="2"><b>Итого к оплате:</b></td>' +
    '<td class="right"><b>' + totalVal.toFixed(2) + ' руб.</b></td><td><b>' + numToWords_(totalVal) + '</b></td></tr></tfoot>' +
    '</table>' +
    '<p>2.5. Каждый платёж вносится не позднее даты, указанной в графике. Датой оплаты считается дата ' +
    'поступления денежных средств Исполнителю (в кассу либо на расчётный счёт).</p>' +
    '<p>2.6. Заказчик вправе досрочно погасить оставшуюся сумму полностью или частично без взимания ' +
    'дополнительных комиссий и штрафов.</p>' +
    '<p>2.7. В случае просрочки любого из платежей более чем на 5 (пять) календарных дней Заказчик ' +
    'уплачивает Исполнителю пеню в размере 0,1% от суммы просроченного платежа за каждый день просрочки. ' +
    'При просрочке платежа более чем на 30 (тридцать) календарных дней Исполнитель вправе потребовать ' +
    'досрочной оплаты всей оставшейся суммы по настоящему договору.</p>';
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

/** Дата как в эталоне: «13» января 2026г. */
function dateRu_(dateStr) {
  var m = String(dateStr || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return '«__» __________ ____г.';
  var months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return '«' + m[1] + '» ' + months[(+m[2])-1] + ' ' + m[3] + 'г.';
}
/** Краткая дата как в эталоне: «13» 01. 2026г. */
function dateShort_(dateStr) {
  var m = String(dateStr || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return '«__» __. ____г.';
  return '«' + m[1] + '» ' + m[2] + '. ' + m[3] + 'г.';
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
    // частые имена с беглой гласной / ё→е (правило не выводит автоматически)
    var sp={'Пётр':'Петра','Петр':'Петра','Павел':'Павла','Лев':'Льва','Лёв':'Льва','Карл':'Карла'};
    if(sp[s]) return sp[s];
    if(female){ if(/я$/i.test(s)) return s.slice(0,-1)+'и'; if(/а$/i.test(s)) return s.slice(0,-1)+'ы'; return s; }
    if(/й$/i.test(s)) return s.slice(0,-1)+'я'; if(/я$/i.test(s)) return s.slice(0,-1)+'и';
    if(/а$/i.test(s)) return s.slice(0,-1)+'ы'; if(/ь$/i.test(s)) return s.slice(0,-1)+'я';
    if(/[бвгджзклмнпрстфхцчшщ]$/i.test(s)) return s+'а'; return s; }
  function gp(s){ if(!s) return s;
    if(female){ if(/на$/i.test(s)) return s.slice(0,-2)+'ны'; return s; }
    if(/ич$/i.test(s)) return s+'а'; return s; }
  return [gl(last), gf(first), gp(patr)].filter(Boolean).join(' ');
}

/**
 * Гарантия по типу тонировочной плёнки, месяцев.
 * Nano Ceramic — 120, Carbon — 60. Прочие/неизвестные → 0 (берётся общий срок).
 * Список легко расширить новыми типами плёнок.
 */
function tintWarrantyMonths_(name) {
  var s = String(name || '').toLowerCase();
  if (/nano|ceramic|нано|керам/.test(s)) return 120;
  if (/carbon|карбон/.test(s))           return 60;
  return 0;
}

/** Карта подстановок {{...}} → значение. Реквизиты — из настроек, дефолт «САНПРОТЕКТ». */
function buildDocPlaceholders_(d, serviceMode) {
  var o = d.order, c = d.client, co = d.company;
  var fio   = o['Клиент'] || c['ФИО'] || c['Название организации'] || '';
  var price = Number(o['Стоимость заказа']) || 0;
  var tintPrice = Number(o['Стоимость тонировки']) || 0;
  var auto  = String(o['Авто'] || '').trim();
  var marka = auto.split(/\s+/)[0] || '';
  var model = auto.split(/\s+/).slice(1).join(' ');
  var film  = (d.materials[0] || {})['Название'] || o['Пленка'] || '';
  var usedFilm = d.materials.reduce(function(s, m){ return s + (Number(m['Кол-во']) || 0); }, 0);
  var get = function(k, def){ return (co[k] != null && co[k] !== '') ? co[k] : def; };

  // Тонировка: описание всех плёнок с зоной и процентом (для договора/акта).
  // Пример: «Лобовое стекло — Nano Ceramic 70%, передние боковые — Carbon 20%».
  // Режим услуги (для отдельных документов на мультиуслугу):
  //  'tint' — только тонировка (цена = стоимость тонировки),
  //  'wrap' — только оклейка (цена = остаток без тонировки),
  //  иначе  — по услуге заказа целиком.
  var isTint_;
  if (serviceMode === 'tint')      { isTint_ = true;  price = tintPrice > 0 ? tintPrice : price; }
  else if (serviceMode === 'wrap') { isTint_ = false; if (tintPrice > 0) price = Math.max(0, price - tintPrice); }
  else                             { isTint_ = /тонир|tint/i.test(o['Услуга'] || ''); }
  var tintDesc = '';
  var warrantyMonths = get('warranty_months', '36');   // общий срок по умолчанию
  if (isTint_) {
    var parts = (d.materials || []).map(function(m){
      var nm = String(m['Название'] || '').trim();
      var zn = String(m['Зона'] || '').trim();
      var lt = String(m['Светопропускаемость'] == null ? '' : m['Светопропускаемость']).trim();
      if (!nm && !zn && !lt) return '';
      return (zn ? zn + ' — ' : '') + nm + (lt ? ' ' + lt + '%' : '');
    }).filter(String);
    tintDesc = parts.join(', ');
    // Бэкофилл для старых заказов: одна плёнка + общий процент по заказу.
    if (!tintDesc) {
      var lt0 = String(o['Светопропускаемость'] == null ? '' : o['Светопропускаемость']).trim();
      if (film || lt0) tintDesc = film + (lt0 ? ' ' + lt0 + '%' : '');
    }
    // Гарантия зависит от типа плёнки: Nano Ceramic — 120 мес., Carbon — 60 мес.
    // Если плёнок несколько — берём наибольший срок среди них.
    var mx = 0;
    (d.materials || []).forEach(function(m){ var w = tintWarrantyMonths_(m['Название']); if (w > mx) mx = w; });
    if (!mx) mx = tintWarrantyMonths_(film);
    if (mx) warrantyMonths = String(mx);
  } else {
    // Гарантия на РАБОТУ по оклейке (PPF) — 36 месяцев (плёночное покрытие — отдельно, 10 лет).
    var isWrap_ = (serviceMode === 'wrap') || /оклейк|ppf|бронир|wrap/i.test(o['Услуга'] || '');
    if (isWrap_) warrantyMonths = '36';
  }
  // Дата договора = дата начала работ; дата акта = дата окончания работ
  var startDate = o['Дата начала работ'] || o['Дата'] || formatToday_();
  var endDate   = o['Дата окончания работ'] || o['Дата выполнения'] || '';
  // Блок рассрочки (график платежей) — только для полного договора при условии оплаты «Рассрочка».
  var payTypeCond = String(o['Тип оплаты'] || '').trim();
  var rassrochkaBlock = (payTypeCond === 'Рассрочка' && serviceMode !== 'wrap' && serviceMode !== 'tint')
    ? buildRassrochkaSection_(d, Number(o['Стоимость заказа']) || price)
    : '';
  return {
    '_rassrochkaBlock': rassrochkaBlock,
    'Номер договора':  o['Номер договора'] || '',
    'Дата':            startDate,
    'Дата прописью':   dateLong_(startDate),
    'Дата выдачи авто': endDate,
    'Начало выполнения работ': startDate,
    'ФИО':             fio,
    'Фамилия И.О.':    surnameInitials_(fio),
    'ФИО род.':        c['ФИО род.'] || c['ФИО родительный'] || genitiveFio_(fio),
    'Паспорт':         o['Паспорт'] || c['Паспорт'] || '',
    'Телефон клиента': o['Телефон'] || c['Телефон'] || '',
    // Реквизиты Заказчика-юрлица
    'Компания заказчика':     c['Имя'] || fio,
    'УНП заказчика':          c['УНП'] || '',
    'Адрес заказчика':        c['Юр. адрес'] || '',
    'Почтовый адрес заказчика': c['Почтовый адрес'] || c['Юр. адрес'] || '',
    'Банк заказчика':         c['Банк. реквизиты'] || '',
    'Директор заказчика':     c['Директор'] || '',
    'Директор заказчика род.': genitiveFio_(c['Директор'] || ''),
    // Подписант по доверенности (если указан в заказе)
    'Подписант':       o['Подписант'] || '',
    'Подписант род.':  genitiveFio_(o['Подписант'] || ''),
    'Доверенность':    o['Доверенность'] || '',
    'Марка авто':      marka,
    'Модель':          model,
    'Гос.номер':       o['Госномер'] || '',
    'VIN':             o['VIN'] || '',
    'Год выпуска':     o['Год выпуска'] || c['Год выпуска'] || '',
    'Пробег':          o['Пробег'] || '',
    'Пленка':          film,
    'Плёнки список':   tintDesc,
    'Светопр-ть':      tintDesc || o['Светопропускаемость'] || '',
    // Описание работ: тонировка — все плёнки с зоной и процентом; оклейка — без названия
    'Описание работ':  (isTint_
                          ? ('тонировочной плёнки' + (tintDesc ? ': ' + tintDesc : ''))
                          : 'антигравийной плёнки'),
    'Использовано пленки': usedFilm || '',
    'Элементы для оклейки': String(o['Элементы'] || '').replace(/\r?\n/g, ', '),
    'Комплекс': o['Комплекс'] || '',
    // Для карты работ — каждый элемент с новой строки (☐ перед каждым)
    'Элементы чеклист': (function(){
      var arr = String(o['Элементы'] || '').split(/\r?\n/).map(function(s){ return s.trim(); }).filter(Boolean);
      if (!arr.length) arr = ['Капот','Передний бампер','Крылья целиком','Передняя часть крыльев','Передняя оптика','Зеркала','Стойки лобового стекла','Полоса на крыше до люка','Внутренние пороги','Зона выгрузки','Кромки дверей','Антиманикюр'];
      return arr.map(function(e){ return '☐ ' + e; }).join('<br>');
    })(),
    // ── Поля и формулировки точно по эталону САНПРОТЕКТ ──
    'Дата ru':         dateRu_(startDate),
    'Дата начала кратко':   dateShort_(startDate),
    'Дата окончания кратко': dateShort_(endDate),
    // Дата сдачи авто (для подписи заказчика в наряде): дата окончания работ,
    // а если не задана — сегодняшняя (наряд печатают в момент выдачи авто).
    'Дата сдачи кратко': dateShort_(endDate || formatToday_()),
    'Сумма цел':       String(Math.round(price)),
    'Кол-во элементов': o['Кол-во элементов'] || '',
    'Паспорт выдан':   o['Паспорт выдан'] || c['Паспорт выдан'] || '',
    'Адрес заказчика физ': o['Адрес'] || c['Адрес'] || c['Юр. адрес'] || '',
    // Предмет договора (п.1.1), работа в акте, услуга в протоколе — по услуге
    'Предмет договора': (function(){
      var avto = (marka + ' ' + model).trim();
      if (isTint_)
        return 'по тонировке а/м ' + avto + ', VIN номер ' + (o['VIN']||'') + (tintDesc ? ', плёнками: ' + tintDesc : (film ? ', плёнкой ' + film : ''));
      return 'по оклейке кузова а/м ' + avto + ', VIN номер ' + (o['VIN']||'') + ' защитной плёнкой ' + film;
    })(),
    'Акт работа': (function(){
      var avto = (marka + ' ' + model).trim();
      if (isTint_)
        return '- тонировка а/м ' + avto + ', VIN номер ' + (o['VIN']||'') + (tintDesc ? ', плёнками: ' + tintDesc : (film ? ', плёнкой ' + film : '')) + ';';
      return '- оклейка кузова а/м ' + avto + ', VIN номер ' + (o['VIN']||'') + ' защитной плёнкой ' + film + ';';
    })(),
    'Протокол услуга': (isTint_
                          ? 'Тонировка автомобиля'
                          : 'Оклейка кузова защитной плёнкой' + (o['Комплекс'] ? ' (комплекс «' + o['Комплекс'] + '»)' : '')),
    'Сумма':           price.toFixed(2),
    'Сумма прописью':  numToWords_(price),
    'Стоимость работ': price.toFixed(2),
    'Стоимость работ прописью': numToWords_(price),
    // Для заказ-наряда (БСО)
    'Заказ оформил':   o['Менеджер'] || get('order_clerk', 'Папкович И.И.'),
    'Работ стоимость': (function(){ var net=d.materials.reduce(function(s,m){return s+(Number(m['Стоимость'])||0);},0); return Math.max(0, price-net).toFixed(2); })(),
    'Материалов стоимость': d.materials.reduce(function(s,m){return s+(Number(m['Стоимость'])||0);},0).toFixed(2),
    'Таблица материалов': (d.materials.map(function(m){
        var qty=Number(m['Кол-во'])||0, pr=Number(m['Цена за м²'])||0, cost=Number(m['Стоимость'])||0;
        return '<tr><td>'+(m['Название']||'')+'</td><td class="center">пог.м</td><td class="right">'+qty+'</td><td class="right">'+pr.toFixed(2)+'</td><td class="right">'+cost.toFixed(2)+'</td></tr>';
      }).join('')) || '<tr><td colspan="5" class="center">—</td></tr>',
    // Реквизиты Исполнителя (white-label; дефолт — реальные данные САНПРОТЕКТ)
    'Компания':   get('company_name', 'Общество с ограниченной ответственностью «САНПРОТЕКТ»'),
    'УНП':        get('unp', '391413250'),
    'Юр.адрес':   co['legal_address'] || co['address'] || '223043, Минская обл., Минский р-н, Папернянский с/с, д. Цнянка, ул. Дзержинского, 44',
    'Почт.адрес': get('postal_address', '220138, а/я 35, г. Минск'),
    'Р/с':        get('bank_account', 'BY87BLNB30120000490087000933'),
    'Банк':       get('bank_name', "ОАО «БНБ-БАНК», код BLNBBY2X"),
    'Директор':   get('director', 'Котляров И.В.'),
    'Директор род.': genitiveFio_(get('director', 'Котляров И.В.')),
    'Гарантия мес': warrantyMonths,
    'Телефон':    get('phone', '+375172525569, +375291090001'),
    'Логотип':    co['logo_dataurl'] || '',
  };
}

// Ширина линии для ручного заполнения (px) по полю — чтобы пустая строка была
// «по размеру» данных (паспорт короче адреса, госномер — совсем короткий и т.д.).
var BLANK_SIZES_ = {
  'ФИО': 240, 'Фамилия И.О.': 130, 'ФИО род.': 240,
  'Паспорт': 130, 'Паспорт выдан': 280,
  'Телефон клиента': 140, 'Адрес заказчика физ': 300,
  'Гос.номер': 95, 'VIN': 170, 'Год выпуска': 55, 'Пробег': 75,
  'Марка авто': 130, 'Модель': 140, 'Пленка': 150, 'Плёнки список': 260, 'Светопр-ть': 90,
  'Компания заказчика': 240, 'УНП заказчика': 110, 'Адрес заказчика': 300,
  'Почтовый адрес заказчика': 300, 'Банк заказчика': 280,
  'Директор заказчика': 180, 'Директор заказчика род.': 200,
  'Подписант': 200, 'Подписант род.': 200, 'Доверенность': 170,
  'Номер договора': 110, 'Кол-во элементов': 55, 'Комплекс': 150,
  'Элементы для оклейки': 320, 'Использовано пленки': 60
};
/** Заменить {{плейсхолдеры}}; отсутствующие → линия для ручного заполнения по размеру поля. */
function fillTemplate_(html, map) {
  return html.replace(/\{\{\s*([^}]+?)\s*\}\}/g, function(_, key) {
    key = key.trim();
    var v = map[key];
    if (v !== undefined && v !== null && v !== '') return String(v);
    var w = BLANK_SIZES_[key] || 90;
    return '<span class="blank" style="min-width:' + w + 'px"></span>';
  });
}

/** Обёртка печатного документа. logoUrl — логотип; asWatermark=true — лого
 *  как бледный водяной знак на всю страницу (для договора), иначе — в шапке. */
function docWrap_(title, bodyHtml, logoUrl, asWatermark) {
  var logo = (logoUrl && !asWatermark) ? '<img src="' + logoUrl + '" alt="logo" style="height:64px;width:auto;display:block;margin:0 auto 6px">' : '';
  var wm   = (logoUrl && asWatermark) ? '<img class="watermark" src="' + logoUrl + '" alt="">' : '';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + title + '</title><style>' +
    '@page{size:A4;margin:12mm 14mm}' +
    '*{box-sizing:border-box}' +
    'body{font-family:"Times New Roman",serif;font-size:10.5pt;line-height:1.18;color:#000;margin:0}' +
    '.watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:60%;max-width:150mm;opacity:.07;z-index:0;pointer-events:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.doc{max-width:180mm;margin:0 auto;position:relative;z-index:1}' +
    'h2{text-align:center;font-size:12pt;margin:2px 0;font-weight:bold}' +
    'h3{font-size:10.5pt;margin:6px 0 2px;font-weight:bold}' +
    'p{margin:2px 0;text-align:justify}' +
    'table{width:100%;border-collapse:collapse;margin:4px 0}' +
    'td,th{border:1px solid #000;padding:2px 5px;font-size:9.5pt;vertical-align:top}th{background:#eee;font-weight:bold}' +
    '.blank{display:inline-block;min-width:90px;border-bottom:1px solid #000;line-height:1}' +
    '.de{border:1px solid #9bb;border-radius:4px;padding:1px 4px;font:inherit;width:62px;text-align:right;background:#f4fbfe}' +
    '@media print{.de{border:none;padding:0;background:transparent;-webkit-print-color-adjust:exact}}' +
    '.editbar{background:#eef7fb;border:1px solid #bde;border-radius:8px;padding:8px 12px;margin:0 0 10px;font-size:11px;color:#235}' +
    '.right{text-align:right}.center{text-align:center}.muted{font-size:8.5pt;color:#333}' +
    '.sign{display:flex;justify-content:space-between;margin-top:12px}' +
    '.page-break{page-break-before:always}.bar{display:flex;justify-content:space-between}' +
    'h2,h3{page-break-after:avoid}table,p{page-break-inside:avoid}' +
    '@media print{.noprint{display:none}}' +
    '</style></head><body>' +
    '<div class="noprint" style="text-align:right;margin:8px 14px"><button onclick="window.print()" style="padding:8px 20px;font-size:13px;cursor:pointer">🖨 Распечатать</button></div>' +
    wm + '<div class="doc">' + logo + bodyHtml + '</div></body></html>';
}

/** Шаблон: ДОГОВОР + Протокол согласования цены + Акт выполненных работ (САНПРОТЕКТ).
 *  isLegal=true — Заказчик юрлицо. byProxy=true — подписывает представитель по доверенности. */
function contractTemplateHtml_(isLegal, byProxy) {
  // «в лице …, действующего на основании …» для юрлица
  var repClause = byProxy
    ? `в лице {{Подписант род.}}, действующего на основании доверенности {{Доверенность}}`
    : `в лице директора {{Директор заказчика род.}}, действующего на основании Устава`;
  var signRole = byProxy ? `По доверенности` : `Директор`;
  var signName = byProxy ? `{{Подписант}}` : `{{Директор заказчика}}`;

  // Сторона Заказчика во вводной части
  var clientIntro = isLegal
    ? `<b>{{Компания заказчика}}</b>, именуемое в дальнейшем «Заказчик», ` + repClause + `, заключили настоящий договор о нижеследующем:`
    : `<b>{{ФИО}}</b>, действующий на основании паспорта {{Паспорт}}, выданного {{Паспорт выдан}}, именуемый в дальнейшем «Заказчик», заключили настоящий договор о нижеследующем:`;
  // Реквизиты Заказчика (раздел 9)
  var clientReq = isLegal
    ? `{{Компания заказчика}}<br>УНП: {{УНП заказчика}}<br>{{Банк заказчика}}<br>Юр. адрес: {{Адрес заказчика}}<br>Почтовый адрес: {{Почтовый адрес заказчика}}<br><br>` + signRole + ` _____________ ` + signName + `<br>М.П.`
    : `ФИО: {{ФИО}}<br>Адрес: {{Адрес заказчика физ}}<br>Паспорт: {{Паспорт}}<br><br>_____________ / {{Фамилия И.О.}}`;
  // Заказчик в акте
  var clientAct = isLegal
    ? `<b>{{Компания заказчика}}</b> ` + repClause + `, именуемое в дальнейшем «Заказчик»`
    : `<b>{{ФИО}}</b>, именуемый в дальнейшем «Заказчик»`;
  var clientName = isLegal ? `{{Компания заказчика}}` : `{{ФИО}}`;
  var clientActSign = isLegal ? signName : `{{Фамилия И.О.}}`;
  return `
  <h2>ДОГОВОР № {{Номер договора}}</h2>
  <div class="bar"><span>г. Минск</span><span>{{Дата ru}}</span></div>
  <p>{{Компания}}, именуемое в дальнейшем «Исполнитель», в лице директора {{Директор род.}}, действующего на основании Устава, с одной стороны, и ` + clientIntro + `</p>

  <h3>1. Предмет договора</h3>
  <p>1.1. Исполнитель по настоящему договору обязуется выполнить работы {{Предмет договора}}, а Заказчик обязуется принять результат выполненных работ и оплатить их стоимость.</p>
  <p>1.2. Сроки выполнения работ:<br>начало выполнения работ: {{Дата начала кратко}}<br>окончание выполнения работ: {{Дата окончания кратко}}</p>

  <h3>2. Цена договора</h3>
  <p>2.1. Цена выполненных работ согласовывается сторонами в Протоколе согласования цены.</p>
  <p>2.2. Стоимость работ по настоящему договору составляет <b>{{Сумма цел}} бел. рублей 00 коп.</b></p>
  <p>2.3. Цена договора, предусмотренная п.2.2., является предварительной и может быть изменена в ходе выполнения работ в связи с изменением объёма производимых работ. Окончательная стоимость выполненных работ по настоящему договору отражается в Акте приёма-передачи выполненных работ, который является неотъемлемой частью настоящего договора.</p>
  <!--RASSROCHKA_BLOCK-->

  <h3>3. Права и обязанности сторон</h3>
  <p>3.1. Исполнитель обязуется:</p>
  <p>3.1.1. Выполнить работы с надлежащим качеством в сроки, предусмотренные п.1.2. настоящего Договора, и сдать их результат Заказчику с одновременным подписанием Акта сдачи-приёмки выполненных работ.</p>
  <p>3.1.2. Выполнить работы, предусмотренные п.1.1. настоящего договора, используя материал Исполнителя. Количество материала отражается в Протоколе согласования цены и согласовывается сторонами до начала выполнения работ, предусмотренного п.1.2. настоящего договора.</p>
  <p>3.2. Заказчик обязуется:</p>
  <p>3.2.1. Произвести оплату 50% стоимости до начала работ, а оставшуюся часть в момент подписания Акта сдачи-приёмки выполненных работ путём передачи наличных денег уполномоченному представителю Исполнителя, с одновременным оформлением бланка строгой отчётности, второй экземпляр которого передаётся Заказчику.</p>

  <h3>4. Ответственность сторон</h3>
  <p>4.1. За ненадлежащее исполнение своих обязательств по настоящему договору стороны несут ответственность в соответствии с действующим законодательством Республики Беларусь.</p>

  <h3>5. Гарантийное обслуживание</h3>
  <p>5.1. Срок гарантийного обслуживания на результаты выполненных по настоящему договору работ составляет {{Гарантия мес}} месяцев с даты подписания Акта приёмки-сдачи выполненных работ (Приложение №3), при соблюдении правил эксплуатации. Гарантия на плёночное покрытие 10 лет.</p>
  <p>5.2. После установки плёнки не мыть автомобиль в течение 10 дней.</p>
  <p>5.3. По истечении 10 дней после установки плёнки явиться на контрольный осмотр по месту установки плёнки.</p>
  <p>5.4. В процессе дальнейшей эксплуатации автомобиля рекомендуется частая ручная мойка специальными неагрессивными составами. В процессе мойки не подносите сопло мойки высокого давления ближе 50 см к поверхности и не подвергайте воздействию края плёнки.</p>
  <p>5.5. Не мойте автомобиль на автоматических мойках.</p>

  <h3>6. Порядок разрешения споров</h3>
  <p>6.1. Все споры, возникающие из настоящего договора, разрешаются Сторонами в порядке переговоров. В случае невозможности разрешения споров в ходе переговоров, спор передаётся на рассмотрение в судебные инстанции в порядке, установленном действующим законодательством.</p>

  <h3>7. Срок действия договора</h3>
  <p>7.1. Настоящий договор вступает в силу с момента его подписания полномочными представителями обеих сторон и действует до полного исполнения сторонами принятых на себя обязательств.</p>
  <p>7.2. Все изменения и дополнения, вносимые в настоящий договор, действительны при условии, что они выполнены в письменной форме и подписаны полномочными представителями обеих сторон.</p>

  <h3>8. Заключительные положения</h3>
  <p>8.1. Настоящий договор составлен в двух экземплярах, имеющих одинаковую юридическую силу, по одному для каждой из сторон.</p>
  <p>8.2. Неотъемлемой частью настоящего договора являются: Протокол согласования цены; Акт сдачи-приёмки выполненных работ.</p>

  <h3>9. Адреса, банковские реквизиты и подписи сторон</h3>
  <table><tr>
    <td style="width:50%"><b>Исполнитель:</b><br>{{Компания}}<br>Р/сч: {{Р/с}} в {{Банк}}, УНП: {{УНП}}<br>Юр. адрес: {{Юр.адрес}}<br>Почтовый адрес: {{Почт.адрес}}<br>Тел./факс: {{Телефон}}<br><br>Директор _____________ {{Директор}}<br>М.П.</td>
    <td style="width:50%"><b>Заказчик:</b><br>` + clientReq + `</td>
  </tr></table>

  <!-- ПРОТОКОЛ СОГЛАСОВАНИЯ ЦЕНЫ -->
  <div style="border-top:1px solid #999;margin:10px 0 4px"></div>
  <h2>Протокол согласования цены</h2>
  <p>от {{Дата ru}} к договору № {{Номер договора}} от {{Дата ru}} между {{Компания}} и ` + clientName + `.</p>
  <table>
    <thead><tr><th style="width:42px">№ п/п</th><th>Наименование услуги</th><th style="width:120px">Количество, шт</th><th style="width:130px">Цена, руб. (с НДС)</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>{{Протокол услуга}}</td><td>{{Кол-во элементов}} эл.</td><td class="right">{{Сумма цел}} р.</td></tr>
      <tr><td>2</td><td>Использовано плёнки {{Пленка}}</td><td>{{Использовано пленки}} м.п.</td><td></td></tr>
    </tbody>
  </table>
  <p>Внесена предоплата за услуги: <span class="blank" style="min-width:340px"></span> руб.</p>
  <div class="sign"><span>Директор _____________ {{Директор}}</span><span>Заказчик _____________ / ` + clientActSign + `</span></div>

  ` + actBodyHtml_(isLegal, byProxy, true);
}

/** Акт выполненных работ. separator=true — с верхней разделительной линией (внутри договора).
 *  Используется и в договоре, и отдельным документом (generateActHtml) — единый источник. */
function actBodyHtml_(isLegal, byProxy, separator) {
  var repClause = byProxy
    ? `в лице {{Подписант род.}}, действующего на основании доверенности {{Доверенность}}`
    : `в лице директора {{Директор заказчика род.}}, действующего на основании Устава`;
  var clientAct = isLegal
    ? `<b>{{Компания заказчика}}</b> ` + repClause + `, именуемое в дальнейшем «Заказчик»`
    : `<b>{{ФИО}}</b>, именуемый в дальнейшем «Заказчик»`;
  var clientActSign = isLegal ? (byProxy ? `{{Подписант}}` : `{{Директор заказчика}}`) : `{{Фамилия И.О.}}`;
  return (separator ? `<div style="border-top:1px solid #999;margin:10px 0 4px"></div>` : ``) + `
  <h2>АКТ ВЫПОЛНЕННЫХ РАБОТ</h2>
  <div class="bar"><span>г. Минск</span><span>{{Дата ru}}</span></div>
  <p>{{Компания}} в лице директора {{Директор род.}}, именуемое в дальнейшем «Исполнитель», с одной стороны, и ` + clientAct + `, с другой стороны, составили настоящий акт о том, что в соответствии с условиями договора № {{Номер договора}} от {{Дата ru}}, Исполнитель выполнил следующую работу: {{Акт работа}}</p>
  <p>Сроки проведения работ: {{Дата окончания кратко}}</p>
  <p>Работа выполнена в полном объёме. Заказчик к качеству и объёму работ претензий не имеет.</p>
  <p>Стоимость выполненных работ составляет: <b>{{Сумма цел}} р. 00 коп.</b></p>
  <div class="sign"><span>Исполнитель _____________ / {{Директор}}</span><span>Заказчик _____________ / ` + clientActSign + `</span></div>
  `;
}

/**
 * Сумма прописью с рублями и копейками (до сотен миллионов).
 * Напр. 2700 → «Две тысячи семьсот рублей 00 копеек».
 */
function numToWords_(n) {
  n = Number(n) || 0;
  var rub = Math.floor(n);
  var kop = Math.round((n - rub) * 100);
  var ones = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять','десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
  var tens = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
  var hund = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];

  function triad(num, fem) {       // 0..999 в слова; fem — женский род для 1/2
    var s = '', h = Math.floor(num / 100), rest = num % 100, t = Math.floor(rest / 10), o = rest % 10;
    if (h) s += hund[h] + ' ';
    if (rest < 20 && rest > 0) {
      var w = ones[rest];
      if (fem && rest === 1) w = 'одна';
      if (fem && rest === 2) w = 'две';
      s += w + ' ';
    } else {
      if (t) s += tens[t] + ' ';
      if (o) {
        var w2 = ones[o];
        if (fem && o === 1) w2 = 'одна';
        if (fem && o === 2) w2 = 'две';
        s += w2 + ' ';
      }
    }
    return s;
  }
  function plural(num, f) {         // f = [для 1, для 2-4, для 5+]
    var n10 = num % 10, n100 = num % 100;
    if (n10 === 1 && n100 !== 11) return f[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return f[1];
    return f[2];
  }

  var mil = Math.floor(rub / 1000000), th = Math.floor((rub % 1000000) / 1000), rest = rub % 1000;
  var words = '';
  if (mil) words += triad(mil, false) + plural(mil, ['миллион','миллиона','миллионов']) + ' ';
  if (th)  words += triad(th, true)   + plural(th,  ['тысяча','тысячи','тысяч']) + ' ';
  if (rest || (!mil && !th)) words += triad(rest, false);
  words = words.trim() || 'ноль';

  var kopStr = (kop < 10 ? '0' + kop : '' + kop);
  var res = words + ' ' + plural(rub, ['рубль','рубля','рублей']) + ' ' + kopStr + ' ' + plural(kop, ['копейка','копейки','копеек']);
  return res.charAt(0).toUpperCase() + res.slice(1);
}
