/**
 * Setup.gs — настройка таблиц
 *
 * ВАЖНО: runFirstSetup() уже был запущен!
 * Для добавления новых листов используй addNewSheets()
 */

// ─── МАСТЕР ПЕРВОГО ЗАПУСКА (из UI) ─────────────────────────────────────────

/**
 * Диагностика структуры базы для UI: какие листы есть, каких колонок не хватает.
 * (Внутренняя версия без safeCall — используется и в мастере.)
 */
function getSetupStatus_() {
  var book = openBook('DATABASE');
  var allSchemas = Object.assign({}, getDatabaseSchema(), getNewSheetsSchema());
  var sheets = [];
  var okCount = 0, issuesCount = 0;

  for (var key in allSchemas) {
    var tabName = CONFIG.TABS[key];
    if (!tabName) continue;
    var sheet = book.getSheetByName(tabName);
    var entry = { key: key, name: tabName, exists: !!sheet, rows: 0, missing: [] };
    if (sheet) {
      var lastCol = sheet.getLastColumn() || 1;
      var actual  = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      entry.rows    = Math.max(0, sheet.getLastRow() - 1);
      entry.missing = allSchemas[key].filter(function(c){ return actual.indexOf(c) < 0; });
      if (entry.missing.length === 0) okCount++; else issuesCount++;
    } else {
      issuesCount++;
    }
    sheets.push(entry);
  }
  return { sheets: sheets, okCount: okCount, issuesCount: issuesCount, ready: issuesCount === 0 };
}

/**
 * Диагностика для UI.
 */
function getSetupStatus() {
  return safeCall(function() { return getSetupStatus_(); });
}

/**
 * МАСТЕР ПЕРВОГО ЗАПУСКА. Запускается кнопкой из интерфейса.
 * Создаёт все недостающие листы и колонки. Полностью идемпотентно —
 * существующие данные не трогаются. Возвращает отчёт по шагам + статус.
 */
function runSetupWizard() {
  return safeCall(function() {
    var steps = [];
    var step = function(label, fn) {
      try { steps.push({ label: label, result: String(fn()), ok: true }); }
      catch (e) { steps.push({ label: label, result: e.message, ok: false }); }
    };
    step('Базовые листы (сотрудники, услуги, расходы…)', runFirstSetup);
    step('Листы модуля (заказы, клиенты, материалы, платежи, график…)', addNewSheets);
    step('Модель оплаты и колонки заказов', migratePaymentModel);
    step('Склад: остатки материалов', migrateStockColumns);
    step('Поля для документов (год, пробег, светопроп., элементы)', addOrderDocColumns);
    step('Почтовый адрес клиентов (юрлица)', addClientPostalColumn);
    step('Записи: дата/время окончания', addAppointmentEndColumns);
    step('Тонировка: зона и светопропускаемость плёнок', addOrderMaterialTintColumns);
    step('Продажа материалов: длина рулона и цены (пог.м, рулон)', addMaterialSalesColumns);
    step('Модуль «Продажи»: листы продаж и позиций', addSalesSheets);
    step('Клиенты: тег «Оптовик»', addClientWholesaleColumn);
    return { steps: steps, status: getSetupStatus_() };
  });
}

/**
 * ДОБАВИТЬ ТОЛЬКО НОВЫЕ ЛИСТЫ (безопасно — существующие не трогает)
 * Запусти один раз для добавления листов Клиенты и Автомобили
 */
function addNewSheets() {
  Logger.log('Добавляем новые листы...');
  
  const newSheets = getNewSheetsSchema();
  const book = openBook('DATABASE');
  
  let created = 0;
  let skipped = 0;
  
  for (const [tabKey, columns] of Object.entries(newSheets)) {
    const tabName = CONFIG.TABS[tabKey];
    if (!tabName) {
      Logger.log('Пропуск: нет имени для ' + tabKey);
      continue;
    }
    
    let sheet = book.getSheetByName(tabName);
    if (!sheet) {
      sheet = book.insertSheet(tabName);
      Logger.log('Создан лист: ' + tabName);
    }
    
    // Если лист уже есть с данными — не трогаем
    if (sheet.getLastRow() > 0) {
      Logger.log('Лист "' + tabName + '" уже есть — пропускаем');
      skipped++;
      continue;
    }
    
    // Записываем заголовки
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    
    // Форматируем заголовки
    const headerRange = sheet.getRange(1, 1, 1, columns.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1a2230');
    headerRange.setFontColor('#ffffff');
    headerRange.setHorizontalAlignment('left');
    headerRange.setVerticalAlignment('middle');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, columns.length);
    
    Logger.log('Лист "' + tabName + '": создано ' + columns.length + ' колонок');
    created++;
  }
  
  Logger.log('Готово! Создано: ' + created + ', пропущено: ' + skipped);
  return 'Создано листов: ' + created + ', пропущено: ' + skipped;
}

