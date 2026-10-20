import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { makeMarkdown, pageText } from "./markdown";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  const { file } = event.data;
  let task: ReturnType<typeof pdfjs.getDocument> | undefined;
  try {
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
    const pages: string[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const text = await page.getTextContent();
      pages.push(pageText(text.items.filter((item) => "str" in item)));
      page.cleanup();
      self.postMessage({ type: "progress", page: number, total: doc.numPages });
    }
    await task.destroy();
    task = undefined;
    if (pages.every((text) => !text.trim())) throw new Error("no-text");
    self.postMessage({
      type: "result",
      markdown: makeMarkdown(file.name, pages),
      pages: pages.length,
      emptyPages: pages.filter((text) => !text.trim()).length,
    });
  } catch (error) {
    const code =
      error instanceof Error && error.name === "PasswordException"
        ? "password"
        : error instanceof Error && error.message === "no-text"
          ? "no-text"
          : "invalid";
    self.postMessage({ type: "error", code });
  } finally {
    await task?.destroy();
  }
};
