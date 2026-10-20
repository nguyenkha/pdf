import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { safeUrl } from "../src/tools/pdf-to-md/structure";
import { InlineMarkdown } from "../src/tools/pdf-to-md/InlineMarkdown";
import { MarkdownPreview } from "../src/tools/pdf-to-md/MarkdownPreview";
import { findImages } from "../src/tools/pdf-to-md/images";
import { partsFromParagraphs } from "../src/tools/pdf-to-md/ocr";
import { scanRulings } from "../src/tools/pdf-to-md/scan-rulings";
import type { Paragraph } from "tesseract.js";
import {
  convertDocument,
  defaultOptions,
  documentTitle,
  type TextPart,
} from "../src/tools/pdf-to-md/markdown";
const part = (str: string, x: number, y: number, size = 12): TextPart => ({
  str,
  transform: [size, 0, 0, -size, x, y],
  width: str.length * 5,
  height: size,
  hasEOL: true,
});
it("allows only safe external URL protocols without embedded credentials or controls", () => {
  expect(safeUrl("https://example.com/a")).toBe("https://example.com/a");
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "https://u:p@example.com",
    "https://example.com/\n",
  ])
    expect(safeUrl(url)).toBeUndefined();
});
it("preserves external PDF annotations as Markdown and inert-until-click preview links", () => {
  const page = {
    width: 600,
    height: 800,
    parts: [part("Reference site", 50, 100)],
    links: [{ url: "https://example.com/", rect: [48, 85, 160, 103] }],
  };
  const result = convertDocument("test.pdf", [page], defaultOptions);
  expect(result.markdown).toContain("[Reference site](<https://example.com/>)");
  expect(result.linkCount).toBe(1);
  const html = renderToStaticMarkup(
    createElement(InlineMarkdown, {
      text: "[Reference](<https://example.com/>)",
    }),
  );
  expect(html).toContain('role="link"');
  expect(html).not.toContain('href="https:');
});
it("keeps safe unmatched annotations without guessing a text range", () => {
  const result = convertDocument(
    "test.pdf",
    [
      {
        width: 600,
        height: 800,
        parts: [part("Body text.", 50, 150)],
        links: [
          { url: "mailto:hello@example.com", rect: [300, 300, 320, 320] },
        ],
      },
    ],
    defaultOptions,
  );
  expect(result.markdown).toContain("mailto:hello@example.com");
});
it("preserves ordered and unordered list structure and supports opting out", () => {
  const page = {
    width: 600,
    height: 800,
    parts: [
      part("1. First item", 50, 100),
      part("2. Second item", 50, 120),
      part("- Bullet item", 50, 160),
    ],
  };
  const result = convertDocument("test.pdf", [page], defaultOptions);
  expect(result.markdown).toContain("1. First item\n2. Second item");
  expect(result.listCount).toBe(3);
  const html = renderToStaticMarkup(
    createElement(MarkdownPreview, { markdown: result.markdown }),
  );
  expect(html).toContain("<ol");
  expect(html).toContain("<ul");
  expect(
    convertDocument("test.pdf", [page], {
      ...defaultOptions,
      preserveLists: false,
    }).markdown,
  ).toContain("1\\. First item");
});
it("matches only clearly superscripted references to numbered small footnotes", () => {
  const body = part("This claim has a note", 50, 200);
  const marker = part("1", 155, 195, 8);
  const note = part("1 Note body text.", 50, 750, 9);
  const result = convertDocument(
    "test.pdf",
    [{ width: 600, height: 800, parts: [body, marker, note] }],
    defaultOptions,
  );
  expect(result.noteCount).toBe(1);
  expect(result.markdown).toContain("[^p1-1]");
  expect(result.markdown).toContain("[^p1-1]: Note body text.");
  expect(
    convertDocument(
      "test.pdf",
      [{ width: 600, height: 800, parts: [body, note] }],
      defaultOptions,
    ).noteCount,
  ).toBe(0);
});
it("does not interpret escaped PDF links, HTML or unsafe URLs as active markup", () => {
  const html = renderToStaticMarkup(
    createElement(InlineMarkdown, {
      text: "\\[fake\\](javascript:alert(1)) &lt;img src=x&gt; [bad](<javascript:alert(1)>)",
    }),
  );
  expect(html).not.toContain("<button");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
});
it("titles the Markdown from metadata, never from app placeholders", () => {
  expect(documentTitle("Annual report 2025")).toBe("Annual report 2025");
  expect(documentTitle("Microsoft Word - plan.docx")).toBe("plan");
  expect(documentTitle("Untitled")).toBe("");
  expect(documentTitle("  ")).toBe("");
  expect(documentTitle(undefined)).toBe("");
});
it("places images in reading order and leaves repeated logos to the margin option", () => {
  const page = {
    parts: [part("Above the figure.", 50, 100), part("Below the figure.", 50, 400)],
    width: 600,
    height: 800,
    images: [
      { path: "images/page-1-1.jpg", x: 50, y: 150, width: 300, height: 200 },
      { path: "images/page-1-2.png", x: 500, y: 10, width: 40, height: 40, repeated: true },
    ],
  };
  const result = convertDocument("", [page], defaultOptions);
  expect(result.markdown).toBe(
    "Above the figure.\n\n![Ảnh 1, trang 1](images/page-1-1.jpg)\n\nBelow the figure.\n",
  );
  expect(result.imagePaths).toEqual(["images/page-1-1.jpg"]);
  const all = convertDocument("", [page], { ...defaultOptions, removeMargins: false });
  expect(all.imagePaths).toEqual(["images/page-1-2.png", "images/page-1-1.jpg"]);
  expect(convertDocument("", [page], { ...defaultOptions, preserveImages: false }).imagePaths).toEqual([]);
});
it("finds painted images with their page box and skips icons", () => {
  const ops = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintFormXObjectBegin: 5, paintFormXObjectEnd: 6 };
  const list = {
    fnArray: [1, 3, 4, 2, 1, 3, 4, 2],
    argsArray: [[], [300, 0, 0, 200, 50, 150], ["img_1", 900, 600], [], [], [10, 0, 0, 10, 0, 0], ["icon", 16, 16], []],
  };
  expect(findImages(list, [1, 0, 0, 1, 0, 0], ops)).toEqual([
    { id: "img_1", x: 50, y: 150, width: 300, height: 200, pixels: 900, matrix: [300, 0, 0, 200, 50, 150] },
  ]);
});
it("never turns PDF text into HTML, images, comments or script links", () => {
  const hostile = [
    '<img src=x onerror="alert(1)">',
    "<!-- Trang 9 -->",
    "![leak](images/page-1-1.jpg)",
    "![leak](https://evil.invalid/x.png)",
    "[click](<javascript:alert(1)>)",
    '<table data-pdf-table="true">',
    "&lt;script&gt;alert(1)&lt;/script&gt;",
  ];
  const result = convertDocument("<b>title</b>", [
    {
      parts: hostile.map((value, index) => part(value, 50, 100 + index * 40)),
      width: 600,
      height: 800,
      links: [{ url: "javascript:alert(1)", rect: [0, 0, 600, 800] }],
    },
  ], defaultOptions);
  const html = renderToStaticMarkup(createElement(MarkdownPreview, { markdown: result.markdown }));
  expect(html).not.toMatch(/<(img|script|b|table)\b/);
  // Everything above shows as text: no element gets an attribute from the PDF.
  expect(html).not.toMatch(/<[^>]*\son\w+=/);
  expect(html).not.toMatch(/(href|src)="(?!#fn-)/);
  expect(html).not.toContain("md-page-mark");
  expect(html).not.toContain("md-inline-link");
  expect(result.markdown).not.toContain("<img");
  expect(result.markdown).not.toContain("<!--");
  expect(result.markdown).not.toMatch(/(^|[^\\])!\[/);
});
it("turns OCR lines into level text parts, split at table-like gaps", () => {
  const word = (text: string, x0: number, x1: number, y: number, confidence = 90) => ({
    text,
    confidence,
    bbox: { x0, y0: y - 26, x1, y1: y + 4 },
  });
  // A scan turned slightly: the baseline drops 10 px over 1000 px.
  const tilt = (x: number, y: number) => y + x / 100;
  const line = (words: ReturnType<typeof word>[], y: number, confidence = 90) =>
    ({
      words: words.map((w) => ({ ...w, bbox: { ...w.bbox, y0: tilt(w.bbox.x0, w.bbox.y0), y1: tilt(w.bbox.x0, w.bbox.y1) } })),
      confidence,
      rowAttributes: { rowHeight: 30 },
      baseline: { x0: 0, y0: tilt(0, y), x1: 1000, y1: tilt(1000, y) },
      bbox: { x0: 0, y0: y - 26, x1: 1000, y1: y + 4 },
    });
  const paragraph = { lines: [
    line([word("Name", 100, 180, 126), word("of", 190, 220, 126), word("Count", 800, 900, 126)], 126),
    line([word("Total", 100, 180, 200, 20), word("42", 800, 840, 200)], 200),
    line([word("~", 100, 120, 260, 10)], 260, 30),
    line([word("漢", 100, 130, 300), word("字", 135, 165, 300)], 300),
  ] } as unknown as Paragraph;
  const parts = partsFromParagraphs([paragraph], { scale: 2 });
  const row = (str: string) => parts.find((p) => p.str === str)!;
  // Cells of one row share a baseline once the tilt is taken out.
  expect(row("Count").transform[5]).toBeCloseTo(row("Name of").transform[5], 0);
  expect(row("42").transform[5]).toBeCloseTo(row("Total").transform[5], 0);
  expect(parts.map((p) => [p.str, p.hasEOL])).toEqual([
    ["Name of", false],
    ["Count", true],
    // A low-confidence word in a clear line stays; a doubtful line goes.
    ["Total", false],
    ["42", true],
    ["漢字", true],
  ]);
  expect(parts[0].height).toBeCloseTo(15);
});
it("finds the drawn rules of a scanned table, not letters or filled shapes", () => {
  const width = 400,
    height = 300;
  const gray = new Uint8Array(width * height).fill(240);
  const ink = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) gray[y * width + x] = 30;
  };
  // A 2 x 2 ruled table, two pixels thick, with a scanner gap in one rule.
  for (const y of [20, 80, 140]) ink(20, y, 300, y + 1);
  for (let x = 150; x < 153; x++) gray[80 * width + x] = gray[81 * width + x] = 240;
  for (const x of [20, 160, 300]) ink(x, 20, x + 1, 141);
  // A letter stroke and a filled box.
  ink(330, 20, 332, 40);
  ink(20, 200, 300, 260);
  const rules = scanRulings(gray, width, height, { horizontal: 60, vertical: 30 });
  // Within a pixel: a rule is followed across two rows (or columns) of pixels.
  const near = (values: number[][]) => values.map((row) => row.map(Math.round));
  expect(near(rules.filter((r) => r.y1 === r.y2).map((r) => [r.y1, r.x1, r.x2]))).toEqual([
    [20, 20, 301],
    [80, 20, 301],
    [140, 20, 301],
  ]);
  expect(near(rules.filter((r) => r.x1 === r.x2).map((r) => [r.x1, r.y1, r.y2]))).toEqual([
    [20, 20, 141],
    [160, 20, 141],
    [300, 20, 141],
  ]);
});
it("keeps one rule whole when the scan shifts part of it by a row", () => {
  const width = 400,
    height = 60;
  const gray = new Uint8Array(width * height).fill(235);
  const ink = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) gray[y * width + x] = 60;
  };
  // Left half on rows 20-21, right half a row lower, as a slightly tilted scan gives.
  ink(10, 20, 200, 21);
  ink(195, 22, 390, 23);
  const rules = scanRulings(gray, width, height, { horizontal: 60, vertical: 30 }, 20);
  expect(rules).toHaveLength(1);
  expect(rules[0].x1).toBe(10);
  expect(rules[0].x2).toBe(390);
  expect(rules[0].y1).toBeGreaterThan(20);
  expect(rules[0].y1).toBeLessThan(23);
});
