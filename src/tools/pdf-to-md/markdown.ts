import type { Ruling } from "./rulings";
import {
  safeUrl,
  linkForLine,
  listItem,
  footnotes,
  type PdfLink,
} from "./structure";
import { escapeMarkdown, pageText, type TextPart } from "./text";
export { escapeMarkdown, pageText, type TextPart } from "./text";
import { restoreReadingOrder } from "./columns";
import type { PageImage } from "./images";
import {
  detectTables,
  tableMarkup,
  tableCsv,
  type ConvertedTable,
} from "./tables";

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

export type TextPage = {
  parts: TextPart[];
  width: number;
  height: number;
  links?: PdfLink[];
  images?: PageImage[];
  rulings?: Ruling[];
  /** Text read by OCR: already in reading order, rules found on the scan. */
  scanned?: boolean;
};
/**
 * Words written into the Markdown itself; the site passes its UI language.
 * Placeholders: {page}, {column}.
 */
export type MarkdownLabels = {
  page: string;
  noText: string;
  marginsOnly: string;
  column: string;
  image: string;
};
export const defaultLabels: MarkdownLabels = {
  page: "Trang {page}",
  noText: "Không tìm thấy lớp chữ trên trang này. Bản thử nghiệm chưa có OCR.",
  marginsOnly: "Các dòng ở mép trang đã được bỏ. Tắt tùy chọn bỏ header/footer để giữ lại.",
  column: "Cột {column}",
  image: "Ảnh {index}, trang {page}",
};
const label = (template: string, values: Record<string, number>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
export type ConversionOptions = {
  labels?: Partial<MarkdownLabels>;
  keepLineBreaks: boolean;
  detectHeadings: boolean;
  removeMargins: boolean;
  detectTables: boolean;
  restoreColumns: boolean;
  joinPages: boolean;
  preserveLinks: boolean;
  preserveLists: boolean;
  preserveFootnotes: boolean;
  preserveImages: boolean;
};
export const defaultOptions: ConversionOptions = {
  keepLineBreaks: false,
  detectHeadings: true,
  removeMargins: true,
  detectTables: true,
  // Only pages with two clear columns are reordered; the rest keep their order.
  restoreColumns: true,
  joinPages: false,
  preserveLinks: true,
  preserveLists: true,
  preserveFootnotes: true,
  preserveImages: true,
};
export type Line = {
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  parts: TextPart[];
};

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
        parts: group,
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
  if (/^\d{1,3}[.)]?\s+\p{L}/u.test(line.text)) return;
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

/**
 * The document's own title from its metadata, or "" when it is missing or
 * only an app's placeholder ("Untitled", "Microsoft Word - report.docx").
 */
