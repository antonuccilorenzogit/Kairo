// Kairo service worker: caches the app shell so it opens instantly and offline.
// API calls always go to the network (health data is never cached here).
const CACHE = "kairo-shell-v1.23.3";
const SHELL = ["./", "index.html", "app.css", "app.js", "import-worker.js", "manifest.webmanifest", "fonts/nunito-latin.woff2", "icons/icon-192.png", "icons/icon-180.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/") || url.origin !== location.origin) return;
  // shortcut files are downloads: Safari mishandles downloads answered by a service worker
  if (url.pathname.startsWith("/shortcuts/")) return;
  // network first, cache as fallback: new versions appear as soon as you are online
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// Notifications sent by your Kairo server (morning recovery, evening bedtime)
self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || "Kairo", { body: m.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: m.url || "/#/oggi" }, tag: m.tag || "kairo" }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url ? e.notification.data.url : "/#/oggi";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
