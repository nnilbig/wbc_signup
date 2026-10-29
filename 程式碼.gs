/**
 * WHONEXT B.C. — 後端
 *
 * 試算表依「欄位位置」讀取，各工作表的欄位順序不可更動。
 * 工作表請設為「格式 → 數值 → 純文字」。
 *
 * 推播：專案設定 → 指令碼屬性 → FCM_PROJECT_ID 填 Firebase 專案 ID；沒填就不推播。
 */

const TZ = 'Asia/Taipei';
const SHEET_SESSIONS = '場次';
const SHEET_SIGNUPS = '報名';
const SHEET_PUSH = '推播';
const ADMIN_EMAIL = ''; // 空白 = 寄給部署者本人
const NAME_MAX = 20;

// 場次：A 場次ID｜B 日期｜C 開始｜D 結束｜E 地點｜F 名額｜G 費用｜H 開放｜I 候補名額
const S = { ID: 0, DATE: 1, START: 2, END: 3, PLACE: 4, CAP: 5, FEE: 6, OPEN: 7, WCAP: 8 };
// 報名：A 報名時間｜B 場次ID｜C 姓名｜D 聯絡方式｜E 狀態｜F 取消時間
const R = { TIME: 0, SID: 1, NAME: 2, CONTACT: 3, STATUS: 4, CANCEL: 5 };
const R_COLS = 6;
// 推播：A 建立時間｜B 姓名（不使用，保留欄位）｜C 裝置 token｜D 平台｜E 狀態｜F 最後更新
const P = { TIME: 0, NAME: 1, TOKEN: 2, PLATFORM: 3, STATUS: 4, UPDATED: 5 };
const P_COLS = 6;
const PLATFORMS = ['ios', 'android', 'desktop'];
const TOKEN_MAX = 4096;
const PUSH_TITLE = 'WHONEXT B.C. 通知';

const MAIN = '正取';
const WAIT = '候補';
const CANCELLED = '已取消';
const VALID = '有效';
const INVALID = '失效';

/* ---------- API（前端放在 GitHub Pages，用 fetch 呼叫） ---------- */

/** GET /exec?action=sessions → 開放中的場次（不帶 action 也是，舊版前端用） */
function doGet(e) {
  return respond_(() => {
    const action = (e && e.parameter && e.parameter.action) || 'sessions';
    if (action !== 'sessions') throw new Error('不支援的操作');
    return getSessions();
  });
}

/**
 * POST /exec，內容為 JSON：
 * { action: 'signUp' | 'cancel' | 'addFriend', sid, name }
 * { action: 'subscribe', token, oldToken?, platform } ｜ { action: 'unsubscribe', token }
 */
