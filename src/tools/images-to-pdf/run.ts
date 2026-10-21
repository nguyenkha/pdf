import { startJob } from "../compress/run";
import type { PageSize } from "../../engines/images";

/** One PDF from the images in order, built with pdf-lib in a worker. */
export function imagesToPdf(
  items: { file: File; rotate: number }[],
  size: PageSize,
  onProgress: (value: number) => void,
) {
  return startJob<{ blob: Blob; pages: number }>(
    { items, size },
    10 * 60_000,
    (progress) => onProgress(progress.value),
    () =>
      new Worker(new URL("../../workers/images.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}
const IMAGE_NAME = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i;
export const isImage = (file: File) => file.type.startsWith("image/") || IMAGE_NAME.test(file.name);
/**
 * A small upright preview (EXIF orientation applied by the browser), and
 * whether this browser can read the image at all: HEIC only opens in Safari.
 */
export async function imagePreview(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("preview");
  return blob;
}
// Letter is the paper size in these regions; A4 everywhere else. The time
// zone has to agree: many people abroad keep an en-US browser.
const LETTER_REGIONS = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE", "GT", "PR"]);
const LETTER_ZONES = /^(America\/|Pacific\/Honolulu$|Asia\/Manila$)/;
export function defaultPageSize(): PageSize {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return region && LETTER_REGIONS.has(region) && LETTER_ZONES.test(zone) ? "letter" : "a4";
  } catch {
    return "a4";
  }
}
