/**
 * Setup.gs — настройка таблиц
 * 
 * ВАЖНО: runFirstSetup() уже был запущен!
 * Для добавления новых листов используй addNewSheets()
 */

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
 * Схема ТОЛЬКО НОВЫХ листов (v1.1)
 * Существующие листы здесь не перечислены — они не будут тронуты
 */
function getNewSheetsSchema() {
  return {
    
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
      'ID', 'Дата', 'Оптовый клиент ID', 'Название клиента',
      'Товары (JSON)', 'Количество позиций', 'Сумма', 'Валюта',
      'Оплачено', 'Долг', 'Способ оплаты',
      'Документ', 'Статус', 'Кто провёл', 'Комментарий'
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
