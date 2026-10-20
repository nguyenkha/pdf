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

export function makeMarkdown(name: string, pages: string[]): string {
  const title = escapeMarkdown(name.replace(/\.pdf$/i, ""));
  return (
    `# ${title}\n\n` +
    pages
      .map(
        (text, index) =>
          `## Trang ${index + 1}\n\n${text.trim() ? escapeMarkdown(text) : "*Không tìm thấy lớp chữ trên trang này. Bản thử nghiệm chưa có OCR.*"}`,
      )
      .join("\n\n---\n\n") +
    "\n"
  );
}

export type TextPage = { parts: TextPart[]; width: number; height: number };
export type ConversionOptions = {
  keepLineBreaks: boolean;
  detectHeadings: boolean;
  removeMargins: boolean;
};
export const defaultOptions: ConversionOptions = {
  keepLineBreaks: false,
  detectHeadings: true,
  removeMargins: true,
};
type Line = { text: string; x: number; y: number; size: number; bold: boolean };

function weightedSize(values: { size: number; weight: number }[]): number {
  const weights = new Map<number, number>();
  for (const { size, weight } of values) {
    const rounded = Math.round(size * 2) / 2;
    if (rounded > 0) weights.set(rounded, (weights.get(rounded) ?? 0) + weight);
  }
  return [...weights].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;
}

function linesFromParts(parts: TextPart[]): Line[] {
  const lines: Line[] = [];
  let group: TextPart[] = [];
  const flush = () => {
    const text = pageText(group).trim();
    if (text) {
      const weight = (part: TextPart) => Math.max(1, part.str.trim().length);
      const total = group.reduce((sum, part) => sum + weight(part), 0);
      lines.push({
        text,
        x: group[0].transform[4],
        y: group[0].transform[5],
        size: weightedSize(
          group.map((part) => ({
            size:
              Math.hypot(part.transform[2], part.transform[3]) || part.height,
            weight: weight(part),
          })),
        ),
        // PDF.js often exposes only a generic font family. Do not invent weight.
        bold:
          group
            .filter((part) =>
              /bold|black|heavy|semibold|demibold/i.test(part.fontFamily ?? ""),
            )
            .reduce((sum, part) => sum + weight(part), 0) /
            total >=
          0.6,
      });
    }
    group = [];
  };
  for (const part of parts) {
    const previous = group.at(-1);
    if (
      previous &&
      (Math.abs(part.transform[5] - previous.transform[5]) >
        Math.max(2, previous.height * 0.4) ||
        part.transform[4] - previous.transform[4] - previous.width >
          Math.max(24, previous.height * 3))
    )
      flush();
    group.push(part);
    if (part.hasEOL) flush();
  }
  flush();
  return lines;
}

function marginKey(
  line: Line,
  page: TextPage,
  bodySize: number,
): string | undefined {
  if (line.size > bodySize * 1.05 || line.text.length > 120) return;
  const y = line.y / page.height;
  const edge = y <= 0.075 ? "top" : y >= 0.925 ? "bottom" : undefined;
  if (!edge) return;
  const text = line.text.trim().toLowerCase().replace(/\s+/g, " ");
  const pageNumber =
    /^(?:(?:page|trang|seite|página)\s+)?\d+(?:\s*(?:\/|of|trên|von)\s*\d+)?$/.test(
      text,
    );
  return `${edge}:${pageNumber ? "page-number" : text}`;
}

function headingLevel(line: Line, bodySize: number): number | undefined {
  if (
    line.text.length > 120 ||
    line.text.split(/\s+/).length > 18 ||
    /[.!?;,]$/.test(line.text)
  )
    return;
  const ratio = line.size / bodySize;
  if (ratio >= 1.8) return 3;
  if (ratio >= 1.4) return 4;
  if (ratio >= 1.2 || (line.bold && ratio >= 0.98 && line.text.length <= 80))
    return 5;
}

