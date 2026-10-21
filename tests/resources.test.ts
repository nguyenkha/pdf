import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { organizePdf } from "../src/engines/merge";

async function source(content: string, nested = false) {
  const doc = await PDFDocument.create();
  const kept = doc.addPage();
  doc.addPage();
  const image = () => doc.context.register(doc.context.flateStream(new Uint8Array([0, 0, 0]), {
    Type: "XObject", Subtype: "Image", Width: 1, Height: 1, ColorSpace: "DeviceRGB", BitsPerComponent: 8,
  }));
  const resources = doc.context.obj({ XObject: { Public: image(), Private: image() } });
  if (nested) {
    const form = doc.context.register(doc.context.flateStream("/Public Do", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 1, 1] }));
    resources.lookup(PDFName.of("XObject"), PDFDict).set(PDFName.of("Form"), form);
  }
  kept.node.set(PDFName.of("Resources"), resources);
  kept.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(content)));
  return doc.save();
}

describe("resources after page deletion", () => {
  it("keeps used images in inherited form resources and drops unused images", async () => {
    const result = await PDFDocument.load((await organizePdf(await source("/Form Do", true), [{ page: 0, rotate: 0 }])).bytes);
    const images = result.context.enumerateIndirectObjects().filter(([, object]) =>
      object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    );
    expect(images).toHaveLength(1);
  });
  it("ignores names inside strings, hex strings and comments", async () => {
    const result = await PDFDocument.load((await organizePdf(await source("% /Private Do\n(/Private Do \\(nested\\)) Tj <2f50726976617465> Tj /Pub#6cic Do"), [{ page: 0, rotate: 0 }])).bytes);
    const images = result.context.enumerateIndirectObjects().filter(([, object]) =>
      object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    );
    expect(images).toHaveLength(1);
  });
  it("refuses ambiguous inline image streams instead of retaining unused resources", async () => {
    await expect(organizePdf(await source("BI /W 1 /H 1 ID abc EI"), [{ page: 0, rotate: 0 }])).rejects.toThrow("unsupported");
  });
  it("bounds decompression while examining page resources", async () => {
    await expect(organizePdf(await source(" ".repeat(9 * 1024 * 1024)), [{ page: 0, rotate: 0 }])).rejects.toThrow("memory");
  });
});
