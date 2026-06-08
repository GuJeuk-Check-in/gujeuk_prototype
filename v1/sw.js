const CACHE_NAME = "gujeuk-v1-shell-20260608-v1";
const APP_SHELL = ["./", "./index.html", "./styles.css", "./app.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        APP_SHELL.map(async (asset) => {
          const response = await fetch(asset, { cache: "reload" });
          await cache.put(asset, response);
        }),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (
    requestUrl.origin !== self.location.origin ||
    requestUrl.pathname.startsWith("/backend/")
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const responseCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request, { ignoreSearch: true })
          .then((cachedResponse) => cachedResponse || caches.match("./index.html")),
      ),
  );
});
