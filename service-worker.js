const CACHE_NAME = "storage-retschwil-shell-v20260714-4";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/styles.css?v=20260714-4",
  "/auth.css?v=20260713-1",
  "/auth.js?v=20260713-1",
  "/app.js?v=20260707-1",
  "/qrcode-generator.js?v=20260622-4",
  "/manifest.json?v=20260714-4",
  "/icons/header-logo.png?v=20260714-4",
  "/icons/favicon.png?v=20260714-4",
  "/icons/android-icon.png?v=20260714-4"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const requestUrl = new URL(event.request.url);

  if (requestUrl.hostname.includes("execute-api")) return;
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/") || caches.match("/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === "opaque") return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      }))
  );
});
