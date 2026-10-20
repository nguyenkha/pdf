import type { Line, Paragraph, Worker as TesseractWorker } from "tesseract.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { Locale } from "../../i18n/config";
import { ocrLanguages } from "./ocr-data";
import { findImages, type ImagePlacement } from "./images";
import { imageObject, imageSource } from "./pdf-image";
import type { Ruling } from "./rulings";
import { scanRulings } from "./scan-rulings";
import type { TextPart } from "./text";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export type OcrPage = { index: number; parts: TextPart[]; rulings: Ruling[] };
export type OcrProgress =
  | { stage: "loading" }
  /** `done` counts whole pages plus the fraction of the current one. */
  | { stage: "page"; page: number; total: number; done: number };
// About 250 dpi for A4; more costs memory on phones without helping much.
const MAX_SIDE = 3000;
// Scans are read at their own resolution: enlarging one only blurs it.
const MIN_SCALE = 2;
const MAX_PIXELS = 12_000_000;
// Words below this confidence are usually noise from pictures or stains.
const MIN_CONFIDENCE = 35;
// Whole lines below this are stamps, photos and handwriting read as letters.
const MIN_LINE_CONFIDENCE = 40;
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
/**
 * Turns Tesseract's paragraphs into text parts in PDF viewport units, the
 * same shape the text layer gives, so headings, lists, tables and columns are
 * found the same way. Coordinates are turned level first: on a scan that sits
 * a degree off, rows of a table would otherwise not line up. A line is split
 * where a wide gap suggests a table cell.
 */
// Letters without ascenders, descenders or marks: their height is the x-height.
const X_LETTERS = /^[acemnorsuvwxz]$/;
// Capitals and digits stand about 0.7 em tall.
const CAPITALS = /^[A-HIK-PR-Z0-9]$/;
/**
 * A line's font size in image pixels from its letters: about twice the
 * x-height, or capitals and digits at 0.7 of it. Tesseract's row height is a poor
 * guide here: Vietnamese marks or one tall letter stretch it by a third.
 */
export function lineSize(line: Line): number {
  const heights = (pattern: RegExp) =>
    line.words
      .flatMap((word) => word.symbols ?? [])
      .filter((symbol) => pattern.test(symbol.text))
      .map((symbol) => symbol.bbox.y1 - symbol.bbox.y0);
  // The lower quartile: a symbol Tesseract could not separate takes its
  // word's whole box, so errors only ever make a letter look taller.
  const low = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 4)];
  const x = heights(X_LETTERS);
  if (x.length) return low(x) * 2;
  const capitals = heights(CAPITALS);
  if (capitals.length) return low(capitals) / 0.7;
  return line.rowAttributes?.rowHeight || line.bbox.y1 - line.bbox.y0;
}
/** How far the scan is turned, from the slope of its long text lines. */
export const skewAngle = (paragraphs: Paragraph[]) =>
  median(
    paragraphs
      .flatMap((paragraph) => paragraph.lines)
      .filter((line) => line.baseline && line.baseline.x1 - line.baseline.x0 > 200)
      .map((line) => Math.atan2(line.baseline.y1 - line.baseline.y0, line.baseline.x1 - line.baseline.x0)),
  );
/** Typical text height in pixels, to tell table rules from letters. */
export const textHeight = (paragraphs: Paragraph[]) =>
  median(paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => line.rowAttributes?.rowHeight || line.bbox.y1 - line.bbox.y0)));
