import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import type { PdfShape, PageShape } from "../lib/shape";
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const IMAGE_OPS: number[] = [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject];

type CanvasPair = { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null };
class WorkerCanvasFactory {
  create(width: number, height: number): CanvasPair { const canvas = new OffscreenCanvas(width, height); return { canvas, context: canvas.getContext('2d') }; }
  reset(pair: CanvasPair, width: number, height: number) { if(pair.canvas){pair.canvas.width=width;pair.canvas.height=height;} }
  destroy(pair: CanvasPair) { if(pair.canvas){pair.canvas.width=0;pair.canvas.height=0;}pair.canvas=null;pair.context=null; }
}

// pdf.js transfers the buffer it is given to its worker; `owned` hands it
// over instead of copying when the caller no longer needs the bytes.
function open(data: Uint8Array, password?: string, owned = false) {
  return pdfjs.getDocument({
    data: owned ? data : data.slice(),
    password,
    stopAtErrors: true,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
    cMapUrl: new URL("/pdfjs/cmaps/",self.location.origin).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("/pdfjs/standard_fonts/",self.location.origin).href,
    useWorkerFetch: true, CanvasFactory: WorkerCanvasFactory,
    // Decoded images then arrive as plain arrays the GC reclaims promptly;
    // ImageBitmaps of full-resolution scans piled up page after page and
    // pushed phones past their tab memory limit.
    isOffscreenCanvasSupported: false,
  });
}
// pdf.js reports PasswordException code 1 (needed) or 2 (incorrect).
async function load(task: ReturnType<typeof open>) {
  try {
    return await task.promise;
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException")
      throw new Error(
        (error as Error & { code?: number }).code === 2
          ? "password-incorrect"
          : "password",
      );
    throw error;
  }
}
// The rewrite engine cannot promise preservation of these features.
async function rejectUnsupported(doc: Awaited<ReturnType<typeof load>>) {
  const layers = await doc.getOptionalContentConfig();
  if (
    doc.isPureXfa ||
    (await doc.getFieldObjects()) ||
    (await doc.getAttachments()) ||
    (await doc.getJSActions()) ||
    Object.keys(layers.getGroups() ?? {}).length
  )
    throw new Error("unsupported");
}
/**
 * tagged: has an accessibility structure tree, which rewriting drops.
 * colorless: the sampled pages are (near) gray, e.g. a black-and-white scan.
 */
export type PdfSummary = {
  pages: number;
  hasImages: boolean;
  tagged: boolean;
  colorless?: boolean;
};
// A pixel counts as colored when its channels differ by more than this;
// yellowed paper and JPEG noise stay below it.
const CHROMA = 40;
const COLORED_SHARE = 0.01;
async function coloredShare(page: Awaited<ReturnType<Awaited<ReturnType<typeof load>>["getPage"]>>) {
  if (typeof OffscreenCanvas === "undefined") return undefined;
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 64 / base.width });
  const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  await page.render({
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
    background: "white",
  }).promise;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let colored = 0;
  for (let i = 0; i < data.length; i += 4) {
    const high = Math.max(data[i], data[i + 1], data[i + 2]);
    const low = Math.min(data[i], data[i + 1], data[i + 2]);
    if (high - low > CHROMA) colored++;
  }
  canvas.width = canvas.height = 0;
  return colored / (data.length / 4);
}
/** Cheap preflight: page count, document-level support, sampled image use. */
export async function probePdf(
  data: Uint8Array,
  password?: string,
): Promise<PdfSummary> {
  const task = open(data, password, true);
  try {
    const doc = await load(task);
    if (!doc.numPages) throw new Error("corrupt");
    await rejectUnsupported(doc);
    let hasImages = false;
    let tagged = false;
    let colorless: boolean | undefined = true;
    for (let number = 1; number <= Math.min(doc.numPages, 3); number++) {
      const page = await doc.getPage(number);
      tagged ||= Boolean(await page.getStructTree());
      hasImages ||= (await page.getOperatorList()).fnArray.some((operator) => IMAGE_OPS.includes(operator));
      // The images are decoded for the operator list already, so a tiny
      // render to judge color costs little.
      if (colorless) {
        const share = await coloredShare(page);
        colorless = share === undefined ? undefined : share < COLORED_SHARE;
      }
      page.cleanup();
    }
    return { pages: doc.numPages, hasImages, tagged, colorless };
  } finally {
    await task.destroy();
  }
}
// getOperatorList decodes every image at full resolution. Doing that for
// all pages of a long scan, before and after compressing, pushed phones past
// their memory limit, so the render checks run on an even sample of pages.
const RENDER_SAMPLE = 8;
export function samplePages(total: number): Set<number> {
  if (total <= RENDER_SAMPLE) return new Set(Array.from({ length: total }, (_, i) => i + 1));
  return new Set(
    Array.from({ length: RENDER_SAMPLE }, (_, i) =>
      1 + Math.round((i * (total - 1)) / (RENDER_SAMPLE - 1)),
    ),
  );
}
export async function inspectPdf(
  data: Uint8Array,
  password?: string,
  onPage: (page: number, pages: number) => void = () => {},
  owned = false,
): Promise<PdfShape> {
  const task = open(data, password, owned);
  try {
    const doc = await load(task);
    if (!doc.numPages) throw new Error("corrupt");
    await rejectUnsupported(doc);
    const sample = samplePages(doc.numPages);
    const pages: PageShape[] = [];
    let linked = Boolean((await doc.getOutline())?.length);
    for (let number = 1; number <= doc.numPages; number++) {
      onPage(number, doc.numPages);
      const page = await doc.getPage(number);
      const text = await page.getTextContent();
      const operators = sample.has(number)
        ? (await page.getOperatorList()).fnArray
        : undefined;
      const annotations = await page.getAnnotations();
      linked ||= annotations.some((annotation) => annotation.dest);
      const viewport = page.getViewport({ scale: 1 });
      const shape: PageShape = {
        text: text.items
          .filter((item) => "str" in item)
          .map((item) => ("str" in item ? item.str : ""))
          .join("")
          .normalize("NFKC")
          .replace(/\s/g, ""),
        width: viewport.width,
        height: viewport.height,
        operators: operators?.length,
        imageCount: operators?.filter((operator) => IMAGE_OPS.includes(operator)).length,
        annotations: annotations
          .map((annotation) =>
            JSON.stringify({
              type: annotation.subtype,
              url: annotation.url ?? annotation.unsafeUrl ?? null,
              text: annotation.contentsObj?.str ?? "",
              // Coordinates tolerate minor decimal differences after rewriting.
              rect: annotation.rect?.map((coordinate: number) =>
                Math.round(coordinate),
              ),
            }),
          )
          .sort(),
      };
      if (operators && typeof OffscreenCanvas !== "undefined") {
        const preview = page.getViewport({ scale: 96 / viewport.width });
        const canvas = new OffscreenCanvas(
          Math.ceil(preview.width),
          Math.ceil(preview.height),
        );
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          await page.render({
            canvasContext: context as unknown as CanvasRenderingContext2D,
            viewport: preview,
            background: "white",
          }).promise;
          shape.thumbnail = new Uint8Array(
            context.getImageData(0, 0, canvas.width, canvas.height).data,
          );
        }
        canvas.width = 0;
        canvas.height = 0;
      }
      pages.push(shape);
      page.cleanup();
    }
    return { pages, linked };
  } finally {
    await task.destroy();
  }
}
