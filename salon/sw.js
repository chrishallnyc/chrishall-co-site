/* THE SALON — service worker.
   Shell: network-first; navigations key to './' so any ?param URL launches offline.
   Artwork: cache-first FIFO (approximates the rotation), bounded — opaque entries carry
   ~7MB quota padding each in Chromium, so the cap stays modest. */
'use strict';
const V = 'salon-v1.0.0'; /* keep in lockstep with SALON_VER in index.html — battery T13 enforces */
const SHELL = V + ':shell';
const ART = 'salon:art'; /* survives shell version bumps — the images don't change */
const ART_MAX = 24;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL)
    .then(c => c.addAll(['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== SHELL && k !== ART).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

async function artPut(req, res) {
  const c = await caches.open(ART);
  await c.put(req, res);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - ART_MAX; i++) await c.delete(keys[i]); /* evict ALL excess — puts land concurrently */
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === location.origin;

  if (sameOrigin) {
    if (req.mode === 'navigate') { /* every entry URL (?room=, ?door=0, ?still...) serves + caches as './' */
      e.respondWith(
        fetch(req).then(res => {
          if (res.ok) { const cp = res.clone(); caches.open(SHELL).then(c => c.put('./', cp)).catch(() => {}); }
          return res;
        }).catch(() => caches.match('./'))
      );
    } else {
      e.respondWith(
        fetch(req).then(res => {
          if (res.ok) { const cp = res.clone(); caches.open(SHELL).then(c => c.put(req, cp)).catch(() => {}); }
          return res;
        }).catch(() => caches.match(req))
      );
    }
    return;
  }
  if (req.destination === 'image') { /* artwork: cache-first */
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const cp = res.clone(); artPut(req, cp).catch(() => {}); }
        return res;
      }))
    );
  }
});
