import { degrees, PDFDocument, type PDFImage } from "pdf-lib";

export type PageSize = "a4" | "letter" | "fit";
/** An image ready for pdf-lib: JPEG bytes go in as they are, PNG is decoded. */
export type ImageSource = {
  bytes: Uint8Array;
  kind: "jpg" | "png";
  /** EXIF turn of a JPEG, in degrees clockwise (0, 90, 180, 270). */
  turn: number;
  /** The person's extra turn, stored as the page's rotation. */
  rotate: number;
};
const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;
// "fit" pages are the image at 96 dpi, at most A4's long side.
const FIT_LONG_SIDE = 841.89;

export const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
export const isPng = (bytes: Uint8Array) =>
  bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
/**
 * The EXIF orientation of a JPEG (1-8), 1 when there is none. Phones store
 * photos sideways and set this tag; PDF viewers ignore it.
 */
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    // Start of scan: the metadata segments are over.
    if (marker === 0xda) return 1;
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && length >= 16 && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      if (tiff + 8 > bytes.length) return 1;
      const little = view.getUint16(tiff) === 0x4949;
      const first = view.getUint32(tiff + 4, little);
      const entries = tiff + first;
      if (entries + 2 > bytes.length) return 1;
      const count = view.getUint16(entries, little);
      for (let i = 0; i < count; i++) {
        const entry = entries + 2 + i * 12;
        if (entry + 12 > bytes.length) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset += 2 + length;
  }
  return 1;
}
// Kept: JFIF (APP0), the color profile (APP2) and Adobe's color transform
// (APP14), which decoding needs. Dropped: EXIF and XMP (APP1: GPS position,
// camera, time), IPTC (APP13), maker notes (other APPn) and comments.
const KEEP_APP = new Set([0xe0, 0xe2, 0xee]);
/**
 * The JPEG without its metadata segments. The compressed image data is
 * untouched, so nothing is recompressed.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    // Start of scan: the rest is image data.
    if (marker === 0xda) break;
    const end = offset + 2 + ((bytes[offset + 2] << 8) | bytes[offset + 3]);
    if (end > bytes.length) return bytes;
    const metadata = marker === 0xfe || (marker >= 0xe0 && marker <= 0xef && !KEEP_APP.has(marker));
    if (!metadata) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  parts.push(bytes.subarray(offset));
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
/** Orientations that only turn the photo; 2, 4, 5 and 7 also mirror it. */
export const TURNS: Record<number, number> = { 1: 0, 3: 180, 6: 90, 8: 270 };

/** One page per image, in order, each image as large as its page allows. */
export async function imagesToPdf(
  sources: ImageSource[],
  size: PageSize,
  onImage: (index: number) => void = () => {},
): Promise<Uint8Array> {
  // No creation date: the file does not say when the photos were turned into it.
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const [index, source] of sources.entries()) {
    onImage(index);
    let image: PDFImage;
    try {
      image = source.kind === "jpg" ? await doc.embedJpg(source.bytes) : await doc.embedPng(source.bytes);
    } catch {
      throw new Error(`image:${index}`);
    }
    // The upright size, after the EXIF turn.
    const sideways = source.turn === 90 || source.turn === 270;
    const [width, height] = sideways ? [image.height, image.width] : [image.width, image.height];
    let pageWidth: number;
    let pageHeight: number;
    if (size === "fit") {
      const scale = Math.min(0.75, FIT_LONG_SIDE / Math.max(width, height));
      [pageWidth, pageHeight] = [width * scale, height * scale];
    } else {
      // The page takes the image's orientation.
      const [short, long] = SIZES[size];
      [pageWidth, pageHeight] = width > height ? [long, short] : [short, long];
    }
    const scale = Math.min(pageWidth / width, pageHeight / height);
    const [drawnWidth, drawnHeight] = [width * scale, height * scale];
    const x = (pageWidth - drawnWidth) / 2;
    const y = (pageHeight - drawnHeight) / 2;
    const page = doc.addPage([pageWidth, pageHeight]);
    // pdf-lib turns an image counterclockwise around its lower-left corner;
    // the offsets put the turned image back on the drawn area.
    const placement =
      source.turn === 90
        ? { x, y: y + drawnHeight, rotate: degrees(-90) }
        : source.turn === 180
          ? { x: x + drawnWidth, y: y + drawnHeight, rotate: degrees(180) }
          : source.turn === 270
            ? { x: x + drawnWidth, y, rotate: degrees(90) }
            : { x, y, rotate: degrees(0) };
    page.drawImage(image, {
      ...placement,
      width: sideways ? drawnHeight : drawnWidth,
      height: sideways ? drawnWidth : drawnHeight,
    });
    if (source.rotate % 360) page.setRotation(degrees(source.rotate % 360));
  }
  doc.setProducer("pdf.kha.do");
  doc.setCreator("pdf.kha.do");
  return doc.save({ useObjectStreams: true });
}