/**
 * Схема ТОЛЬКО НОВЫХ листов (v1.2)
 * Существующие листы здесь не перечислены — они не будут тронуты
 */
function getNewSheetsSchema() {
  return {

    // Заказы (v1.3) — материалы и расходы теперь в отдельных листах
    ORDERS: [
      'ID',                    // ЗАК-00001
      'Номер договора',        // 04/01-XXX или 12/01-XXX
      'Дата',
      'Дата выполнения',
      'Статус',                // Новый / В работе / Готов / Выдан / Отменён
      'Клиент ID',
      'Клиент',
      'Телефон',
      'Авто',
      'Госномер',
      'VIN',
      'Услуга',
      'Стоимость заказа',
      'Тип оплаты',            // Нал / Безнал / Отсрочка / Рассрочка / '' — УСЛОВИЯ (редактируются), задаёт −15%
      'Статус оплаты',         // Не оплачен / Частично / Оплачен — ФАКТ (только платежами)
      'Безнал',                // legacy-зеркало статуса: Да/Нет/Частично/'' (новый код не использует как источник)
      'Срок оплаты',           // dd.MM.yyyy — когда ожидается оплата / следующий взнос
      'Менеджер',
      'Оклейщики',
      'Итого материалы',       // сумма из Расход материалов (тип=расход)
      'Итого расходы',         // сумма из Расходы заказа
      'Валовая прибыль',       // считается автоматически
      'Бонус менеджера',
      'Бонус оклейщика',
      'Маржинальная прибыль',
      'Заметки',
      'Проверено',             // Да / Нет — проверка данных директором
      'Создан',
      'Обновлён',
    ],

    // Справочник материалов (v1.3)
    MATERIALS: [
      'ID',
      'Название',
      'Категория',             // PPF плёнка / Тонировочная плёнка / Антихром / Химия / Расходник
      'Услуга',                // PPF / Тонировка / Полировка / Универсальная
      'Единица',               // пм / м² / шт / л / кг
      'Цена',                  // себестоимость за единицу (для пм — за м²)
      'Ширина рулона',         // метры (обычно 1.52)
      'Длина рулона',          // метры — сколько пог.м в рулоне (для продажи)
      'Цена за пог.м',         // ПРОДАЖА: цена за погонный метр (перепродажа)
      'Цена за рулон',         // ПРОДАЖА: цена за целый рулон (перепродажа)
      'Остаток',               // текущий остаток на складе (в ед. измерения)
      'Мин. остаток',          // порог «мало» для подсветки
      'Активен',               // Да / Нет
      'Создан',
      'Обновлён',
    ],

    // Расход материалов по заказу (v1.3)
    ORDER_MATERIALS: [
      'ID',
      'Заказ ID',
      'Материал ID',
      'Название',              // денормализовано для быстрого чтения
      'Единица',               // пм / м²
      'Кол-во',                // введённое количество
      'Ширина рулона',         // снимок из справочника на момент заполнения
      'Кол-во м²',             // расчётное: пм × ширина или напрямую м²
      'Цена за м²',            // снимок цены из справочника
      'Тип',                   // расход / остаток
      'Стоимость',             // 0 если остаток, иначе Кол-во м² × Цена за м²
      'Зона',                  // тонировка: стекло/зона (Лобовое, Передние боковые…)
      'Светопропускаемость',   // тонировка: % пропускания света этой плёнки
      'Создан',
    ],

    // Расходы по заказу — такси, арматура и т.д. (v1.3)
    ORDER_EXPENSES: [
      'ID',
      'Заказ ID',
      'Название',              // Такси / Арматура / произвольное
      'Сумма',
      'Создан',
    ],

    // Платежи по заказам — рассрочка и частичные оплаты (v1.4)
    PAYMENTS: [
      'ID',
      'Заказ ID',
      'Дата',
      'Сумма',
      'Способ оплаты',         // Нал / Безнал
      'Комментарий',
      'Создан',
    ],

    // График платежей (рассрочка) — плановые взносы (v1.9)
    SCHEDULE: [
      'ID',
      'Заказ ID',
      '№',                     // порядковый номер взноса
      'Дата',                  // dd.MM.yyyy — плановая дата взноса
      'Сумма',                 // плановая сумма взноса
      'Оплачен',               // Да / Нет
      'Создан',
    ],

    // Фото до/после по заказу (v2.0) — сами файлы лежат в Google Drive
    ORDER_PHOTOS: [
      'ID',
      'Заказ ID',
      'Тип',                   // До / После
      'Drive ID',              // id файла в Google Drive
      'URL',                   // ссылка на просмотр
      'Имя файла',
      'Создан',
    ],

    // Календарь записей (v2.0): запись клиента на услугу к мастеру на дату/время
    APPOINTMENTS: [
      'ID',
      'Дата',                  // dd.MM.yyyy — дата начала
      'Время',                 // HH:mm — время начала
      'Дата окончания',        // dd.MM.yyyy — по умолчанию = дате начала
      'Время окончания',       // HH:mm
      'Длительность',          // минут (для однодневных, вычисляется)
      'Клиент',
      'Телефон',
      'Авто',
      'Услуга',
      'Мастер',
      'Статус',                // Запланирована / Пришёл / Отменена
      'Заказ ID',              // если из записи создан заказ
      'Комментарий',
      'Создан',
    ],

    // Движение остатков материалов (v2.0): приход / списание / коррекция
    MAT_MOVES: [
      'ID',
      'Материал ID',
      'Название',              // денормализовано
      'Тип',                   // Приход / Списание / Коррекция
      'Кол-во',                // + или − к остатку
      'Остаток после',         // снимок остатка после операции
      'Комментарий',
      'Заказ ID',              // если списание привязано к заказу
      'Создан',
    ],

    // Единая база клиентов (физ. и юр. лица)
    CLIENTS: [
      'ID',
      'Тип',                  // физ / юр
      'Имя',                  // для физ: ФИО, для юр: название организации
      'Телефон',
      'Email',
      // Поля физ. лица
      'Паспорт',
      // Поля юр. лица
      'УНП',
      'Юр. адрес',
      'Почтовый адрес',
      'Банк. реквизиты',
      'Директор',
      'Контактное лицо',
      // Общие
      'Источник лида',
      'Заметки',
      'Статус',               // Активен / Архив
      'Всего заказов',        // считается автоматически
      'Сумма заказов',        // считается автоматически
      'Последний заказ',      // дата
      'Создан',
      'Обновлён',
    ],
    
    // Автомобили клиентов (один клиент может иметь несколько авто)
    VEHICLES: [
      'ID',
      'Клиент ID',
      'Марка',
      'Модель',
      'Год',
      'Госномер',
      'VIN',
      'Цвет',
      'Заметки',
      'Создан',
    ],
    
  };
}

