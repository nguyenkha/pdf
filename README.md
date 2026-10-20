# pdf.kha.do

**Your PDF. Your device. Your rules.**

Free, open-source PDF tools that run entirely in your browser. No uploads, accounts, paywalls, ads, analytics, daily quotas, or bullshit. The website loads from the internet; your PDF stays on your device.

Source: https://github.com/nguyenkha/pdf · Website: https://pdf.kha.do

## Features

- Compress one PDF by dropping it or browsing, then download the result
- Best quality by default; balanced/smallest preferences and optional image-quality controls
- Optional target size with bounded quality attempts, keeping dimensions before trying downsampling
- Selectable text and vectors preserved in ordinary PDFs; no whole-page rasterization
- Real input/output checks for pages, text, annotations, links, dimensions, and coarse visual regressions
- Eleven languages, Arabic RTL, locale-aware numbers, system/light/dark themes
- Static localized SEO and privacy pages; GitHub Pages and Cloudflare Pages support
- Works offline after the required application and engine assets have been cached

Only Compress PDF is implemented. Future tools are not shown as functional.

## Development and verification

Requires Node 24+ and pnpm 10.32.1. No account, API key, or environment secret is required.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium webkit
pnpm test:e2e --workers=2
pnpm preview
```

Browser tests run against the production `dist/` build, so build before running them. `pnpm test:pdf:native` optionally checks synthetic fixtures with locally installed Ghostscript and Poppler. Fixtures can be regenerated with `python3 scripts/make-fixtures.py`.

The production build writes `dist/bundle-report.json` with raw, gzip, and Brotli quality-5 estimates. These are asset sizes; actual transfer compression depends on the host.

## Privacy model

The page fetches only its own application assets. There is no upload endpoint or remote PDF service. A File is passed to a dedicated worker, read in memory, and processed by locally hosted JavaScript/WASM. On Android, the installed app is a share target: a shared PDF is held in the service worker's memory only until the page takes it, and is never written to storage. The original filename is only used to display the chosen file and name the download. Engine diagnostics are suppressed; only the page number of Ghostscript's "Page N" lines is read, for the progress bar. PDF contents are not logged. A password for a protected PDF stays in the worker for that one job and is never stored.

No document data is put in localStorage, IndexedDB, or Cache Storage. Only language/theme choices are stored in localStorage. A service worker caches explicitly allowed same-origin application assets, never PDFs or blob URLs. Cancel/reset releases workers and result object URLs. Browser tests monitor HTTP requests while processing and verify no document data or metadata is sent.

Initial website/asset requests still reach the hosting provider, which may maintain normal access logs. This is not a claim of zero network traffic when visiting the site.

## Architecture and compression

`src/app/tools.ts` is a small typed tool registry with localized keys, routes, icons, lazy components, and engine dependencies. Reusable upload, file, progress, and download components live in `src/components/`.

The initial UI imports neither PDF.js nor Ghostscript. Clicking Compress starts `compress.worker.ts`, which reads the File, inspects the document with PDF.js, and identifies pages containing images. Text/vector-only documents get a structural pass. PDFs with images first get a pixel-preserving structural attempt, then ranked JPEG quality attempts at the original dimensions. Downsampling is a final fallback for target/smallest settings. File size is not assumed to be monotonic with JPEG quality. No target is promised achievable.

Each Ghostscript attempt runs in a separate worker, which is terminated after the pass. This prevents interpreter state from leaking between attempts. Cancel tells the orchestration worker to stop its child before termination. A timeout bounds every job. Candidate output is validated before release. If nothing is smaller, the original is retained and the UI says so. Lossy image recompression is disclosed beside the result.

### Engine decision and licensing

| Approach | Decision |
| --- | --- |
| Ghostscript WASM | Chosen: genuine image recompression through `pdfwrite`, ordinary text/vector preservation, maintained upstream, AGPL-3.0-or-later |
| MuPDF WASM | Mature AGPL engine; structural saving is straightforward, but this workflow needs additional image-object editing |
| PDFium WASM | Permissive renderer/editor foundation; would require a larger custom image-rewrite layer |
| pdf-lib plus codecs | Permissive but does not provide safe general-purpose recompression of arbitrary embedded PDF images |

The pinned `@wasm-zoo/ghostscript@0.7.2` package contains Ghostscript 10.08.0. Its stock browser wrapper requires a DOM, so `scripts/vendor-engine.mjs` generates a documented ESM adapter from the supplied core: it adds an export and a WASM-heap-size accessor. The binary is copied unchanged. Source recipes, manifests, checksums, provenance, and corresponding-source information are available from [WASM Zoo](https://github.com/ttomohisa/wasm-zoo/tree/ghostscript-v0.7.2) and [Ghostscript](https://github.com/ArtifexSoftware/ghostpdl). The exact app adapter/build instructions are in this repository.

Original application code is AGPL-3.0-or-later, **not MIT**. Dependencies retain their licenses. The build copies runtime licenses and the engine's complete supplied notices to `dist/licenses/`. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.

### Honest limitations

PDF rewriting cannot preserve every PDF feature. A password-protected PDF can be compressed after the user enters its password; the compressed copy is written without encryption and the result says so. Forms/signatures, attachments, JavaScript actions, optional layers and XFA are rejected when detected. Tagged (accessibility) PDFs are compressed, but the structure tree is not kept; the user is told before compressing. Unsupported preservation changes stop processing rather than producing a download. Checks compare text, page geometry, annotation summaries and small render previews; they cannot prove complete semantic or pixel-perfect equivalence. Important documents should still be reviewed before sharing. Unusual fonts, color spaces, transparency, bookmarks, and less common PDF extensions may require an original-preserving workflow instead.

There is no artificial file-size quota. Files above 80 MiB show a memory advisory and can still be attempted. Browser/engine memory limits are real; a large document can exhaust them, particularly on mobile Safari. Only one page preview is decoded at a time, and render checks (operator list and preview) run on up to 8 evenly spread pages; text, geometry and annotations are checked on every page. A measured small scan used a 128 MiB Ghostscript heap; total process memory is higher because it also includes the ~16 MiB WASM bytes, PDF parsing, input/output buffers and rendering. Expect usage to grow with document complexity. The browser cannot report a reliable cross-platform total working set.

## Hosting

The **same `dist/` directory** is deployable on either host. Serve it at an origin root; the app does not require the official domain to function. Canonical/hreflang URLs intentionally use the production domain. All runtime processing assets are included locally.

### GitHub Pages

1. Create a public repository, push to `main`, and set Settings → Pages → Source to **GitHub Actions**.
2. Set the repository's custom domain to `pdf.kha.do`. For Actions deployments, the repository Pages setting is authoritative; the included `CNAME` also documents the intended domain.
3. Create DNS `CNAME pdf -> nguyenkha.github.io`, without a `/pdf` suffix. Wait for the certificate, then enable Enforce HTTPS.
4. `.github/workflows/deploy.yml` installs from the lockfile, runs lint/typecheck/unit tests/build and Chromium/WebKit browser tests, then deploys Pages automatically on pushes to `main`.

Every locale and privacy URL has a real HTML entry point, so no SPA rewrite is needed. GitHub Pages does not apply Cloudflare `_headers`; production HTML also includes an appropriate CSP meta policy.

### Cloudflare Pages

Build command: `pnpm install --frozen-lockfile && pnpm build`. Output: `dist`. Node: 24. Add `pdf.kha.do` under Custom domains and configure its DNS as instructed by Pages. No Workers, Functions, API keys, or backend are needed for the application.

`_headers` supplies security headers and WASM MIME/cache settings. Hashed/versioned assets are immutable; HTML and `sw.js` should be revalidated. Root redirects to the saved/browser locale with English fallback. Every localized route is a file; no catch-all rewrite is needed.

## Roadmap and contributing

Merge, split, rotate, extraction and images-to-PDF may be added as independent local tools. Privacy and correctness take priority over feature count. Contributions are welcome; see `CONTRIBUTING.md`.

## Corpus and memory checks

`pnpm test:corpus` builds a synthetic corpus with native Ghostscript (`scripts/make-corpus.mjs`: 300 dpi color and gray scans, a long text document, one with bookmarks and page links), compresses each file in WebKit with an iPhone profile and in desktop Chromium, and fails when the output loses pages or bookmarks, or when a job's peak memory passes a 2 GB ceiling. Browser resident memory varies by up to ~50% between identical runs, so the ceiling only catches gross regressions; the measured peaks are reported for trends. CI writes the timings and peaks to the run summary.

## Adding a tool

Tools are listed in `src/app/tools.ts` and mirrored in `scripts/seo.mjs`. Build the component under `src/tools/<id>/` against `ToolProps`, add it to both lists with a slug, and add its strings (`<nameKey>Title`, `Description`, `Hero`, `Intro`) to every locale. The page, hreflang, sitemap and offline cache follow from the slug. Planned tools (entries without `load`) never show by name; while any exist, the switcher ends with one "more tools coming" placeholder.
