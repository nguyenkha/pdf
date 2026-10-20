import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { safeUrl } from "../src/tools/pdf-to-md/structure";
import { InlineMarkdown } from "../src/tools/pdf-to-md/InlineMarkdown";
import { MarkdownPreview } from "../src/tools/pdf-to-md/MarkdownPreview";
import {
  convertDocument,
  defaultOptions,
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
  expect(result.markdown).toContain("[^p1-1]: Note body text\\.");
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