function joinWrapped(previous: string, next: string): string {
  if (/\u00ad$/.test(previous) && /^\p{L}/u.test(next))
    return previous.slice(0, -1) + next;
  // Ordinary hyphens may be meaningful (privacy-first), so keep them.
  if (/-$/.test(previous) && /^\p{Ll}/u.test(next)) return previous + next;
  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(previous) &&
    /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(next)
  )
    return previous + next;
  return previous + " " + next;
}

export function convertDocument(
  name: string,
  pages: TextPage[],
  options: ConversionOptions,
) {
  const lines = pages.map((page) => linesFromParts(page.parts));
  const bodySize = weightedSize(
    lines.flat().map((line) => ({ size: line.size, weight: line.text.length })),
  );
  const candidates = new Map<
    string,
    { pages: Set<number>; positions: number[] }
  >();
  lines.forEach((pageLines, index) => {
    if (pageLines.length < 3) return;
    for (const line of pageLines) {
      const key = marginKey(line, pages[index], bodySize);
      if (!key) continue;
      const record = candidates.get(key) ?? {
        pages: new Set<number>(),
        positions: [],
      };
      record.pages.add(index);
      record.positions.push(line.y / pages[index].height);
      candidates.set(key, record);
    }
  });
  const repeated = new Set(
    [...candidates]
      .filter(
        ([, record]) =>
          record.pages.size >= Math.max(3, Math.ceil(pages.length * 0.75)) &&
          Math.max(...record.positions) - Math.min(...record.positions) <= 0.02,
      )
      .map(([key]) => key),
  );
  const headingLevels = [
    ...new Set(
      lines
        .flat()
        .map((line) => headingLevel(line, bodySize))
        .filter((level): level is number => level !== undefined),
    ),
  ].sort((a, b) => a - b);
  let removedLines = 0;
  let headings = 0;
  let emptyPages = 0;
  const pageMarkdowns = lines.map((original, index) => {
    if (!original.length) emptyPages++;
    const kept = original.filter((line) => {
      const key = marginKey(line, pages[index], bodySize);
      if (options.removeMargins && key && repeated.has(key)) {
        removedLines++;
        return false;
      }
      return true;
    });
    const blocks: string[] = [];
    let paragraph = "";
    let previous: Line | undefined;
    const flush = () => {
      if (paragraph) blocks.push(escapeMarkdown(paragraph));
      paragraph = "";
    };
    for (const line of kept) {
      const heading = options.detectHeadings
        ? headingLevel(line, bodySize)
        : undefined;
      if (heading) {
        flush();
        blocks.push(
          `${"#".repeat(3 + headingLevels.indexOf(heading))} ${escapeMarkdown(line.text)}`,
        );
        headings++;
        previous = undefined;
        continue;
      }
      const list = /^(?:[-*•◦▪]|\d+[.)]|[a-zA-Z][.)])\s/.test(line.text);
      const separated =
        previous &&
        (Math.abs(line.y - previous.y) >
          Math.max(line.size, previous.size) * 1.8 ||
          Math.abs(line.x - previous.x) > line.size * 1.2 ||
          list ||
          /^(?:[-*•◦▪]|\d+[.)])\s/.test(previous.text));
      if (separated) flush();
      paragraph = !paragraph
        ? line.text
        : options.keepLineBreaks
          ? paragraph + "\n" + line.text
          : joinWrapped(paragraph, line.text);
      previous = line;
    }
    flush();
    const content =
      blocks.join("\n\n") ||
      (original.length
        ? "*Các dòng ở mép trang đã được bỏ. Tắt tùy chọn bỏ header/footer để giữ lại.*"
        : "*Không tìm thấy lớp chữ trên trang này. Bản thử nghiệm chưa có OCR.*");
    return `## Trang ${index + 1}\n\n${content}`;
  });
  return {
    markdown: `# ${escapeMarkdown(name.replace(/\.pdf$/i, ""))}\n\n${pageMarkdowns.join("\n\n---\n\n")}\n`,
    pageMarkdowns,
    emptyPages,
    removedLines,
    headings,
  };
}
