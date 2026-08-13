/* Mission Chain DApp — minimal service worker (installability + app-shell cache).
   IMPORTANT: never caches API / RPC / WalletConnect (all cross-origin) — DApp needs live data.
   Bump CACHE version when the shell caching strategy changes. */
var CACHE = 'mc-shell-v3';
var SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // Only handle same-origin GETs. Cross-origin (api.missionchain.io, RPC, WalletConnect, fonts) -> straight to network.
  if (url.origin !== self.location.origin) return;

  // Page navigations: network-first (always fresh when online), fall back to cache offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match('/'); });
      })
    );
    return;
  }

  // Build output: straight to network, never cached here.
  //
  // These are already served with `Cache-Control: immutable, max-age=1y`, so the HTTP cache
  // does this job correctly and drops an entry the moment its hashed name stops being
  // referenced. The service worker's copy had no such expiry: a chunk cached under an old
  // name survived every deploy, every hard reload, and every version bump of this file,
  // because cache-first never asks the network whether anything changed.
  //
  // That is how a nav badge that had been removed from the source, removed from the
  // running container, and confirmed absent from every file on the server kept appearing
  // on screen. Caching a hashed asset twice bought nothing and cost that.
  if (url.pathname.indexOf('/_next/') === 0) {
    return; // fall through to the network
  }

  // Icons and the manifest: cache-first is fine, they are small and rarely change.
  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