// ─── МИГРАЦИЯ v1.4: колонка «Срок оплаты» в листе Заказы ────────────────────

/**
 * Добавить колонку «Срок оплаты» в существующий лист Заказы.
 * Запустить ОДИН РАЗ после обновления до v1.4.
 * Вставляет колонку сразу после «Безнал».
 */
function addDueDateColumn() {
  const sheet   = getTab('DATABASE', 'ORDERS');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  if (headers.indexOf('Срок оплаты') >= 0) {
    Logger.log('Колонка "Срок оплаты" уже существует — пропуск');
    return 'Уже есть';
  }

  const beznalIdx = headers.indexOf('Безнал');
  if (beznalIdx < 0) throw new Error('Колонка "Безнал" не найдена в листе Заказы');

  // Вставляем пустую колонку после "Безнал"
  sheet.insertColumnAfter(beznalIdx + 1);

  // Пишем заголовок с форматированием
  const hCell = sheet.getRange(1, beznalIdx + 2);
  hCell.setValue('Срок оплаты');
  hCell.setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff');

  sheet.autoResizeColumn(beznalIdx + 2);
  Logger.log('Добавлена колонка "Срок оплаты" на позицию ' + (beznalIdx + 2));
  return 'Готово: колонка "Срок оплаты" добавлена';
}

// ─── МИГРАЦИЯ: поля для документов (год, пробег, светопроп., элементы) ───────

/** Добавить в лист «Заказы» колонки для договоров. Идемпотентно. */
/**
 * Добавить колонку «Почтовый адрес» в лист Клиенты (после «Юр. адрес»).
 * Идемпотентно: если колонка уже есть — пропускает.
 */
function addClientPostalColumn() {
  const sheet = getTab('DATABASE', 'CLIENTS');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('Почтовый адрес') >= 0) return 'Колонка «Почтовый адрес» уже есть';
  const afterIdx = headers.indexOf('Юр. адрес');
  const insertAt = afterIdx >= 0 ? afterIdx + 1 : sheet.getLastColumn();
  sheet.insertColumnAfter(insertAt);
  sheet.getRange(1, insertAt + 1).setValue('Почтовый адрес')
    .setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff');
  sheet.autoResizeColumn(insertAt + 1);
  return 'Добавлена колонка «Почтовый адрес»';
}

