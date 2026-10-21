const CACHE = "pdf-kha-do-assets-v6";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          // The installed app starts at "/", which then picks a language.
          "/",
          "/en/compress/",
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
const transfers = new Map();
const remember = (files, client, path) => {
  const token = crypto.randomUUID();
  const timer = setTimeout(() => transfers.delete(token), 60_000);
  transfers.set(token, { files, client, path, timer, expires: Date.now() + 60_000 });
  return token;
};
self.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (!port || !event.source?.id) return;
  // One tool hands its result to another, the same way as the share sheet.
  if (event.data?.type === "hand-over") {
    const path = event.data.path;
    if (typeof path !== "string" || !/^\/[a-zA-Z-]+\/[a-z0-9-]+\/$/.test(path) || !Array.isArray(event.data.files))
      return port.postMessage(false);
    const files = event.data.files.filter((file) => file instanceof File);
    const token = remember(files, event.source.id, path);
    const transfer = transfers.get(token);
    // navigate() identifies the resulting document even in browsers that do
    // not expose FetchEvent.replacesClientId/resultingClientId.
    transfer.navigation = event.source.navigate(`${path}?shared=1#transfer=${token}`)
      .then((client) => {
        transfer.client = client?.id;
        port.postMessage(Boolean(client));
      }).catch(() => { transfers.delete(token); clearTimeout(transfer.timer); port.postMessage(false); });
    event.waitUntil(transfer.navigation);
  }
  if (event.data?.type === "take-shared") {
    const transfer = transfers.get(event.data.token);
    if (!transfer) return port.postMessage([]);
    event.waitUntil((async () => {
      await transfer.navigation;
      const url = new URL(event.source.url);
      // External share-target navigation has no sending WindowClient. The
      // unguessable token must arrive on the recipient's original URL.
      if (transfer.path === null && transfer.client === null &&
          new URLSearchParams(url.hash.slice(1)).get("transfer") === event.data.token)
        transfer.client = event.source.id;
      if (transfer.expires < Date.now() || transfer.client !== event.source.id ||
          (transfer.path !== null && url.pathname !== transfer.path) || !transfers.has(event.data.token))
        return port.postMessage([]);
      transfers.delete(event.data.token);
      clearTimeout(transfer.timer);
      port.postMessage(transfer.files);
    })());
  }
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const target = new URL(request.url);
  if (request.method === "POST" && target.pathname === "/share-target") {
    event.respondWith(
      (async () => {
        const form = await request.formData();
        const files = form.getAll("file").filter((file) => file instanceof File);
        const token = remember(files, null, null);
        return Response.redirect(`/?shared=1#transfer=${token}`, 303);
      })(),
    );
    return;
  }
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith(".pdf"))
    return;
  const html =
    url.pathname === "/" ||
    /^\/(en|zh-CN|es|ar|fr|pt|ru|hi|ja|ko|de|vi)\/(?:[a-z0-9-]+\/)?$/.test(url.pathname);
  const asset =
    html ||
    url.pathname.startsWith("/pdfjs/") ||
    url.pathname.startsWith("/engine/") ||
    url.pathname.startsWith("/ocr/") ||
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
