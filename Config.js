/**
 * SPRauto ERP — конфигурация
 * ЕДИНСТВЕННОЕ место, где хранятся ID таблиц, папок и константы.
 * Никогда не дублируй ID в других файлах!
 */

const CONFIG = {
  APP_NAME: 'SPRauto ERP',
  VERSION: '1.1.0',
  
  // Режим работы: DEV или PROD
  MODE: 'DEV',
  
  SHEETS: {
    DEV: {
      DATABASE:          '1SBLWRTkxxn2-5hbxBenmM4njOQOT64QsMhf-4dPqBrg',
      OKLEYKA_CLIENTS:   '1ZBZrUkBedov7Y6fE0kytBQHGcgL40pgYLjV90H-QN0M',
      TONIROVKA_CLIENTS: '1C6QzRODwaw4xf8Q-76kYb-8C-RN2itfeomu69pPLYko',
      RASCHET_OKLEYKA:   '1054JIozquIipA2Vhu6v6nv8NS0Q61aVUiBpUirtW_sU',
      RASCHET_PREMII:    '1GT_w9J0Z_IBAi9sJN_TFccUPBS-z1xRV4bJpKCPrzB8',
      RASCHET_PROJECTS:  '1Za7oxD0WT6k2gPH73B1TrnMB2yQlxPQvbaxGXNPB6DQ',
      DASHBOARD:         '1Lxr7TARkxZXiuU495gf4KcZNsiUPovNOFbW2m5Wjrg8',
    },
    PROD: {
      DATABASE:          '',
      OKLEYKA_CLIENTS:   '',
      TONIROVKA_CLIENTS: '',
      RASCHET_OKLEYKA:   '',
      RASCHET_PREMII:    '',
      RASCHET_PROJECTS:  '',
      DASHBOARD:         '',
    },
  },
  
  TABS: {
    // База данных — существующие листы
    EMPLOYEES:       'Сотрудники',
    POSITIONS:       'Должности',
    SERVICES:        'Услуги',
    EXPENSES:        'Расходы',
    CYCLES:          'Циклы расчёта',
    TASKS:           'Задачи',
    NOTIFICATIONS:   'Уведомления',
    ACTIVITY_LOG:    'Журнал действий',
    SETTINGS:        'Настройки',
    PRODUCTS:        'Товары',
    STOCK:           'Остатки',
    STOCK_MOVES:     'Движение товаров',
    WHOLESALE:       'Оптовые клиенты',
    SALES:           'Продажи со склада',
    
    // НОВЫЙ лист — Клиенты (v1.1)
    CLIENTS:         'Клиенты',
    VEHICLES:        'Автомобили',

    // НОВЫЙ лист — Заказы (v1.2)
    ORDERS:          'Заказы',

    // НОВЫЕ листы — Материалы и расходы по заказам (v1.3)
    MATERIALS:       'Справочник материалов',
    ORDER_MATERIALS: 'Расход материалов',
    ORDER_EXPENSES:  'Расходы заказа',
    PAYMENTS:        'Платежи',
    SCHEDULE:        'График платежей',

    // В книге Расчёт ОКЛЕЙКА (существующая, не трогаем)
    RASCHET:         'Расчёт ОКЛЕЙКА',
    DDS_CLIENTS:     'ДДС клиенты',
    DDS_EXPENSES:    'ДДС Затраты',
  },
  
  FOLDERS: {
    DEV:  { DOCUMENTS: '', TEMPLATES: '', PHOTOS: '' },
    PROD: { DOCUMENTS: '', TEMPLATES: '', PHOTOS: '' },
  },
  
  TEMPLATES: {
    CONTRACT_PHYSICAL_PPF:  '',
    CONTRACT_LEGAL_PPF:     '',
    CONTRACT_PHYSICAL_TINT: '',
    CONTRACT_LEGAL_TINT:    '',
    ORDER_FORM:             '',
    ACT:                    '',
    INVOICE:                '',
  },
  
  DEFAULT_CURRENCY: 'BYN',
  DEFAULT_LANGUAGE: 'ru',
  
  CURRENCIES: [
    { code: 'BYN', name: 'Белорусский рубль', symbol: 'Br' },
    { code: 'RUB', name: 'Российский рубль',  symbol: '₽' },
    { code: 'USD', name: 'Доллар США',        symbol: '$' },
    { code: 'EUR', name: 'Евро',              symbol: '€' },
  ],
  
  POSITIONS: [
    'Оклейщик',
    'Тонировщик',
    'Арматурщик',
    'Менеджер',
    'Администратор',
    'Директор',
    'Зам. директора',
    'Начальник склада',
  ],
  
  SERVICES: [
    { code: 'PPF',     name: 'Оклейка PPF',   icon: '🛡️', active: true,  calcType: 'area',     bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'TINT',    name: 'Тонировка',     icon: '🎨', active: true,  calcType: 'elements', bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'POLISH',  name: 'Полировка',     icon: '✨', active: false, calcType: 'fixed',    bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'CERAMIC', name: 'Керамика',      icon: '💎', active: false, calcType: 'fixed',    bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'ANTICHR', name: 'Антихром',      icon: '⬛', active: false, calcType: 'elements', bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'SOUND',   name: 'Шумоизоляция',  icon: '🔇', active: false, calcType: 'hourly',   bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'CHEMIE',  name: 'Химчистка',     icon: '🧹', active: false, calcType: 'fixed',    bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'ANTICOR', name: 'Антикор',       icon: '🛢️', active: false, calcType: 'fixed',    bonusPoolPct: 35, managerBonusPct: 5 },
  ],
  
  // Источники лидов (откуда пришёл клиент)
  LEAD_SOURCES: [
    'Instagram',
    'Рекомендация',
    'Повторный',
    'TikTok',
    'Google',
    'Сайт',
    'Авто.бай',
    'Другое',
  ],
  
  EXPENSE_CATEGORIES: [
    'Материалы', 'Аренда', 'Коммунальные', 'Зарплата',
    'Бонусы', 'Маркетинг', 'Налоги', 'Транспорт',
    'Закупка товаров', 'Изъятие владельца', 'Прочее',
  ],

  // Часто используемые расходы в карточке заказа (подсказки для автодополнения)
  ORDER_EXPENSE_HINTS: ['Такси', 'Арматура', 'Парковка', 'Доставка', 'Инструмент', 'Прочее'],

  // Категории материалов в справочнике
  MATERIAL_CATEGORIES: [
    'PPF плёнка', 'Тонировочная плёнка', 'Антихром',
    'Защита фар', 'Химия', 'Расходник', 'Инструмент',
  ],

  // Стандартная ширина рулона (м) — используется по умолчанию
  DEFAULT_ROLL_WIDTH: 1.52,
  
  INVENTORY_CATEGORIES: [
    'PPF плёнка', 'Тонировочная плёнка', 'Защита фар',
    'Химия', 'Расходники', 'Инструмент', 'Аксессуары',
  ],
  
  ROLES: {
    OWNER:    { name: 'Владелец',      level: 100 },
    DIRECTOR: { name: 'Директор',      level: 90  },
    ADMIN:    { name: 'Администратор', level: 70  },
    MANAGER:  { name: 'Менеджер',      level: 50  },
    MASTER:   { name: 'Мастер',        level: 30  },
    ACCOUNT:  { name: 'Бухгалтер',     level: 40  },
    VIEW:     { name: 'Просмотр',      level: 10  },
  },
};

