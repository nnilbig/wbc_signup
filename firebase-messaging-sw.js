// 背景接收推播。不載入 Firebase SDK：GAS 發的通知內容直接在這裡顯示，
// 每則推播都一定顯示通知（iPhone 若推播沒顯示通知，會被系統停掉推播權限）。

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch (err) {}
  var n = msg.notification || msg.data || {};
  var title = n.title || 'WHONEXT B.C. 通知';
  var body = n.body || '';

  e.waitUntil(Promise.all([
    self.registration.showNotification(title, { body: body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }),
    // App 開著時讓頁面跳提示並更新名單
    self.clients.matchAll({ type: 'window' }).then(function (list) {
      list.forEach(function (c) { c.postMessage({ type: 'push', title: title, body: body }); });
    })
  ]));
});

// 點通知：已開著就切過去，否則開預約頁
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(url) === 0 && 'focus' in list[i]) return list[i].focus();
    }
    return self.clients.openWindow(url);
  }));
});
