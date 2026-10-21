import {
  concatTransformationMatrix,
  degrees,
  drawObject,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  type PDFImage,
} from "pdf-lib";

export type PageSize = "a4" | "letter" | "fit";
/** An image ready for pdf-lib: JPEG bytes go in as they are, PNG is decoded. */
export type ImageSource = {
  bytes: Uint8Array;
  kind: "jpg" | "png";
  /** EXIF orientation of a JPEG (1-8): how to turn or mirror it upright. */
  orientation: number;
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
const startsWith = (bytes: Uint8Array, at: number, text: string) =>
  Array.from(text).every((char, i) => bytes[at + i] === char.charCodeAt(0));
/**
 * The JPEG without metadata, its compressed image data untouched. Kept: the
 * color profile (APP2 ICC_PROFILE) and Adobe's color transform (APP14),
 * which decoding needs, and a bare JFIF header. Dropped: EXIF and XMP (GPS
 * position, camera, time), IPTC, maker notes, MPF and FlashPix (pointers to
 * extra images), comments, the JFIF thumbnail, and everything after the end
 * of the image (motion-photo video, HDR gain maps). Throws on anything it
 * cannot follow, so the caller redraws the image instead.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  for (;;) {
    if (offset + 2 > bytes.length || bytes[offset] !== 0xff) throw new Error("jpeg");
    const marker = bytes[offset + 1];
    // Fill bytes before a marker.
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd9) {
      parts.push(bytes.subarray(offset, offset + 2));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) throw new Error("jpeg");
    const end = offset + 2 + ((bytes[offset + 2] << 8) | bytes[offset + 3]);
    if (end > bytes.length || end < offset + 4) throw new Error("jpeg");
    const body = offset + 4;
    if (marker === 0xe0 && startsWith(bytes, body, "JFIF\0") && end - body >= 14) {
      // The JFIF header alone: length 16, no thumbnail.
      const header = bytes.slice(offset, offset + 18);
      header[2] = 0;
      header[3] = 16;
      header[16] = header[17] = 0;
      parts.push(header);
    } else if (
      (marker === 0xe2 && startsWith(bytes, body, "ICC_PROFILE\0")) ||
      (marker === 0xee && startsWith(bytes, body, "Adobe")) ||
      !(marker === 0xfe || (marker >= 0xe0 && marker <= 0xef))
    )
      parts.push(bytes.subarray(offset, end));
    offset = end;
    if (marker !== 0xda) continue;
    // Entropy-coded data runs to the next marker; FF00 and restarts are data.
    let at = offset;
    while (at + 1 < bytes.length) {
      if (bytes[at] === 0xff) {
        const next = bytes[at + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) {
          at += 2;
          continue;
        }
        if (next !== 0xff) break;
      }
      at++;
    }
    if (at + 1 >= bytes.length) throw new Error("jpeg");
    parts.push(bytes.subarray(offset, at));
    offset = at;
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
// Where each EXIF orientation puts a stored point (s across, t down, 0..1)
// in the upright picture (x across, y down).
const UPRIGHT: Record<number, (s: number, t: number) => [number, number]> = {
  1: (s, t) => [s, t],
  2: (s, t) => [1 - s, t],
  3: (s, t) => [1 - s, 1 - t],
  4: (s, t) => [s, 1 - t],
  5: (s, t) => [t, s],
  6: (s, t) => [1 - t, s],
  7: (s, t) => [1 - t, 1 - s],
  8: (s, t) => [t, 1 - s],
};

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
    // The upright size, after the EXIF orientation.
    const upright = UPRIGHT[source.orientation] ?? UPRIGHT[1];
    const sideways = source.orientation >= 5 && source.orientation <= 8;
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
    // The image's unit square (u right, v up; its first row is at v = 1)
    // mapped onto the drawn area, turned and mirrored as EXIF says.
    const point = (u: number, v: number) => {
      const [across, down] = upright(u, 1 - v);
      return [x + across * drawnWidth, y + (1 - down) * drawnHeight];
    };
    const [e, f] = point(0, 0);
    const [ux, uy] = point(1, 0);
    const [vx, vy] = point(0, 1);
    const name = page.node.newXObject("Image", image.ref);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(ux - e, uy - f, vx - e, vy - f, e, f),
      drawObject(name),
      popGraphicsState(),
    );
    if (source.rotate % 360) page.setRotation(degrees(source.rotate % 360));
  }
  doc.setProducer("pdf.kha.do");
  doc.setCreator("pdf.kha.do");
  return doc.save({ useObjectStreams: true });
}
