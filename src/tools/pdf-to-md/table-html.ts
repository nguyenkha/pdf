import type { SpannedCell } from "./grid";
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function tableHtml(rows: string[][], spans?: SpannedCell[]): string {
  const cells =
    spans ??
    rows.flatMap((row, r) =>
      row.map((text, c) => ({ row: r, col: c, rowSpan: 1, colSpan: 1, text })),
    );
  return (
    '<table data-pdf-table="true">\n' +
    rows
      .map(
        (_, r) =>
          "<tr>" +
          cells
            .filter((c) => c.row === r)
            .map(
              (c) =>
                `<td rowspan="${c.rowSpan}" colspan="${c.colSpan}">${escapeHtml(c.text).replaceAll("\n", "<br>")}</td>`,
            )
            .join("") +
          "</tr>",
      )
      .join("\n") +
    "\n</table>"
  );
}
/** Parse only our generated table grammar; never insert document HTML into the DOM. */
export function parseTableHtml(
  value: string,
): { text: string; rowSpan: number; colSpan: number }[][] | undefined {
  if (
    !value.startsWith('<table data-pdf-table="true">\n') ||
    !value.endsWith("\n</table>")
  )
    return;
  const rows = value
    .slice('<table data-pdf-table="true">\n'.length, -"\n</table>".length)
    .split("\n");
  if (rows.length > 100) return;
  const output = [];
  for (const row of rows) {
    if (!row.startsWith("<tr>") || !row.endsWith("</tr>")) return;
    let rest = row.slice(4, -5);
    const cells = [];
    while (rest) {
      const match =
        /^<td rowspan="([1-9]\d{0,2})" colspan="([1-9]\d?)">((?:[^<]|<br>)*)<\/td>/.exec(
          rest,
        );
      if (
        !match ||
        Number(match[1]) > 100 ||
        Number(match[2]) > 20 ||
        cells.length >= 20
      )
        return;
      const text = match[3]
        .replaceAll("<br>", "\n")
        .replaceAll("&quot;", '"')
        .replaceAll("&gt;", ">")
        .replaceAll("&lt;", "<")
        .replaceAll("&amp;", "&");
      cells.push({
        text,
        rowSpan: Number(match[1]),
        colSpan: Number(match[2]),
      });
      rest = rest.slice(match[0].length);
    }
    output.push(cells);
  }
  return output;
}
