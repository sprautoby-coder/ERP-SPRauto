/**
 * Api_Notifications.gs — напоминания о платежах (дебиторка).
 *
 * Логика v1: ежедневный ДАЙДЖЕСТ владельцу/менеджеру (а не авто-рассылка
 * клиентам) — список просроченных и скоро наступающих платежей. Это безопасно
 * (нельзя случайно «спамить» клиентов неверными суммами) и сразу полезно:
 * бизнес видит, кому звонить сегодня.
 *
 * Каналы: e-mail (MailApp, без секретов) и Telegram (если задан бот-токен и
 * chat_id в настройках). Ежедневный запуск — триггер, включается кнопкой из UI.
 *
 * Разовый шаг владельца: при первом запуске Google Apps Script попросит доступ
 * к отправке почты и внешним запросам — подтвердить один раз.
 */

// ─── ДАЙДЖЕСТ ────────────────────────────────────────────────────────────────

/**
 * Собирает дайджест: просроченные + платежи в ближайшие daysBefore дней.
 * @param {number} daysBefore сколько дней вперёд считать «скоро»
 */
function buildReminderDigest_(daysBefore) {
  daysBefore = Number(daysBefore) || 3;
  var resp = getDebtOrders();
  var debts = (resp && resp.ok) ? (resp.data || []) : [];

  var overdue = [], soon = [];
  debts.forEach(function(d) {
    if (d.isOverdue) overdue.push(d);
    else if (d.daysUntilDue !== null && d.daysUntilDue >= 0 && d.daysUntilDue <= daysBefore) soon.push(d);
  });
  // Просроченные — по «дольше всех» сверху; скоро — по ближайшей дате
  overdue.sort(function(a, b){ return (a.daysUntilDue||0) - (b.daysUntilDue||0); });
  soon.sort(function(a, b){ return (a.daysUntilDue||0) - (b.daysUntilDue||0); });

  var cur = getSettingValue_('currency');
  var sym = ({ BYN:'Br', RUB:'₽', USD:'$', EUR:'€' })[cur] || 'Br';
  var fmt = function(n){ return Math.round(Number(n)||0).toLocaleString('ru') + ' ' + sym; };

  var company = getSettingValue_('company_name') || 'SPRauto';

  var line = function(d, kind) {
    var when = d.isOverdue
      ? ('просрочен на ' + Math.abs(d.daysUntilDue) + ' дн.')
      : (d.daysUntilDue === 0 ? 'сегодня' : ('через ' + d.daysUntilDue + ' дн.'));
    return '• ' + (d.contract || d.id) + ' — ' + d.client + ' (' + (d.phone || 'без тел.') + '): ' +
           'остаток ' + fmt(d.remaining) + ', срок ' + (d.dueDate || '—') + ' (' + when + ')';
  };

  var textParts = [];
  textParts.push(company + ' — напоминание о платежах');
  textParts.push('');
  if (overdue.length) {
    textParts.push('🔴 ПРОСРОЧЕНО (' + overdue.length + '):');
    overdue.forEach(function(d){ textParts.push(line(d, 'overdue')); });
    textParts.push('');
  }
  if (soon.length) {
    textParts.push('🟡 СКОРО (' + soon.length + ', в ближайшие ' + daysBefore + ' дн.):');
    soon.forEach(function(d){ textParts.push(line(d, 'soon')); });
    textParts.push('');
  }
  var sumOverdue = overdue.reduce(function(a, d){ return a + (Number(d.remaining)||0); }, 0);
  if (overdue.length) textParts.push('Итого просрочено: ' + fmt(sumOverdue));

  var textBody = textParts.join('\n');

  // HTML-вариант для письма
  var rowHtml = function(d) {
    var color = d.isOverdue ? '#d9534f' : '#f0a500';
    var when  = d.isOverdue ? ('просрочен на ' + Math.abs(d.daysUntilDue) + ' дн.')
              : (d.daysUntilDue === 0 ? 'сегодня' : ('через ' + d.daysUntilDue + ' дн.'));
    return '<tr>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + (d.contract || d.id) + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + d.client + '<br><span style="color:#888;font-size:12px">' + (d.phone||'') + '</span></td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">' + fmt(d.remaining) + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + (d.dueDate||'—') + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee;color:' + color + '">' + when + '</td>' +
    '</tr>';
  };
  var section = function(title, list, color) {
    if (!list.length) return '';
    return '<h3 style="color:' + color + ';margin:18px 0 6px">' + title + ' (' + list.length + ')</h3>' +
      '<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px">' +
      '<tr style="text-align:left;color:#888"><th style="padding:6px 10px">Договор</th><th style="padding:6px 10px">Клиент</th><th style="padding:6px 10px;text-align:right">Остаток</th><th style="padding:6px 10px">Срок</th><th style="padding:6px 10px">Статус</th></tr>' +
      list.map(rowHtml).join('') + '</table>';
  };
  var htmlBody =
    '<div style="font-family:Arial,sans-serif;max-width:680px">' +
      '<h2 style="margin:0 0 4px">' + company + '</h2>' +
      '<div style="color:#888;margin-bottom:8px">Напоминание о платежах · ' +
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy') + '</div>' +
      section('🔴 Просрочено', overdue, '#d9534f') +
      section('🟡 Скоро', soon, '#c8870a') +
      (overdue.length ? '<p style="margin-top:14px;font-weight:600">Итого просрочено: ' + fmt(sumOverdue) + '</p>' : '') +
      (!overdue.length && !soon.length ? '<p>Нет платежей, требующих внимания. 👍</p>' : '') +
    '</div>';

  return {
    overdue: overdue, soon: soon,
    hasAny: overdue.length > 0 || soon.length > 0,
    textBody: textBody, htmlBody: htmlBody, company: company,
  };
}

