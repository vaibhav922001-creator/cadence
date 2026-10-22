/* Cadence service worker: caches the app shell only (this site's own files).
   Health data lives in IndexedDB, not here. Requests to Google, Anthropic or any proxy are never cached. */
const CACHE = "cadence-shell-aec9f298e87b";
const SHELL = ["./","./index.html","./manifest.webmanifest","./apple-touch-icon.png","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./icon-maskable.svg","./icon.svg"];
const SHELL_PATHS = new Set(SHELL.map((p) => new URL(p, self.registration.scope).pathname));

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("cadence-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google, Anthropic, fonts, proxies: straight to network
  if (!SHELL_PATHS.has(url.pathname) || url.search) return;
  const isPage = req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html");
  if (isPage) {
    // network first so new versions arrive; fall back to the cached shell offline
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(new URL("./index.html", self.registration.scope).href, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(new URL("./index.html", self.registration.scope).href).then((r) => r || caches.match(req))),
    );
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
