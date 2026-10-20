import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { detectGridTables } from "../src/tools/pdf-to-md/grid";
import { extractRulings, type Ruling } from "../src/tools/pdf-to-md/rulings";
import { tableHtml, parseTableHtml } from "../src/tools/pdf-to-md/table-html";
import { MarkdownPreview } from "../src/tools/pdf-to-md/MarkdownPreview";
import {
  convertDocument,
  defaultOptions,
  type TextPart,
} from "../src/tools/pdf-to-md/markdown";
const part = (str: string, x: number, y: number): TextPart => ({
  str,
  transform: [10, 0, 0, -10, x, y],
  width: str.length * 5,
  height: 10,
  hasEOL: true,
});
const grid = (offset = 0): Ruling[] => [
  ...[50, 100, 150, 200].map((x) => ({
    x1: x + offset,
    x2: x + offset,
    y1: 50,
    y2: 140,
  })),
  ...[50, 80, 110, 140].map((y) => ({
    x1: 50 + offset,
    x2: 200 + offset,
    y1: y,
    y2: y,
  })),
];
const parts = [
  part("Header", 55, 70),
  part("B", 105, 70),
  part("C", 155, 70),
  part("line 1", 55, 94),
  part("line 2", 55, 106),
  part("42", 155, 99),
  part("last", 55, 129),
  part("8", 105, 129),
  part("16", 155, 129),
];
it("preserves wrapped cell text and an explicit empty cell", () => {
  const [table] = detectGridTables(parts, grid());
  expect(table.rows).toEqual([
    ["Header", "B", "C"],
    ["line 1\nline 2", "", "42"],
    ["last", "8", "16"],
  ]);
  expect(table.parts.size).toBe(parts.length);
});
it("exports merged cells as safe HTML and leaves covered CSV slots empty", () => {
  const lines = grid().filter((l) => l.x1 !== 100 || l.x2 !== 100);
  lines.push({ x1: 100, x2: 100, y1: 80, y2: 140 });
  const source = parts.filter((p) => p.str !== "B");
  const result = convertDocument(
    "test.pdf",
    [{ parts: source, rulings: lines, width: 600, height: 800 }],
    defaultOptions,
  );
  expect(result.tables[0].merged).toBe(true);
  expect(result.tables[0].cells[0]).toEqual(["Header", "", "C"]);
  expect(result.markdown).toContain('colspan="2"');
  expect(result.tables[0].csv).toContain('"Header","","C"');
  const html = renderToStaticMarkup(
    createElement(MarkdownPreview, { markdown: result.markdown }),
  );
  expect(html).toContain('colSpan="2"');
  expect(html).toContain("line 1\nline 2");
});
it("recovers vertical merged cells without duplicating text", () => {
  const lines = grid().filter((l) => l.y1 !== 110 || l.y2 !== 110);
  lines.push({ x1: 100, x2: 200, y1: 110, y2: 110 });
  const [table] = detectGridTables(
    parts.filter((p) => p.str !== "last"),
    lines,
  );
  expect(table.spans.find((c) => c.row === 1 && c.col === 0)?.rowSpan).toBe(2);
  expect(table.rows[2][0]).toBe("");
});
it("separates adjacent table regions sharing text baselines and retains nearby prose", () => {
  const second = parts.map((p) => ({
    ...p,
    transform: [
      ...p.transform.slice(0, 4),
      p.transform[4] + 250,
      p.transform[5],
    ],
  }));
  const source = [...parts, ...second, part("Nearby prose", 500, 70)];
  const result = convertDocument(
    "test.pdf",
    [
      {
        parts: source,
        rulings: [...grid(), ...grid(250)],
        width: 700,
        height: 800,
      },
    ],
    defaultOptions,
  );
  expect(result.tables).toHaveLength(2);
  expect(result.markdown).toContain("Nearby prose");
});
it("declines partial borders, crossing text and nonrectangular merged cells", () => {
  const partial = grid().filter((l) => l.x1 !== 100 || l.x2 !== 100);
  partial.push({ x1: 100, x2: 100, y1: 50, y2: 92 });
  expect(detectGridTables(parts, partial)).toHaveLength(0);
  expect(
    detectGridTables(
      [...parts, part("This crosses a border", 75, 125)],
      grid(),
    ),
  ).toHaveLength(0);
  const lshape = grid().filter(
    (l) => !(l.y1 === 80 && l.y2 === 80) && !(l.x1 === 100 && l.x2 === 100),
  );
  lshape.push(
    { x1: 100, x2: 100, y1: 80, y2: 140 },
    { x1: 100, x2: 200, y1: 80, y2: 80 },
  );
  expect(detectGridTables(parts, lshape)).toHaveLength(0);
});
it("declines large unruled bodies rather than collapsing data rows into one cell", () => {
  const lines = [
    ...[50, 200, 350].map((x) => ({ x1: x, x2: x, y1: 50, y2: 400 })),
    ...[50, 100, 400].map((y) => ({ x1: 50, x2: 350, y1: y, y2: y })),
  ];
  const source = [
    part("A", 55, 75),
    part("B", 205, 75),
    ...Array.from({ length: 10 }, (_, i) => part("item", 55, 125 + i * 20)),
  ];
  expect(detectGridTables(source, lines)).toHaveLength(0);
});
it("never inserts arbitrary HTML or attributes from PDF table text", () => {
  const value = tableHtml([
    ['<img src="https://invalid/">', "&lt;script&gt;"],
    ["A\nB", "x"],
  ]);
  const parsed = parseTableHtml(value);
  expect(parsed?.[0][0].text).toBe('<img src="https://invalid/">');
  const html = renderToStaticMarkup(
    createElement(MarkdownPreview, { markdown: value }),
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<script");
  expect(html).toContain("&lt;img");
  expect(
    parseTableHtml(value.replace('rowspan="1"', 'onclick="alert(1)"')),
  ).toBeUndefined();
});
const ops = {
  save: 1,
  restore: 2,
  transform: 3,
  setLineWidth: 4,
  constructPath: 5,
  rectangle: 6,
  moveTo: 7,
  lineTo: 8,
  closePath: 9,
  stroke: 10,
  fill: 11,
  endPath: 12,
  clip: 13,
  eoClip: 14,
  setDash: 15,
  setGState: 16,
};
it("extracts transformed stroked paths, thin fills and ignores unpainted clipping paths", () => {
  const list = {
    fnArray: [
      ops.transform,
      ops.constructPath,
      ops.stroke,
      ops.constructPath,
      ops.fill,
      ops.constructPath,
      ops.endPath,
    ],
    argsArray: [
      [2, 0, 0, 2, 10, 20],
      [
        [ops.moveTo, ops.lineTo],
        [0, 0, 20, 0],
      ],
      [],
      [[ops.rectangle], [0, 10, 20, 0.5]],
      [],
      [[ops.rectangle], [0, 0, 20, 20]],
      [],
    ],
  };
  const found = extractRulings(list, [1, 0, 0, 1, 0, 0], ops);
  expect(found).toHaveLength(2);
  expect(found[0]).toEqual({ x1: 10, y1: 20, x2: 50, y2: 20 });
  expect(found[1].y1).toBe(40.5);
});
it("ignores invisible, dashed and diagonally rotated paths", () => {
  const path = [
    [ops.moveTo, ops.lineTo],
    [0, 0, 20, 0],
  ];
  expect(
    extractRulings(
      {
        fnArray: [ops.setDash, ops.constructPath, ops.stroke],
        argsArray: [[[2, 2], 0], path, []],
      },
      [1, 0, 0, 1, 0, 0],
      ops,
    ),
  ).toHaveLength(0);
  expect(
    extractRulings(
      {
        fnArray: [ops.setGState, ops.constructPath, ops.stroke],
        argsArray: [[[["CA", 0]]], path, []],
      },
      [1, 0, 0, 1, 0, 0],
      ops,
    ),
  ).toHaveLength(0);
  expect(
    extractRulings(
      { fnArray: [ops.constructPath, ops.stroke], argsArray: [path, []] },
      [1, 1, -1, 1, 0, 0],
      ops,
    ),
  ).toHaveLength(0);
});

it("clips to a painted rectangular viewport and rejects complex clipping", () => {
  const rectangle = [[ops.rectangle], [0, 0, 20, 20]];
  const line = [
    [ops.moveTo, ops.lineTo],
    [-10, 10, 30, 10],
  ];
  const found = extractRulings(
    {
      fnArray: [
        ops.constructPath,
        ops.clip,
        ops.endPath,
        ops.constructPath,
        ops.stroke,
      ],
      argsArray: [rectangle, [], [], line, []],
    },
    [1, 0, 0, 1, 0, 0],
    ops,
  );
  expect(found).toEqual([{ x1: 0, y1: 10, x2: 20, y2: 10 }]);
  const triangle = [
    [ops.moveTo, ops.lineTo, ops.lineTo, ops.closePath],
    [0, 0, 20, 0, 10, 20],
  ];
  expect(
    extractRulings(
      {
        fnArray: [
          ops.constructPath,
          ops.clip,
          ops.endPath,
          ops.constructPath,
          ops.stroke,
        ],
        argsArray: [triangle, [], [], line, []],
      },
      [1, 0, 0, 1, 0, 0],
      ops,
    ),
  ).toHaveLength(0);
});
it("does not treat diagonally rotated filled rectangles as vertical borders", () => {
  expect(
    extractRulings(
      {
        fnArray: [ops.constructPath, ops.fill],
        argsArray: [[[ops.rectangle], [0, 0, 20, 20]], []],
      },
      [1, 1, -1, 1, 0, 0],
      ops,
    ),
  ).toHaveLength(0);
});
