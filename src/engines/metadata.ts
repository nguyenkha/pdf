// Reading and cutting image metadata. Kept apart from pdf-lib so the pdf.js
// workers that clean their canvas output do not load it.
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
// Frames (C0-CF: SOFn, DHT, DAC), quantization and restart tables, scans
// and the rest of the image structure; every other segment is dropped.
const IMAGE_SEGMENTS = new Set([
  ...Array.from({ length: 16 }, (_, i) => 0xc0 + i),
  0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf,
]);
const startsWith = (bytes: Uint8Array, at: number, text: string) =>
  Array.from(text).every((char, i) => bytes[at + i] === char.charCodeAt(0));
/**
 * The JPEG without metadata, its compressed image data untouched. Kept: the
 * color profile (APP2 ICC_PROFILE) and Adobe's color transform (APP14,
 * rebuilt to its 12 bytes),
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
    } else if (marker === 0xee && startsWith(bytes, body, "Adobe") && end - body >= 12) {
      // Adobe's version, flags and color transform, nothing more.
      const header = bytes.slice(offset, offset + 16);
      header[2] = 0;
      header[3] = 14;
      parts.push(header);
    } else if ((marker === 0xe2 && startsWith(bytes, body, "ICC_PROFILE\0")) || IMAGE_SEGMENTS.has(marker))
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
  return concat(parts);
}
// PNG chunks that shape the picture; text, EXIF and time chunks are dropped.
const PNG_KEEP = new Set(["IHDR", "PLTE", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "IDAT", "IEND"]);
/** A PNG without metadata chunks (some browsers' canvases add an eXIf one). */
export function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const end = offset + 12 + view.getUint32(offset);
    if (end > bytes.length) throw new Error("png");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (PNG_KEEP.has(type)) parts.push(bytes.subarray(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  return concat(parts);
}
/** A canvas's JPEG or PNG without the metadata some browsers write into it. */
export async function cleanCanvasImage(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const clean = isJpeg(bytes) ? stripJpegMetadata(bytes) : isPng(bytes) ? stripPngMetadata(bytes) : bytes;
  return new Blob([clean as BlobPart], { type: blob.type });
}
function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
