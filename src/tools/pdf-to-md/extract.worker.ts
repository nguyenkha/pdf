import { extractRulings } from "./rulings";
import { findImages, type PageImage } from "./images";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { safeUrl } from "./structure";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import {
  convertDocument,
  documentTitle,
  type ConversionOptions,
  type TextPage,
  type TextPart,
} from "./markdown";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
let pages: TextPage[] | undefined;
let title = "";
let files = new Map<string, Blob>();
// Pages whose text came from OCR; their scan picture is not repeated as an image.
let recognized = new Set<number>();
// Bounds for what images may cost: count, pixels per side, total bytes.
const MAX_IMAGES = 300;
const MAX_SIDE = 2000;
const MAX_BYTES = 150 * 1024 * 1024;
type PdfImage = {
  bitmap?: ImageBitmap;
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
};
/** Turns a pdf.js image object into a PNG (with transparency) or JPEG. */
async function encode(image: PdfImage): Promise<Blob | undefined> {
  if (!image.width || !image.height || typeof OffscreenCanvas === "undefined") return;
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  let source: CanvasImageSource | undefined = image.bitmap;
  if (!source && image.data) {
    const rgba = new Uint8ClampedArray(image.width * image.height * 4);
    const { data, kind } = image;
    if (kind === 3) rgba.set(data.subarray(0, rgba.length));
    else if (kind === 2)
      for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) {
        rgba[j] = data[i];
        rgba[j + 1] = data[i + 1];
        rgba[j + 2] = data[i + 2];
        rgba[j + 3] = 255;
      }
    else if (kind === 1) {
      const row = Math.ceil(image.width / 8);
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          const on = (data[y * row + (x >> 3)] >> (7 - (x & 7))) & 1;
          rgba.fill(on ? 255 : 0, (y * image.width + x) * 4, (y * image.width + x) * 4 + 3);
          rgba[(y * image.width + x) * 4 + 3] = 255;
        }
    } else return;
    const raw = new OffscreenCanvas(image.width, image.height);
    raw.getContext("2d")!.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
    source = raw;
  }
  if (!source) return;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  let transparent = false;
  for (let i = 3; i < pixels.length; i += 64)
    if (pixels[i] < 250) {
      transparent = true;
      break;
    }
  return transparent
    ? canvas.convertToBlob({ type: "image/png" })
    : canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
}
type Page = Awaited<ReturnType<Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>["getPage"]>>;
/** A resolved image object; undefined if pdf.js never delivers it. */
const imageObject = (page: Page, id: string) =>
  new Promise<PdfImage | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 3000);
    (id.startsWith("g_") ? page.commonObjs : page.objs).get(id, (value: unknown) => {
      clearTimeout(timer);
      resolve(value as PdfImage);
    });
  });
type Request =
  | { type: "extract"; file: File; options: ConversionOptions }
  | { type: "format"; options: ConversionOptions }
  | { type: "ocr"; pages: { index: number; parts: TextPart[] }[]; options: ConversionOptions };
