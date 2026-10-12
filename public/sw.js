/* Service worker CHỈ cho thông báo đẩy: không có fetch handler, không cache dữ liệu. Phạm vi "/". */
"use strict";
var DEFAULT_TITLE = "Điểm danh Giáo lý";

function clip(v, max) {
  if (typeof v !== "string") return "";
  var s = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(/\s+/g, " ").trim();
  var c = Array.from(s);
  return c.length <= max ? s : c.slice(0, max - 1).join("") + "…";
}

/* Chỉ đường dẫn cùng nguồn bắt đầu bằng "/" (không "//", không "\"); còn lại về "/". */
function safeUrl(u) {
  return typeof u === "string" && u.length <= 512 && /^\/(?![\/\\])[\x21-\x7e]*$/.test(u) && u.indexOf("\\") < 0 ? u : "/";
}

function payload(event) {
  try {
    var d = event.data ? event.data.json() : null;
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

/* Luôn hiện thông báo (iOS thu hồi đăng ký nếu push không hiện gì), kể cả khi nội dung hỏng. */
self.addEventListener("push", function (event) {
  var d = payload(event);
  event.waitUntil(self.registration.showNotification(clip(d.title, 80) || DEFAULT_TITLE, {
    body: clip(d.body, 200),
    icon: "/icon-192.png",
    lang: "vi",
    data: { url: safeUrl(d.url) },
  }));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var data = event.notification.data;
  var target = new URL(safeUrl(data && data.url), self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    var mine = list.filter(function (c) { return c.url.indexOf(self.location.origin + "/") === 0; });
    var exact = mine.filter(function (c) { return c.url === target; })[0];
    if (exact) return exact.focus();
    var app = mine[0];
    if (app && app.navigate) {
      return app.focus().then(function () { return app.navigate(target); }).catch(function () { return self.clients.openWindow(target); });
    }
    return self.clients.openWindow(target);
  }));
});
