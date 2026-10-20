import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
const root = "dist";
const files = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) walk(p);
    else files.push(p);
  }
}
walk(root);
// The locale home only redirects; the compress page is the real first load.
const html = fs.readFileSync("dist/en/compress/index.html", "utf8");
const initial = new Set(
  [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map(
    (match) => path.join(root, match[1]),
  ),
);
for (const file of files.filter((file) => /CompressTool-[^/]+\.js$/.test(file)))
  initial.add(file);
for (const file of [
  "en/compress/index.html",
  "theme.js",
  "icons/icon.svg",
  "manifest.webmanifest",
])
  initial.add(path.join(root, file));
function measure(paths) {
  let raw = 0,
    gzip = 0,
    brotli = 0;
  for (const p of paths) {
    const b = fs.readFileSync(p);
    raw += b.length;
    gzip += zlib.gzipSync(b).length;
    brotli += zlib.brotliCompressSync(b, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
    }).length;
  }
  return { raw, gzip, brotli };
}
const report = {
  initialJS: measure([...initial].filter((p) => p.endsWith(".js"))),
  initialCSS: measure([...initial].filter((p) => p.endsWith(".css"))),
  initialTransferred: measure([...initial]),
  wasm: measure(files.filter((p) => p.endsWith(".wasm"))),
  allJS: measure(files.filter((p) => p.endsWith(".js"))),
  totalSiteAssets: measure(files),
};
fs.writeFileSync("dist/bundle-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
