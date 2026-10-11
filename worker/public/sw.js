// Kairo service worker: caches the app shell so it opens instantly and offline.
// API calls always go to the network (health data is never cached here).
const CACHE = "kairo-shell-v1.3.0";
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
