export type TextPart = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
  fontFamily?: string;
};

export function escapeMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, "\\$&");
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

