import { describe, expect, it } from "vitest";
import {
  convertDocument,
  defaultOptions,
  type TextPart,
  type TextPage,
} from "../src/tools/pdf-to-md/markdown";
const line = (
  str: string,
  y: number,
  size = 12,
  x = 50,
  fontFamily = "sans-serif",
): TextPart => ({
  str,
  transform: [size, 0, 0, -size, x, y],
  width: (str.length * size) / 2,
  height: size,
  hasEOL: true,
  fontFamily,
});
const page = (parts: TextPart[]): TextPage => ({
  parts,
  width: 600,
  height: 800,
});
const convert = (parts: TextPart[], options = defaultOptions) =>
  convertDocument("test.pdf", [page(parts)], options).markdown;
describe("layout-aware Markdown", () => {
  it("joins wrapped lines but preserves paragraph gaps", () => {
    const md = convert([
      line("A paragraph wraps", 100),
      line("onto the next line.", 116),
      line("Another paragraph.", 160),
    ]);
    expect(md).toContain(
      "A paragraph wraps onto the next line.\n\nAnother paragraph.",
    );
  });
  it("preserves extracted line breaks when requested", () => {
    expect(
      convert([line("Line one", 100), line("Line two", 116)], {
        ...defaultOptions,
        keepLineBreaks: true,
      }),
    ).toContain("Line one\nLine two");
  });
  it("removes only discretionary hyphens and preserves meaningful hyphens", () => {
    expect(
      convert([line("com\u00ad", 100), line("pression works.", 116)]),
    ).toContain("compression works");
    expect(
      convert([line("privacy-", 100), line("first tools.", 116)]),
    ).toContain("privacy-first tools");
  });
  it("does not add spaces between wrapped CJK text", () => {
    expect(convert([line("这是", 100), line("测试", 116)])).toContain(
      "这是测试",
    );
  });
  it("detects short large headings using the document body size", () => {
    const md = convert([
      line("Main heading", 100, 24),
      line(
        "This is normal body text long enough to establish the main font size.",
        150,
      ),
      line("Subheading", 200, 16),
    ]);
    expect(md).toContain("## Main heading");
    expect(md).toContain("### Subheading");
  });
  it("uses bold family information only when provided and allows disabling headings", () => {
    const parts = [
      line("Short heading", 100, 12, 50, "Example Bold"),
      line(
        "This normal body text establishes the font size without being a heading.",
        130,
      ),
    ];
    expect(convert(parts)).toContain("## Short heading");
    expect(
      convert(parts, { ...defaultOptions, detectHeadings: false }),
    ).not.toContain("## Short heading");
  });
  it("does not classify complete sentences or very long lines as headings", () => {
    const md = convert([
      line("A full sentence.", 100, 24),
      line(
        "Body text with enough letters to determine the document body font.",
        160,
      ),
    ]);
    expect(md).not.toContain("### A full");
  });
  it("does not merge indented lists or column jumps", () => {
    const md = convert([
      line("Body line", 100),
      line("1. A list item", 116),
      line("Another column", 120, 12, 350),
    ]);
    expect(md).toContain("Body line\n\n1. A list item\n\nAnother column");
  });
  it("removes repeated small margin text and variable page numbers, never repeated body text", () => {
    const pages = Array.from({ length: 4 }, (_, i) =>
      page([
        line("REPORT", 30, 9),
        line("Repeated body text is still meaningful.", 150),
        line(`Page ${i + 1} of 4`, 780, 9),
      ]),
    );
    const result = convertDocument("test.pdf", pages, defaultOptions);
    expect(result.removedLines).toBe(8);
    expect(result.markdown).not.toContain("REPORT");
    expect(result.markdown.match(/Repeated body/g)).toHaveLength(4);
    const kept = convertDocument("test.pdf", pages, {
      ...defaultOptions,
      removeMargins: false,
    });
    expect(kept.removedLines).toBe(0);
    expect(kept.markdown).toContain("REPORT");
  });
  it("requires at least 3 pages and consistent margin positions", () => {
    const p = page([
      line("REPORT", 30, 9),
      line("Body content remains.", 150),
      line("Footer", 780, 9),
    ]);
    expect(
      convertDocument("test.pdf", [p, p], defaultOptions).removedLines,
    ).toBe(0);
    const pages = [
      p,
      p,
      page([
        line("REPORT", 58, 9),
        line("Body content remains.", 150),
        line("Footer", 750, 9),
      ]),
    ];
    expect(
      convertDocument("test.pdf", pages, defaultOptions).removedLines,
    ).toBe(0);
  });
  it("does not normalize meaningful varying identifiers into running headers", () => {
    const pages = Array.from({ length: 4 }, (_, i) =>
      page([
        line(`Invoice ${100 + i}`, 30, 9),
        line("Body content remains.", 150),
        line("Other content.", 200),
      ]),
    );
    expect(
      convertDocument("test.pdf", pages, defaultOptions).removedLines,
    ).toBe(0);
  });
});
