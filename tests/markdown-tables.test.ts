import { expect, it } from "vitest";
import {
  detectTables,
  tableMarkdown,
  tableCsv,
  splitTableRow,
} from "../src/tools/pdf-to-md/tables";
import {
  convertDocument,
  defaultOptions,
  type TextPart,
} from "../src/tools/pdf-to-md/markdown";
const text = (str: string, x: number, y: number): TextPart => ({
  str,
  transform: [12, 0, 0, -12, x, y],
  width: str.length * 6,
  height: 12,
  hasEOL: true,
});
const rows = (values: string[][]) =>
  values.flatMap((row, r) =>
    row.map((str, c) => text(str, 50 + c * 150, 100 + r * 22)),
  );
const data = [
  ["Product", "Count", "Price"],
  ["Apple", "12", "$24"],
  ["Pear", "8", "$16"],
  ["Plum", "5", "$10"],
];
it("recognizes aligned rectangular data and preserves cells", () => {
  const found = detectTables(rows(data));
  expect(found).toHaveLength(1);
  expect(found[0].rows).toEqual(data);
});
it("supports right aligned numeric cells", () => {
  const parts = rows(data);
  for (const part of parts)
    if (/^\d+$/.test(part.str)) part.transform[4] = 230 - part.width;
  expect(detectTables(parts)).toHaveLength(1);
});
it("declines missing or merged cells and keeps their original text", () => {
  const values = [data[0], data[1], ["Merged cell", "20"], data[3]];
  const parts = rows(values);
  expect(detectTables(parts)).toHaveLength(0);
  const result = convertDocument(
    "test.pdf",
    [{ parts, width: 600, height: 800 }],
    defaultOptions,
  );
  expect(result.markdown).toContain("Merged cell");
  expect(result.tables).toHaveLength(0);
});
it("declines two columns of prose and short ambiguous blocks", () => {
  expect(
    detectTables(
      rows([
        ["Some prose here.", "Another prose line."],
        ["Some more text.", "This is prose too."],
        ["Final sentence.", "More reading here."],
      ]),
    ),
  ).toHaveLength(0);
  expect(detectTables(rows(data.slice(0, 2)))).toHaveLength(0);
});
it("declines shifted columns and overlapping cells", () => {
  const parts = rows(data);
  parts[7].transform[4] += 40;
  expect(detectTables(parts)).toHaveLength(0);
});
it("escapes Markdown pipes and round trips delimiter parsing", () => {
  const md = tableMarkdown([
    ["Name", "Count"],
    ["A|B", "2"],
    ["C\\D", "3"],
  ]);
  expect(splitTableRow(md.split("\n")[2])).toEqual(["A\\|B", "2"]);
  expect(md).toContain("| --- | --- |");
});
it("does not drop the first numeric data row when there is no header", () => {
  const md = tableMarkdown([
    ["2024", "12"],
    ["2025", "20"],
    ["2026", "22"],
  ]);
  expect(md).toContain("Cột 1");
  expect(md).toContain("| 2024 | 12 |");
});
it("quotes CSV values and blocks spreadsheet formula injection", () => {
  const csv = tableCsv([
    ["A,B", 'say "hi"'],
    ['=HYPERLINK("x")', "-12"],
    ["\t+1+2", "@SUM(1)"],
  ]);
  expect(csv).toContain('"A,B","say ""hi"""');
  expect(csv).toContain("\"'=HYPERLINK");
  expect(csv).toContain('"-12"');
  expect(csv).toContain('"\'\t+1+2"');
  expect(csv).toContain("\"'@SUM");
});
it("allows opting out of table formatting without dropping values", () => {
  const result = convertDocument(
    "table.pdf",
    [{ parts: rows(data), width: 600, height: 800 }],
    { ...defaultOptions, detectTables: false },
  );
  expect(result.tables).toHaveLength(0);
  expect(result.markdown).toContain("Apple");
  expect(result.markdown).not.toContain("| --- |");
});