/**
 * Добавить колонки «Дата окончания» и «Время окончания» в лист Записи
 * (после «Время»). Бэкфилл: окончание = дате начала. Идемпотентно.
 */
function addAppointmentEndColumns() {
  const sheet = getTab('DATABASE', 'APPOINTMENTS');
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const style = function(cell){ cell.setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff'); };
  const need = ['Дата окончания', 'Время окончания'];
  let added = [];
  // Вставляем сразу после «Время», чтобы было рядом
  need.forEach(function(col){
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.indexOf(col) >= 0) return;
    const after = headers.indexOf('Время') >= 0 ? headers.indexOf('Время') + (added.length + 1) : sheet.getLastColumn();
    sheet.insertColumnAfter(after);
    style(sheet.getRange(1, after + 1).setValue(col));
    added.push(col);
  });
  // Бэкфилл: окончание = дате начала (время окончания оставляем пустым — на клиенте посчитается)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const h2 = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const dCol = h2.indexOf('Дата'), edCol = h2.indexOf('Дата окончания');
    if (dCol >= 0 && edCol >= 0) {
      const dates = sheet.getRange(2, dCol + 1, lastRow - 1, 1).getValues();
      const ends  = sheet.getRange(2, edCol + 1, lastRow - 1, 1).getValues();
      let changed = false;
      for (let i = 0; i < ends.length; i++) {
        if (!ends[i][0] && dates[i][0]) { ends[i][0] = dates[i][0]; changed = true; }
      }
      if (changed) sheet.getRange(2, edCol + 1, lastRow - 1, 1).setValues(ends);
    }
  }
  return added.length ? ('Добавлены: ' + added.join(', ')) : 'Колонки окончания уже есть';
}

function addOrderDocColumns() {
  const sheet = getTab('DATABASE', 'ORDERS');
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const need = ['Год выпуска', 'Пробег', 'Светопропускаемость', 'Элементы', 'Подписант', 'Доверенность', 'Паспорт', 'Дата начала работ', 'Дата окончания работ', 'Паспорт выдан', 'Адрес', 'Кол-во элементов', 'Комплекс', 'Администратор', 'Бонус администратора', 'Удалён'];
  const added = [];
  need.forEach(function(col) {
    if (headers.indexOf(col) >= 0) return;
    const lastCol = sheet.getLastColumn();
    sheet.insertColumnAfter(lastCol);
    sheet.getRange(1, lastCol + 1).setValue(col)
      .setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff');
    headers.push(col);
    added.push(col);
  });
  Logger.log(added.length ? 'Добавлены: ' + added.join(', ') : 'Все колонки уже есть');
  return added.length ? ('Добавлены колонки: ' + added.join(', ')) : 'Колонки документов уже есть';
}

/**
 * Тонировка: добавить в «Расход материалов» колонки «Зона» и «Светопропускаемость»,
 * чтобы у каждой плёнки заказа был свой процент. Идемпотентно.
 */
function addOrderMaterialTintColumns() {
  const sheet = getTab('DATABASE', 'ORDER_MATERIALS');
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const need = ['Зона', 'Светопропускаемость'];
  const added = [];
  need.forEach(function(col) {
    if (headers.indexOf(col) >= 0) return;
    const lastCol = sheet.getLastColumn();
    sheet.insertColumnAfter(lastCol);
    sheet.getRange(1, lastCol + 1).setValue(col)
      .setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff');
    headers.push(col);
    added.push(col);
  });
  // «Светопропускаемость» — число (иначе наследует формат даты от «Создан» → «00:00»)
  fixNumericColumns_(sheet, ['Светопропускаемость']);
  return added.length ? ('Добавлены колонки: ' + added.join(', ')) : 'Колонки тонировки уже есть (формат обновлён)';
}

/**
 * Продажа материалов: добавить в справочник «Материалы» колонки
 * «Длина рулона», «Цена за пог.м», «Цена за рулон». Идемпотентно.
 */
