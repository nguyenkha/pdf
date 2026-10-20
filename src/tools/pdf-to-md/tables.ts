import { detectGridTables, type SpannedCell } from "./grid";
import type { Ruling } from "./rulings";
import { tableHtml } from "./table-html";
import { escapeMarkdown, pageText, type TextPart } from "./text";
export type ConvertedTable = {
  page: number;
  cells: string[][];
  csv: string;
  merged?: boolean;
};
type Cell = { text: string; left: number; right: number; parts: TextPart[] };
type Row = { y: number; size: number; cells: Cell[]; parts: TextPart[] };
export type TableRegion = {
  rows: string[][];
  parts: Set<TextPart>;
  spans?: SpannedCell[];
};
const sizeOf = (part: TextPart) =>
  Math.hypot(part.transform[2], part.transform[3]) || part.height || 12;
const numberLike = (text: string) =>
  /\p{N}/u.test(text) && /^[\p{N}\s.,()%+\-−$€£¥₫:/]+$/u.test(text);

function visualRows(parts: TextPart[]): Row[] {
  const rows: Row[] = [];
  for (const part of [...parts]
    .filter((p) => p.str.trim())
    .sort(
      (a, b) =>
        a.transform[5] - b.transform[5] || a.transform[4] - b.transform[4],
    )) {
    let row = rows.at(-1);
    if (
      !row ||
      Math.abs(row.y - part.transform[5]) > Math.max(2, sizeOf(part) * 0.3)
    ) {
      row = { y: part.transform[5], size: sizeOf(part), cells: [], parts: [] };
      rows.push(row);
    }
    row.parts.push(part);
  }
  for (const row of rows) {
    row.parts.sort((a, b) => a.transform[4] - b.transform[4]);
    let group: TextPart[] = [];
    const flush = () => {
      if (group.length)
        row.cells.push({
          text: pageText(group.map((part) => ({ ...part, hasEOL: false }))),
          left: group[0].transform[4],
          right: Math.max(
            ...group.map((part) => part.transform[4] + part.width),
          ),
          parts: group,
        });
      group = [];
    };
    for (const part of row.parts) {
      const previous = group.at(-1);
      if (
        previous &&
        part.transform[4] - previous.transform[4] - previous.width >
          Math.max(7, row.size * 1.15)
      )
        flush();
      group.push(part);
    }
    flush();
  }
  return rows;
}

function confident(rows: Row[]): boolean {
  if (rows.length < 3) return false;
  const count = rows[0].cells.length;
  if (count < 2 || count > 12 || rows.some((row) => row.cells.length !== count))
    return false;
  if (
    rows.some((row) =>
      row.cells.some(
        (cell) =>
          cell.text.length > 65 ||
          cell.text.split(/\s+/).length > 8 ||
          /[!?;]$/.test(cell.text),
      ),
    )
  )
    return false;
  const data = rows.slice(1);
  const numericColumn = Array.from(
    { length: count },
    (_, col) => data.filter((row) => numberLike(row.cells[col].text)).length,
  ).some((n) => n >= 2 && n >= data.length * 0.7);
  if (
    !numericColumn &&
    (count < 3 ||
      rows.length < 4 ||
      rows.some((row) =>
        row.cells.some(
          (cell) => cell.text.split(/\s+/).length > 4 || /\.$/.test(cell.text),
        ),
      ))
  )
    return false;
  for (let col = 0; col < count; col++) {
    const cells = data.map((row) => row.cells[col]);
    const tolerance = Math.max(4, rows[0].size * 0.65);
    const aligned = (values: number[]) =>
      Math.max(...values) - Math.min(...values) <= tolerance;
    if (
      !aligned(cells.map((c) => c.left)) &&
      !aligned(cells.map((c) => c.right)) &&
      !aligned(cells.map((c) => (c.left + c.right) / 2))
    )
      return false;
    if (col + 1 < count) {
      const gap =
        Math.min(...rows.map((r) => r.cells[col + 1].left)) -
        Math.max(...rows.map((r) => r.cells[col].right));
      if (gap < Math.max(5, rows[0].size * 0.6)) return false;
    }
  }
  return true;
}

export function detectTables(
  parts: TextPart[],
  rulings: Ruling[] = [],
): TableRegion[] {
  const tables: TableRegion[] = detectGridTables(parts, rulings);
  const claimed = new Set(tables.flatMap((table) => [...table.parts]));
  const rows = visualRows(parts.filter((part) => !claimed.has(part)));
  for (let i = 0; i < rows.length; ) {
    const first = rows[i];
    if (first.cells.length < 2) {
      i++;
      continue;
    }
    let end = i + 1;
    while (
      end < rows.length &&
      rows[end].cells.length >= 2 &&
      rows[end].y - rows[end - 1].y <=
        Math.max(first.size, rows[end].size) * 2.8 &&
      Math.abs(rows[end].size - first.size) <= first.size * 0.3
    )
      end++;
    const run = rows.slice(i, end);
    const wrapped = (neighbor: Row | undefined, boundary: Row) =>
      neighbor &&
      neighbor.cells.length === 1 &&
      Math.abs(neighbor.y - boundary.y) <= boundary.size * 1.5 &&
      neighbor.cells[0].left >= first.cells[0].left - 4 &&
      neighbor.cells[0].left <= first.cells.at(-1)!.right;
    if (
      confident(run) &&
      !wrapped(rows[i - 1], first) &&
      !wrapped(rows[end], run.at(-1)!)
    )
      tables.push({
        rows: run.map((row) => row.cells.map((cell) => cell.text)),
        parts: new Set(run.flatMap((row) => row.parts)),
      });
    i = end;
  }
  return tables.sort(
    (a, b) =>
      Math.min(...[...a.parts].map((p) => p.transform[5])) -
      Math.min(...[...b.parts].map((p) => p.transform[5])),
  );
}

export function tableMarkdown(rows: string[][]): string {
  const numericHeader = rows[0].some(numberLike);
  const headers = numericHeader
    ? rows[0].map((_, i) => `Cột ${i + 1}`)
    : rows[0];
  const data = numericHeader ? rows : rows.slice(1);
  const row = (cells: string[]) =>
    `| ${cells.map(escapeMarkdown).join(" | ")} |`;
  return [
    row(headers),
    row(headers.map(() => "---")).replaceAll("\\-", "-"),
    ...data.map(row),
  ].join("\n");
}
export function tableCsv(rows: string[][]): string {
  const safe = (text: string) => {
    const formula =
      /^[=+@-]/.test(text.replace(/\p{Cc}/gu, " ").trimStart()) &&
      !/^[-+]?\d+(?:[.,]\d+)*%?$/.test(text.trim());
    return `"${(formula ? "'" + text : text).replaceAll('"', '""')}"`;
  };
  return (
    "\ufeff" + rows.map((row) => row.map(safe).join(",")).join("\r\n") + "\r\n"
  );
}
export function splitTableRow(row: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const char of row.trim().slice(1, -1)) {
    if (char === "|" && !escaped) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
    if (char === "\\") escaped = !escaped;
    else escaped = false;
  }
  cells.push(cell.trim());
  return cells;
}

export function tableMarkup(table: TableRegion): string {
  return table.spans?.some((c) => c.rowSpan > 1 || c.colSpan > 1) ||
    table.rows.some((row) => row.some((cell) => cell.includes("\n")))
    ? tableHtml(table.rows, table.spans)
    : tableMarkdown(table.rows);
}