function doPost(e) {
  return respond_(() => {
    let p;
    try {
      p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (err) {
      throw new Error('資料格式錯誤');
    }
    const fn = {
      signUp: signUp, cancel: cancel, addFriend: addFriend,
      subscribe: subscribe, unsubscribe: unsubscribe
    }[p.action];
    if (!fn) throw new Error('不支援的操作');
    return fn(p);
  });
}

/** 一律回 200 + JSON；錯誤放在 error，前端原樣顯示。 */
function respond_(fn) {
  let out;
  try {
    out = { ok: true, data: fn() };
  } catch (err) {
    out = { ok: false, error: err.message || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 功能 ---------- */

/** 開放中的場次，含正取、候補姓名（不含聯絡方式）。 */
function getSessions() {
  const rows = readSignups_().rows;
  return readSessions_()
    .filter(s => s.open)
    .sort((a, b) => sortKey_(a).localeCompare(sortKey_(b)))
    .map(s => publicSession_(s, rows));
}

/** 報名：正取未滿 → 正取；候補未滿 → 候補；都滿 → 拒絕。 */
function signUp(p) {
  const sid = String((p && p.sid) || '');
  const name = cleanName_(p && p.name);
  const msg = withLock_(() => addSignup_(sid, name));
  return { msg: msg, sessions: getSessions() };
}

/** 取消：改為已取消；原為正取時，最早的候補遞補正取，推播給所有開啟通知的裝置，並寄信通知管理者。 */
function cancel(p) {
  const sid = String((p && p.sid) || '');
  const name = cleanName_(p && p.name);
  const res = withLock_(() => cancelSignup_(sid, name));
  res.pushed = 0;
  if (res.promoted) {
    try {
      res.pushed = pushToAll_(when_(res.session) + '：' + res.promoted + ' 已遞補').sent;
    } catch (e) {
      console.error('推播失敗：' + e);
    }
  }
  notifyAdmin_(res);
  return { msg: res.msg, sessions: getSessions() };
}

/** 代報名：以「姓名友1、友2…」報名（前端暫不使用）。 */
function addFriend(p) {
  const sid = String((p && p.sid) || '');
  const base = cleanName_(p && p.name);
  const msg = withLock_(() => {
    const taken = activeRows_(readSignups_().rows, sid).map(r => r.name);
    let n = 1;
    while (taken.indexOf(base + '友' + n) !== -1) n++;
    return addSignup_(sid, cleanName_(base + '友' + n));
  });
  return { msg: msg, sessions: getSessions() };
}

/** 這支裝置接收通知：同一個 token（或換新前的 oldToken）再登記時更新原本那列。 */
function subscribe(p) {
  const token = cleanToken_(p && p.token);
  const oldToken = String((p && p.oldToken) || '').trim();
  const platform = PLATFORMS.indexOf(p && p.platform) !== -1 ? p.platform : 'desktop';
  withLock_(() => {
    const sheet = pushSheet_();
    const t = now_();
    const rows = readTokens_(sheet);
    const found = rows.find(r => r.token === token) || rows.find(r => oldToken && r.token === oldToken);
    if (found) {
      sheet.getRange(found.row, P.TOKEN + 1, 1, P_COLS - P.TOKEN)
        .setNumberFormat('@')
        .setValues([[token, platform, VALID, t]]);
    } else {
      appendRow_(sheet, P_COLS, [t, '', token, platform, VALID, t]);
    }
  });
  return { msg: '通知已開啟' };
}

/** 這支裝置不再接收通知。 */
function unsubscribe(p) {
  const token = cleanToken_(p && p.token);
  withLock_(() => markTokens_(readTokens_(pushSheet_()).filter(r => r.token === token)));
  return { msg: '通知已關閉' };
}

/** 編輯器內測試與授權用。 */
function test() {
  Logger.log(JSON.stringify(getSessions(), null, 2));
  Logger.log('今日剩餘寄信額度：' + MailApp.getRemainingDailyQuota());
  Logger.log('FCM_PROJECT_ID：' + (fcmProject_() || '（未設定）'));
  const info = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + ScriptApp.getOAuthToken(), { muteHttpExceptions: true });
  const scope = String(JSON.parse(info.getContentText()).scope || '');
  Logger.log('推播權限：' + (scope.indexOf('firebase.messaging') !== -1 ? '有' : '沒有（appsscript.json 少了 firebase.messaging，或尚未重新授權）'));
  Logger.log('授權範圍：' + scope.split(' ').join('\n'));
}

/* ---------- 寫入 ---------- */

function addSignup_(sid, name) {
  const s = findOpenSession_(sid);
  const signups = readSignups_();
  const active = activeRows_(signups.rows, sid);

  if (active.some(r => r.name === name)) throw new Error(name + ' 已經在名單中');

  const mainCount = active.filter(r => r.status === MAIN).length;
  const waitCount = active.filter(r => r.status === WAIT).length;

  let status;
  if (mainCount < s.cap) status = MAIN;
  else if (waitCount < s.wcap) status = WAIT;
  else throw new Error('名額與候補都已額滿');

  appendRow_(signups.sheet, R_COLS, [now_(), sid, name, '', status, '']);

  return status === MAIN
    ? name + ' 報名成功'
    : name + ' 排入候補第 ' + (waitCount + 1) + ' 位';
}

function cancelSignup_(sid, name) {
  const s = findOpenSession_(sid);
  const signups = readSignups_();
  const active = activeRows_(signups.rows, sid);
  const target = active.filter(r => r.name === name).pop();

  if (!target) throw new Error('名單中沒有「' + name + '」');

  const sheet = signups.sheet;
  sheet.getRange(target.row, R.STATUS + 1, 1, 2)
    .setNumberFormat('@')
    .setValues([[CANCELLED, now_()]]);

  let mainCount = active.filter(r => r.status === MAIN).length;
  let waitCount = active.filter(r => r.status === WAIT).length;
  if (target.status === MAIN) mainCount--; else waitCount--;

  // 只有正取空出位子、且正取確實未滿時才遞補（避免管理者調低名額後超收）
  let promoted = '';
  if (target.status === MAIN && mainCount < s.cap) {
    const first = active.find(r => r.status === WAIT);
    if (first) {
      sheet.getRange(first.row, R.STATUS + 1).setNumberFormat('@').setValue(MAIN);
      promoted = first.name;
      mainCount++;
      waitCount--;
    }
  }

  return {
    msg: promoted ? name + ' 已取消，' + promoted + ' 遞補正取' : name + ' 已取消',
    session: s,
    name: name,
    was: target.status,
    promoted: promoted,
    mainCount: mainCount,
    waitCount: waitCount
  };
}

function appendRow_(sheet, cols, values) {
  const row = sheet.getLastRow() + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
  sheet.getRange(row, 1, 1, cols).setNumberFormat('@').setValues([values]);
}

function notifyAdmin_(res) {
  try {
    const to = ADMIN_EMAIL || Session.getEffectiveUser().getEmail();
    if (!to) return;
    const s = res.session;
    const when = s.date + ' ' + s.start + '-' + s.end;
    const body = [
      '場次：' + when + '　' + s.place,
      '取消：' + res.name + '（原為' + res.was + '）',
      '遞補：' + (res.promoted || '無'),
      '目前：正取 ' + res.mainCount + '/' + s.cap + '，候補 ' + res.waitCount + '/' + s.wcap,
      res.promoted ? '推播：' + (res.pushed ? '已通知 ' + res.pushed + ' 支裝置' : '沒有發送（沒有開啟通知的裝置）') : '',
      '時間：' + now_(),
      '',
      res.promoted && !res.pushed ? '請在群組通知 ' + res.promoted + ' 已遞補正取。' : ''
    ].join('\n');
    MailApp.sendEmail(to, '[WHONEXT B.C.] ' + res.name + ' 取消 ' + when, body);
  } catch (e) {
    console.error('寄信失敗：' + e);
  }
}

/* ---------- 推播（Firebase Cloud Messaging HTTP v1） ---------- */

/** 發給所有有效的裝置。 */
function pushToAll_(body) {
  return sendPush_(readTokens_(pushSheet_()).filter(r => r.status === VALID), body);
}

/**
 * 每支裝置發一則；Firebase 回報 token 已失效（UNREGISTERED）的列標記為「失效」。
 * 授權用部署者自己的 OAuth token（appsscript.json 需有 firebase.messaging 權限）。
 */
function sendPush_(targets, body) {
  const seen = {};
  targets = targets.filter(r => !seen[r.token] && (seen[r.token] = true));
  const out = { devices: targets.length, sent: 0, failed: 0, invalid: 0 };
  const project = fcmProject_();
  if (!project || !targets.length) return out;

  const url = 'https://fcm.googleapis.com/v1/projects/' + project + '/messages:send';
  const auth = 'Bearer ' + ScriptApp.getOAuthToken();
  const responses = UrlFetchApp.fetchAll(targets.map(r => ({
    url: url,
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: auth },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      message: {
        token: r.token,
        // 前端的 service worker 讀 notification（沒有就讀 data）自行顯示通知
        data: { title: PUSH_TITLE, body: body },
        webpush: {
          headers: { Urgency: 'high', TTL: '86400' },
          notification: { title: PUSH_TITLE, body: body, icon: 'icons/icon-192.png' }
        }
      }
    })
  })));

  const dead = [];
  responses.forEach((res, i) => {
    const code = res.getResponseCode();
    if (code === 200) { out.sent++; return; }
    out.failed++;
    const text = res.getContentText();
    if (code === 404 || text.indexOf('UNREGISTERED') !== -1) dead.push(targets[i]);
    else console.error('推播失敗 ' + code + '：' + text);
  });
  if (dead.length) {
    withLock_(() => markTokens_(dead));
    out.invalid = dead.length;
  }
  return out;
}

