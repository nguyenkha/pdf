import { escapeMarkdown, pageText, type TextPart } from "./text";
import type { Line } from "./markdown";
export type PdfLink = { url: string; rect: number[] };
export function safeUrl(value: string): string | undefined {
  if (/\p{Cc}/u.test(value)) return;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:", "mailto:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    return url.href.replace(/[()<>]/g, (char) => encodeURIComponent(char));
  } catch {
    return;
  }
}
export function linkForLine(line: Line, links: PdfLink[]): PdfLink | undefined {
  const left = Math.min(...line.parts.map((p) => p.transform[4]));
  const right = Math.max(...line.parts.map((p) => p.transform[4] + p.width));
  return links.find(
    (link) =>
      safeUrl(link.url) &&
      line.y >= link.rect[1] - 2 &&
      line.y - line.size <= link.rect[3] + 2 &&
      Math.max(
        0,
        Math.min(right, link.rect[2]) - Math.max(left, link.rect[0]),
      ) /
        Math.max(1, right - left) >=
        0.7,
  );
}
export function listItem(
  text: string,
): { marker: string; body: string; ordered: boolean } | undefined {
  const match = /^([-*•◦▪]|\d+[.)])\s+(.+)$/.exec(text);
  if (!match) return;
  const ordered = /^\d/.test(match[1]);
  return {
    marker: ordered ? match[1].replace(/\)$/u, ".") : "-",
    body: match[2],
    ordered,
  };
}
export function footnotes(
  lines: Line[],
  height: number,
  bodySize: number,
  page: number,
) {
  const skip = new Set<Line>();
  const removed = new Set<TextPart>();
  const references = new Map<Line, string[]>();
  const definitions: string[] = [];
  for (const line of lines) {
    const note = /^(\d{1,3})[.)]?\s+(.+)$/.exec(line.text);
    if (!note || line.y < height * 0.8 || line.size > bodySize * 0.85) continue;
    const marker = lines
      .flatMap((l) => l.parts)
      .find(
        (part) =>
          part.str.trim() === note[1] &&
          Math.hypot(part.transform[2], part.transform[3]) <= bodySize * 0.85 &&
          part.transform[5] < height * 0.8,
      );
    if (!marker) continue;
    const target = lines
      .filter(
        (candidate) =>
          candidate !== line &&
          candidate.y < height * 0.8 &&
          candidate.parts.some((part) => part !== marker && part.str.trim()) &&
          Math.abs(candidate.y - marker.transform[5]) <= bodySize * 0.8,
      )
      .map((candidate) => ({
        candidate,
        end: Math.max(
          ...candidate.parts
            .filter((part) => part !== marker)
            .map((part) => part.transform[4] + part.width),
        ),
      }))
      .filter(
        ({ end }) =>
          marker.transform[4] - end >= -2 &&
          marker.transform[4] - end <= bodySize * 2,
      )
      .sort(
        (a, b) =>
          Math.abs(a.candidate.y - marker.transform[5]) -
          Math.abs(b.candidate.y - marker.transform[5]),
      )[0]?.candidate;
    if (!target) continue;
    const key = `p${page}-${note[1]}`;
    references.set(target, [...(references.get(target) ?? []), `[^${key}]`]);
    removed.add(marker);
    skip.add(line);
    let content = note[2];
    let previous = line;
    for (const continuation of lines.slice(lines.indexOf(line) + 1)) {
      if (
        continuation.size > bodySize * 0.85 ||
        continuation.y - previous.y <= 0 ||
        continuation.y - previous.y > line.size * 1.8 ||
        continuation.x < line.x ||
        /^\d+[.)]?\s/.test(continuation.text)
      )
        break;
      content += " " + continuation.text;
      skip.add(continuation);
      previous = continuation;
    }
    definitions.push(`[^${key}]: ${escapeMarkdown(content)}`);
  }
  const overrides = new Map<Line, string>();
  for (const line of lines) {
    if (line.parts.some((part) => removed.has(part))) {
      const text = pageText(line.parts.filter((part) => !removed.has(part)));
      if (text.trim()) overrides.set(line, text);
      else skip.add(line);
    }
  }
  return { skip, overrides, references, definitions };
}
