// Nordbeck To-Do – Service Worker: App-Dateien zwischenspeichern, Push anzeigen
const CACHE = "nordbeck-todo-v1.0.17";
const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "js/store.js", "js/util.js", "js/config.js", "js/supabase.js",
  "img/logo.png", "icons/icon-192.png", "icons/badge-96.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Eigene Dateien: erst Netz (immer aktuell), bei Funkloch aus dem Speicher
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  const req = new Request(e.request.mode === "navigate" ? u.origin + u.pathname : e.request.url, { cache: "no-cache" });
  e.respondWith(
    fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "Nordbeck To-Do", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Nordbeck To-Do", {
    body: d.body || "", tag: d.tag, renotify: true,
    icon: "icons/icon-192.png", badge: "icons/badge-96.png",
    data: { url: d.url || "./#/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./#/", self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) {
        c.postMessage({ type: "open", url });
        return c.focus();
      }
    }
    return clients.openWindow(url);
  })());
});
