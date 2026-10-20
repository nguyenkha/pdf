import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFArray, PDFDict } from "pdf-lib";
import { attemptsFor, type CompressOptions, type RunResult } from "./ghostscript";

// A4 height in inches: a dpi becomes a pixel cap for a page-sized image.
// Smaller images are never enlarged, so the cap only ever spares them.
const PAGE_INCHES = 11.69;
const WORTHWHILE = 0.1;
// Bigger than this is not a real page image but a decompression bomb.
const MAX_PIXELS = 50_000_000;
const name = (key: string) => PDFName.of(key);
// Keys that describe the old encoding; everything else (SMask, Intent,
// Interpolate, optional content) carries over to the new stream.
const ENCODING = ["Length", "Filter", "DecodeParms", "Width", "Height", "ColorSpace", "BitsPerComponent"];
type Source =
  | { kind: "jpeg" }
  | { kind: "flate"; components: 1 | 3; predictor: number; columns: number };
/** Components of a colour space a canvas reproduces: gray or RGB, calibrated or not. */
function components(space: unknown): 1 | 3 | undefined {
  const spaceName =
    space instanceof PDFName
      ? space.decodeText()
      : space instanceof PDFArray && space.lookup(0) instanceof PDFName
        ? (space.lookup(0) as PDFName).decodeText()
        : "";
  if (spaceName === "DeviceRGB" || spaceName === "CalRGB") return 3;
  if (spaceName === "DeviceGray" || spaceName === "CalGray") return 1;
  if (spaceName === "ICCBased") {
    const n = ((space as PDFArray).lookup(1) as PDFRawStream | undefined)?.dict.lookup(name("N"));
    if (n instanceof PDFNumber && (n.asNumber() === 1 || n.asNumber() === 3)) return n.asNumber() as 1 | 3;
  }
  return undefined;
}
/**
 * Images a canvas can redraw exactly as the PDF means them: JPEG, or 8-bit
 * Flate pixels, in gray or RGB. Inverted decodes, colour-key masks,
 * pre-blended mattes, CMYK and indexed colours stay as they are.
 */
