import { expect, it } from "vitest";
import { restoreReadingOrder } from "../src/tools/pdf-to-md/columns";
import {
  convertDocument,
  defaultOptions,
  type TextPart,
} from "../src/tools/pdf-to-md/markdown";
const text = (str: string, x: number, y: number): TextPart => ({
  str,
  transform: [12, 0, 0, -12, x, y],
  width: str.length * 5,
  height: 12,
  hasEOL: true,
});
const parts = Array.from({ length: 4 }, (_, i) => [
  text(`Left column sentence ${i + 1}.`, 50, 150 + i * 18),
  text(`Right column sentence ${i + 1}.`, 340, 150 + i * 18),
]).flat();
it("reads each clear column top to bottom", () => {
  const result = restoreReadingOrder(parts, 600, 800);
  expect(result.reordered).toBe(true);
  expect(result.parts[3].str).toBe("Left column sentence 4.");
  expect(result.parts[4].str).toBe("Right column sentence 1.");
});
it("keeps spanning headings before both columns", () => {
  const heading = {
    ...text("A full width heading over both columns", 50, 100),
    width: 480,
  };
  expect(restoreReadingOrder([heading, ...parts], 600, 800).parts[0]).toBe(
    heading,
  );
});
it("does not reorder single-column or RTL text", () => {
  const single = parts.filter((p) => p.transform[4] < 100);
  expect(restoreReadingOrder(single, 600, 800).reordered).toBe(false);
  expect(
    restoreReadingOrder(
      parts.map((p) => ({ ...p, dir: "rtl" })),
      600,
      800,
    ).reordered,
  ).toBe(false);
});
it("does not mistake non-overlapping indented paragraphs for columns", () => {
  const separated = parts.map((p) =>
    p.transform[4] > 300
      ? { ...p, transform: [12, 0, 0, -12, 340, p.transform[5] + 250] }
      : p,
  );
  expect(restoreReadingOrder(separated, 600, 800).reordered).toBe(false);
});
it("makes page markers optional without dropping page text", () => {
  const pages = [
    { parts: [text("First page content.", 50, 150)], width: 600, height: 800 },
    { parts: [text("Second page content.", 50, 150)], width: 600, height: 800 },
  ];
  const result = convertDocument("test.pdf", pages, {
    ...defaultOptions,
    joinPages: true,
  });
  expect(result.markdown).not.toContain("<!--");
  expect(result.markdown).not.toContain("---");
  expect(result.markdown).toContain("First page content");
  expect(result.markdown).toContain("Second page content");
  const marked = convertDocument("", pages, defaultOptions).markdown;
  expect(marked).toBe(
    "<!-- Trang 1 -->\n\nFirst page content.\n\n---\n\n<!-- Trang 2 -->\n\nSecond page content.\n",
  );
  // A single page needs no marker at all.
  expect(convertDocument("", pages.slice(0, 1), defaultOptions).markdown).toBe("First page content.\n");
});
it("ignores PDF spacing items that bridge the gutter", () => {
  const spaced = parts.flatMap((p) =>
    p.transform[4] < 100
      ? [p, { ...text(" ", 200, p.transform[5]), width: 140 }]
      : [p],
  );
  const result = restoreReadingOrder(spaced, 600, 800);
  expect(
    result.parts.map((p) => p.str).indexOf("Left column sentence 4."),
  ).toBeLessThan(
    result.parts.map((p) => p.str).indexOf("Right column sentence 1."),
  );
});
it("declines three-column pages rather than partially reordering them", () => {
  const three = Array.from({ length: 4 }, (_, i) =>
    [50, 230, 410].map((x, col) => ({
      ...text(`Column ${col + 1} sentence ${i + 1}.`, x, 150 + i * 18),
      width: 120,
    })),
  ).flat();
  expect(restoreReadingOrder(three, 600, 800).reordered).toBe(false);
});
