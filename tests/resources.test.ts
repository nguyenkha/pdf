import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";
import { organizePdf } from "../src/engines/merge";

async function source(content: string, nested = false) {
  const doc = await PDFDocument.create();
  const kept = doc.addPage();
  const removed = doc.addPage();
  const image = () => doc.context.register(doc.context.flateStream(new Uint8Array([0, 0, 0]), {
    Type: "XObject", Subtype: "Image", Width: 1, Height: 1, ColorSpace: "DeviceRGB", BitsPerComponent: 8,
  }));
  const resources = doc.context.obj({ XObject: { Public: image(), Private: image() } });
  if (nested) {
    const form = doc.context.register(doc.context.flateStream("/Public Do", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 1, 1] }));
    resources.lookup(PDFName.of("XObject"), PDFDict).set(PDFName.of("Form"), form);
  }
  kept.node.set(PDFName.of("Resources"), resources);
  removed.node.set(PDFName.of("Resources"), resources);
  kept.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(content)));
  return doc.save();
}

const imageCount = (doc: PDFDocument) => doc.context.enumerateIndirectObjects().filter(([, object]) =>
  object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
).length;
async function twoPages(build: (doc: PDFDocument, kept: ReturnType<PDFDocument["addPage"]>, removed: ReturnType<PDFDocument["addPage"]>,
  image: () => ReturnType<PDFDocument["context"]["register"]>) => void) {
  const doc = await PDFDocument.create();
  const kept = doc.addPage();
  const removed = doc.addPage();
  const image = () => doc.context.register(doc.context.flateStream(new Uint8Array([0, 0, 0]), {
    Type: "XObject", Subtype: "Image", Width: 1, Height: 1, ColorSpace: "DeviceRGB", BitsPerComponent: 8,
  }));
  build(doc, kept, removed, image);
  return doc.save();
}

describe("resources after page deletion", () => {
  it("refuses a shared pattern that would keep a deleted-only image", async () => {
    const bytes = await twoPages((doc, kept, removed, image) => {
      const pattern = doc.context.register(doc.context.flateStream("/Img Do", {
        PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 1, 1], XStep: 1, YStep: 1,
        Resources: { XObject: { Img: image() } },
      }));
      const resources = doc.context.obj({ Pattern: { P: pattern } });
      kept.node.set(PDFName.of("Resources"), resources);
      removed.node.set(PDFName.of("Resources"), resources);
      kept.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream("0 0 1 1 re f")));
      removed.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream("/Pattern cs /P scn 0 0 1 1 re f")));
    });
    await expect(organizePdf(bytes, [{ page: 0, rotate: 0 }])).rejects.toThrow("unsupported");
  });
  it("refuses a shared Type3 font whose glyphs draw inherited page images", async () => {
    const bytes = await twoPages((doc, kept, removed, image) => {
      const glyph = doc.context.register(doc.context.flateStream("1 0 0 0 1 1 d1 /Img Do"));
      const font = doc.context.register(doc.context.obj({
        Type: "Font", Subtype: "Type3", FontBBox: [0, 0, 1, 1], FontMatrix: [1, 0, 0, 1, 0, 0],
        CharProcs: { g: glyph }, Encoding: { Type: "Encoding", Differences: [103, PDFName.of("g")] },
        FirstChar: 103, LastChar: 103, Widths: [1],
      }));
      const resources = doc.context.obj({ Font: { T3: font }, XObject: { Img: image(), Other: image() } });
      kept.node.set(PDFName.of("Resources"), resources);
      removed.node.set(PDFName.of("Resources"), resources);
      kept.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream("BT /T3 1 Tf (g) Tj ET")));
      removed.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream("/Other Do")));
    });
    await expect(organizePdf(bytes, [{ page: 0, rotate: 0 }])).rejects.toThrow("unsupported");
  });
  it("deletes pages that share only an ordinary font, even with private inline images", async () => {
    const bytes = await twoPages((doc, kept, removed, image) => {
      const font = doc.context.register(doc.context.obj({ Type: "Font", Subtype: "Type1", BaseFont: StandardFonts.Helvetica }));
      kept.node.set(PDFName.of("Resources"), doc.context.obj({ Font: { F1: font }, ExtGState: { G: { CA: 1 } }, XObject: { Mine: image() } }));
      removed.node.set(PDFName.of("Resources"), doc.context.obj({ Font: { F1: font }, XObject: { Img: image() } }));
      kept.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream("BI /W 1 /H 1 /CS /G /BPC 8 ID \x00 EI /Mine Do BT /F1 9 Tf (a) Tj ET")));
      removed.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream("/Img Do")));
    });
    const result = await PDFDocument.load((await organizePdf(bytes, [{ page: 0, rotate: 0 }])).bytes);
    expect(result.getPageCount()).toBe(1);
    expect(imageCount(result)).toBe(1);
  });
  it("reads Flate content with default decode parameters", async () => {
    const bytes = await twoPages((doc, kept, removed, image) => {
      const resources = doc.context.obj({ XObject: { Used: image(), Secret: image() } });
      kept.node.set(PDFName.of("Resources"), resources);
      removed.node.set(PDFName.of("Resources"), resources);
      kept.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream("/Used Do", { DecodeParms: { Predictor: 1 } })));
    });
    expect(imageCount(await PDFDocument.load((await organizePdf(bytes, [{ page: 0, rotate: 0 }])).bytes))).toBe(1);
  });
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