const hasText = (page: TextPage) => page.parts.some((part) => part.str.trim());
self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  if (!["extract", "format", "ocr"].includes(request.type)) return;
  let task: ReturnType<typeof pdfjs.getDocument> | undefined;
  try {
    if (request.type === "extract") {
      const { file } = request;
      pages = undefined;
      files = new Map();
      recognized = new Set();
      const data = new Uint8Array(await file.arrayBuffer());
      if (String.fromCharCode(...data.subarray(0, 5)) !== "%PDF-")
        throw new Error("invalid");
      task = pdfjs.getDocument({
        data,
        isEvalSupported: false,
        enableXfa: false,
        stopAtErrors: true,
        verbosity: 0,
        useSystemFonts: false,
        cMapUrl: new URL("/pdfjs/cmaps/", self.location.origin).href,
        cMapPacked: true,
        standardFontDataUrl: new URL(
          "/pdfjs/standard_fonts/",
          self.location.origin,
        ).href,
        useWorkerFetch: true,
      });
      const doc = await task.promise;
      const info = (await doc.getMetadata().catch(() => undefined))?.info as
        | { Title?: unknown }
        | undefined;
      title = documentTitle(typeof info?.Title === "string" ? info.Title : "");
      const extracted: TextPage[] = [];
      // One encoded file per image object, wherever it is drawn.
      const encoded = new Map<string, string | undefined>();
      const seenOn = new Map<string, Set<number>>();
      let bytes = 0;
      for (let number = 1; number <= doc.numPages; number++) {
        const page = await doc.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        const text = await page.getTextContent();
        const operators = await page.getOperatorList();
        const rulings = extractRulings(operators, viewport.transform, pdfjs.OPS);
        const images: PageImage[] = [];
        for (const placement of findImages(operators, viewport.transform, pdfjs.OPS)) {
          seenOn.set(placement.id, (seenOn.get(placement.id) ?? new Set()).add(number));
          if (!encoded.has(placement.id)) {
            let path: string | undefined;
            if (encoded.size < MAX_IMAGES && bytes < MAX_BYTES) {
              const object = await imageObject(page, placement.id);
              const blob = object && (await encode(object).catch(() => undefined));
              if (blob) {
                bytes += blob.size;
                path = `images/page-${number}-${encoded.size + 1}.${blob.type === "image/png" ? "png" : "jpg"}`;
                files.set(path, blob);
              }
            }
            encoded.set(placement.id, path);
          }
          const path = encoded.get(placement.id);
          if (path) images.push({ ...placement, path });
        }
        const links = (await page.getAnnotations()).flatMap((annotation) => {
          const url = annotation.url && safeUrl(annotation.url);
          if (!url || annotation.subtype !== "Link" || !annotation.rect)
            return [];
          const rect = viewport.convertToViewportRectangle(annotation.rect);
          return [
            {
              url,
              rect: [
                Math.min(rect[0], rect[2]),
                Math.min(rect[1], rect[3]),
                Math.max(rect[0], rect[2]),
                Math.max(rect[1], rect[3]),
              ],
            },
          ];
        });
        extracted.push({
          width: viewport.width,
          links,
          rulings,
          images,
          height: viewport.height,
          parts: text.items
            .filter((item) => "str" in item)
            .map((item) => ({
              ...item,
              transform: pdfjs.Util.transform(
                viewport.transform,
                item.transform,
              ),
              fontFamily: text.styles[item.fontName]?.fontFamily,
            })),
        });
        page.cleanup();
        self.postMessage({
          type: "progress",
          page: number,
          total: doc.numPages,
        });
      }
      await task.destroy();
      task = undefined;
      pages = extracted;
      // Kept for OCR: the page could still offer to read the scan.
      if (!extracted.some(hasText)) throw new Error("no-text");
      // Logos and backgrounds sit on most pages; real figures rarely repeat.
      for (const page of extracted)
        for (const image of page.images ?? []) {
          const id = [...encoded].find(([, path]) => path === image.path)?.[0];
          const count = id ? (seenOn.get(id)?.size ?? 0) : 0;
          image.repeated = count >= Math.max(3, Math.ceil(extracted.length * 0.5));
        }
      // Keep text, layout and encoded images for option changes, not PDF bytes.
      pages = extracted;
    }
    if (!pages) throw new Error("invalid");
    if (request.type === "ocr")
      for (const { index, parts } of request.pages) {
        const page = pages[index];
        if (!page) continue;
        recognized.add(index);
        page.parts = parts;
        // The scan itself is now text: drop pictures covering most of the page.
        page.images = page.images?.filter(
          (image) => image.width * image.height < page.width * page.height * 0.6,
        );
      }
    const result = convertDocument(title, pages, request.options);
    self.postMessage({
      type: "result",
      ...result,
      images: [...new Set(result.imagePaths)].map((path) => ({ path, blob: files.get(path)! })),
      textless: pages.flatMap((page, index) => (hasText(page) || recognized.has(index) ? [] : [index])),
      recognized: recognized.size,
      pages: pages.length,
    });
  } catch (error) {
    const code =
      error instanceof Error && error.name === "PasswordException"
        ? "password"
        : error instanceof Error && error.message === "no-text"
          ? "no-text"
          : error instanceof Error && /memory|allocation/i.test(error.message)
            ? "memory"
            : "invalid";
    self.postMessage({ type: "error", code, pages: code === "no-text" ? pages?.length : undefined });
  } finally {
    await task?.destroy();
  }
};
