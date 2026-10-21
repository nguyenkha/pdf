import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { crc32 } from "../src/lib/zip";
import { imagesToPdf, jpegOrientation, stripJpegMetadata } from "../src/engines/images";
import { renderScale } from "../src/engines/validate";
import { imageName } from "../src/tools/pdf-to-images/run";

/** SOI, an APP1 Exif segment with one IFD entry for orientation, then SOS. */
function exifJpeg(orientation: number, little = false) {
  const tiff = new DataView(new ArrayBuffer(8 + 2 + 12 + 4));
  tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, little);
  tiff.setUint32(4, 8, little);
  tiff.setUint16(8, 1, little);
  tiff.setUint16(10, 0x0112, little);
  tiff.setUint16(12, 3, little);
  tiff.setUint32(14, 1, little);
  tiff.setUint16(18, orientation, little);
  const body = [...new TextEncoder().encode("Exif\0\0"), ...new Uint8Array(tiff.buffer)];
  const length = body.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...body, 0xff, 0xda, 0, 2]);
}
function png(width: number, height: number) {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new DataView(new ArrayBuffer(13));
  header.setUint32(0, width);
  header.setUint32(4, height);
  header.setUint8(8, 8);
  header.setUint8(9, 2);
  // Each row: filter byte 0, then gray RGB pixels.
  const raw = new Uint8Array(height * (1 + width * 3)).fill(128);
  for (let row = 0; row < height; row++) raw[row * (1 + width * 3)] = 0;
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", new Uint8Array(header.buffer)),
    ...chunk("IDAT", deflateSync(raw)),
    ...chunk("IEND", new Uint8Array()),
  ]);
}
const sizes = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((page) => {
    const { width, height } = page.getSize();
    return [Math.round(width), Math.round(height), page.getRotation().angle];
  });

describe("EXIF orientation", () => {
  it("reads big- and little-endian tags", () => {
    expect(jpegOrientation(exifJpeg(6))).toBe(6);
    expect(jpegOrientation(exifJpeg(8, true))).toBe(8);
  });
  it("defaults to upright without a tag or with nonsense", () => {
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
    expect(jpegOrientation(exifJpeg(42))).toBe(1);
    expect(jpegOrientation(exifJpeg(6).subarray(0, 20))).toBe(1);
  });
});
describe("JPEG metadata", () => {
  const segment = (marker: number, text: string) => {
    const body = new TextEncoder().encode(text);
    return [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  };
  // Scan data with a stuffed FF00 and a restart marker, which are data.
  const scan = [0xff, 0xda, 0, 2, 1, 0xff, 0x00, 2, 0xff, 0xd0, 3];
  const latin = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
  it("keeps ICC, Adobe, tables and image data and drops metadata segments", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      ...segment(0xe1, "Exif GPS 1.29N 103.85E"),
      ...segment(0xe2, "ICC_PROFILE\0sRGB"),
      ...segment(0xe2, "MPF\0extra image"),
      ...segment(0xed, "IPTC"),
      ...segment(0xee, "Adobe"),
      ...segment(0xfe, "comment"),
      ...segment(0xdb, "quant"),
      ...scan,
      // A progressive JPEG may put segments between scans.
      ...segment(0xe1, "XMP between scans"),
      ...scan,
      0xff, 0xd9,
    ]);
    const out = stripJpegMetadata(jpeg);
    const text = latin(out);
    expect(text).toContain("ICC_PROFILE");
    expect(text).toContain("Adobe");
    expect(text).toContain("quant");
    expect(text).not.toMatch(/Exif|GPS|MPF|IPTC|comment|XMP/);
    expect(Array.from(out.slice(-scan.length * 2 - 2))).toEqual([...scan, ...scan, 0xff, 0xd9]);
  });
  it("cuts everything after the end of the image", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, ...segment(0xdb, "quant"), ...scan, 0xff, 0xd9,
      // A motion photo's video, or an HDR gain map with its own EXIF.
      ...new TextEncoder().encode("ftypmp42 video Exif GPS"),
    ]);
    const out = stripJpegMetadata(jpeg);
    expect(Array.from(out.slice(-2))).toEqual([0xff, 0xd9]);
    expect(latin(out)).not.toMatch(/ftyp|GPS/);
  });
  it("keeps the JFIF header without its thumbnail", () => {
    const jfif = [0xff, 0xe0, 0, 22, ...new TextEncoder().encode("JFIF\0"), 1, 2, 0, 0, 1, 0, 1, 2, 1, 7, 7, 7, 7, 7, 7];
    const out = stripJpegMetadata(new Uint8Array([0xff, 0xd8, ...jfif, ...scan, 0xff, 0xd9]));
    expect(Array.from(out.slice(2, 20))).toEqual([...jfif.slice(0, 2), 0, 16, ...jfif.slice(4, 16), 0, 0]);
    expect(out.length).toBe(2 + 18 + scan.length + 2);
  });
  it("throws on files it cannot follow, so they are redrawn", () => {
    expect(() => stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x10, 0x00, 1, 2]))).toThrow();
    expect(() => stripJpegMetadata(new Uint8Array([0xff, 0xd8, ...scan]))).toThrow();
    expect(() => stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0x00, 0x01]))).toThrow();
  });
});
describe("images to PDF", () => {
  it("turns A4 pages to each image's orientation", async () => {
    const bytes = await imagesToPdf(
      [
        { bytes: png(40, 20), kind: "png", orientation: 1, rotate: 0 },
        { bytes: png(20, 40), kind: "png", orientation: 1, rotate: 90 },
      ],
      "a4",
    );
    expect(await sizes(bytes)).toEqual([
      [842, 595, 0],
      [595, 842, 90],
    ]);
  });
  it("sizes pages to the image at 96 dpi, capped at A4's long side", async () => {
    const bytes = await imagesToPdf(
      [
        { bytes: png(400, 200), kind: "png", orientation: 1, rotate: 0 },
        { bytes: png(2000, 1000), kind: "png", orientation: 1, rotate: 0 },
      ],
      "fit",
    );
    expect(await sizes(bytes)).toEqual([
      [300, 150, 0],
      [842, 421, 0],
    ]);
  });
  it("leaves no creation date and names the tool as producer", async () => {
    const doc = await PDFDocument.load(
      await imagesToPdf([{ bytes: png(4, 4), kind: "png", orientation: 1, rotate: 0 }], "letter"),
      { updateMetadata: false },
    );
    expect(doc.getCreationDate()).toBeUndefined();
    expect(doc.getProducer()).toBe("pdf.kha.do");
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });
  it("names an unreadable image by its position", async () => {
    await expect(
      imagesToPdf([{ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), kind: "jpg", orientation: 1, rotate: 0 }], "a4"),
    ).rejects.toThrow("image:0");
  });
});
describe("PDF to images", () => {
  it("pads page numbers so files sort in page order", () => {
    expect(imageName("report.pdf", 3, 12, "jpg")).toBe("report-03.jpg");
    expect(imageName("scan.PDF", 7, 7, "png")).toBe("scan-7.png");
  });
  it("scales posters down to the canvas pixel cap", () => {
    expect(renderScale(595, 842, 150)).toBeCloseTo(150 / 72);
    const scale = renderScale(2384, 3370, 300);
    expect(2384 * scale * 3370 * scale).toBeLessThanOrEqual(16_000_001);
  });
});