function addMaterialSalesColumns() {
  const sheet = getTab('DATABASE', 'MATERIALS');
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const need = ['Длина рулона', 'Цена за пог.м', 'Цена за рулон'];
  const added = [];
  need.forEach(function(col) {
    if (headers.indexOf(col) >= 0) return;
    const lastCol = sheet.getLastColumn();
    sheet.insertColumnAfter(lastCol);
    sheet.getRange(1, lastCol + 1).setValue(col)
      .setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff');
    headers.push(col);
    added.push(col);
  });
  // ВАЖНО: новые колонки вставляются после «Обновлён» (дата/время) и наследуют
  // его формат → числа превращаются в «00:00». Принудительно ставим числовой
  // формат и чистим значения, ставшие датой из-за прежнего формата.
  fixNumericColumns_(sheet, need);
  return added.length ? ('Добавлены колонки: ' + added.join(', ')) : 'Колонки продажи материалов уже есть (формат обновлён)';
}

/**
 * Привести перечисленные колонки к числовому формату и убрать значения,
 * которые из-за унаследованного формата «дата/время» стали объектом Date.
 */
function fixNumericColumns_(sheet, cols) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    cols.forEach(function(col){ const i = headers.indexOf(col); if (i >= 0) sheet.getRange(2, i + 1, 1, 1).setNumberFormat('0.####'); });
    return;
  }
  cols.forEach(function(col) {
    const idx = headers.indexOf(col);
    if (idx < 0) return;
    const rng = sheet.getRange(2, idx + 1, lastRow - 1, 1);
    rng.setNumberFormat('0.####');
    const vals = rng.getValues();
    let changed = false;
    for (let r = 0; r < vals.length; r++) {
      if (vals[r][0] instanceof Date) { vals[r][0] = ''; changed = true; }
    }
    if (changed) rng.setValues(vals);
  });
}

/**
 * Модуль «Продажи»: создать листы «Продажи» и «Позиции продаж» (если нет).
 * Идемпотентно — не трогает существующие данные.
 */
function addSalesSheets() {
  const book = openBook('DATABASE');
  const schema = getNewSheetsSchema();
  const need = ['SALES', 'SALE_ITEMS'];
  const created = [];
  need.forEach(function(key) {
    const name = CONFIG.TABS[key];
    const cols = schema[key];
    if (!name || !cols) return;
    let sheet = book.getSheetByName(name);
    if (!sheet) {
      sheet = book.insertSheet(name);
      sheet.getRange(1, 1, 1, cols.length).setValues([cols])
        .setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, cols.length);
      created.push(name);
    } else {
      // Лист есть — добьём недостающие колонки (напр. Менеджер/Бонус)
      let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      cols.forEach(function(col) {
        if (headers.indexOf(col) >= 0) return;
        const lastCol = sheet.getLastColumn();
        sheet.insertColumnAfter(lastCol);
        sheet.getRange(1, lastCol + 1).setValue(col)
          .setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff');
        headers.push(col);
      });
    }
  });
  return created.length ? ('Созданы листы: ' + created.join(', ')) : 'Листы продаж проверены (колонки актуальны)';
}

/**
 * Клиенты: добавить колонку «Оптовик» (Да/Нет) — тег оптового клиента. Идемпотентно.
 */
function addClientWholesaleColumn() {
  const sheet = getTab('DATABASE', 'CLIENTS');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('Оптовик') >= 0) return 'Колонка «Оптовик» уже есть';
  const lastCol = sheet.getLastColumn();
  sheet.insertColumnAfter(lastCol);
  sheet.getRange(1, lastCol + 1).setValue('Оптовик')
    .setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff');
  return 'Добавлена колонка «Оптовик»';
}

// ─── МИГРАЦИЯ v1.5: «Тип оплаты» и «Проверено» ──────────────────────────────

/**
 * Добавить колонки «Тип оплаты» и «Проверено» в лист Заказы.
 * Запустить ОДИН РАЗ после обновления до v1.5.
 * Безопасно: пропускает колонку если она уже есть.
 */
function addPaymentColumns() {
  const sheet   = getTab('DATABASE', 'ORDERS');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const styleHeader = function(cell) {
    cell.setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff');
  };

  // «Тип оплаты» — вставляем после «Безнал»
  if (headers.indexOf('Тип оплаты') < 0) {
    const afterIdx = headers.indexOf('Срок оплаты') >= 0
      ? headers.indexOf('Срок оплаты')
      : headers.indexOf('Безнал');
    if (afterIdx < 0) throw new Error('Не найдена опорная колонка');
    sheet.insertColumnAfter(afterIdx + 1);
    const cell = sheet.getRange(1, afterIdx + 2);
    cell.setValue('Тип оплаты');
    styleHeader(cell);
    sheet.autoResizeColumn(afterIdx + 2);
    Logger.log('Добавлена «Тип оплаты»');
  } else {
    Logger.log('«Тип оплаты» уже есть — пропуск');
  }

  // Перечитываем заголовки после возможной вставки
  const headers2 = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // «Проверено» — добавляем в конец (перед «Создан»)
  if (headers2.indexOf('Проверено') < 0) {
    const createIdx = headers2.indexOf('Создан');
    const insertAt  = createIdx >= 0 ? createIdx : headers2.length;
    sheet.insertColumnBefore(insertAt + 1);
    const cell2 = sheet.getRange(1, insertAt + 1);
    cell2.setValue('Проверено');
    styleHeader(cell2);
    // Заполняем существующие строки значением «Нет»
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, insertAt + 1, lastRow - 1, 1).setValue('Нет');
    }
    sheet.autoResizeColumn(insertAt + 1);
    Logger.log('Добавлена «Проверено»');
  } else {
    Logger.log('«Проверено» уже есть — пропуск');
  }

  return 'Миграция v1.5 выполнена';
}

