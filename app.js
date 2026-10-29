// 環境設定（API 網址、Firebase）在 config.js
var API = CONFIG.api;

// 測試版與正式版都在 nnilbig.github.io，localStorage 共用，測試版的 key 另外加前綴
var KEY = CONFIG.env === 'dev' ? 'whonext_dev_' : 'whonext_';
var NAME_KEY = KEY + 'name';
var CACHE_KEY = KEY + 'sessions';
var REFRESH_MS = 30000;
var state = { sessions: null, open: null, name: loadName(), busy: false, pending: null };
var toastTimer = null;
var seq = 0;
var list = document.getElementById('list');

/* ---------- 資料 ---------- */

// GET 讀場次；POST 用 text/plain 送 JSON，避開 CORS 預檢（GAS 不處理 OPTIONS）
function api(body) {
  var req = body
    ? fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
    : fetch(API + '?action=sessions', { cache: 'no-store' });
  return req
    .then(function (r) { return r.json(); })
    .catch(function () { throw new Error('連線失敗，請稍後再試'); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.error);
      return res.data;
    });
}

// silent：背景更新失敗時不跳提示，畫面保留舊資料
function load(silent) {
  var my = ++seq;
  api()
    .then(function (sessions) {
      if (my === seq) apply(sessions); // 期間有報名/取消，以較新的結果為準
    })
    .catch(function (err) {
      if (!state.sessions) list.innerHTML = '<div class="state">載入失敗，請重新整理</div>';
      if (!silent) toast(err.message);
    });
}

function apply(sessions) {
  state.sessions = sessions;
  saveCache(sessions);
  // 正在輸入姓名時不重繪，避免手機鍵盤被收起；下次重繪會帶上新資料
  if (document.activeElement && document.activeElement.classList.contains('name')) return;
  render();
}

function saveCache(sessions) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(sessions)); } catch (e) {}
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { return null; }
}

function call(fn, sid) {
  var name = state.name.trim();
  if (!name) { toast('請先輸入姓名'); focusName(); return; }
  seq++;
  setBusy(fn);
  api({ action: fn, sid: sid, name: name })
    .then(function (res) {
      state.sessions = res.sessions;
      saveCache(res.sessions);
      setBusy(null);
      toast(res.msg);
    })
    .catch(function (err) {
      setBusy(null);
      toast(err.message);
      load();
    });
}

/* ---------- 畫面 ---------- */

function render() {
  var sessions = state.sessions || [];
  if (!sessions.some(function (s) { return s.sid === state.open; })) state.open = null;
  if (!sessions.length) {
    list.innerHTML = '<div class="state">目前沒有開放的場次</div>';
    return;
  }
  var focused = document.activeElement && document.activeElement.classList.contains('name');
  list.innerHTML = sessions.map(cardHtml).join('');
  if (focused) focusName();
}

function cardHtml(s) {
  var n = s.main.length, w = s.wait.length;
  var left = Math.max(s.cap - n, 0);
  var full = n >= s.cap, allFull = full && w >= s.wcap;
  var open = state.open === s.sid;

  var dots = '';
  for (var i = 0; i < s.cap; i++) dots += '<i class="dot' + (i < n ? ' on' : '') + '"></i>';
  if (s.wcap > 0) {
    dots += '<i class="dot sep"></i>';
    for (var j = 0; j < s.wcap; j++) dots += '<i class="dot w' + (j < w ? ' on' : '') + '"></i>';
  }

  var html =
    '<section class="card' + (open ? ' open' : '') + '" data-sid="' + esc(s.sid) + '">' +
      '<div class="head" data-toggle role="button" tabindex="0" aria-expanded="' + open + '">' +
        '<div class="row1">' +
          '<div class="when">' + esc(md(s.date)) + ' ' + esc(s.start) + '-' + esc(s.end) + '</div>' +
          '<span class="tag ' + (full ? 'full">FULL' : 'open">OPEN') + '</span>' +
        '</div>' +
        '<div class="place">' + esc(s.place) + '</div>' +
        '<div class="board">' +
          cell('報名', n, s.cap, n === 0) +
          cell('剩餘', left, null, left === 0) +
          cell('候補', w, s.wcap, s.wcap === 0 || w === 0) +
        '</div>' +
        '<div class="lights" aria-label="正取 ' + n + '/' + s.cap + '，候補 ' + w + '/' + s.wcap + '">' + dots + '</div>' +
      '</div>';

  if (open) {
    html +=
      '<div class="body">' +
        '<input class="name" type="text" maxlength="20" autocomplete="nickname" enterkeyhint="done" placeholder="輸入姓名" value="' + esc(state.name) + '">' +
        '<div class="btns">' +
          '<button class="btn primary' + (state.pending === 'signUp' ? ' loading' : '') + '" data-act="signUp"' + (allFull || state.busy ? ' disabled' : '') + '>' +
            (state.pending === 'signUp' ? loading('送出中') : allFull ? '已額滿' : full ? '排候補' : '確認報名') + '</button>' +
          '<button class="btn ghost' + (state.pending === 'cancel' ? ' loading' : '') + '" data-act="cancel"' + (state.busy ? ' disabled' : '') + '>' +
            (state.pending === 'cancel' ? loading('取消中') : '取消報名') + '</button>' +
        '</div>' +
        roster('報名名單', s.main, n + '/' + s.cap, '') +
        (s.wcap > 0 ? roster('候補名單', s.wait, w + '/' + s.wcap, ' wait') : '') +
      '</div>';
  }
  return html + '</section>';
}

