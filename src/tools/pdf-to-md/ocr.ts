import type { Line, Worker as TesseractWorker } from "tesseract.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import type { Locale } from "../../i18n/config";
import { ocrLanguages } from "./ocr-data";
import { findImages } from "./images";
import type { TextPart } from "./text";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export type OcrPage = { index: number; parts: TextPart[] };
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
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;
/**
 * Turns Tesseract's lines into text parts in PDF viewport units, the same
 * shape the text layer gives, so headings, lists, tables and columns are
 * found the same way. A line is split where a wide gap suggests a table cell.
 */
export function partsFromLines(lines: Line[], scale: number, rtl = false): TextPart[] {
  const parts: TextPart[] = [];
  for (const line of lines) {
    const words = line.words.filter((word) => word.text.trim() && word.confidence >= MIN_CONFIDENCE);
    if (!words.length) continue;
    const rowHeight = line.rowAttributes?.rowHeight || line.bbox.y1 - line.bbox.y0;
    // Tesseract's row height (ascender to descender) is close to the font size.
    const size = Math.max(4, rowHeight / scale);
    const baseline = Math.max(line.baseline?.y0 ?? 0, line.baseline?.y1 ?? 0) || line.bbox.y1;
    const segments: (typeof words)[] = [];
    for (const word of words) {
      const last = segments.at(-1)?.at(-1);
      if (last && word.bbox.x0 - last.bbox.x1 <= rowHeight * 1.5) segments.at(-1)!.push(word);
      else segments.push([word]);
    }
    segments.forEach((segment, index) => {
      const str = segment
        .map((word) => word.text.trim())
        .join(" ")
        // Tesseract spaces out CJK characters; written text has none.
        .replace(new RegExp(`(${CJK.source}) (?=${CJK.source})`, "g"), "$1");
      const x0 = segment[0].bbox.x0 / scale;
      const x1 = segment.at(-1)!.bbox.x1 / scale;
      parts.push({
        str,
        transform: [size, 0, 0, size, x0, baseline / scale],
        width: x1 - x0,
        height: size,
        hasEOL: index === segments.length - 1,
        dir: rtl ? "rtl" : "ltr",
      });
    });
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
  const { createWorker } = (await import("tesseract.js/dist/tesseract.esm.min.js")).default;
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
      const scan = findImages(await page.getOperatorList(), base.transform, pdfjs.OPS)
        .filter((image) => image.pixels && image.width * image.height >= base.width * base.height * 0.3)
        .map((image) => image.pixels! / image.width);
      const scale = scan.length ? Math.min(limit, Math.max(MIN_SCALE, ...scan)) : limit;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas");
      await page.render({ canvasContext: context, viewport, background: "white" }).promise;
      page.cleanup();
      const { data } = await recognizer.recognize(canvas, {}, { blocks: true, text: false });
      // Free the page bitmap before the next one; phones are tight on memory.
      canvas.width = canvas.height = 0;
      const lines = (data.blocks ?? []).flatMap((block) =>
        block.paragraphs.flatMap((paragraph) => paragraph.lines),
      );
      pages.push({ index, parts: partsFromLines(lines, scale, languages[0] === "ara") });
    }
    return pages;
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
  }
}
