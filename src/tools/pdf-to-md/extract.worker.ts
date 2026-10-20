import { extractRulings } from "./rulings";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { safeUrl } from "./structure";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import {
  convertDocument,
  type ConversionOptions,
  type TextPage,
} from "./markdown";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
let pages: TextPage[] | undefined;
let name = "";
type Request =
  | { type: "extract"; file: File; options: ConversionOptions }
  | { type: "format"; options: ConversionOptions };
self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type !== "extract" && request.type !== "format") return;
  let task: ReturnType<typeof pdfjs.getDocument> | undefined;
  try {
    if (request.type === "extract") {
      const { file } = request;
      name = file.name;
      pages = undefined;
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
      const extracted: TextPage[] = [];
      for (let number = 1; number <= doc.numPages; number++) {
        const page = await doc.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        const text = await page.getTextContent();
        const rulings = extractRulings(
          await page.getOperatorList(),
          viewport.transform,
          pdfjs.OPS,
        );
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
      if (
        extracted.every((page) => page.parts.every((part) => !part.str.trim()))
      )
        throw new Error("no-text");
      // Keep only text and layout for option changes, not PDF bytes or images.
      pages = extracted;
    }
    if (!pages) throw new Error("invalid");
    self.postMessage({
      type: "result",
      ...convertDocument(name, pages, request.options),
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
    self.postMessage({ type: "error", code });
  } finally {
    await task?.destroy();
  }
};
