/**
 * SPRauto ERP — конфигурация
 * ЕДИНСТВЕННОЕ место, где хранятся ID таблиц, папок и константы.
 * Никогда не дублируй ID в других файлах!
 */

const CONFIG = {
  APP_NAME: 'SPRauto ERP',
  VERSION: '1.0.0',
  
  // Режим работы: DEV или PROD
  // На время разработки — только DEV
  MODE: 'DEV',
  
  /**
   * ID Google Spreadsheets
   * Перед PROD-запуском заполнить раздел PROD
   */
  SHEETS: {
    DEV: {
      // === НОВАЯ книга базы данных ===
      DATABASE:          '1AQSV-b-rK-eAgWGvLjMKQdyLqDeSQLZ-jAeG9F5cZRc',
      
      // === Существующие книги (как есть) ===
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
  
  /**
   * Названия листов внутри книг
   */
  TABS: {
    // В книге [DEV] SPRauto · База данных
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
    
    // В книге Расчёт ОКЛЕЙКА
    RASCHET:         'Расчёт ОКЛЕЙКА',
    DDS_CLIENTS:     'ДДС Клиенты',
    DDS_EXPENSES:    'ДДС Затраты',
  },
  
  /**
   * Папки Google Drive
   */
  FOLDERS: {
    DEV: {
      DOCUMENTS:     '',  // заполни позже — папка для генерации документов
      TEMPLATES:     '',  // папка с шаблонами договоров и актов
      PHOTOS:        '',  // папка для фото автомобилей
    },
    PROD: {
      DOCUMENTS:     '',
      TEMPLATES:     '',
      PHOTOS:        '',
    },
  },
  
  /**
   * ID шаблонов документов (Google Docs)
   */
  TEMPLATES: {
    CONTRACT_PHYSICAL_PPF:  '',
    CONTRACT_LEGAL_PPF:     '',
    CONTRACT_PHYSICAL_TINT: '',
    CONTRACT_LEGAL_TINT:    '',
    ORDER_FORM:             '',
    ACT:                    '',
    INVOICE:                '',
  },
  
  /**
   * Дефолтные значения и бизнес-правила
   */
  DEFAULT_CURRENCY: 'BYN',
  DEFAULT_LANGUAGE: 'ru',
  
  CURRENCIES: [
    { code: 'BYN', name: 'Белорусский рубль', symbol: 'Br' },
    { code: 'RUB', name: 'Российский рубль',  symbol: '₽' },
    { code: 'USD', name: 'Доллар США',        symbol: '$' },
    { code: 'EUR', name: 'Евро',              symbol: '€' },
  ],
  
  /**
   * Должности (твой список)
   */
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
  
/**
   * Услуги (стартовый справочник)
   * bonusPoolPct — % фонда бонусов от валовой прибыли заказа.
   *                Этот фонд делится между всеми мастерами заказа.
   * managerBonusPct — отдельный % менеджеру (если был лид/привод клиента).
   */
  SERVICES: [
    { code: 'PPF',     name: 'Оклейка PPF',  icon: '🛡️', active: true,  calcType: 'area',     bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'TINT',    name: 'Тонировка',    icon: '🎨', active: true,  calcType: 'elements', bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'POLISH',  name: 'Полировка',    icon: '✨', active: false, calcType: 'fixed',    bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'CERAMIC', name: 'Керамика',     icon: '💎', active: false, calcType: 'fixed',    bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'ANTICHR', name: 'Антихром',     icon: '⬛', active: false, calcType: 'elements', bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'SOUND',   name: 'Шумоизоляция', icon: '🔇', active: false, calcType: 'hourly',   bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'CHEMIE',  name: 'Химчистка',    icon: '🧹', active: false, calcType: 'fixed',    bonusPoolPct: 35, managerBonusPct: 5 },
    { code: 'ANTICOR', name: 'Антикор',      icon: '🛢️', active: false, calcType: 'fixed',    bonusPoolPct: 35, managerBonusPct: 5 },
  ],
  
  /**
   * Категории расходов
   */
  EXPENSE_CATEGORIES: [
    'Материалы',
    'Аренда',
    'Коммунальные',
    'Зарплата',
    'Бонусы',
    'Маркетинг',
    'Налоги',
    'Транспорт',
    'Закупка товаров',
    'Изъятие владельца',
    'Прочее',
  ],
  
  /**
   * Категории товаров склада
   */
  INVENTORY_CATEGORIES: [
    'PPF плёнка',
    'Тонировочная плёнка',
    'Защита фар',
    'Химия',
    'Расходники',
    'Инструмент',
    'Аксессуары',
  ],
  
  /**
   * Роли доступа (заготовка)
   */
  ROLES: {
    OWNER:    { name: 'Владелец',      level: 100 },
    DIRECTOR: { name: 'Директор',      level: 90 },
    ADMIN:    { name: 'Администратор', level: 70 },
    MANAGER:  { name: 'Менеджер',      level: 50 },
    MASTER:   { name: 'Мастер',        level: 30 },
    ACCOUNT:  { name: 'Бухгалтер',     level: 40 },
    VIEW:     { name: 'Просмотр',      level: 10 },
  },
};

/**
 * Хелперы для доступа к таблицам и папкам
 */

function getSheetId(key) {
  const id = CONFIG.SHEETS[CONFIG.MODE][key];
  if (!id) throw new Error(`No SHEET ID for key: ${key} in mode ${CONFIG.MODE}`);
  return id;
}

function openBook(key) {
  return SpreadsheetApp.openById(getSheetId(key));
}

function getTab(bookKey, tabKey) {
  const book = openBook(bookKey);
  const tabName = CONFIG.TABS[tabKey];
  if (!tabName) throw new Error(`No TAB name for key: ${tabKey}`);
  const sheet = book.getSheetByName(tabName);
  if (!sheet) throw new Error(`Tab "${tabName}" not found in book ${bookKey}`);
  return sheet;
}