export function partsFromParagraphs(
  paragraphs: Paragraph[],
  {
    scale,
    origin = [0, 0],
    rtl = false,
    angle = skewAngle(paragraphs),
    rules = [],
  }: {
    /** Image pixels per PDF unit. */
    scale: number;
    /** Where the image's top-left corner sits on the page. */
    origin?: [number, number];
    rtl?: boolean;
    angle?: number;
    /** Table rules found on the level scan, in its pixels: text never crosses one. */
    rules?: Ruling[];
  },
): TextPart[] {
  const verticals = rules.filter((rule) => rule.x1 === rule.x2);
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const level = (x: number, y: number) => [x * cos + y * sin, -x * sin + y * cos];
  const parts: TextPart[] = [];
  // Measured sizes wobble by a fifth: within that of the page's body size a
  // line is body text, so noise never turns it into a heading.
  // Weighted by text, as for a text layer: many short table cells do not set it.
  const measured = paragraphs.flatMap((paragraph) =>
    paragraph.lines.map((line) => ({ size: lineSize(line), weight: line.words.reduce((sum, word) => sum + (word.text?.trim().length ?? 0), 0) })),
  );
  const total = measured.reduce((sum, item) => sum + item.weight, 0);
  let seen = 0;
  const body =
    [...measured].sort((a, b) => a.size - b.size).find((item) => (seen += item.weight) >= total / 2)?.size ?? 0;
  const snap = (size: number) => (Math.abs(size - body) <= body * 0.22 ? body : size);
  for (const paragraph of paragraphs) {
    const sizes = paragraph.lines.map((line) => snap(lineSize(line)));
    // Only a paragraph's first line can be a heading Tesseract kept with it.
    const rest = median(sizes.slice(1));
    for (const [index, line] of paragraph.lines.entries()) {
      if (line.confidence < MIN_LINE_CONFIDENCE) continue;
      const size = Math.max(4, (index && rest ? rest : sizes[index]) / scale);
      const rowHeight = line.rowAttributes?.rowHeight || line.bbox.y1 - line.bbox.y0;
      // Noise is a whole doubtful line; a doubtful word in a clear line is usually real.
      const words = line.words.filter(
        (word) => word.text.trim() && (word.confidence >= MIN_CONFIDENCE || line.confidence >= 70),
      );
      if (!words.length) continue;
      const baseline = line.baseline?.x1 > line.baseline?.x0 ? line.baseline : undefined;
      const baselineAt = (x: number) =>
        baseline
          ? baseline.y0 + ((x - baseline.x0) * (baseline.y1 - baseline.y0)) / (baseline.x1 - baseline.x0)
          : line.bbox.y1;
      const segments: (typeof words)[] = [];
      for (const word of words) {
        const last = segments.at(-1)?.at(-1);
        const [left, y] = last ? level(last.bbox.x1, baselineAt(last.bbox.x1)) : [0, 0];
        const [right] = level(word.bbox.x0, baselineAt(word.bbox.x0));
        const ruled = verticals.some(
          (rule) => rule.x1 > left && rule.x1 < right && y >= rule.y1 && y - rowHeight <= rule.y2,
        );
        if (last && !ruled && word.bbox.x0 - last.bbox.x1 <= rowHeight * 1.5) segments.at(-1)!.push(word);
        else segments.push([word]);
      }
      segments.forEach((segment, index) => {
        const str = segment
          .map((word) => word.text.trim())
          .join(" ")
          // Tesseract spaces out CJK characters; written text has none.
          .replace(new RegExp(`(${CJK.source}) (?=${CJK.source})`, "g"), "$1");
        const first = segment[0].bbox.x0,
          last = segment.at(-1)!.bbox.x1;
        const [x0, y] = level(first, baselineAt(first));
        const [x1] = level(last, baselineAt(last));
        parts.push({
          str,
          transform: [size, 0, 0, size, origin[0] + x0 / scale, origin[1] + y / scale],
          width: (x1 - x0) / scale,
          height: size,
          hasEOL: index === segments.length - 1,
          dir: rtl ? "rtl" : "ltr",
        });
      });
    }
  }
  return parts;
}
/**
 * Renders the chosen pages and reads their text on this device. Nothing is
 * sent anywhere: the recognizer and its language data come from this site.
 */