// ─── ОТПРАВКА ────────────────────────────────────────────────────────────────

/**
 * Отправить напоминание сейчас (по кнопке «Проверить/отправить»).
 * Шлёт на e-mail (настройка notify_email или почта владельца) и в Telegram
 * (если заданы telegram_bot_token + telegram_chat_id).
 */
function sendPaymentRemindersNow() {
  return safeCall(function() {
    var daysBefore = Number(getSettingValue_('reminder_days_before')) || 3;
    var digest = buildReminderDigest_(daysBefore);

    var result = { overdueCount: digest.overdue.length, soonCount: digest.soon.length, emailSent: false, telegramSent: false, errors: [] };

    // E-mail
    var email = String(getSettingValue_('notify_email') || '').trim();
    if (!email) { try { email = Session.getActiveUser().getEmail(); } catch (e) {} }
    if (email) {
      try {
        MailApp.sendEmail({
          to: email,
          subject: digest.company + ' · Напоминание о платежах' +
                   (digest.overdue.length ? (' — просрочено ' + digest.overdue.length) : ''),
          htmlBody: digest.htmlBody,
        });
        result.emailSent = true;
      } catch (e) { result.errors.push('E-mail: ' + e.message); }
    }

    // Telegram
    var token  = String(getSettingValue_('telegram_bot_token') || '').trim();
    var chatId = String(getSettingValue_('telegram_chat_id') || '').trim();
    if (token && chatId) {
      try { sendTelegram_(token, chatId, digest.textBody); result.telegramSent = true; }
      catch (e) { result.errors.push('Telegram: ' + e.message); }
    }

    logActivity('Напоминание о платежах', 'Система', '', '',
      'overdue=' + result.overdueCount + ' soon=' + result.soonCount +
      ' email=' + result.emailSent + ' tg=' + result.telegramSent);

    return result;
  });
}

/** Точка входа ежедневного триггера: шлём только если есть что напомнить. */
function dailyPaymentReminders() {
  var daysBefore = Number(getSettingValue_('reminder_days_before')) || 3;
  var digest = buildReminderDigest_(daysBefore);
  if (!digest.hasAny) return; // не отправляем пустые письма
  sendPaymentRemindersNow();
}

/** Отправка сообщения в Telegram через Bot API. */
function sendTelegram_(token, chatId, text) {
  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    muteHttpExceptions: true,
    payload: { chat_id: chatId, text: text, disable_web_page_preview: 'true' },
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('Telegram API ' + code + ': ' + res.getContentText().slice(0, 200));
}

// ─── ТРИГГЕР (включение/выключение из UI) ────────────────────────────────────

/** Включить ежедневные напоминания в указанный час (по умолчанию 9 утра). */
function enablePaymentReminders(hour) {
  return safeCall(function() {
    hour = Number(hour); if (isNaN(hour) || hour < 0 || hour > 23) hour = 9;
    removeReminderTriggers_();
    ScriptApp.newTrigger('dailyPaymentReminders').timeBased().everyDays(1).atHour(hour).create();
    saveSetting('reminder_hour', String(hour), 'Час ежедневных напоминаний', 'Уведомления');
    saveSetting('reminder_enabled', 'Да', 'Ежедневные напоминания включены', 'Уведомления');
    return { enabled: true, hour: hour };
  });
}

/** Выключить ежедневные напоминания. */
function disablePaymentReminders() {
  return safeCall(function() {
    removeReminderTriggers_();
    saveSetting('reminder_enabled', 'Нет', 'Ежедневные напоминания включены', 'Уведомления');
    return { enabled: false };
  });
}

/** Статус: включён ли триггер + текущие настройки уведомлений. */
function getReminderStatus() {
  return safeCall(function() {
    var has = ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction() === 'dailyPaymentReminders'; });
    return {
      enabled:    has,
      hour:       Number(getSettingValue_('reminder_hour')) || 9,
      daysBefore: Number(getSettingValue_('reminder_days_before')) || 3,
      email:      getSettingValue_('notify_email') || '',
      telegram:   !!(getSettingValue_('telegram_bot_token') && getSettingValue_('telegram_chat_id')),
    };
  });
}

function removeReminderTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'dailyPaymentReminders') ScriptApp.deleteTrigger(t);
  });
}
