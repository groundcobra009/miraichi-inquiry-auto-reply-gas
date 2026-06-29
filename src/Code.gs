const SHEET_NAMES = {
  reply: '返信用',
  sendLog: '送信ログ',
  settings: '設定',
};

const SETTINGS_KEYS = [
  'form_id',
  'form_url',
  'form_edit_url',
  'spreadsheet_id',
  'spreadsheet_url',
  'created_at',
];

const SCRIPT_PROPERTY_KEYS = {
  spreadsheetId: 'spreadsheet_id',
};

const REPLY_HEADERS = [
  'お名前',
  'メールアドレス',
  '会社名',
  '問い合わせ分類',
  '問い合わせ内容',
  '優先度',
  '返信要否',
  '返信件名',
  '返信案',
  'チェック',
  '返信',
  '最終更新日時',
];

const SEND_LOG_HEADERS = [
  '日時',
  '行番号',
  '宛先',
  '件名',
  '結果',
  '詳細',
];

const FORM_FIELDS = [
  { title: 'お名前', type: 'text', required: true },
  { title: 'メールアドレス', type: 'email', required: true },
  { title: '会社名', type: 'text', required: false },
  { title: '電話番号', type: 'text', required: false },
  {
    title: '問い合わせ分類',
    type: 'choice',
    required: true,
    choices: ['サービスについて', '料金・請求について', '導入相談', '不具合・トラブル', 'その他'],
  },
  { title: '問い合わせ内容', type: 'paragraph', required: true },
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('問い合わせ自動返信')
    .addItem('初期設定', 'setupInquirySystem')
    .addSeparator()
    .addItem('フォームURLを表示', 'showFormUrls')
    .addItem('返信用シートを準備', 'prepareReplySheetFromMenu')
    .addItem('送信設定を開く', 'showSendSidebar')
    .addItem('ヘルプ', 'showHelpDialog')
    .addSeparator()
    .addItem('送信OKのメールを送信', 'sendApprovedReplies')
    .addToUi();
}

function setupInquirySystem() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) {
      throw new Error('現在開いているスプレッドシートを取得できませんでした。');
    }

    const replySheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.reply);
    prepareReplySheet_(replySheet);

    const logSheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.sendLog);
    prepareSendLogSheet_(logSheet);

    const settingsSheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.settings);
    prepareSettingsSheet_(settingsSheet);

    const currentSettings = readSettings_(settingsSheet);
    const form = getOrCreateInquiryForm_(currentSettings.form_id, spreadsheet.getName());

    ensureFormFields_(form);
    ensureFormDestination_(form, spreadsheet);
    removeLegacyFormSubmitTriggers_();

    const createdAt = currentSettings.created_at || formatDate_(new Date());
    const settings = {
      form_id: form.getId(),
      form_url: form.getPublishedUrl(),
      form_edit_url: form.getEditUrl(),
      spreadsheet_id: spreadsheet.getId(),
      spreadsheet_url: spreadsheet.getUrl(),
      created_at: createdAt,
    };
    writeSettings_(settingsSheet, settings);
    PropertiesService.getScriptProperties()
      .setProperty(SCRIPT_PROPERTY_KEYS.spreadsheetId, spreadsheet.getId());

    showAlert_(
      '初期設定が完了しました。\n\n' +
        'フォームURL:\n' + settings.form_url + '\n\n' +
        'フォーム編集URL:\n' + settings.form_edit_url
    );
  } finally {
    lock.releaseLock();
  }
}

function showFormUrls() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const settingsSheet = spreadsheet.getSheetByName(SHEET_NAMES.settings);

  if (!settingsSheet) {
    showInitialSetupRequired_();
    return;
  }

  const settings = readSettings_(settingsSheet);
  if (!settings.form_url || !settings.form_edit_url || !settings.spreadsheet_url) {
    showInitialSetupRequired_();
    return;
  }

  showAlert_(
    'フォームURL:\n' + settings.form_url + '\n\n' +
      'フォーム編集URL:\n' + settings.form_edit_url + '\n\n' +
      'スプレッドシートURL:\n' + settings.spreadsheet_url
  );
}

function prepareReplySheetFromMenu() {
  const spreadsheet = getSpreadsheet_();
  const replySheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.reply);
  prepareReplySheet_(replySheet);
  showAlert_('返信用シートを準備しました。Google Workspace Studioでこのシートに行を追加してください。');
}

function showSendSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('送信設定');
  SpreadsheetApp.getUi().showSidebar(html);
}

function showHelpDialog() {
  const html = HtmlService.createHtmlOutputFromFile('HelpDialog')
    .setWidth(760)
    .setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, '問い合わせ自動返信 ヘルプ');
}

function regenerateReplyForActiveRow() {
  prepareReplySheetFromMenu();
}

function sendApprovedReplies() {
  const result = sendApprovedRepliesCore_();
  showAlert_(formatSendResult_(result));
  return result;
}