export function documentTitle(raw: string | undefined): string {
  const title = (raw ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/^Microsoft (?:Word|PowerPoint|Excel) - /i, "")
    .replace(/\.(?:docx?|pptx?|xlsx?|odt|pages|key|indd|rtf|txt|pdf)$/i, "")
    .trim();
  return /^(?:untitled|document\d*|unknown|-+)?$/i.test(title) ? "" : title;
}
/** Markdown for each page, joined with `---` and an invisible page marker. */
export function convertDocument(
  title: string,
  pages: TextPage[],
  options: ConversionOptions,
) {
  const labels = { ...defaultLabels, ...options.labels };
  let columnPages = 0;
  const lines = pages.map((page) => {
    // OCR's layout analysis has already put columns in reading order.
    const ordered = options.restoreColumns && !page.scanned
      ? restoreReadingOrder(page.parts, page.width, page.height, page.rulings)
      : { parts: page.parts, reordered: false };
    if (ordered.reordered) columnPages++;
    return linesFromParts(ordered.parts);
  });
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
  const tables: ConvertedTable[] = [];
  let removedLines = 0;
  let headings = 0;
  let emptyPages = 0;
  let linkCount = 0;
  let noteCount = 0;
  let listCount = 0;
  const imagePaths: string[] = [];
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
    const notes = options.preserveFootnotes
      ? footnotes(kept, pages[index].height, bodySize, index + 1)
      : {
          skip: new Set<Line>(),
          overrides: new Map<Line, string>(),
          references: new Map<Line, string[]>(),
          definitions: [] as string[],
        };
    const links = options.preserveLinks
      ? (pages[index].links ?? []).filter((link) => safeUrl(link.url))
      : [];
    const usedLinks = new Set<PdfLink>();
    noteCount += notes.definitions.length;
    const regions = options.detectTables
      ? detectTables(
          kept.flatMap((line) => line.parts),
          pages[index].rulings,
          pages[index].scanned,
        )
      : [];
    const emitted = new Set<(typeof regions)[number]>();
    const blocks: string[] = [];
    // Images go before the first line below their middle, in reading order.
    const pending = options.preserveImages
      ? (pages[index].images ?? [])
          .filter((image) => !(image.repeated && options.removeMargins))
          .sort((a, b) => a.y - b.y)
      : [];
    const image = (item: PageImage) => {
      imagePaths.push(item.path);
      blocks.push(
        `![${escapeMarkdown(label(labels.image, { index: imagePaths.length, page: index + 1 }))}](${item.path})`,
      );
    };
    let paragraph = "";
    let paragraphRefs: string[] = [];
    let previous: Line | undefined;
    const flush = () => {
      if (paragraph)
        blocks.push(escapeMarkdown(paragraph) + paragraphRefs.join(""));
      paragraph = "";
      paragraphRefs = [];
    };
    const tableOwner = new Map(
      regions.flatMap((region) =>
        [...region.parts].map((part) => [part, region] as const),
      ),
    );
    // A PDF text line can cross adjacent tables; split ownership without dropping prose.
    const segmented = kept.flatMap((line) => {
      const groups = new Map<
        (typeof regions)[number] | undefined,
        TextPart[]
      >();
      for (const part of line.parts) {
        const key = tableOwner.get(part);
        groups.set(key, [...(groups.get(key) ?? []), part]);
      }
      if (!line.parts.some((part) => tableOwner.has(part)) || groups.size === 1)
        return [line];
      return [...groups.values()]
        .filter((parts) => parts.some((p) => p.str.trim()))
        .map((parts) => ({
          ...line,
          parts,
          text: pageText(parts),
          x: parts[0].transform[4],
        }));
    });
    for (const originalLine of segmented) {
      while (pending.length && pending[0].y + pending[0].height / 2 < originalLine.y) {
        flush();
        previous = undefined;
        image(pending.shift()!);
      }
      if (notes.skip.has(originalLine)) continue;
      const refs = notes.references.get(originalLine) ?? [];
      const line = {
        ...originalLine,
        text: notes.overrides.get(originalLine) ?? originalLine.text,
      };
      const region = regions.find((table) =>
        line.parts
          .filter((part) => part.str.trim())
          .every((part) => table.parts.has(part)),
      );
      if (region) {
        flush();
        previous = undefined;
        if (!emitted.has(region)) {
          blocks.push(tableMarkup(region, labels.column));
          tables.push({
            page: index + 1,
            cells: region.rows,
            csv: tableCsv(region.rows),
            merged: region.spans?.some((c) => c.rowSpan > 1 || c.colSpan > 1),
          });
          emitted.add(region);
        }
        continue;
      }
      const link = linkForLine(line, links);
      if (link) {
        flush();
        blocks.push(
          `[${escapeMarkdown(line.text)}](<${safeUrl(link.url)}>)` +
            refs.join(""),
        );
        usedLinks.add(link);
        linkCount++;
        previous = undefined;
        continue;
      }
      const item = options.preserveLists ? listItem(line.text) : undefined;
      if (item) {
        flush();
        const rendered =
          `${item.marker} ${escapeMarkdown(item.body)}` + refs.join("");
        const last = blocks.at(-1);
        const prefix = item.ordered ? /^\d+\. / : /^- /;
        if (last && last.split("\n").every((row) => prefix.test(row)))
          blocks[blocks.length - 1] += "\n" + rendered;
        else blocks.push(rendered);
        listCount++;
        previous = undefined;
        continue;
      }
      const heading = options.detectHeadings
        ? headingLevel(line, bodySize)
        : undefined;
      if (heading) {
        flush();
        blocks.push(
          `${"#".repeat(2 + headingLevels.indexOf(heading))} ${escapeMarkdown(line.text)}`,
        );
        headings++;
        if (refs.length) blocks[blocks.length - 1] += refs.join("");
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
      paragraphRefs.push(...refs);
      previous = line;
    }
    flush();
    for (const item of pending) image(item);
    for (const link of links) {
      if (!usedLinks.has(link)) {
        blocks.push(`[${escapeMarkdown(link.url)}](<${safeUrl(link.url)}>)`);
        linkCount++;
      }
    }
    blocks.push(...notes.definitions);
    // A page with images but no text is likely a scan: say so after them.
    if (!kept.length)
      blocks.push(`*${escapeMarkdown(original.length ? labels.marginsOnly : labels.noText)}*`);
    const content = blocks.join("\n\n");
    return content;
  });
  // One page needs no marker; comments stay out of rendered Markdown.
  const marker = (index: number) =>
    `<!-- ${label(labels.page, { page: index + 1 }).replace(/--/g, "- -")} -->\n\n`;
  const body =
    pages.length === 1 || options.joinPages
      ? pageMarkdowns.join("\n\n")
      : pageMarkdowns.map((page, index) => marker(index) + page).join("\n\n---\n\n");
  return {
    markdown: `${title ? `# ${escapeMarkdown(title)}\n\n` : ""}${body}\n`,
    pageMarkdowns,
    emptyPages,
    removedLines,
    headings,
    tables,
    columnPages,
    linkCount,
    noteCount,
    listCount,
    imagePaths,
  };
}
