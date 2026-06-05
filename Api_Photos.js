/**
 * Api_Photos.gs — фото «до/после» по заказу.
 *
 * Сами файлы хранятся в Google Drive (в папке компании), а в листе
 * «Фото заказов» лежат только ссылки. Это держит таблицу лёгкой и позволяет
 * показывать галерею в карточке заказа.
 *
 * ВАЖНО (разовый шаг владельца): при ПЕРВОМ использовании Google Apps Script
 * запросит доступ к Google Drive — нужно один раз подтвердить (переавторизация).
 */

// ─── ПАПКА ХРАНЕНИЯ ──────────────────────────────────────────────────────────

/**
 * Возвращает папку Google Drive для фото заказов.
 * ID папки хранится в настройках (ключ photos_folder_id). Если папки нет —
 * создаёт её и запоминает ID. Идемпотентно.
 */
function getPhotosFolder_() {
  var folderId = getSettingValue_('photos_folder_id');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); }
    catch (e) { /* папку удалили — создадим заново ниже */ }
  }
  var company = getSettingValue_('company_name') || 'SPRauto';
  var folder = DriveApp.createFolder(company + ' — Фото заказов');
  saveSetting('photos_folder_id', folder.getId(), 'Папка Google Drive с фото заказов', 'Система');
  return folder;
}

/** Прочитать одно значение настройки по ключу (без обёртки). */
function getSettingValue_(key) {
  var sheet = getTab('DATABASE', 'SETTINGS');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';
  var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return '';
}

// ─── ЗАГРУЗКА / ЧТЕНИЕ / УДАЛЕНИЕ ────────────────────────────────────────────

/**
 * Загрузить фото по заказу.
 * @param {Object} payload { orderId, kind ('До'|'После'), dataUrl, filename }
 * @return {Object} запись о фото { id, orderId, kind, fileId, url, viewUrl, filename }
 */
function uploadOrderPhoto(payload) {
  return safeCall(function() {
    bumpDataVersion_();
    payload = payload || {};
    var orderId = String(payload.orderId || '').trim();
    var kind    = (payload.kind === 'После') ? 'После' : 'До';
    var dataUrl = String(payload.dataUrl || '');
    if (!orderId)            throw new Error('Не указан заказ');
    if (!dataUrl)            throw new Error('Пустое изображение');

    // Разбираем data URL: "data:image/jpeg;base64,XXXX"
    var match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Неверный формат изображения');
    var contentType = match[1];
    var bytes       = Utilities.base64Decode(match[2]);

    var ext      = (contentType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    var stamp    = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
    var filename = (payload.filename || (orderId + '_' + kind + '_' + stamp + '.' + ext));

    var blob = Utilities.newBlob(bytes, contentType, filename);
    var file = getPhotosFolder_().createFile(blob);

    // Доступ по ссылке на просмотр — чтобы фото показывалось в карточке
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

    var fileId = file.getId();
    var rec = {
      'ID':        getNextId('DATABASE', 'ORDER_PHOTOS', 'PHOTO'),
      'Заказ ID':  orderId,
      'Тип':       kind,
      'Drive ID':  fileId,
      'URL':       'https://drive.google.com/file/d/' + fileId + '/view',
      'Имя файла': filename,
      'Создан':    new Date(),
    };
    appendRowByObject('DATABASE', 'ORDER_PHOTOS', rec);
    logActivity('Загрузка фото', 'Заказ', orderId, '', kind);

    return photoToClient_(rec);
  });
}

/** Получить все фото заказа, разбитые на «До» и «После». */
function getOrderPhotos(orderId) {
  return safeCall(function() {
    orderId = String(orderId || '');
    var before = [], after = [];
    readSheetAsObjects('DATABASE', 'ORDER_PHOTOS').forEach(function(r) {
      if (String(r['Заказ ID']) !== orderId) return;
      var p = photoToClient_(r);
      if (p.kind === 'После') after.push(p); else before.push(p);
    });
    return { before: before, after: after };
  });
}

/** Удалить фото (строку из листа + файл в корзину Drive). */
function deleteOrderPhoto(photoId) {
  return safeCall(function() {
    bumpDataVersion_();
    photoId = String(photoId || '');
    var sheet = getTab('DATABASE', 'ORDER_PHOTOS');
    var data  = sheet.getDataRange().getValues();
    var headers = data[0];
    var idCol   = headers.indexOf('ID');
    var driveCol = headers.indexOf('Drive ID');
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === photoId) {
        // Файл — в корзину (не безвозвратно)
        try { DriveApp.getFileById(data[i][driveCol]).setTrashed(true); } catch (e) {}
        sheet.deleteRow(i + 1);
        return { deleted: true };
      }
    }
    return { deleted: false };
  });
}

// ─── ВСПОМОГАТЕЛЬНЫЕ ─────────────────────────────────────────────────────────

/**
 * Готовит запись для клиента: добавляет прямую ссылку на картинку (thumbnail).
 * lh3.googleusercontent.com надёжно отдаёт изображение для <img> по Drive ID.
 */
function photoToClient_(r) {
  var fileId = r['Drive ID'];
  return {
    id:       r['ID'],
    orderId:  r['Заказ ID'],
    kind:     r['Тип'],
    fileId:   fileId,
    img:      'https://lh3.googleusercontent.com/d/' + fileId,   // для <img src>
    viewUrl:  r['URL'] || ('https://drive.google.com/file/d/' + fileId + '/view'),
    filename: r['Имя файла'] || '',
  };
}
