import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import type { PdfShape, PageShape } from "../lib/shape";
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type CanvasPair = { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null };
class WorkerCanvasFactory {
  create(width: number, height: number): CanvasPair { const canvas = new OffscreenCanvas(width, height); return { canvas, context: canvas.getContext('2d') }; }
  reset(pair: CanvasPair, width: number, height: number) { if(pair.canvas){pair.canvas.width=width;pair.canvas.height=height;} }
  destroy(pair: CanvasPair) { if(pair.canvas){pair.canvas.width=0;pair.canvas.height=0;}pair.canvas=null;pair.context=null; }
}

export async function inspectPdf(data: Uint8Array): Promise<PdfShape> {
  const task = pdfjs.getDocument({
    data: data.slice(),
    stopAtErrors: true,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
    cMapUrl: new URL("/pdfjs/cmaps/",self.location.origin).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("/pdfjs/standard_fonts/",self.location.origin).href,
    useWorkerFetch: true, CanvasFactory: WorkerCanvasFactory,
  });
  try {
    const doc = await task.promise;
    if (!doc.numPages) throw new Error("corrupt");
    // The rewrite engine cannot promise preservation of these features.
    const layers = await doc.getOptionalContentConfig();
    if (
      doc.isPureXfa ||
      (await doc.getFieldObjects()) ||
      (await doc.getAttachments()) ||
      (await doc.getJSActions()) ||
      Object.keys(layers.getGroups() ?? {}).length
    )
      throw new Error("unsupported");
    const pages: PageShape[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      if (await page.getStructTree()) throw new Error("unsupported");
      const text = await page.getTextContent();
      const operators = await page.getOperatorList();
      const annotations = await page.getAnnotations();
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
        operators: operators.fnArray.length,
        imageCount: operators.fnArray.filter(operator=>[pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.paintImageMaskXObject].includes(operator)).length,
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
      if (typeof OffscreenCanvas !== "undefined") {
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
    return { pages };
  } finally {
    await task.destroy();
  }
}