export async function recognizePages(
  file: File,
  indexes: number[],
  locale: Locale,
  onProgress: (progress: OcrProgress) => void,
  signal: AbortSignal,
): Promise<OcrPage[]> {
  onProgress({ stage: "loading" });
  const { createWorker, PSM } = (await import("tesseract.js/dist/tesseract.esm.min.js")).default;
  const languages = ocrLanguages(locale);
  let recognizer: TesseractWorker | undefined;
  let position = 0;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    verbosity: 0,
    useSystemFonts: false,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  });
  const stop = () => {
    void recognizer?.terminate();
    void task.destroy();
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    recognizer = await createWorker(languages, 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr/lang",
      gzip: true,
      workerBlobURL: false,
      // The service worker caches /ocr/ like the other assets; no IndexedDB copy.
      cacheMethod: "none",
      logger: (message) => {
        if (message.status === "recognizing text")
          onProgress({
            stage: "page",
            page: position + 1,
            total: indexes.length,
            done: position + message.progress,
          });
      },
    });
    // tesseract.js defaults to one uniform block; a page needs layout analysis
    // to keep columns apart and table rows in.
    await recognizer.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const doc = await task.promise;
    const pages: OcrPage[] = [];
    for (const [at, index] of indexes.entries()) {
      position = at;
      if (signal.aborted) throw new Error("cancelled");
      onProgress({ stage: "page", page: at + 1, total: indexes.length, done: at });
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const limit = Math.min(
        MAX_SIDE / Math.max(base.width, base.height),
        Math.sqrt(MAX_PIXELS / (base.width * base.height)),
      );
      const images = findImages(await page.getOperatorList(), base.transform, pdfjs.OPS);
      // A scan is one upright picture over the page: read its own pixels, which
      // every browser decodes alike, instead of a resampled rendering.
      const scan = images.find((image) => isScan(image, base.width, base.height));
      const pixels = scan && images.length === 1 ? await scanPixels(page, scan, limit) : undefined;
      let canvas: HTMLCanvasElement;
      let scale: number;
      let origin: [number, number] = [0, 0];
      if (pixels) {
        canvas = pixels;
        scale = canvas.width / scan!.width;
        origin = [scan!.x, scan!.y];
      } else {
        // Otherwise render the page, at the resolution of any scan on it.
        const native = images
          .filter((image) => image.pixels && image.width * image.height >= base.width * base.height * 0.3)
          .map((image) => image.pixels! / image.width);
        scale = native.length ? Math.min(limit, Math.max(MIN_SCALE, ...native)) : limit;
        const viewport = page.getViewport({ scale });
        canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas");
        await page.render({ canvasContext: context, viewport, background: "white" }).promise;
      }
      page.cleanup();
      const { data } = await recognizer.recognize(canvas, {}, { blocks: true, text: false });
      const paragraphs = (data.blocks ?? []).flatMap((block) => block.paragraphs);
      const angle = skewAngle(paragraphs);
      const rules = tableRules(canvas, angle, textHeight(paragraphs) || 30);
      const rulings = rules.map((rule) => ({
        x1: origin[0] + rule.x1 / scale,
        y1: origin[1] + rule.y1 / scale,
        x2: origin[0] + rule.x2 / scale,
        y2: origin[1] + rule.y2 / scale,
      }));
      // Free the page bitmap before the next one; phones are tight on memory.
      canvas.width = canvas.height = 0;
      pages.push({
        index,
        parts: partsFromParagraphs(paragraphs, { scale, origin, rtl: languages[0] === "ara", angle, rules }),
        rulings,
      });
    }
    return pages;
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
  }
}
/**
 * Table and form rules drawn on the scan, found on a level copy of the page so
 * they share the coordinates of the level text parts.
 */
function tableRules(canvas: HTMLCanvasElement, angle: number, text: number): Ruling[] {
  const pad = Math.ceil(canvas.width * Math.abs(Math.sin(angle))) + 2;
  const level = document.createElement("canvas");
  level.width = canvas.width;
  level.height = canvas.height + pad * 2;
  const context = level.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  context.fillStyle = "#fff";
  context.fillRect(0, 0, level.width, level.height);
  context.translate(0, pad);
  context.rotate(-angle);
  context.drawImage(canvas, 0, 0);
  const { data } = context.getImageData(0, 0, level.width, level.height);
  level.width = level.height = 0;
  const gray = new Uint8Array(data.length / 4);
  for (let i = 0; i < gray.length; i++)
    gray[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
  return scanRulings(gray, canvas.width, canvas.height + pad * 2, {
    horizontal: text * 3,
    vertical: text * 1.5,
  }, text).map((rule) => ({ ...rule, y1: rule.y1 - pad, y2: rule.y2 - pad }));
}
/** Covers most of the page, drawn upright: not mirrored, turned or sheared. */
function isScan(image: ImagePlacement, width: number, height: number) {
  const [a, b, c, d] = image.matrix;
  const sx = image.pixels ? image.pixels / image.width : 0;
  return (
    image.width * image.height >= width * height * 0.8 &&
    a > 0 &&
    d < 0 &&
    Math.abs(b) < 1e-3 * a &&
    Math.abs(c) < 1e-3 * a &&
    sx > 0
  );
}
/** The scan's own pixels in a canvas, enlarged only if very coarse. */
async function scanPixels(
  page: Parameters<typeof imageObject>[0],
  scan: ImagePlacement,
  limit: number,
): Promise<HTMLCanvasElement | undefined> {
  const object = await imageObject(page, scan.id);
  const source = object && imageSource(object, (width, height) => Object.assign(document.createElement("canvas"), { width, height }));
  if (!object || !source) return;
  const native = object.width / scan.width;
  // The PDF may stretch pixels: then the page rendering is the safer reading.
  if (Math.abs(object.height / scan.height - native) > native * 0.02) return;
  const scale = Math.min(limit, Math.max(MIN_SCALE, native));
  const canvas = document.createElement("canvas");
  // At the scan's own size, keep its exact pixel grid: rounding the page size
  // instead would resample every row by a fraction and blur thin strokes.
  const exact = scale === native;
  canvas.width = exact ? object.width : Math.round(scan.width * scale);
  canvas.height = exact ? object.height : Math.round(scan.height * scale);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}