// ─── Хелперы ────────────────────────────────────────────────────────────────

function getSheetId(key) {
  const id = CONFIG.SHEETS[CONFIG.MODE][key];
  if (!id) throw new Error('No SHEET ID for key: ' + key + ' in mode ' + CONFIG.MODE);
  return id;
}

/**
 * Кэш открытых книг на время ОДНОГО исполнения скрипта.
 * Каждый google.script.run — это свежее V8-исполнение, поэтому кэш живёт
 * только в рамках одного запроса и сбрасывается сам. Риска устаревания нет:
 * SpreadsheetApp.openById возвращает живую ссылку (не снимок данных), а
 * openById — самая дорогая операция в Apps Script. Один getOrders открывал
 * книгу DATABASE 4 раза (ORDERS/CLIENTS/PAYMENTS/SCHEDULE) — теперь 1 раз.
 * ВАЖНО: кэшируем только хэндл книги, НЕ данные листов (иначе read-after-write
 * в одном вызове мог бы вернуть устаревшие данные).
 */
const _BOOK_CACHE = {};

function openBook(key) {
  if (_BOOK_CACHE[key]) return _BOOK_CACHE[key];
  const book = SpreadsheetApp.openById(getSheetId(key));
  _BOOK_CACHE[key] = book;
  return book;
}

function getTab(bookKey, tabKey) {
  const book = openBook(bookKey);
  const tabName = CONFIG.TABS[tabKey];
  if (!tabName) throw new Error('No TAB name for key: ' + tabKey);
  const sheet = book.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab "' + tabName + '" not found in book ' + bookKey);
  return sheet;
}