function markTokens_(rows) {
  const sheet = pushSheet_();
  const t = now_();
  rows.forEach(r => {
    sheet.getRange(r.row, P.STATUS + 1, 1, 2).setNumberFormat('@').setValues([[INVALID, t]]);
  });
}

function fcmProject_() {
  return String(PropertiesService.getScriptProperties().getProperty('FCM_PROJECT_ID') || '').trim();
}

/* ---------- 試算表選單 ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('WHONEXT')
    .addItem('通知新場次', 'menuNotifySession')
    .addItem('發送測試通知', 'menuTestPush')
    .addToUi();
}

/** 在「場次」點選某一列後執行，推播給所有有效裝置。 */
function menuNotifySession() {
  const ui = SpreadsheetApp.getUi();
  if (!fcmProject_()) return ui.alert('尚未設定指令碼屬性 FCM_PROJECT_ID');

  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveRange().getRow();
  if (sheet.getName() !== SHEET_SESSIONS || row < 2) {
    return ui.alert('請先在「' + SHEET_SESSIONS + '」工作表點選要通知的場次那一列');
  }
  const sid = String(sheet.getRange(row, S.ID + 1).getDisplayValue()).trim();
  const s = readSessions_().find(x => x.sid === sid);
  if (!s) return ui.alert('第 ' + row + ' 列沒有場次ID');
  if (!s.open) return ui.alert(sid + ' 尚未開放（「開放」欄不是 Y）');

  const left = Math.max(s.cap - publicSession_(s, readSignups_().rows).main.length, 0);
  const body = when_(s) + ' 開放報名，剩 ' + left + ' 位';
  const devices = readTokens_(pushSheet_()).filter(r => r.status === VALID).length;
  if (!devices) return ui.alert('目前沒有開啟通知的裝置');

  const ok = ui.alert('通知新場次', '「' + body + '」\n\n將發送給 ' + devices + ' 支裝置，確定發送？', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  ui.alert(pushReport_(pushToAll_(body)));
}

/** 推播給所有有效裝置，用來確認設定正確。 */
function menuTestPush() {
  const ui = SpreadsheetApp.getUi();
  if (!fcmProject_()) return ui.alert('尚未設定指令碼屬性 FCM_PROJECT_ID');

  const devices = readTokens_(pushSheet_()).filter(r => r.status === VALID).length;
  if (!devices) return ui.alert('目前沒有開啟通知的裝置');
  const ok = ui.alert('發送測試通知', '「推播測試成功」將發送給 ' + devices + ' 支裝置，確定發送？', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  ui.alert(pushReport_(pushToAll_('推播測試成功')));
}

function pushReport_(res) {
  return '成功 ' + res.sent + ' 支，失敗 ' + res.failed + ' 支' +
    (res.invalid ? '（其中 ' + res.invalid + ' 支已失效，已標記）' : '');
}

/* ---------- 讀取 ---------- */

function readSessions_() {
  return sheet_(SHEET_SESSIONS).getDataRange().getDisplayValues().slice(1)
    .filter(v => String(v[S.ID]).trim())
    .map(v => ({
      sid: String(v[S.ID]).trim(),
      date: String(v[S.DATE]).trim(),
      start: String(v[S.START]).trim(),
      end: String(v[S.END]).trim(),
      place: String(v[S.PLACE]).trim(),
      cap: toInt_(v[S.CAP]),
      wcap: toInt_(v[S.WCAP]),
      open: String(v[S.OPEN]).trim().toUpperCase() === 'Y'
    }));
}

function readSignups_() {
  const sheet = sheet_(SHEET_SIGNUPS);
  const rows = sheet.getDataRange().getDisplayValues().slice(1).map((v, i) => ({
    row: i + 2,
    sid: String(v[R.SID]).trim(),
    name: String(v[R.NAME]).trim(),
    status: String(v[R.STATUS]).trim()
  }));
  return { sheet: sheet, rows: rows };
}

function readTokens_(sheet) {
  return sheet.getDataRange().getDisplayValues().slice(1).map((v, i) => ({
    row: i + 2,
    name: String(v[P.NAME]).trim(),
    token: String(v[P.TOKEN]).trim(),
    status: String(v[P.STATUS]).trim()
  })).filter(r => r.token);
}

/** 「推播」工作表；沒有就建立（含標題列、純文字格式）。 */
function pushSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_PUSH);
  if (!sh) {
    sh = ss.insertSheet(SHEET_PUSH);
    sh.getRange(1, 1, sh.getMaxRows(), P_COLS).setNumberFormat('@');
    sh.getRange(1, 1, 1, P_COLS).setValues([['建立時間', '姓名', '裝置 token', '平台', '狀態', '最後更新']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function publicSession_(s, rows) {
  const mine = activeRows_(rows, s.sid);
  return {
    sid: s.sid, date: s.date, start: s.start, end: s.end, place: s.place,
    cap: s.cap, wcap: s.wcap,
    main: mine.filter(r => r.status === MAIN).map(r => r.name),
    wait: mine.filter(r => r.status === WAIT).map(r => r.name)
  };
}

function findOpenSession_(sid) {
  const s = readSessions_().find(x => x.sid === sid);
  if (!s || !s.open) throw new Error('這個場次目前沒有開放');
  return s;
}

/* ---------- 工具 ---------- */

function activeRows_(rows, sid) {
  return rows.filter(r => r.sid === sid && (r.status === MAIN || r.status === WAIT));
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('目前報名人數較多，請稍後再試');
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function cleanName_(v) {
  const name = String(v || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('請輸入姓名');
  if (name.length > NAME_MAX) throw new Error('姓名請在 ' + NAME_MAX + ' 字以內');
  return name;
}

function cleanToken_(v) {
  const token = String(v || '').trim();
  if (!token || token.length > TOKEN_MAX || /\s/.test(token)) throw new Error('裝置資料錯誤');
  return token;
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('找不到工作表「' + name + '」');
  return sh;
}

function sortKey_(s) {
  const pad = x => ('0000' + (parseInt(x, 10) || 0)).slice(-4);
  const d = s.date.split(/[\/\-.]/).map(pad).join('');
  const t = s.start.split(':').map(pad).join('');
  return d + t;
}

/** 10/31 20:00-22:00 */
function when_(s) {
  const p = s.date.split(/[\/\-.]/);
  const md = p.length < 3 ? s.date : parseInt(p[1], 10) + '/' + parseInt(p[2], 10);
  return md + ' ' + s.start + '-' + s.end;
}

function toInt_(v) {
  const n = parseInt(String(v).trim(), 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

function now_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm:ss');
}
