import { startJob } from "../compress/run";
import type { RenderedPage } from "../../engines/validate";

export type ImageFormat = "jpg" | "png";
export const formatType = (format: ImageFormat) => (format === "jpg" ? "image/jpeg" : "image/png");
/** The chosen pages (1-based) as images, drawn with pdf.js in a worker. */
export function renderImages(
  file: File,
  pages: number[],
  dpi: number,
  format: ImageFormat,
  onProgress: (done: number) => void,
) {
  return startJob<RenderedPage[]>(
    { file, pages, dpi, type: formatType(format) },
    10 * 60_000,
    (progress) => onProgress(progress.page ?? 0),
    () =>
      new Worker(new URL("../../workers/render.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}
/** report.pdf, page 3 of 12 -> report-03.jpg, so the files sort in page order. */
export function imageName(pdfName: string, page: number, pages: number, format: ImageFormat) {
  const base = pdfName.replace(/\.pdf$/i, "") || "page";
  return `${base}-${String(page).padStart(String(pages).length, "0")}.${format}`;
}
