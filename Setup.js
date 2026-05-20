/**
 * Setup.gs — первоначальная настройка таблиц
 * Запусти функцию runFirstSetup() один раз, чтобы создать все заголовки.
 */

/**
 * ГЛАВНАЯ ФУНКЦИЯ ПЕРВОНАЧАЛЬНОЙ НАСТРОЙКИ
 * Запускать ТОЛЬКО ОДИН РАЗ после создания книги.
 * Создаёт все заголовки колонок во всех новых листах.
 */
function runFirstSetup() {
  Logger.log('🚀 Начинаем первоначальную настройку...');
  
  const schema = getDatabaseSchema();
  const book = openBook('DATABASE');
  
  let created = 0;
  let skipped = 0;
  
  for (const [tabKey, columns] of Object.entries(schema)) {
    const tabName = CONFIG.TABS[tabKey];
    if (!tabName) {
      Logger.log(`⚠️  Пропуск: нет имени для ключа ${tabKey}`);
      continue;
    }
    
    let sheet = book.getSheetByName(tabName);
    if (!sheet) {
      sheet = book.insertSheet(tabName);
      Logger.log(`✅ Создан лист: ${tabName}`);
    }
    
    // Проверяем, есть ли уже заголовки
    if (sheet.getLastRow() > 0) {
      Logger.log(`⏭️  Лист "${tabName}" уже содержит данные — пропускаем заголовки`);
      skipped++;
      continue;
    }
    
    // Записываем заголовки
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    
    // Форматируем строку заголовков
    const headerRange = sheet.getRange(1, 1, 1, columns.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1a2230');
    headerRange.setFontColor('#ffffff');
    headerRange.setHorizontalAlignment('left');
    headerRange.setVerticalAlignment('middle');
    
    // Замораживаем первую строку
    sheet.setFrozenRows(1);
    
    // Авторазмер колонок
    sheet.autoResizeColumns(1, columns.length);
    
    Logger.log(`✅ Лист "${tabName}": создано ${columns.length} колонок`);
    created++;
  }
  
  Logger.log(`✨ Готово! Создано: ${created}, пропущено: ${skipped}`);
  
  // Удалим стандартный «Лист1», если он пустой
  const defaultSheet = book.getSheetByName('Лист1');
  if (defaultSheet && defaultSheet.getLastRow() === 0) {
    book.deleteSheet(defaultSheet);
    Logger.log('🗑️  Удалён пустой "Лист1"');
  }
  
  return `✅ Настройка завершена. Создано листов: ${created}, пропущено: ${skipped}`;
}

/**
 * Схема всех листов с заголовками колонок
 */
function getDatabaseSchema() {
  return {
    EMPLOYEES: [
      'ID', 'ФИО', 'Телефон', 'Email', 
      'Основная должность', 'Доп. роли', 'Направления',
      'Статус', 'Дата приёма', 'Дата увольнения',
      'Базовая ставка', '% бонуса', 'Аватар', 'Заметки',
      'Создан', 'Обновлён'
    ],
    
    POSITIONS: [
      'Код', 'Название', 'Описание', 'Активна'
    ],
    
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
      'Связан с', 'ID связи',
      'Назначена кому', 'Создал кто',
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
    
    SETTINGS: [
      'Ключ', 'Значение', 'Описание', 'Категория'
    ],
    
    PRODUCTS: [
      'ID', 'Артикул', 'Название', 'Категория', 'Бренд',
      'Единица измерения',
      'Закупочная цена', 'Опт. цена', 'Розн. цена', 'Валюта',
      'Поставщик', 'Активен', 'Фото', 'Описание',
      'Создан', 'Обновлён'
    ],
    
    STOCK: [
      'Товар ID', 'Название', 'Доступно',
      'Зарезервировано', 'Всего',
      'Локация', 'Обновлено'
    ],
    
    STOCK_MOVES: [
      'ID', 'Дата', 'Тип операции',
      'Товар ID', 'Название товара', 'Количество',
      'Цена за единицу', 'Сумма', 'Валюта',
      'Контрагент', 'Связан с заказом', 'Связан с продажей',
      'Кто провёл', 'Комментарий'
    ],
    
    WHOLESALE: [
      'ID', 'Название', 'Тип',
      'Контактное лицо', 'Должность',
      'Телефон', 'Email',
      'УНП/ИНН', 'Юр. адрес',
      'Расчётный счёт', 'Банк', 'BIC',
      'Тариф', 'Долг', 'Дата создания', 'Заметки'
    ],
    
    SALES: [
      'ID', 'Дата', 'Оптовый клиент ID', 'Название клиента',
      'Товары (JSON)', 'Количество позиций',
      'Сумма', 'Валюта',
      'Оплачено', 'Долг', 'Способ оплаты',
      'Документ', 'Статус', 'Кто провёл', 'Комментарий'
    ],
  };
}

/**
 * Заполнение тестовыми данными (опционально, для разработки)
 * Запусти после runFirstSetup() если нужны примеры.
 */
function fillTestData() {
  fillTestEmployees_();
  fillTestPositions_();
  fillTestServices_();
  Logger.log('✅ Тестовые данные заполнены');
}

function fillTestPositions_() {
  const sheet = getTab('DATABASE', 'POSITIONS');
  if (sheet.getLastRow() > 1) return; // уже есть данные
  
  const data = CONFIG.POSITIONS.map((name, i) => [
    'POS-' + String(i + 1).padStart(3, '0'),
    name,
    '',
    'Да'
  ]);
  
  sheet.getRange(2, 1, data.length, data[0].length).setValues(data);
}

function fillTestEmployees_() {
  const sheet = getTab('DATABASE', 'EMPLOYEES');
  if (sheet.getLastRow() > 1) return;
  
  const now = new Date();
  const data = [
    ['СОТР-001', 'Карпов Андрей Сергеевич', '+375 29 111-11-11', '', 'Оклейщик', 'Менеджер', 'PPF,Антихром', 'Работает', new Date(2024, 0, 15), '', 4500, 15, '', '', now, now],
    ['СОТР-002', 'Резник Михаил Петрович',  '+375 29 222-22-22', '', 'Тонировщик', '',           'Тонировка',  'Работает', new Date(2024, 2, 10), '', 3800, 12, '', '', now, now],
    ['СОТР-003', 'Власов Сергей Викторович','+375 29 333-33-33', '', 'Оклейщик', '',             'PPF',        'Работает', new Date(2024, 5, 1),  '', 3500, 12, '', '', now, now],
    ['СОТР-004', 'Пархоменко Елена Ивановна','+375 29 444-44-44', '', 'Менеджер', 'Администратор','Менеджер',   'Работает', new Date(2024, 1, 1),  '', 2800, 5,  '', '', now, now],
  ];
  
  sheet.getRange(2, 1, data.length, data[0].length).setValues(data);
}

function fillTestServices_() {
  const sheet = getTab('DATABASE', 'SERVICES');
  if (sheet.getLastRow() > 1) return;
  
  const data = CONFIG.SERVICES.map(s => [
    s.code,
    s.name,
    '',
    s.calcType === 'area' ? 'По площади' : s.calcType === 'elements' ? 'По элементам' : s.calcType === 'hourly' ? 'Почасовая' : 'Фиксированная',
    '',
    'BYN',
    s.calcType === 'area' ? 'м²' : s.calcType === 'elements' ? 'элемент' : s.calcType === 'hourly' ? 'час' : '',
    '',
    15,
    5,
    '',
    s.active ? 'Да' : 'Нет',
    ''
  ]);
  
  sheet.getRange(2, 1, data.length, data[0].length).setValues(data);
}

/**
 * Полная проверка готовности базы данных
 */
function checkDatabaseStructure() {
  Logger.log('🔍 Проверка структуры базы данных...');
  const schema = getDatabaseSchema();
  const book = openBook('DATABASE');
  
  let ok = 0, issues = 0;
  
  for (const [tabKey, expectedColumns] of Object.entries(schema)) {
    const tabName = CONFIG.TABS[tabKey];
    const sheet = book.getSheetByName(tabName);
    
    if (!sheet) {
      Logger.log(`❌ ${tabName}: лист отсутствует`);
      issues++;
      continue;
    }
    
    const actualColumns = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
    const missing = expectedColumns.filter(c => !actualColumns.includes(c));
    
    if (missing.length > 0) {
      Logger.log(`⚠️  ${tabName}: отсутствуют колонки: ${missing.join(', ')}`);
      issues++;
    } else {
      Logger.log(`✅ ${tabName}: OK (${actualColumns.length} колонок)`);
      ok++;
    }
  }
  
  Logger.log(`\n📊 Итог: ${ok} OK, ${issues} проблем`);
  return { ok, issues };
}