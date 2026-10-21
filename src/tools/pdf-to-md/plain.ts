// The converter's Markdown as plain text, for people who asked for the text
// of a PDF rather than Markdown: no markup, tables as tab-separated rows.
const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" };
const entities = (text: string) => text.replace(/&(?:lt|gt|amp|quot|#39);/g, (entity) => ENTITIES[entity]);
/** Inline markup out: links keep their address, footnotes their number. */
function inline(text: string): string {
  return entities(
    text
      // [label](<url>) or [label](url): the label, then the address unless it is the label.
      .replace(/(?<!\\)\[((?:\\.|[^\]\\])*)\]\(<?([^()<>\s]+)>?\)/g, (_, label: string, url: string) => {
        const plain = label.replace(/\\(.)/g, "$1");
        return plain === url ? plain : `${label} (${url})`;
      })
      .replace(/(?<!\\)\[\^([^\]\s]+)\]:?/g, "[$1]")
      .replace(/(?<!\\)\*\*?/g, "")
      .replace(/\\([\\`*_[\]|~#+\-.!()=<>{}])/g, "$1"),
  );
}
/** A pipe-table row's cells, splitting only on unescaped bars. */
const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => inline(cell.trim()));
export function markdownToText(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Page markers and the rules between pages.
    if (/^<!--.*-->$/.test(line.trim()) || /^-{3,}$/.test(line.trim())) continue;
    // Merged-cell tables are written as HTML: one row per <tr>, cells by tab.
    if (line.startsWith("<table")) {
      for (i++; i < lines.length && !lines[i].startsWith("</table>"); i++) {
        const row = [...lines[i].matchAll(/<t[dh][^>]*>((?:[^<]|<br>)*)<\/t[dh]>/g)].map((match) =>
          entities(match[1].replaceAll("<br>", " ")).trim(),
        );
        if (row.length) out.push(row.join("\t"));
      }
      continue;
    }
    if (/^\s*\|/.test(line)) {
      if (!/^[\s|:-]+$/.test(line)) out.push(cells(line).join("\t"));
      continue;
    }
    // Images are files beside the Markdown, not text.
    if (/^!\[(?:\\.|[^\]\\])*\]\([^)]*\)$/.test(line.trim())) continue;
    out.push(inline(line.replace(/^#{1,6}\s+/, "")));
  }
  return (
    out
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}
