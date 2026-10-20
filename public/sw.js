const CACHE = "pdf-kha-do-assets-v3";
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
          // Also removes the old "pdf-kha-do-shared" hand-over cache.
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});
// Android share sheet -> installed app. Shared PDFs stay in this worker's
// memory only until the page takes them (or the worker stops); they are
// never written to storage.
let shared = [];
self.addEventListener("message", (event) => {
  if (event.data?.type !== "take-shared" || !event.ports[0]) return;
  event.ports[0].postMessage(shared);
  shared = [];
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const target = new URL(request.url);
  if (request.method === "POST" && target.pathname === "/share-target") {
    event.respondWith(
      (async () => {
        const form = await request.formData();
        shared = form.getAll("file").filter((file) => file instanceof File);
        return Response.redirect("/?shared=1", 303);
      })(),
    );
    return;
  }
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith(".pdf"))
    return;
  const html = /^\/(en|zh-CN|es|ar|fr|pt|ru|hi|ja|de|vi)\/(?:[a-z0-9-]+\/)?$/.test(
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
        // Pages are cached by path: a query such as ?shared=1 must not
        // become a separate, lingering cache entry.
        const key = url.origin + url.pathname;
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(key, response.clone());
          return response;
        } catch {
          const cached = await cache.match(key);
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
