# PDF to Markdown experiment

Local experiment on `experiment/pdf-to-md`. Run `pnpm install --frozen-lockfile`, then `pnpm dev:pdf-to-md`. Open `http://127.0.0.1:4182/experiments/pdf-to-md/`.

The separate development entry point is not included in the production Vite build or main tool navigation. No deployment or additional dependency is needed. The interface is Vietnamese for this local experiment.

PDF.js extracts existing text in a dedicated worker, one page at a time. The PDF engine starts only on conversion. Files and extracted text are not uploaded, logged or stored persistently. This entry point does not register a service worker. The preview uses a read-only text field; extracted HTML and Markdown syntax are escaped in the download. Cancelling terminates the worker; replacing a file revokes the prior download URL.

Output has a document title and numbered page sections. There is no OCR, table recognition, image extraction, semantic heading detection or multi-column reconstruction. Image-only pages are marked; entirely image-only files and password-protected documents get an explanation rather than a misleading download. Complex layouts can have incorrect reading order. This is not a production-quality document converter.

Verification: `pnpm test:pdf-to-md` runs three unit cases and twelve Chromium/WebKit browser cases, including download contents, page count markers, unsupported files and same-origin GET-only network activity. `pnpm lint`, `pnpm typecheck` and `pnpm build` also pass.
