const CACHE = "pdf-kha-do-assets-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          "/en/",
          "/icons/icon.svg",
          "/theme.js",
          "/redirect.js",
          "/manifest.webmanifest",
        ]),
      ),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith(".pdf"))
    return;
  const html = /^\/(en|zh-CN|es|ar|fr|pt|ru|hi|ja|de|vi)\/(?:privacy\/)?$/.test(
    url.pathname,
  );
  const asset =
    html ||
    url.pathname.startsWith("/pdfjs/") ||
    url.pathname.startsWith("/engine/") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    ["/theme.js", "/redirect.js", "/manifest.webmanifest"].includes(
      url.pathname,
    );
  if (!asset) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      if (html) {
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          const cached = await cache.match(request);
          if (cached) return cached;
          throw new Error("offline");
        }
      }
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
