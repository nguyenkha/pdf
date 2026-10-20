import { describe, expect, it } from "vitest";
import {
  escapeMarkdown,
  makeMarkdown,
  pageText,
  type TextPart,
} from "../src/tools/pdf-to-md/markdown";
const part = (str: string, x: number, y: number, hasEOL = false): TextPart => ({
  str,
  transform: [1, 0, 0, 12, x, y],
  width: str.length * 6,
  height: 12,
  hasEOL,
});
describe("text-only Markdown", () => {
  it("joins fragments and respects lines without guessing headings", () => {
    expect(
      pageText([
        part("Hello", 0, 100),
        part("world", 36, 100, true),
        part("Next", 0, 80),
      ]),
    ).toBe("Hello world\nNext");
  });
  it("escapes raw HTML and Markdown syntax from PDF text", () => {
    expect(escapeMarkdown("<img src=x> [click](javascript:alert(1))")).toBe(
      "&lt;img src=x&gt; \\[click\\](javascript:alert(1))",
    );
  });
  it("escapes block syntax only where Markdown would read it", () => {
    expect(escapeMarkdown("Version 1.2 - see (a) #5 & more")).toBe("Version 1.2 - see (a) #5 & more");
    expect(escapeMarkdown("# not a heading\n- not a list\n12. not ordered\n---")).toBe(
      "\\# not a heading\n\\- not a list\n12\\. not ordered\n\\---",
    );
    expect(escapeMarkdown("&copy; *bold* a|b")).toBe("&amp;copy; \\*bold\\* a\\|b");
  });
  it("keeps pages and marks image-only pages honestly", () => {
    const markdown = makeMarkdown("document.pdf", ["Text", ""]);
    expect(markdown).toContain("# document\n\n## Trang 1\n\nText");
    expect(markdown).toContain("## Trang 2");
    expect(markdown).toContain("chưa có OCR");
  });
});