function redrawable(dict: PDFDict): Source | undefined {
  const filter = dict.lookup(name("Filter"));
  const single = filter instanceof PDFArray ? (filter.size() === 1 ? filter.lookup(0) : undefined) : filter;
  const count = components(dict.lookup(name("ColorSpace")));
  const smask = dict.lookup(name("SMask"));
  if (
    !(single instanceof PDFName) ||
    !count ||
    dict.has(name("Decode")) ||
    dict.has(name("Mask")) ||
    (smask instanceof PDFRawStream && smask.dict.has(name("Matte")))
  )
    return undefined;
  if (single.decodeText() === "DCTDecode") return { kind: "jpeg" };
  const bits = dict.lookup(name("BitsPerComponent"));
  if (single.decodeText() !== "FlateDecode" || !(bits instanceof PDFNumber) || bits.asNumber() !== 8) return undefined;
  const params = dict.lookup(name("DecodeParms"));
  const parms = params instanceof PDFArray ? params.lookup(0) : params;
  const value = (key: string, fallback: number) => {
    const found = parms instanceof PDFDict ? parms.lookup(name(key)) : undefined;
    return found instanceof PDFNumber ? found.asNumber() : fallback;
  };
  const width = (dict.lookup(name("Width")) as PDFNumber).asNumber();
  const predictor = value("Predictor", 1);
  // Only no prediction or the PNG predictors over whole 8-bit pixels.
  if (predictor !== 1 && (predictor < 10 || value("Colors", 1) !== count || value("BitsPerComponent", 8) !== 8))
    return undefined;
  return { kind: "flate", components: count, predictor, columns: value("Columns", width) };
}
/** Undoes PNG row filters (predictors 10-15), one filter byte before each row. */
export function unpredictPng(data: Uint8Array, rowBytes: number, pixelBytes: number): Uint8Array {
  const rows = Math.floor(data.length / (rowBytes + 1));
  const output = new Uint8Array(rows * rowBytes);
  for (let row = 0; row < rows; row++) {
    const type = data[row * (rowBytes + 1)];
    const line = data.subarray(row * (rowBytes + 1) + 1, (row + 1) * (rowBytes + 1));
    const at = row * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= pixelBytes ? output[at + i - pixelBytes] : 0;
      const up = row ? output[at - rowBytes + i] : 0;
      const corner = row && i >= pixelBytes ? output[at - rowBytes + i - pixelBytes] : 0;
      let value = line[i];
      if (type === 1) value += left;
      else if (type === 2) value += up;
      else if (type === 3) value += (left + up) >> 1;
      else if (type === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left),
          pb = Math.abs(p - up),
          pc = Math.abs(p - corner);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      output[at + i] = value & 0xff;
    }
  }
  return output;
}
async function bitmapOf(object: PDFRawStream, kind: Source): Promise<ImageBitmap> {
  if (kind.kind === "jpeg")
    // Orientation tags inside the JPEG mean nothing in a PDF.
    return createImageBitmap(new Blob([object.contents as BlobPart], { type: "image/jpeg" }), {
      imageOrientation: "none",
    });
  const width = (object.dict.lookup(name("Width")) as PDFNumber).asNumber();
  const height = (object.dict.lookup(name("Height")) as PDFNumber).asNumber();
  if (!(width > 0 && height > 0) || width * height > MAX_PIXELS) throw new Error("image too large");
  const inflated = new Uint8Array(
    await new Response(
      new Blob([object.contents as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const rowBytes = width * kind.components;
  const pixels = kind.predictor >= 10 ? unpredictPng(inflated, rowBytes, kind.components) : inflated;
  if (pixels.length < rowBytes * height) throw new Error("short image data");
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; j < rgba.length; i += kind.components, j += 4) {
    rgba[j] = pixels[i];
    rgba[j + 1] = pixels[i + (kind.components === 3 ? 1 : 0)];
    rgba[j + 2] = pixels[i + (kind.components === 3 ? 2 : 0)];
    rgba[j + 3] = 255;
  }
  return createImageBitmap(new ImageData(rgba, width, height));
}
async function reencode(object: PDFRawStream, kind: Source, maxSide: number, quality: number) {
  const bitmap = await bitmapOf(object, kind);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality })).arrayBuffer());
  canvas.width = canvas.height = 0;
  return { bytes, width, height };
}
/** The document with its images re-encoded as JPEG; everything else is kept as it was. */
async function rewriteImages(source: Uint8Array, maxSide: number, quality: number): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source, { updateMetadata: false });
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const dict = object.dict;
    const kind = dict.lookup(name("Subtype"))?.toString() === "/Image" ? redrawable(dict) : undefined;
    if (!kind) continue;
    const image = await reencode(object, kind, maxSide, quality).catch(() => undefined);
    if (!image || image.bytes.length >= object.contents.length) continue;
    const entries: Record<string, unknown> = {};
    for (const [key, value] of dict.entries())
      if (!ENCODING.includes(key.decodeText())) entries[key.decodeText()] = value;
    doc.context.assign(
      ref,
      doc.context.stream(image.bytes, {
        ...entries,
        Width: image.width,
        Height: image.height,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        Filter: "DCTDecode",
      }),
    );
  }
  return doc.save({ useObjectStreams: true });
}
/**
 * The fallback when a full rewrite would change a document's text (some
 * fonts lose their character mapping in Ghostscript): fonts, text and page
 * content stay as they are, only images are re-encoded as JPEG (as the lossy
 * rewrite does too), along the same quality ladder the chosen options use.
 */
export async function compressImagesOnly(
  input: Uint8Array,
  options: CompressOptions,
  validate: (bytes: Uint8Array) => Promise<void>,
): Promise<RunResult> {
  const rows = attemptsFor(options).filter((row) => row.quality <= 100);
  let best: Uint8Array | undefined;
  let attempts = 0;
  for (const row of rows) {
    attempts++;
    const bytes = await rewriteImages(input, row.dpi ? row.dpi * PAGE_INCHES : Infinity, row.quality / 100);
    if (bytes.length < (best?.length ?? input.length)) best = bytes;
    if (options.target && best && best.length <= options.target) break;
  }
  if (!best || best.length > input.length * (1 - WORTHWHILE))
    return { achieved: false, attempts, heapBytes: 0, lossy: false };
  await validate(best);
  return {
    bytes: best,
    achieved: options.target !== undefined && best.length <= options.target,
    attempts,
    heapBytes: 0,
    lossy: true,
  };
}