function sendApprovedRepliesFromSidebar() {
  return sendApprovedRepliesCore_();
}

function sendApprovedRepliesByTrigger() {
  sendApprovedRepliesCore_();
}

function getSendSidebarState() {
  return {
    triggerEnabled: hasAutoSendTrigger_(),
  };
}

function setAutoSendTriggerEnabled(enabled) {
  if (enabled) {
    ensureAutoSendTrigger_();
  } else {
    deleteAutoSendTriggers_();
  }
  return getSendSidebarState();
}

function onFormSubmit(e) {
  // Google Workspace Studio reads the standard form response sheet directly.
  // Keep this no-op so older installed triggers do not recreate legacy sheets.
}

function getOrCreateSheet_(spreadsheet, sheetName) {
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

function getSpreadsheet_() {
  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) {
    PropertiesService.getScriptProperties()
      .setProperty(SCRIPT_PROPERTY_KEYS.spreadsheetId, activeSpreadsheet.getId());
    return activeSpreadsheet;
  }

  const spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty(SCRIPT_PROPERTY_KEYS.spreadsheetId);
  if (!spreadsheetId) {
    throw new Error('スプレッドシートIDが未設定です。先に初期設定を実行してください。');
  }

  return SpreadsheetApp.openById(spreadsheetId);
}

function prepareReplySheet_(sheet) {
  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), REPLY_HEADERS.length)).getValues()[0];
  const hasHeaders = REPLY_HEADERS.every(function(header, index) {
    return currentHeaders[index] === header;
  });

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, REPLY_HEADERS.length).setValues([REPLY_HEADERS]);
    sheet.setFrozenRows(1);
  }
}

function prepareSendLogSheet_(sheet) {
  const currentHeaders = sheet.getRange(1, 1, 1, SEND_LOG_HEADERS.length).getValues()[0];
  const hasHeaders = SEND_LOG_HEADERS.every(function(header, index) {
    return currentHeaders[index] === header;
  });

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, SEND_LOG_HEADERS.length).setValues([SEND_LOG_HEADERS]);
    sheet.setFrozenRows(1);
  }

  sheet.autoResizeColumns(1, SEND_LOG_HEADERS.length);
}

function sendApprovedRepliesCore_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = getSpreadsheet_();
    const sheet = spreadsheet.getSheetByName(SHEET_NAMES.reply);
    if (!sheet) {
      throw new Error('返信用シートが見つかりません。先に返信用シートを準備してください。');
    }
    const logSheet = getOrCreateSheet_(spreadsheet, SHEET_NAMES.sendLog);
    prepareSendLogSheet_(logSheet);

    const lastRow = sheet.getLastRow();
    const result = {
      scanned: Math.max(0, lastRow - 1),
      sent: 0,
      skipped: 0,
      failed: 0,
      messages: [],
    };

    if (lastRow < 2) {
      result.messages.push('送信対象行がありません。');
      return result;
    }

    const values = sheet.getRange(2, 1, lastRow - 1, REPLY_HEADERS.length).getValues();
    const now = formatDate_(new Date());

    values.forEach(function(row, index) {
      const sheetRow = index + 2;
      const email = String(row[1] || '').trim();
      const replyRequired = String(row[6] || '').trim();
      const subject = String(row[7] || '').trim();
      const body = String(row[8] || '').trim();
      const approved = isTrueValue_(row[9]);
      const alreadySent = isTrueValue_(row[10]);

      if (!approved || alreadySent || replyRequired !== '要返信') {
        result.skipped += 1;
        return;
      }

      if (!email || !subject || !body) {
        result.failed += 1;
        const message = '宛先、件名、本文のいずれかが空です。';
        result.messages.push(sheetRow + '行目: ' + message);
        appendSendLog_(logSheet, now, sheetRow, email, subject, '失敗', message);
        return;
      }

      try {
        MailApp.sendEmail({
          to: email,
          subject: subject,
          body: body,
        });
        sheet.getRange(sheetRow, 11).setValue(true);
        sheet.getRange(sheetRow, 12).setValue(now);
        appendSendLog_(logSheet, now, sheetRow, email, subject, '成功', '送信しました。');
        result.sent += 1;
      } catch (error) {
        result.failed += 1;
        result.messages.push(sheetRow + '行目: ' + error.message);
        appendSendLog_(logSheet, now, sheetRow, email, subject, '失敗', error.message);
      }
    });

    if (result.sent === 0 && result.failed === 0) {
      result.messages.push('送信条件に一致する行がありませんでした。');
    }

    return result;
  } finally {
    lock.releaseLock();
  }
}

function appendSendLog_(sheet, timestamp, rowNumber, email, subject, status, detail) {
  sheet.appendRow([
    timestamp,
    rowNumber,
    email,
    subject,
    status,
    detail,
  ]);
}

