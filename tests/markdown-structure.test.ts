import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { safeUrl } from "../src/tools/pdf-to-md/structure";
import { InlineMarkdown } from "../src/tools/pdf-to-md/InlineMarkdown";
import { MarkdownPreview } from "../src/tools/pdf-to-md/MarkdownPreview";
import { findImages } from "../src/tools/pdf-to-md/images";
import { partsFromLines } from "../src/tools/pdf-to-md/ocr";
import type { Line } from "tesseract.js";
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
    { id: "img_1", x: 50, y: 150, width: 300, height: 200, pixels: 900 },
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
it("turns OCR lines into text parts, split at table-like gaps", () => {
  const word = (text: string, x0: number, x1: number, confidence = 90) => ({
    text,
    confidence,
    bbox: { x0, y0: 100, x1, y1: 130 },
  });
  const line = (words: ReturnType<typeof word>[]) =>
    ({ words, rowAttributes: { rowHeight: 30 }, baseline: { y0: 126, y1: 126 }, bbox: { x0: 0, y0: 100, x1: 900, y1: 130 } }) as unknown as Line;
  const parts = partsFromLines(
    [line([word("Name", 100, 180), word("of", 190, 220), word("noise", 230, 300, 10), word("Count", 600, 700)]), line([word("漢", 100, 130), word("字", 135, 165)])],
    2,
  );
  expect(parts.map((p) => [p.str, p.transform[4], p.transform[5], p.hasEOL])).toEqual([
    ["Name of", 50, 63, false],
    ["Count", 300, 63, true],
    ["漢字", 50, 63, true],
  ]);
  expect(parts[0].height).toBeCloseTo(15);
});
