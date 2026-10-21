import { renderPages, type RenderedPage } from "../engines/validate";

// PDF pages to images with pdf.js, one page at a time; each image is posted
// as soon as it is drawn so the page never holds more than one canvas.
self.onmessage = async (
  event: MessageEvent<{ file: File; pages: number[]; dpi: number; type: "image/jpeg" | "image/png" }>,
) => {
  const { file, pages, dpi, type } = event.data;
  try {
    const images: RenderedPage[] = [];
    await renderPages(new Uint8Array(await file.arrayBuffer()), pages, { dpi, type }, (image, index) => {
      images.push(image);
      self.postMessage({ type: "progress", value: (index + 1) / pages.length, page: index + 1 });
    });
    self.postMessage({ type: "result", result: images });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "processing" });
  }
};