function cell(label, value, of, off) {
  return '<div class="cell' + (off ? ' off' : '') + '"><div class="lbl">' + label + '</div>' +
    '<div class="num">' + value + (of !== null ? '<small>/' + of + '</small>' : '') + '</div></div>';
}

function roster(title, names, count, cls) {
  var items = names.length
    ? names.map(function (nm, i) {
        return '<li data-pick="' + esc(nm) + '"><span class="no">' + (i < 9 ? '0' : '') + (i + 1) + '</span>' +
          '<span class="who">' + esc(nm) + '</span></li>';
      }).join('')
    : '<li class="none">—</li>';
  return '<div class="sec"><span>' + title + '</span><b>' + count + '</b></div>' +
    '<ol class="roster' + cls + '">' + items + '</ol>';
}

function loading(label) {
  return label + '<span class="ld"><i></i><i></i><i></i></span>';
}

function setBusy(fn) {
  state.busy = !!fn;
  state.pending = fn || null;
  render();
}

/* ---------- 互動 ---------- */

list.addEventListener('click', function (e) {
  var card = e.target.closest('.card');
  if (!card) return;
  var sid = card.getAttribute('data-sid');

  if (e.target.closest('[data-toggle]')) return toggle(sid);

  var pick = e.target.closest('[data-pick]');
  if (pick) {
    setName(pick.getAttribute('data-pick'));
    var input = card.querySelector('.name');
    if (input) input.value = state.name;
    return;
  }

  var btn = e.target.closest('button[data-act]');
  if (!btn || btn.disabled || state.busy) return;
  var act = btn.getAttribute('data-act');
  if (act === 'signUp' || act === 'cancel') call(act, sid);
});

list.addEventListener('keydown', function (e) {
  if (e.target.hasAttribute('data-toggle') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    toggle(e.target.closest('.card').getAttribute('data-sid'));
  }
  if (e.target.classList.contains('name') && e.key === 'Enter') e.target.blur();
});

list.addEventListener('input', function (e) {
  if (e.target.classList.contains('name')) setName(e.target.value);
});

function toggle(sid) {
  state.open = state.open === sid ? null : sid;
  render();
}

function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
}

/* ---------- 通知 ---------- */

var PUSH_KEY = KEY + 'push'; // 這支裝置登記過的 { token, name }
var GUIDE_KEY = KEY + 'guide_closed';
var FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
var ua = navigator.userAgent;
var isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
var isStandalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
var pushReady = !!(CONFIG.firebase && CONFIG.vapidKey); // 這個環境有設定推播
// iPhone 只有從主畫面打開時才有 PushManager，Safari 內會是 false
var canPush = pushReady && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
var push = { saved: loadPush(), busy: false }; // saved：這支裝置登記過的 { token }
var messaging = null;

function renderPush() {
  var on = isPushOn();
  var btn = $('pushBtn');
  btn.hidden = !canPush;
  btn.disabled = push.busy;
  btn.className = 'bell' + (on ? ' on' : '');
  btn.textContent = push.busy ? '設定中…' : on ? '通知已開啟' : '開啟通知';
}

function isPushOn() {
  return canPush && !!push.saved && Notification.permission === 'granted';
}

function setPushBusy(busy) {
  push.busy = busy;
  renderPush();
}

function enablePush() {
  // iPhone 只允許在按鈕的點擊中直接詢問權限，之前不能有任何非同步動作
  var perm = Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission);
  setPushBusy(true);
  perm
    .then(function (p) {
      if (p !== 'granted') throw new Error(p === 'denied' ? '通知已被封鎖，請到手機設定開啟' : '尚未允許通知');
      return getToken();
    })
    .then(subscribe)
    .then(function () {
      setPushBusy(false);
      toast('通知已開啟');
    })
    .catch(function (err) {
      setPushBusy(false);
      toast(err.message);
    });
}

