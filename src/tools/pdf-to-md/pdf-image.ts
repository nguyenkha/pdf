/** An image object as pdf.js delivers it: a decoded bitmap, or raw pixels. */
export type PdfImage = {
  bitmap?: ImageBitmap;
  width: number;
  height: number;
  /** 1: 1-bit gray rows padded to bytes, 2: RGB, 3: RGBA. */
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
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
): CanvasImageSource | undefined {
  if (image.bitmap) return image.bitmap;
  if (!image.data || !image.width || !image.height) return;
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
  const raw = canvas(image.width, image.height);
  const context = raw.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) return;
  context.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
  return raw;
}