// ─── МИГРАЦИЯ v1.6: чистая модель оплаты («Статус оплаты») ───────────────────

/**
 * ЕДИНАЯ миграция модели оплаты. Запустить ОДИН РАЗ после обновления до v1.6.
 *
 * 1. Гарантирует наличие колонок: «Срок оплаты», «Тип оплаты», «Статус оплаты», «Проверено».
 * 2. Бэкфилл существующих строк:
 *    - «Статус оплаты» считается по платежам (лист Платежи) и сумме заказа.
 *    - «Тип оплаты» (если пусто) восстанавливается из legacy «Безнал»: Да→Безнал, Нет→Нал.
 *    - «Проверено» пустое → «Нет».
 *
 * Безопасна для повторного запуска (колонки не дублируются, бэкфилл идемпотентен).
 */
/**
 * Миграция склада (v2.0): добавляет в справочник материалов колонки
 * «Остаток» и «Мин. остаток», если их нет. Идемпотентно.
 */
function migrateStockColumns() {
  try { addNewSheets(); } catch (e) {}
  const sheet = getTab('DATABASE', 'MATERIALS');
  const styleHeader = function(cell) {
    cell.setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff');
  };
  ['Остаток', 'Мин. остаток'].forEach(function(name) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.indexOf(name) >= 0) return;
    sheet.insertColumnAfter(sheet.getLastColumn());
    const cell = sheet.getRange(1, sheet.getLastColumn());
    cell.setValue(name);
    styleHeader(cell);
  });
  return 'Склад: колонки остатков на месте';
}

