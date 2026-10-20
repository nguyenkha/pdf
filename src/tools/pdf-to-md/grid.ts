import { pageText, type TextPart } from "./text";
import type { Ruling } from "./rulings";
export type SpannedCell = {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
};
export type GridTable = {
  rows: string[][];
  parts: Set<TextPart>;
  spans: SpannedCell[];
};
const clusters = (values: number[], tolerance: number) => {
  const groups: number[][] = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    const group = groups.at(-1);
    if (group && value - group[0] <= tolerance) group.push(value);
    else groups.push([value]);
  }
  return groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
};
/** Requires a closed grid. Absent internal borders represent merged cells, never missing text. */
export function detectGridTables(
  parts: TextPart[],
  rulings: Ruling[],
  /**
   * Rules found on a scan: placed less exactly and broken in places, so a rule
   * counts as drawn when it covers most of a cell side.
   */
  scanned = false,
): GridTable[] {
  const tolerance = scanned ? 3 : 1.5;
  if (rulings.length > 4000) return [];
  const parent = rulings.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const join = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (let i = 0; i < rulings.length; i++)
    for (let j = i + 1; j < rulings.length; j++) {
      const a = rulings[i],
        b = rulings[j];
      if (
        a.x1 <= b.x2 + tolerance &&
        b.x1 <= a.x2 + tolerance &&
        a.y1 <= b.y2 + tolerance &&
        b.y1 <= a.y2 + tolerance
      )
        join(i, j);
    }
  const groups = new Map<number, Ruling[]>();
  rulings.forEach((line, i) => {
    const key = find(i);
    groups.set(key, [...(groups.get(key) ?? []), line]);
  });
  const tables: GridTable[] = [];
  for (const lines of groups.values()) {
    const vertical = lines.filter((l) => l.x1 === l.x2),
      horizontal = lines.filter((l) => l.y1 === l.y2);
    const xs = clusters(vertical.map((l) => l.x1), tolerance),
      ys = clusters(horizontal.map((l) => l.y1), tolerance);
    const cols = xs.length - 1,
      rows = ys.length - 1;
    if (cols < 2 || cols > 20 || rows < 2 || rows > 100 || cols * rows > 1500)
      continue;
    if (
      xs.some((x, i) => i > 0 && x - xs[i - 1] < 5) ||
      ys.some((y, i) => i > 0 && y - ys[i - 1] < 5)
    )
      continue;
    const coverage = (
      values: [number, number][],
      start: number,
      end: number,
    ): boolean | undefined => {
      const clipped = values
        .map(([a, b]) => [Math.max(a, start), Math.min(b, end)])
        .filter(([a, b]) => b > a)
        .sort((a, b) => a[0] - b[0]);
      let covered = start,
        amount = 0;
      for (const [a, b] of clipped) {
        if (a > covered + tolerance) {
          amount += b - a;
          continue;
        }
        amount += Math.max(0, b - covered);
        covered = Math.max(covered, b);
      }
      if (scanned) {
        // Union of what is drawn along this side, as a share of its length.
        let union = 0,
          reach = start;
        for (const [a, b] of clipped) {
          union += Math.max(0, b - Math.max(a, reach));
          reach = Math.max(reach, b);
        }
        const share = union / (end - start);
        return share >= 0.5 ? true : share <= 0.15 ? false : undefined;
      }
      if (covered >= end - tolerance) return true;
      return amount <= tolerance ? false : undefined;
    };
    const v = (col: number, row: number) =>
      coverage(
        vertical
          .filter((l) => Math.abs(l.x1 - xs[col]) <= tolerance)
          .map((l) => [l.y1, l.y2]),
        ys[row],
        ys[row + 1],
      );
    const h = (row: number, col: number) =>
      coverage(
        horizontal
          .filter((l) => Math.abs(l.y1 - ys[row]) <= tolerance)
          .map((l) => [l.x1, l.x2]),
        xs[col],
        xs[col + 1],
      );
    // A scan may lose a stretch of the outer border; inner rules still decide cells.
    if (
      (!scanned &&
        Array.from(
          { length: rows },
          (_, r) => v(0, r) === true && v(cols, r) === true,
        ).some((ok) => !ok)) ||
      (!scanned &&
        Array.from(
          { length: cols },
          (_, c) => h(0, c) === true && h(rows, c) === true,
        ).some((ok) => !ok))
    )
      continue;
    const cells = Array.from({ length: rows * cols }, (_, i) => i);
    const root = (i: number): number =>
      cells[i] === i ? i : (cells[i] = root(cells[i]));
    const merge = (a: number, b: number) => {
      cells[root(a)] = root(b);
    };
    let valid = true;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (c + 1 < cols) {
          const edge = v(c + 1, r);
          if (edge === undefined) valid = false;
          else if (!edge) merge(r * cols + c, r * cols + c + 1);
        }
        if (r + 1 < rows) {
          const edge = h(r + 1, c);
          if (edge === undefined) valid = false;
          else if (!edge) merge(r * cols + c, (r + 1) * cols + c);
        }
      }
    if (!valid) continue;
    const slots = new Map<number, number[]>();
    cells.forEach((_, i) => {
      const key = root(i);
      slots.set(key, [...(slots.get(key) ?? []), i]);
    });
    const spans: SpannedCell[] = [];
    for (const ids of slots.values()) {
      const rs = ids.map((i) => Math.floor(i / cols)),
        cs = ids.map((i) => i % cols);
      const row = Math.min(...rs),
        col = Math.min(...cs),
        rowSpan = Math.max(...rs) - row + 1,
        colSpan = Math.max(...cs) - col + 1;
      if (ids.length !== rowSpan * colSpan) {
        valid = false;
        break;
      }
      // A remaining internal line inside a merged rectangle is ambiguous.
      for (let r = row; r < row + rowSpan; r++)
        for (let c = col; c < col + colSpan; c++) {
          if (c + 1 < col + colSpan && v(c + 1, r) !== false) valid = false;
          if (r + 1 < row + rowSpan && h(r + 1, c) !== false) valid = false;
        }
      spans.push({ row, col, rowSpan, colSpan, text: "" });
    }
    if (!valid) continue;
    const owned = new Set<TextPart>();
    const content = new Map<SpannedCell, TextPart[]>();
    for (const part of parts.filter((p) => p.str.trim())) {
      const size =
        Math.hypot(part.transform[2], part.transform[3]) || part.height || 12;
      const x = part.transform[4],
        y = part.transform[5],
        centerX = x + part.width / 2,
        centerY = y - size * 0.35;
      if (
        centerX < xs[0] ||
        centerX > xs.at(-1)! ||
        centerY < ys[0] ||
        centerY > ys.at(-1)!
      )
        continue;
      const cell = spans.find(
        (s) =>
          centerX >= xs[s.col] &&
          centerX <= xs[s.col + s.colSpan] &&
          centerY >= ys[s.row] &&
          centerY <= ys[s.row + s.rowSpan],
      );
      if (
        !cell ||
        x < xs[cell.col] - tolerance ||
        x + part.width > xs[cell.col + cell.colSpan] + tolerance ||
        y > ys[cell.row + cell.rowSpan] + tolerance ||
        y - size < ys[cell.row] - tolerance
      ) {
        valid = false;
        break;
      }
      content.set(cell, [...(content.get(cell) ?? []), part]);
      owned.add(part);
    }
    if (
      !valid ||
      owned.size < 2 ||
      spans.filter((s) => content.has(s)).length < 2
    )
      continue;
    const values = Array.from({ length: rows }, () =>
      Array<string>(cols).fill(""),
    );
    for (const cell of spans) {
      const textParts = (content.get(cell) ?? []).sort(
        (a, b) =>
          a.transform[5] - b.transform[5] || a.transform[4] - b.transform[4],
      );
      const textRows: TextPart[][] = [];
      for (const part of textParts) {
        const row = textRows.at(-1);
        if (row && Math.abs(row[0].transform[5] - part.transform[5]) <= 2)
          row.push(part);
        else textRows.push([part]);
      }
      // A tall unruled region is not one multiline cell: retain its text instead.
      if (textRows.length > 8) valid = false;
      cell.text = textRows
        .map((row) => pageText(row.map((p) => ({ ...p, hasEOL: false }))))
        .join("\n");
      values[cell.row][cell.col] = cell.text;
    }
    if (!valid) continue;
    tables.push({
      rows: values,
      parts: owned,
      spans: spans.sort((a, b) => a.row - b.row || a.col - b.col),
    });
  }
  // Reject overlapping candidate grids instead of duplicating document content.
  return tables
    .filter(
      (table, i) =>
        !tables.some(
          (other, j) =>
            i !== j && [...table.parts].some((p) => other.parts.has(p)),
        ),
    )
    .sort(
      (a, b) =>
        Math.min(...[...a.parts].map((p) => p.transform[5])) -
        Math.min(...[...b.parts].map((p) => p.transform[5])),
    );
}
