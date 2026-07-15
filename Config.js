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
    EXPENSE_CAT:     'Категории расходов',
    CYCLES:          'Циклы расчёта',
    TASKS:           'Задачи',
    NOTIFICATIONS:   'Уведомления',
    ACTIVITY_LOG:    'Журнал действий',
    SETTINGS:        'Настройки',
    PRODUCTS:        'Товары',
    STOCK:           'Остатки',
    STOCK_MOVES:     'Движение товаров',
    WHOLESALE:       'Оптовые клиенты',
    SALES:           'Продажи',              // продажи материалов клиентам (шапка)
    SALE_ITEMS:      'Позиции продаж',       // строки продажи (материал/кол-во/цена)
    
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
    ORDER_PHOTOS:    'Фото заказов',     // фото до/после (ссылки на Google Drive)
    MAT_MOVES:       'Движение материалов', // приход/списание/коррекция остатков плёнки
    APPOINTMENTS:    'Записи',             // календарь записей клиентов на услуги

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
  
  // Каталог услуг по умолчанию. Переопределяется per-tenant через настройку
  // SERVICES_JSON (white-label). contractPrefix — префикс нумерации договоров услуги.
  SERVICES: [
    { code: 'PPF',     name: 'Оклейка PPF',   icon: '🛡️', active: true,  calcType: 'area',     bonusPoolPct: 35, managerBonusPct: 5, contractPrefix: '04/01-', color: '#4da6ff' },
    { code: 'TINT',    name: 'Тонировка',     icon: '🎨', active: true,  calcType: 'elements', bonusPoolPct: 35, managerBonusPct: 5, contractPrefix: '12/01-', color: '#9b59b6' },
    { code: 'POLISH',  name: 'Полировка',     icon: '✨', active: false, calcType: 'fixed',    bonusPoolPct: 35, managerBonusPct: 5, contractPrefix: '05/01-', color: '#f0a500' },
    { code: 'CERAMIC', name: 'Керамика',      icon: '💎', active: false, calcType: 'fixed',    bonusPoolPct: 35, managerBonusPct: 5, contractPrefix: '06/01-', color: '#1abc9c' },
    { code: 'ANTICHR', name: 'Антихром',      icon: '⬛', active: false, calcType: 'elements', bonusPoolPct: 35, managerBonusPct: 5, contractPrefix: '07/01-', color: '#34495e' },
    { code: 'SOUND',   name: 'Шумоизоляция',  icon: '🔇', active: false, calcType: 'hourly',   bonusPoolPct: 35, managerBonusPct: 5, contractPrefix: '08/01-', color: '#e67e22' },
    { code: 'CHEMIE',  name: 'Химчистка',     icon: '🧹', active: false, calcType: 'fixed',    bonusPoolPct: 35, managerBonusPct: 5, contractPrefix: '09/01-', color: '#5cb85c' },
    { code: 'ANTICOR', name: 'Антикор',       icon: '🛢️', active: false, calcType: 'fixed',    bonusPoolPct: 35, managerBonusPct: 5, contractPrefix: '10/01-', color: '#d9534f' },
  ],

  // Комплексы оклейки PPF по умолчанию. Переопределяются per-tenant через
  // настройку COMPLEXES_JSON (white-label). price — ориентировочная цена (подсказка),
  // els — состав (список оклеиваемых элементов). Стоимость заказа НЕ перезаписывается.
  COMPLEXES: [
    { name: 'Оптима',         price: 1300, els: ['капот полностью','крылья 1/3','передняя оптика','стойки лобового стекла','полоса на крышу','зона выгрузки','внутренние пороги','кромки дверей','антиманикюр'] },
    { name: 'Оптима+',        price: 1600, els: ['капот полностью','крылья полностью','передняя оптика','стойки лобового стекла','полоса на крышу','зона выгрузки','внутренние пороги','кромки дверей','антиманикюр'] },
    { name: 'Премиум',        price: 2350, els: ['капот полностью','крылья полностью','передний бампер','передняя оптика','стойки лобового стекла','полоса на крышу','зона выгрузки','внутренние пороги','кромки дверей','антиманикюр','боковые зеркала'] },
    { name: 'Полная оклейка', price: 0,    els: ['полная оклейка кузова'] },
  ],

  // Статусы заказов = «воронки» канбана (white-label, переопределяются настройкой
  // ORDER_STATUSES_JSON). id — стабильный ключ для распознавания переименований.
  // cancelled:true — стадия «отменён»: такие заказы НЕ учитываются в выручке/ДДС/ЗП.
  // done:true — завершённая стадия (напр. «Выдан»): не считается «в работе».
  ORDER_STATUSES: [
    { id: 'new',       name: 'Новый',    color: '#6c8ebf' },
    { id: 'work',      name: 'В работе', color: '#f0a500' },
    { id: 'done',      name: 'Готов',    color: '#4da6ff' },
    { id: 'delivered', name: 'Выдан',    color: '#5cb85c', done: true },
    { id: 'cancelled', name: 'Отменён',  color: '#d9534f', cancelled: true },
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
  
  // Стартовый набор категорий (сид для листа «Категории расходов»).
  // Реальный список берётся из листа и редактируется в Настройках.
  EXPENSE_CATEGORIES: [
    'Материалы', 'Аренда', 'Коммунальные', 'Зарплата',
    'Зарплата за предыдущий период',
    'Бонусы', 'Маркетинг', 'Налоги', 'Транспорт',
    'Закупка товаров', 'Изъятие владельца', 'Прочее',
  ],
  // Категории, которые по умолчанию вычитаются из ЗП при расчёте (флаг «Вычитать из ЗП»).
  // «Зарплата за предыдущий период» СЮДА НЕ входит — она гасит долг прошлого периода.
  EXPENSE_CATEGORIES_SALARY_DEDUCT: ['Зарплата'],

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