function migratePaymentModel() {
  // Сначала гарантируем, что все листы модуля заказов существуют
  // (Платежи, Расход материалов, Расходы заказа, Справочник материалов и т.д.).
  // addNewSheets() безопасен — существующие листы с данными не трогает.
  try {
    addNewSheets();
  } catch (e) {
    Logger.log('addNewSheets предупреждение: ' + e.message);
  }

  const sheet = getTab('DATABASE', 'ORDERS');

  const styleHeader = function(cell) {
    cell.setFontWeight('bold').setBackground('#1a2230').setFontColor('#ffffff');
  };

  // Вставить колонку с заголовком после опорной (по имени). Возвращает индекс (0-based) новой колонки.
  const ensureColumnAfter = function(colName, afterNames) {
    let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.indexOf(colName) >= 0) return; // уже есть
    let afterIdx = -1;
    for (let k = 0; k < afterNames.length && afterIdx < 0; k++) {
      afterIdx = headers.indexOf(afterNames[k]);
    }
    if (afterIdx < 0) afterIdx = headers.length - 1; // в конец, если опорная не найдена
    sheet.insertColumnAfter(afterIdx + 1);
    const cell = sheet.getRange(1, afterIdx + 2);
    cell.setValue(colName);
    styleHeader(cell);
    sheet.autoResizeColumn(afterIdx + 2);
    Logger.log('Добавлена колонка «' + colName + '»');
  };

  ensureColumnAfter('Срок оплаты',   ['Безнал', 'Стоимость заказа']);
  ensureColumnAfter('Тип оплаты',    ['Срок оплаты', 'Безнал']);
  ensureColumnAfter('Статус оплаты', ['Тип оплаты', 'Срок оплаты']);
  // «Проверено» — перед «Создан»
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('Проверено') < 0) {
    const createIdx = headers.indexOf('Создан');
    const insertAt  = createIdx >= 0 ? createIdx : headers.length;
    sheet.insertColumnBefore(insertAt + 1);
    const cell = sheet.getRange(1, insertAt + 1);
    cell.setValue('Проверено');
    styleHeader(cell);
    Logger.log('Добавлена колонка «Проверено»');
  }

  // ─── Бэкфилл строк ───
  const data    = sheet.getDataRange().getValues();
  const hdr      = data[0];
  const idIdx    = hdr.indexOf('ID');
  const priceIdx = hdr.indexOf('Стоимость заказа');
  const typeIdx  = hdr.indexOf('Тип оплаты');
  const statIdx  = hdr.indexOf('Статус оплаты');
  const bzIdx    = hdr.indexOf('Безнал');
  const verIdx   = hdr.indexOf('Проверено');

  // Сумма платежей по каждому заказу (лист Платежи может быть пустым/новым)
  const paidByOrder = {};
  try {
    readSheetAsObjects('DATABASE', 'PAYMENTS').forEach(function(p) {
      if (!p['ID']) return;
      const oid = String(p['Заказ ID']);
      paidByOrder[oid] = (paidByOrder[oid] || 0) + (Number(p['Сумма']) || 0);
    });
  } catch (e) {
    Logger.log('Лист Платежи недоступен, бэкфилл по платежам пропущен: ' + e.message);
  }

  let updated = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][idIdx] || '');
    if (!id) continue;

    const price = Number(data[i][priceIdx]) || 0;
    const paid  = paidByOrder[id] || 0;
    const legacyBeznal = String(data[i][bzIdx] || '').trim();

    // Статус оплаты
    let status;
    if (paid <= 0) {
      // нет платежей — но legacy мог быть «Да»/«Нет» (старая разметка «оплачено»)
      status = (legacyBeznal === 'Да' || legacyBeznal === 'Нет') ? 'Оплачен'
             : (legacyBeznal === 'Частично') ? 'Частично'
             : 'Не оплачен';
    } else if (paid >= price) {
      status = 'Оплачен';
    } else {
      status = 'Частично';
    }
    if (statIdx >= 0 && !String(data[i][statIdx] || '').trim()) {
      sheet.getRange(i + 1, statIdx + 1).setValue(status);
    }

    // Тип оплаты (только если пусто)
    if (typeIdx >= 0 && !String(data[i][typeIdx] || '').trim()) {
      const guessed = legacyBeznal === 'Да' ? 'Безнал' : legacyBeznal === 'Нет' ? 'Нал' : '';
      if (guessed) sheet.getRange(i + 1, typeIdx + 1).setValue(guessed);
    }

    // Проверено
    if (verIdx >= 0 && !String(data[i][verIdx] || '').trim()) {
      sheet.getRange(i + 1, verIdx + 1).setValue('Нет');
    }
    updated++;
  }

  Logger.log('migratePaymentModel: обработано строк ' + updated);
  return 'Миграция v1.6 выполнена: колонки + бэкфилл (' + updated + ' строк)';
}

// ─── Оригинальная функция (оставляем для истории) ────────────────────────────

/**
 * ГЛАВНАЯ ФУНКЦИЯ ПЕРВОНАЧАЛЬНОЙ НАСТРОЙКИ
 * УЖЕ БЫЛА ЗАПУЩЕНА. Повторный запуск безопасен — пропустит существующие листы.
 */
function runFirstSetup() {
  Logger.log('Начинаем настройку...');
  
  const schema = getDatabaseSchema();
  const book = openBook('DATABASE');
  
  let created = 0;
  let skipped = 0;
  
  for (const [tabKey, columns] of Object.entries(schema)) {
    const tabName = CONFIG.TABS[tabKey];
    if (!tabName) continue;
    
    let sheet = book.getSheetByName(tabName);
    if (!sheet) {
      sheet = book.insertSheet(tabName);
    }
    
    if (sheet.getLastRow() > 0) {
      skipped++;
      continue;
    }
    
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    const headerRange = sheet.getRange(1, 1, 1, columns.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1a2230');
    headerRange.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, columns.length);
    created++;
  }
  
  Logger.log('Готово! Создано: ' + created + ', пропущено: ' + skipped);
  return 'Создано: ' + created + ', пропущено: ' + skipped;
}