function formatSendResult_(result) {
  const lines = [
    '送信処理が完了しました。',
    '',
    '確認行数: ' + result.scanned,
    '送信済み: ' + result.sent,
    'スキップ: ' + result.skipped,
    '失敗: ' + result.failed,
  ];

  if (result.messages && result.messages.length > 0) {
    lines.push('', '詳細:', result.messages.join('\n'));
  }

  return lines.join('\n');
}

function isTrueValue_(value) {
  if (value === true) {
    return true;
  }
  const text = String(value || '').trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === '1' || text === '送信済み';
}

function hasAutoSendTrigger_() {
  return ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === 'sendApprovedRepliesByTrigger';
  });
}

function ensureAutoSendTrigger_() {
  if (hasAutoSendTrigger_()) {
    return;
  }

  ScriptApp.newTrigger('sendApprovedRepliesByTrigger')
    .timeBased()
    .everyMinutes(15)
    .create();
}

function deleteAutoSendTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'sendApprovedRepliesByTrigger') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function prepareSettingsSheet_(sheet) {
  const headers = sheet.getRange(1, 1, 1, 3).getValues()[0];
  if (headers[0] !== 'key' || headers[1] !== 'value' || headers[2] !== 'description') {
    sheet.getRange(1, 1, 1, 3).setValues([['key', 'value', 'description']]);
    sheet.setFrozenRows(1);
  }
  sheet.autoResizeColumns(1, 3);
}

function readSettings_(sheet) {
  const values = sheet.getDataRange().getValues();
  const settings = {};

  values.slice(1).forEach(function(row) {
    const key = row[0];
    if (key) {
      settings[key] = row[1];
    }
  });

  return settings;
}

function writeSettings_(sheet, settings) {
  prepareSettingsSheet_(sheet);

  const descriptions = {
    form_id: '問い合わせフォームのID',
    form_url: '回答者に共有するフォームURL',
    form_edit_url: '管理者用のフォーム編集URL',
    spreadsheet_id: '回答先スプレッドシートのID',
    spreadsheet_url: '回答先スプレッドシートのURL',
    created_at: '初期設定を最初に完了した日時',
  };

  const existing = readSettings_(sheet);
  const merged = Object.assign({}, existing, settings);
  const rows = SETTINGS_KEYS.map(function(key) {
    return [key, merged[key] || '', descriptions[key] || ''];
  });

  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  const extraRows = Math.max(0, sheet.getLastRow() - rows.length - 1);
  if (extraRows > 0) {
    sheet.getRange(rows.length + 2, 1, extraRows, 3).clearContent();
  }
  sheet.autoResizeColumns(1, 3);
}

function getOrCreateInquiryForm_(formId, spreadsheetName) {
  if (formId) {
    try {
      return FormApp.openById(String(formId));
    } catch (error) {
      // The stored form may have been deleted or access may have been revoked.
    }
  }

  const form = FormApp.create(spreadsheetName + ' 問い合わせフォーム');
  form.setDescription('お問い合わせ内容を入力してください。担当者が内容を確認します。');
  form.setCollectEmail(false);
  form.setConfirmationMessage('お問い合わせありがとうございます。内容を確認のうえ、担当者よりご連絡します。');
  return form;
}

function ensureFormFields_(form) {
  const existingTitles = form.getItems().map(function(item) {
    return item.getTitle();
  });

  FORM_FIELDS.forEach(function(field) {
    if (existingTitles.indexOf(field.title) !== -1) {
      return;
    }

    if (field.type === 'text') {
      form.addTextItem()
        .setTitle(field.title)
        .setRequired(field.required);
      return;
    }

    if (field.type === 'email') {
      const item = form.addTextItem()
        .setTitle(field.title)
        .setRequired(field.required);
      const validation = FormApp.createTextValidation()
        .requireTextIsEmail()
        .setHelpText('メールアドレスの形式で入力してください。')
        .build();
      item.setValidation(validation);
      return;
    }

    if (field.type === 'choice') {
      form.addMultipleChoiceItem()
        .setTitle(field.title)
        .setChoiceValues(field.choices)
        .setRequired(field.required);
      return;
    }

    if (field.type === 'paragraph') {
      form.addParagraphTextItem()
        .setTitle(field.title)
        .setRequired(field.required);
    }
  });
}

function ensureFormDestination_(form, spreadsheet) {
  try {
    if (
      form.getDestinationType() === FormApp.DestinationType.SPREADSHEET &&
      form.getDestinationId() === spreadsheet.getId()
    ) {
      return;
    }
  } catch (error) {
    // Continue and reset the destination below if the current state cannot be read.
  }

  form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId());
}

function removeLegacyFormSubmitTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'onFormSubmit') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss');
}

function showInitialSetupRequired_() {
  showAlert_('まだ初期設定が完了していません。メニューから初期設定を実行してください。');
}

function showAlert_(message) {
  SpreadsheetApp.getUi().alert(message);
}
