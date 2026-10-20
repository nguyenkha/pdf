export type TextPart = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
  fontFamily?: string;
  dir?: string;
};

/**
 * Escapes only what Markdown would read as syntax: inline markers anywhere,
 * block markers (headings, lists, quotes, rules) at the start of a line.
 * Raw HTML never survives, so PDF text cannot inject tags or links.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/&(?=#?\w+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]|~]/g, "\\$&")
    .replace(/^(\s*)(#{1,6}|[-+])(?=\s|$)/gm, "$1\\$2")
    .replace(/^(\s*\d{1,9})([.)])(?=\s|$)/gm, "$1\\$2")
    .replace(/^(\s*)([-=]{2,})\s*$/gm, "$1\\$2");
}

export function pageText(parts: TextPart[]): string {
  const lines: string[] = [];
  let line = "";
  let previous: TextPart | undefined;
  const flush = () => {
    if (line.trim()) lines.push(line.trim());
    line = "";
  };
  for (const part of parts) {
    if (
      previous &&
      Math.abs(part.transform[5] - previous.transform[5]) >
        Math.max(2, previous.height * 0.4)
    )
      flush();
    if (line && part.str && !/\s$/.test(line) && !/^\s/.test(part.str)) {
      const gap =
        part.transform[4] -
        ((previous?.transform[4] ?? 0) + (previous?.width ?? 0));
      if (gap > 1) line += " ";
    }
    line += part.str;
    if (part.hasEOL) flush();
    previous = part;
  }
  flush();
  return lines.join("\n");
}

export function readableMarkdown(text: string): string {
  return text
    .replace(/\\([\\`*_{}[\]()#+.!|~-])/g, "$1")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
