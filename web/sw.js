// Caches the game so it opens and plays offline after the first visit.
// Bump the version whenever game files change, so players get the update.
const CACHE_NAME = "snake3d-v2";
const APP_FILES = [
  "./",
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "js/main.js",
  "js/logic.js",
  "js/render.js",
  "js/sound.js",
  "js/i18n.js",
  "fonts/NotoSansBengali-Regular.ttf",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// Network first, so updates show up right away when online; the cache is the offline fallback
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
