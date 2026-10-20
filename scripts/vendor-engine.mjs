import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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

// OCR: the recognizer and its language data are served from this site, so a
// scan is read on the device without contacting any CDN. Only the LSTM cores
// are kept (the site never asks for the legacy engine).
const ocr = "public/ocr";
const tesseract = path.dirname(
  fileURLToPath(import.meta.resolve("tesseract.js/package.json")),
);
const ocrCore = path.dirname(
  createRequire(path.join(tesseract, "package.json")).resolve(
    "tesseract.js-core/package.json",
  ),
);
fs.mkdirSync(`${ocr}/core`, { recursive: true });
fs.mkdirSync(`${ocr}/lang`, { recursive: true });
fs.copyFileSync(path.join(tesseract, "dist/worker.min.js"), `${ocr}/worker.min.js`);
for (const variant of ["", "-simd", "-relaxedsimd"])
  fs.copyFileSync(
    path.join(ocrCore, `tesseract-core${variant}-lstm.wasm.js`),
    `${ocr}/core/tesseract-core${variant}-lstm.wasm.js`,
  );
for (const language of ["eng", "vie", "chi_sim", "spa", "ara", "fra", "por", "rus", "hin", "jpn", "kor", "deu"])
  fs.copyFileSync(
    `node_modules/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`,
    `${ocr}/lang/${language}.traineddata.gz`,
  );