function getDatabaseSchema() {
  return {
    EMPLOYEES: [
      'ID', 'ФИО', 'Телефон', 'Email',
      'Основная должность', 'Доп. роли', 'Направления',
      'Статус', 'Дата приёма', 'Дата увольнения',
      'Базовая ставка', '% бонуса', 'Аватар', 'Заметки',
      'Создан', 'Обновлён'
    ],
    POSITIONS:  ['Код', 'Название', 'Описание', 'Активна'],
    SERVICES: [
      'Код', 'Название', 'Категория', 'Тип расчёта',
      'Базовая цена', 'Валюта', 'Единица измерения',
      'Расход материала', '% мастеру', '% менеджеру',
      'Шаблон договора', 'Активна', 'Описание'
    ],
    EXPENSES: [
      'ID', 'Дата', 'Категория', 'Описание',
      'Сумма', 'Валюта', 'Способ оплаты',
      'Связан с заказом', 'Связан с сотрудником', 'Связан с товаром',
      'Кто внёс', 'Комментарий', 'Создан'
    ],
    CYCLES: [
      'ID', 'Номер', 'Дата открытия', 'Дата закрытия',
      'Кто закрыл', 'Выручка', 'Расходы',
      'ЗП ставки', 'ЗП бонусы', 'Касса изъято',
      'Чистая прибыль', 'Статус', 'Комментарий'
    ],
    TASKS: [
      'ID', 'Дата создания', 'Тип', 'Заголовок', 'Описание',
      'Связан с', 'ID связи', 'Назначена кому', 'Создал кто',
      'Срок', 'Приоритет', 'Статус', 'Дата выполнения'
    ],
    NOTIFICATIONS: [
      'ID', 'Дата', 'Получатель', 'Тип',
      'Текст', 'Связан с', 'ID связи',
      'Прочитано', 'Дата прочтения'
    ],
    ACTIVITY_LOG: [
      'Дата и время', 'Кто', 'Действие',
      'Объект', 'ID объекта',
      'Старое значение', 'Новое значение', 'Комментарий'
    ],
    SETTINGS:   ['Ключ', 'Значение', 'Описание', 'Категория'],
    PRODUCTS: [
      'ID', 'Артикул', 'Название', 'Категория', 'Бренд',
      'Единица измерения', 'Закупочная цена', 'Опт. цена', 'Розн. цена', 'Валюта',
      'Поставщик', 'Активен', 'Фото', 'Описание', 'Создан', 'Обновлён'
    ],
    STOCK: ['Товар ID', 'Название', 'Доступно', 'Зарезервировано', 'Всего', 'Локация', 'Обновлено'],
    STOCK_MOVES: [
      'ID', 'Дата', 'Тип операции', 'Товар ID', 'Название товара', 'Количество',
      'Цена за единицу', 'Сумма', 'Валюта', 'Контрагент',
      'Связан с заказом', 'Связан с продажей', 'Кто провёл', 'Комментарий'
    ],
    WHOLESALE: [
      'ID', 'Название', 'Тип', 'Контактное лицо', 'Должность',
      'Телефон', 'Email', 'УНП/ИНН', 'Юр. адрес',
      'Расчётный счёт', 'Банк', 'BIC', 'Тариф', 'Долг', 'Дата создания', 'Заметки'
    ],
    SALES: [
      'ID', 'Дата', 'Клиент ID', 'Клиент', 'Телефон',
      'Способ оплаты',          // Нал / Безнал / Отсрочка / Рассрочка
      'Итого', 'Оплачено', 'Статус оплаты',   // Не оплачен / Частично / Оплачен
      'Менеджер', 'Бонус %', 'Бонус сумма',   // менеджер продажи и его бонус
      'Срок оплаты', 'Комментарий', 'Удалён', 'Создан', 'Обновлён'
    ],
    SALE_ITEMS: [
      'ID', 'Продажа ID', 'Материал ID', 'Название',
      'Единица',                // пог.м / рулон / м² / шт
      'Кол-во', 'Цена', 'Сумма', 'Создан'
    ],
  };
}

/**
 * Проверка структуры базы данных
 */
function checkDatabaseStructure() {
  Logger.log('Проверка структуры...');
  const allSchemas = Object.assign({}, getDatabaseSchema(), getNewSheetsSchema());
  const book = openBook('DATABASE');
  let ok = 0, issues = 0;
  
  for (const [tabKey, expectedColumns] of Object.entries(allSchemas)) {
    const tabName = CONFIG.TABS[tabKey];
    if (!tabName) continue;
    const sheet = book.getSheetByName(tabName);
    if (!sheet) {
      Logger.log('ОТСУТСТВУЕТ: ' + tabName);
      issues++;
      continue;
    }
    const actualColumns = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
    const missing = expectedColumns.filter(c => !actualColumns.includes(c));
    if (missing.length > 0) {
      Logger.log('Отсутствуют колонки в ' + tabName + ': ' + missing.join(', '));
      issues++;
    } else {
      Logger.log('OK: ' + tabName + ' (' + actualColumns.length + ' колонок)');
      ok++;
    }
  }
  Logger.log('Итог: ' + ok + ' OK, ' + issues + ' проблем');
  return { ok: ok, issues: issues };
}
