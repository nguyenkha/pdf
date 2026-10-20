# Third-party notices

Original pdf.kha.do code: Copyright (c) 2026 kha.do, AGPL-3.0-or-later. Third-party code retains its own license.

| Runtime component | Purpose | License |
| --- | --- | --- |
| Ghostscript 10.08.0, distributed by `@wasm-zoo/ghostscript` 0.7.2 | PDF rewriting and image recompression | AGPL-3.0-or-later; supplied third-party notices also apply |
| WASM Zoo distribution adapter/build recipes | Reproducible distribution | MIT; does not relicense the Ghostscript binary |
| PDF.js (`pdfjs-dist`) | Parsing, text, annotations, validation previews; local CMaps and standard fonts | Apache-2.0; included font notices apply |
| pdf-lib 1.17.1 with `@pdf-lib/standard-fonts`, `@pdf-lib/upng`, pako and tslib | Merging PDFs by copying pages | MIT (pako: MIT and Zlib; tslib: 0BSD) |
| React, React DOM, scheduler | UI | MIT |
| Lucide React | Icons | ISC |

Development tools include Vite/Vitest/Prettier (MIT), TypeScript/Playwright (Apache-2.0), and ESLint/typescript-eslint (MIT). The optional Node canvas dependency of PDF.js is not shipped in the browser bundle.

Upstream sources:

- https://github.com/ttomohisa/wasm-zoo/tree/ghostscript-v0.7.2 (manifest, provenance, corresponding source, recipes and supplied license collection)
- https://github.com/ArtifexSoftware/ghostpdl
- https://github.com/mozilla/pdf.js
- https://github.com/Hopding/pdf-lib
- https://github.com/facebook/react
- https://github.com/lucide-icons/lucide

`scripts/vendor-engine.mjs` exports the supplied classic Emscripten core as an ES module and adds a heap-size accessor; it leaves the WASM binary unchanged. `scripts/copy-notices.mjs` copies runtime license texts and Ghostscript's complete supplied third-party notices into `dist/licenses/`, including the distribution MIT license and upstream AGPL text. PDF.js font notices are included alongside its locally hosted font assets. Retain these notices, the application source/build scripts, and the applicable corresponding source when redistributing the application or engine binaries.

The application icon is an original document/letter design. It does not use Adobe's PDF or Acrobat logo.
