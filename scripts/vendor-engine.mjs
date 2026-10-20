import fs from "node:fs";
import path from "node:path";
// Upstream is a classic Emscripten factory. Export it as ESM for a real module
// Worker, rather than using the package's document-dependent browser wrapper.
const source = "node_modules/@wasm-zoo/ghostscript";
const destination = "public/engine/ghostscript-10.08.0-0.7.2";
fs.mkdirSync(destination, { recursive: true });
let core = fs.readFileSync(path.join(source, "gs-core.js"), "utf8");
const marker = ";return Module}})();";
if (core.split(marker).length !== 2)
  throw new Error("Upstream factory changed: review the ESM adapter");
core = core.replace(
  marker,
  ";Module.getHeapBytes=()=>HEAPU8.byteLength;return Module}})();",
);
fs.writeFileSync(
  path.join(destination, "core.js"),
  `${core}\nexport default createGhostscriptCore;\n`,
);
fs.copyFileSync(
  path.join(source, "gs-core.wasm"),
  path.join(destination, "core.wasm"),
);

for (const name of ["cmaps", "standard_fonts"]) {
  fs.cpSync(`node_modules/pdfjs-dist/${name}`, `public/pdfjs/${name}`, {
    recursive: true,
  });
}