function disablePush() {
  if (!confirm('要關閉這支手機的通知嗎？')) return;
  setPushBusy(true);
  api({ action: 'unsubscribe', token: push.saved.token })
    .then(function () {
      savePush(null);
      setPushBusy(false);
      toast('通知已關閉');
      // 退訂這支裝置；之後再開啟會拿到新的 token
      navigator.serviceWorker.getRegistration()
        .then(function (reg) { return reg && reg.pushManager.getSubscription(); })
        .then(function (sub) { return sub && sub.unsubscribe(); })
        .catch(function () {});
    })
    .catch(function (err) {
      setPushBusy(false);
      toast(err.message);
    });
}

// token 換新時帶上舊的，後端更新原本那列，不會多一列
function subscribe(token) {
  var old = push.saved && push.saved.token;
  return api({ action: 'subscribe', token: token, oldToken: old && old !== token ? old : undefined, platform: platform() })
    .then(function () { savePush({ token: token }); });
}

// 註冊 service worker → 向 Firebase 取得這支裝置的 token
function getToken() {
  return Promise.all([loadMessaging(), navigator.serviceWorker.register('firebase-messaging-sw.js')])
    .then(function (r) {
      return r[0].getToken({ vapidKey: CONFIG.vapidKey, serviceWorkerRegistration: r[1] });
    })
    .then(function (token) {
      if (!token) throw new Error('empty token');
      return token;
    })
    .catch(function (err) {
      console.error(err);
      throw new Error('通知設定失敗，請稍後再試');
    });
}

function loadMessaging() {
  if (!messaging) {
    messaging = loadScript(FIREBASE_SDK + 'firebase-app-compat.js')
      .then(function () { return loadScript(FIREBASE_SDK + 'firebase-messaging-compat.js'); })
      .then(function () {
        if (!firebase.apps.length) firebase.initializeApp(CONFIG.firebase);
        return firebase.messaging();
      });
    messaging.catch(function () { messaging = null; });
  }
  return messaging;
}

// 開啟 App 時確認 token 沒變；變了就重新登記
function refreshPush() {
  if (!canPush || !push.saved) return;
  if (Notification.permission !== 'granted') { savePush(null); return; } // 在系統設定關掉了
  getToken()
    .then(function (token) {
      if (token !== push.saved.token) return subscribe(token);
    })
    .catch(function () {});
}

function renderGuide() {
  $('guideApp').textContent = CONFIG.appName;
  $('guide').hidden = !(pushReady && isIOS && !isStandalone && !guideClosed());
}

$('pushBtn').addEventListener('click', function () {
  if (push.busy) return;
  if (isPushOn()) disablePush();
  else enablePush();
});

$('guideClose').addEventListener('click', function () {
  try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) {}
  renderGuide();
});

// App 開著時收到推播：service worker 轉過來，跳提示並更新名單
if (canPush) {
  navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'push') {
      toast(e.data.body || e.data.title);
      load(true);
    }
  });
}

function platform() {
  return isIOS ? 'ios' : /Android/.test(ua) ? 'android' : 'desktop';
}

function savePush(v) {
  push.saved = v;
  try {
    if (v) localStorage.setItem(PUSH_KEY, JSON.stringify(v));
    else localStorage.removeItem(PUSH_KEY);
  } catch (e) {}
}

function loadPush() {
  try { return JSON.parse(localStorage.getItem(PUSH_KEY)); } catch (e) { return null; }
}

function guideClosed() {
  try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch (e) { return false; }
}

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = function () { reject(new Error('載入失敗：' + src)); };
    document.head.appendChild(s);
  });
}

/* ---------- 小工具 ---------- */

function $(id) {
  return document.getElementById(id);
}

function setName(v) {
  state.name = v;
  try { localStorage.setItem(NAME_KEY, v); } catch (e) {}
}

function loadName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
}

function focusName() {
  var input = list.querySelector('.card.open .name');
  if (input) input.focus();
}

// 2026/10/31 → 10/31
function md(d) {
  var p = String(d).split(/[\/\-.]/);
  if (p.length < 3) return d;
  return ('0' + parseInt(p[1], 10)).slice(-2) + '/' + ('0' + parseInt(p[2], 10)).slice(-2);
}

function esc(v) {
  return String(v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && !state.busy) load(true);
});

// 定時在背景更新；分頁不在前景時不打 API
setInterval(function () {
  if (document.visibilityState === 'visible' && !state.busy) load(true);
}, REFRESH_MS);

// 環境：測試版顯示 TEST；iPhone 主畫面名稱
$('envTag').hidden = CONFIG.env !== 'dev';
document.querySelector('meta[name="apple-mobile-web-app-title"]').setAttribute('content', CONFIG.appName);
renderPush();
renderGuide();
refreshPush();

// 先畫上次的資料，再到背景抓最新的
state.sessions = loadCache();
if (state.sessions) render();
load(!!state.sessions);
