# PDF to Markdown experiment

Local branch: `experiment/pdf-to-md`. Install with `pnpm install --frozen-lockfile`, start with `pnpm dev:pdf-to-md`, then open http://127.0.0.1:4182/experiments/pdf-to-md/.

This Vietnamese development entry is excluded from the production Vite build and main navigation. No deployment or additional dependency is needed.

## Text and reading order

- Adjacent lines become paragraphs. Larger vertical gaps, indentation changes and list markers preserve boundaries. **Giữ xuống dòng gốc** retains extracted line breaks.
- Only discretionary soft hyphens are removed between wrapped letters. Ordinary hyphens remain because they may be meaningful.
- Short headings are inferred from relative font size. Bold is considered only when PDF.js exposes a descriptive font family, never from opaque internal font IDs. Heading detection can be disabled.
- Small repeated lines in the outer 7.5% of the page are removed only when their text and position agree on at least three pages and 75% of the document. Numbered footnote-like text and repeated body text remain. The UI reports removals; the option can be disabled.
- Optional reading-order recovery handles clear **two-column, left-to-right** pages with an identifiable gutter. Spanning titles remain ahead of their sections. RTL, vertical writing, apparent three-column layouts and uncertain cases retain the original order. PDF whitespace-only items do not become false column barriers.
- **Nối các trang** removes page headings and separators from the full Markdown. It does not merge sentences across page boundaries. Comparison still has individual pages.

These are geometry heuristics, not semantic understanding. Review complex layouts. Image-only pages are marked; wholly scanned and password-protected documents receive an explanation. There is no OCR or image extraction.

## Tables and CSV

Simple tables become Markdown tables and HTML tables in the preview. Each detected table has a separate CSV download, with its source page shown. CSV uses UTF-8 BOM, quoted values and CRLF; spreadsheet formula-like cells are prefixed with an apostrophe to reduce formula injection risk. This protection may change such a cell's literal CSV value.

Detection requires at least three consistently aligned rows and two to twelve columns. Two-column tables need numeric data evidence so ordinary prose columns are less likely to be mistaken for tables. Numeric-first tables receive generated column names without losing the first data row. Merged cells, multiline cells, missing cells, irregular alignment and tables spanning pages are not reliably supported. Uncertain regions remain text rather than being forced into a table. The first nonnumeric row is treated as a header; verify this interpretation against the PDF.

## Links, lists and footnotes

- External PDF link annotations are retained for HTTP, HTTPS and mailto only. Credentials and control characters are rejected. A link covering most of a text line is attached to that line; otherwise its URL is retained separately at the page end. Precise inline spans, internal PDF destinations and links inside table cells are not reconstructed.
- Basic numbered and bullet list markers become Markdown lists. Nested levels, wrapped list items and complex numbering are not guaranteed.
- Clearly matched small numeric superscripts and numbered notes near the bottom of the same page become Markdown footnotes with page-specific IDs. Ambiguous notes remain ordinary text. This is not general citation recognition.

## Preview and export

The preview uses React text nodes: no raw HTML or remote images. **Markdown** shows the full source. Generated links are explicit buttons styled as links, with their URL available as a title; only activating one opens the destination, with `noopener,noreferrer`. Previewing never fetches link destinations. Footnote references navigate locally.

**So sánh với PDF** lazily opens one original page beside its corresponding Markdown; previous/next controls select pages. Narrow screens stack the panes. Canvas resolution is bounded. Closing comparison destroys its loading task even before loading finishes.

**Copy Markdown** writes only after a click. If clipboard access fails, the source is selected for manual copying. Markdown download always includes the whole document. The preview supports the converter's generated subset, not arbitrary Markdown extensions. Other Markdown viewers may interpret footnotes differently.

## Privacy and memory

PDF.js extracts text and safe link annotations in a worker one page at a time. Its PDF loading task is destroyed after extraction; only plain text, geometry and safe URLs remain in worker RAM for option changes. Replacing a file or cancelling terminates that worker. Comparison uses a separate parser destroyed on close. Download object URLs are revoked on replacement/unmount.

No document content is uploaded, logged or stored persistently. This entry does not register a service worker. It loads only same-origin application assets. Clipboard, downloads and external link navigation require user action. The website needs network access to load its assets; the PDF stays on the device.

## Verification

`pnpm test:pdf-to-md`: **38 unit cases and 26 Chromium/WebKit browser cases** covering structure, margins, tables/CSV, conservative column recovery, page joining, links/lists/footnotes, safe rendering, clipboard fallback, parser cleanup, downloads, unsupported inputs and network privacy. The links fixture verifies that conversion/preview makes no external request. `pnpm lint` and `pnpm build` also pass; the build includes TypeScript checking.

`node scripts/make-md-fixture.mjs` regenerates synthetic structured, table, two-column and links/lists/footnotes PDFs. They contain no personal data.

### Public PDF corpus

Run `node scripts/download-pdf-samples.mjs`, then `pnpm test:pdf-to-md:corpus`. Downloads are development-only and go to `~/.local/share/pdf-test-corpus/tables`, with source URLs, SHA-256 hashes and rights notes in `sources.json`. Set `PDF_CORPUS_DIR` to use another folder. Public PDFs are not redistributed in this repository; their individual redistribution rights have not been verified.

Sources: [Tabula-java fixtures](https://github.com/tabulapdf/tabula-java) at pinned revision `2cdf3b4fd3f7e921dca8cc6814cdd9316be40f0f`, and the [W3C PDF table example](https://w3c.github.io/wcag/techniques/pdf/PDF6).

All **7 corpus cases passed**. The W3C example produced one correct table, including the expected Elm Street CSV row. AnimalSounds, twotables, spreadsheet_no_bounding_frame, spanning_cells, MultiColumn and 12s0324 produced no tables and retained text. These six are conservative fallback checks, not evidence of successful table extraction or complete reading-order accuracy. Improving recall requires further layout work; OCR is a separate future step.
