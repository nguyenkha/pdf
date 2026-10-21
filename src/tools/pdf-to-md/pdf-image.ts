/** An image object as pdf.js delivers it: a decoded bitmap, or raw pixels. */
export type PdfImage = {
  bitmap?: ImageBitmap;
  width: number;
  height: number;
  /** 1: 1-bit gray rows padded to bytes, 2: RGB, 3: RGBA. */
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
};
// Bound decoding in PDF.js as well as the buffers built from raw pixels.
export const PDF_IMAGE_LIMITS = {
  maxImageSize: 16_000_000,
  canvasMaxAreaInBytes: 64_000_000,
};
type Page = {
  objs: { get(id: string, callback: (value: unknown) => void): void };
  commonObjs: { get(id: string, callback: (value: unknown) => void): void };
};
/** A resolved image object; undefined if pdf.js never delivers it. */
export const imageObject = (page: Page, id: string) =>
  new Promise<PdfImage | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 3000);
    (id.startsWith("g_") ? page.commonObjs : page.objs).get(id, (value: unknown) => {
      clearTimeout(timer);
      resolve(value as PdfImage);
    });
  });
/**
 * Something a canvas can draw at the image's own size. Raw pixels are copied
 * into a canvas made by `canvas` (OffscreenCanvas in a worker, a DOM canvas
 * on the page).
 */
export function imageSource(
  image: PdfImage,
  canvas: (width: number, height: number) => OffscreenCanvas | HTMLCanvasElement,
  maxSide = 3000,
): CanvasImageSource | undefined {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) ||
      image.width <= 0 || image.height <= 0 || image.width * image.height > PDF_IMAGE_LIMITS.maxImageSize ||
      !Number.isFinite(maxSide) || maxSide < 1) return;
  if (image.bitmap) return image.bitmap;
  if (!image.data) return;
  const { data, kind } = image;
  if (kind !== 1 && kind !== 2 && kind !== 3) return;
  const stride = kind === 1 ? Math.ceil(image.width / 8) : image.width * (kind === 2 ? 3 : 4);
  if (data.length < stride * image.height) return;
  const scale = Math.min(1, Math.min(maxSide, 3000) / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y + 0.5) * image.height / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / width));
      const at = (y * width + x) * 4;
      if (kind === 1) {
        const value = (data[sy * stride + (sx >> 3)] >> (7 - (sx & 7))) & 1;
        rgba[at] = rgba[at + 1] = rgba[at + 2] = value ? 255 : 0;
        rgba[at + 3] = 255;
      } else {
        const from = sy * stride + sx * (kind === 2 ? 3 : 4);
        rgba[at] = data[from];
        rgba[at + 1] = data[from + 1];
        rgba[at + 2] = data[from + 2];
        rgba[at + 3] = kind === 3 ? data[from + 3] : 255;
      }
    }
  }
  const raw = canvas(width, height);
  const context = raw.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) return;
  context.putImageData(new ImageData(rgba, width, height), 0, 0);
  return raw;
}
