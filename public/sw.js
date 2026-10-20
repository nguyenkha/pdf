const CACHE = "pdf-kha-do-assets-v2";
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
          keys.filter((k) => k !== CACHE && k !== SHARED).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});
// Android share sheet -> installed app. The shared PDFs are parked in a
// local cache only until the page picks them up and deletes them; nothing
// leaves the device.
const SHARED = "pdf-kha-do-shared";
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const target = new URL(request.url);
  if (request.method === "POST" && target.pathname === "/share-target") {
    event.respondWith(
      (async () => {
        const form = await request.formData();
        const cache = await caches.open(SHARED);
        let index = 0;
        for (const file of form.getAll("file")) {
          if (!(file instanceof File)) continue;
          await cache.put(
            `/shared/${index++}`,
            new Response(file, {
              headers: { "Content-Type": "application/pdf", "X-Name": encodeURIComponent(file.name) },
            }),
          );
        }
        return Response.redirect("/?shared=1", 303);
      })(),
    );
    return;
  }
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith(".pdf"))
    return;
  const html = /^\/(en|zh-CN|es|ar|fr|pt|ru|hi|ja|de|vi)\/(?:privacy\/|compress-pdf-to-[a-z0-9]+\/)?$/.test(
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
