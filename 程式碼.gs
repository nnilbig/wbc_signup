/**
 * WHONEXT B.C. 預約平台 — 後端
 *
 * 試算表依「欄位位置」讀取，兩張工作表的欄位順序不可更動。
 * 兩張工作表請設為「格式 → 數值 → 純文字」。
 */

const TZ = 'Asia/Taipei';
const SHEET_SESSIONS = '場次';
const SHEET_SIGNUPS = '報名';
const ADMIN_EMAIL = ''; // 空白 = 寄給部署者本人
const NAME_MAX = 20;

// 場次：A 場次ID｜B 日期｜C 開始｜D 結束｜E 地點｜F 名額｜G 費用｜H 開放｜I 候補名額
const S = { ID: 0, DATE: 1, START: 2, END: 3, PLACE: 4, CAP: 5, FEE: 6, OPEN: 7, WCAP: 8 };
// 報名：A 報名時間｜B 場次ID｜C 姓名｜D 聯絡方式｜E 狀態｜F 取消時間
const R = { TIME: 0, SID: 1, NAME: 2, CONTACT: 3, STATUS: 4, CANCEL: 5 };
const R_COLS = 6;

const MAIN = '正取';
const WAIT = '候補';
const CANCELLED = '已取消';

/* ---------- API（前端放在 GitHub Pages，用 fetch 呼叫） ---------- */

/** GET /exec → 開放中的場次 */
function doGet() {
  return respond_(() => getSessions());
}

/** POST /exec，內容為 JSON：{ action: 'signUp' | 'cancel' | 'addFriend', sid, name } */
function doPost(e) {
  return respond_(() => {
    let p;
    try {
      p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (err) {
      throw new Error('資料格式錯誤');
    }
    const fn = { signUp: signUp, cancel: cancel, addFriend: addFriend }[p.action];
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

/** 取消：改為已取消；原為正取時，最早的候補遞補正取，並寄信通知管理者。 */
function cancel(p) {
  const sid = String((p && p.sid) || '');
  const name = cleanName_(p && p.name);
  const res = withLock_(() => cancelSignup_(sid, name));
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

/** 編輯器內測試與授權用。 */
function test() {
  Logger.log(JSON.stringify(getSessions(), null, 2));
  Logger.log('今日剩餘寄信額度：' + MailApp.getRemainingDailyQuota());
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

  appendSignup_(signups.sheet, [now_(), sid, name, '', status, '']);

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

function appendSignup_(sheet, values) {
  const row = sheet.getLastRow() + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
  sheet.getRange(row, 1, 1, R_COLS).setNumberFormat('@').setValues([values]);
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
      '時間：' + now_(),
      '',
      res.promoted ? '請在群組通知 ' + res.promoted + ' 已遞補正取。' : ''
    ].join('\n');
    MailApp.sendEmail(to, '[WHONEXT B.C.] ' + res.name + ' 取消 ' + when, body);
  } catch (e) {
    console.error('寄信失敗：' + e);
  }
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

function toInt_(v) {
  const n = parseInt(String(v).trim(), 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

function now_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm:ss');
}
