// RAPTOR service worker (phase 15 PWA shell) — deliberately minimal.
// Strategy: network-first for EVERYTHING, falling back to a cached copy of
// the small shell files when offline. The multi-hundred-MB terrain drapes are
// NEVER precached (browser HTTP cache handles them); this worker only makes
// the app installable and the shell survivable offline. Cache is keyed by
// version: bumping SHELL_VERSION on deploy retires the old cache.
const SHELL_VERSION = "raptor-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/assets/icon-192.png", "/assets/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // keep the shell copies fresh as they flow past
        const u = new URL(e.request.url);
        if (SHELL.includes(u.pathname) && res.ok) {
          const copy = res.clone();
          caches.open(SHELL_VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
