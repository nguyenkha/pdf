# PDF to Markdown experiment

Local branch: `experiment/pdf-to-md`. Install with `pnpm install --frozen-lockfile`, start with `pnpm dev:pdf-to-md`, then open http://127.0.0.1:4182/experiments/pdf-to-md/.

This Vietnamese development entry is excluded from the production Vite build and main navigation. No deployment or additional dependency is needed.

## Text conversion

- Adjacent lines are joined into paragraphs. Larger vertical gaps, indentation changes and list markers preserve boundaries. **Giữ xuống dòng gốc** retains extracted line breaks.
- Discretionary soft hyphens are removed between wrapped letters. Ordinary hyphens are preserved because the converter cannot distinguish a wrapped word from a meaningful compound such as “privacy-first”.
- Short headings are inferred from font size relative to document body text. Bold is considered only if PDF.js exposes a descriptive font family; its opaque internal font IDs are never treated as weight information. Heading detection can be disabled. Document/page/section levels remain nested.
- Small repeated lines in the outer 7.5% of the page are removed only if their text and position agree on at least three pages and 75% of the document. Only narrow page-number patterns are normalized; distinct invoice IDs are preserved. Repeated body text is retained. The UI reports removed lines and the option can be disabled instantly.

These are layout heuristics, not semantic understanding. Columns, tables, unusual layouts and mixed writing directions can still have incorrect reading order. Review the output. Image-only pages are marked; wholly scanned and password-protected documents get an explanation. There is no OCR or image/table extraction.

## Preview and export

The default preview renders generated Markdown with React text nodes. **Markdown** shows the full source. **So sánh với PDF** lazily opens one original PDF page beside its corresponding Markdown, with previous/next controls; on narrow screens the panes stack. Canvas resolution is bounded. Closing comparison destroys its loading task even before loading finishes.

**Copy Markdown** writes only after a click. If clipboard access fails, the source is selected for manual copying. Download always contains the whole document. The preview supports this converter's limited Markdown, not arbitrary extensions, raw HTML or remote images/links.

## Privacy and memory

PDF.js extracts text in a worker one page at a time. After extraction its PDF loading task is destroyed; only plain text/layout remain in worker RAM to update options without reparsing. Replacing a file or cancelling terminates that worker. PDF comparison uses a separate parser that is destroyed on close. Download object URLs are revoked on replacement/unmount.

No document content is uploaded, logged or stored persistently. This entry does not register a service worker. It uses only same-origin application assets. Clipboard and downloads happen only at the user's request.

## Verification

`pnpm test:pdf-to-md`: 16 unit cases and 18 Chromium/WebKit browser cases covering text structure, conservative margin cleanup, option updates, page comparison, parser cleanup, clipboard success/fallback, downloads, unsupported inputs and network privacy. `pnpm lint`, `pnpm typecheck` and `pnpm build` are the other checks.

`node scripts/make-md-fixture.mjs` regenerates the synthetic four-page fixture with titles, wrapped paragraphs and running headers/footers. It contains no personal document data.
