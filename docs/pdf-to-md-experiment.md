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

Two complementary detectors run in the existing worker:

- **Ruled tables:** PDF.js operator lists provide visible, thin horizontal/vertical strokes and filled rectangle borders. Graphics transforms, rectangular clipping, line width, opacity and dashed lines are considered. Connected paths must define a closed grid with at least two rows and two columns. Text is assigned only when it fits inside a cell. Wrapped lines stay in that cell, and empty cells remain empty. Missing internal borders can produce rectangular row/column spans. Partial borders, nonrectangular merges, crossing text, tall unruled regions, complex clipping and overly complex grids are declined. The detector is bounded to avoid unbounded layout searches. No image decoding for OCR or new WASM dependency is introduced; PDF.js may decode image resources while building its operator list.
- **Unruled tables:** the previous conservative alignment detector requires at least three consistently aligned rows and two to twelve columns. Two-column tables need numeric evidence to reduce confusion with prose columns. It does not reconstruct merged cells, missing cells or wrapped cells.

Multiple independent tables on the same page get separate exports. Merged cells and multiline cells are exported as a generated HTML table embedded in Markdown, because pipe-table Markdown cannot represent them reliably. The preview parses only this narrow generated grammar and builds React elements; it never inserts raw HTML. Other Markdown viewers may disable HTML tables.

CSV cannot encode row/column spans: a merged cell's text is placed at its top-left coordinate, with covered positions left empty. Multiline values remain quoted fields containing newlines. The interface explains the merged-cell rule. Ordinary empty cells and covered cells are both empty in CSV, so CSV does not preserve merge metadata. Simple unmerged tables retain pipe-table Markdown. For those, the first nonnumeric row is treated as a header; numeric-first tables receive generated column names without dropping the first data row. Generated HTML uses neutral data cells rather than guessing complex header semantics.

Tables spanning pages, borderless complex tables, nested tables, charts and arbitrary layout recovery remain unsupported. Uncertain regions retain text. Review exports against the PDF: these are geometric heuristics, not a general table-understanding model.

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

`pnpm test:pdf-to-md`: **49 unit cases and 28 Chromium/WebKit browser cases** covering structure, margins, tables/CSV, conservative column recovery, page joining, links/lists/footnotes, safe rendering, clipboard fallback, parser cleanup, downloads, unsupported inputs and network privacy. The links fixture verifies that conversion/preview makes no external request. `pnpm lint` and `pnpm build` also pass; the build includes TypeScript checking.

`node scripts/make-md-fixture.mjs` regenerates synthetic structured, simple and ruled tables, two-column and links/lists/footnotes PDFs. They contain no personal data.

### Public PDF corpus

Run `node scripts/download-pdf-samples.mjs`, then `pnpm test:pdf-to-md:corpus`. Downloads are development-only and go to `~/.local/share/pdf-test-corpus/tables`, with source URLs, SHA-256 hashes and rights notes in `sources.json`. Set `PDF_CORPUS_DIR` to use another folder. Public PDFs are not redistributed in this repository; their individual redistribution rights have not been verified.

Sources: [Tabula-java fixtures](https://github.com/tabulapdf/tabula-java) at pinned revision `2cdf3b4fd3f7e921dca8cc6814cdd9316be40f0f`, and the [W3C PDF table example](https://w3c.github.io/wcag/techniques/pdf/PDF6).

All **7 corpus cases passed**. W3C produces one table with the expected Elm Street CSV row. **twotables** produces two Japanese financial tables: merged headers, multiline labels, empty cells and final balance rows are checked. **spanning_cells** produces two tables with merged scenario headers and checked CSV values. That is five recovered tables in three sample files, rather than the previous one file. Representative rows and spans are verified; this is not exhaustive cell-by-cell verification of every public table. AnimalSounds, spreadsheet_no_bounding_frame, MultiColumn and 12s0324 still retain text without detected tables. These four are conservative fallback checks, not successful table extraction. In particular, 12s0324 has a large sparsely ruled body that must not be collapsed into one multiline cell. OCR remains deferred.
