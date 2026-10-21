import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { organizePdf } from "../src/engines/merge";
import { flattenSignatureFields, withoutSignatures } from "../src/engines/signatures";

async function make(widths: number[], rotations: number[] = []) {
  const doc = await PDFDocument.create();
  widths.forEach((width, index) => doc.addPage([width, 100]).setRotation(degrees(rotations[index] ?? 0)));
  return doc.save();
}
describe("organize", () => {
  it("removes deleted-page images from a shared resource dictionary", async () => {
    const doc = await PDFDocument.create();
    const kept = doc.addPage();
    const removed = doc.addPage();
    const image = doc.context.register(doc.context.flateStream(new Uint8Array([1, 2, 3]), {
      Type: "XObject", Subtype: "Image", Width: 1, Height: 1, ColorSpace: "DeviceRGB", BitsPerComponent: 8,
    }));
    const resources = doc.context.obj({ XObject: { Secret: image } });
    kept.node.set(PDFName.of("Resources"), resources);
    removed.node.set(PDFName.of("Resources"), resources);
    removed.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream("/Secret Do")));
    const result = await PDFDocument.load((await organizePdf(await doc.save(), [{ page: 0, rotate: 0 }])).bytes);
    expect(result.context.enumerateIndirectObjects().filter(([, object]) =>
      object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    )).toHaveLength(0);
  });
  it("does not serialize the contents of a deleted link destination", async () => {
    const doc = await PDFDocument.create();
    const kept = doc.addPage();
    const removed = doc.addPage();
    removed.drawText("PRIVATE_DELETED_PAGE");
    const link = doc.context.register(doc.context.obj({
      Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10],
      Dest: [removed.ref, PDFName.of("Fit")],
    }));
    kept.node.set(PDFName.of("Annots"), doc.context.obj([link]));
    const result = await PDFDocument.load((await organizePdf(await doc.save(), [{ page: 0, rotate: 0 }])).bytes);
    expect(result.getPageCount()).toBe(1);
    const streams = result.context.enumerateIndirectObjects().flatMap(([, object]) =>
      object instanceof PDFRawStream ? [Buffer.from(decodePDFRawStream(object).decode()).toString()] : [],
    );
    expect(streams.join("\n")).not.toContain(Buffer.from("PRIVATE_DELETED_PAGE").toString("hex").toUpperCase());
    const pages = result.context.enumerateIndirectObjects().filter(([, object]) =>
      object instanceof PDFDict && object.get(PDFName.of("Type")) === PDFName.of("Page"),
    );
    expect(pages).toHaveLength(1);
  });
  it("reorders, turns and leaves out pages as planned", async () => {
    const source = await make([100, 200, 300], [0, 90, 0]);
    const result = await organizePdf(source, [
      { page: 2, rotate: 90 },
      { page: 1, rotate: 270 },
    ]);
    const doc = await PDFDocument.load(result.bytes);
    expect(result.pages).toBe(2);
    expect(doc.getPages().map((page) => page.getWidth())).toEqual([300, 200]);
    // Rotation adds to the page's own and wraps at a full turn.
    expect(doc.getPages().map((page) => page.getRotation().angle)).toEqual([90, 0]);
  });
  it("drops links to pages left out and re-points the rest", async () => {
    const doc = await PDFDocument.create();
    const [first, second, third] = [doc.addPage([100, 100]), doc.addPage([100, 100]), doc.addPage([100, 100])];
    const link = (target: typeof second) =>
      doc.context.register(
        doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], Dest: [target.ref, PDFName.of("Fit")] }),
      );
    first.node.set(PDFName.of("Annots"), doc.context.obj([link(second), link(third)]));
    const result = await PDFDocument.load(
      (await organizePdf(await doc.save(), [{ page: 0, rotate: 0 }, { page: 2, rotate: 0 }])).bytes,
    );
    const annots = result.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    expect(annots.size()).toBe(1);
    const dest = (annots.lookup(0) as PDFDict).lookup(PDFName.of("Dest"), PDFArray);
    expect(dest.get(0)).toBe(result.getPage(1).ref);
  });
  it("rejects plans that name pages the file does not have", async () => {
    await expect(organizePdf(await make([100]), [{ page: 3, rotate: 0 }])).rejects.toThrow("plan");
    await expect(organizePdf(await make([100]), [])).rejects.toThrow("plan");
  });
  it("flattens digital signatures and says so", async () => {
    const result = await organizePdf(new Uint8Array(await readFile("tests/fixtures/signed.pdf")), [{ page: 0, rotate: 180 }]);
    expect(result.signed).toBe(true);
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPage(0).getRotation().angle).toBe(180);
    expect(doc.catalog.has(PDFName.of("AcroForm"))).toBe(false);
  });
  it("draws signatures even when ordinary form fields remain", async () => {
    const doc = await PDFDocument.load(await readFile("tests/fixtures/signed.pdf"));
    doc.getForm().createTextField("name").addToPage(doc.getPage(0));
    const before = doc.getPage(0).node.Contents()?.toString();
    expect(flattenSignatureFields(doc)).toBe(1);
    expect(doc.getPage(0).node.Contents()?.toString()).not.toBe(before);
    expect(doc.getForm().getFields().map((field) => field.getName())).toEqual(["name"]);
    expect(flattenSignatureFields(doc)).toBe(0);
  });
  it("keeps other stamps when one signature has no appearance", async () => {
    const doc = await PDFDocument.load(await readFile("tests/fixtures/signed.pdf"));
    const signature = doc.getForm().getFields()[0];
    signature.acroField.getWidgets()[0].dict.delete(PDFName.of("AP"));
    expect(flattenSignatureFields(doc)).toBe(1);
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });
  it("accepts invisible signatures with zero-size appearance geometry", async () => {
    const doc = await PDFDocument.load(await readFile("tests/fixtures/signed.pdf"));
    doc.getForm().getFields()[0].acroField.getWidgets()[0].setRectangle({ x: 0, y: 0, width: 0, height: 0 });
    expect(flattenSignatureFields(doc)).toBe(1);
  });
  it("removes old signature values from serialized unsigned copies", async () => {
    const doc = await PDFDocument.load(await readFile("tests/fixtures/signed.pdf"));
    const field = doc.getForm().getFields()[0];
    field.acroField.dict.set(PDFName.of("V"), doc.context.register(doc.context.obj({ Contents: PDFName.of("PRIVATE_SIGNATURE_VALUE") })));
    const output = await PDFDocument.load(await withoutSignatures(await doc.save()));
    expect(output.context.enumerateIndirectObjects().some(([, object]) => object.toString().includes("PRIVATE_SIGNATURE_VALUE"))).toBe(false);
  });
  it("resolves an indirect normal-appearance state dictionary", async () => {
    const doc = await PDFDocument.load(await readFile("tests/fixtures/signed.pdf"));
    const widget = doc.getForm().getFields()[0].acroField.getWidgets()[0];
    const ap = widget.dict.lookup(PDFName.of("AP"), PDFDict);
    ap.set(PDFName.of("N"), doc.context.register(doc.context.obj({ On: ap.get(PDFName.of("N"))! })));
    widget.dict.set(PDFName.of("AS"), PDFName.of("On"));
    expect(flattenSignatureFields(doc)).toBe(1);
  });
  it("names a locked file", async () => {
    await expect(
      organizePdf(new Uint8Array(await readFile("tests/fixtures/password.pdf")), [{ page: 0, rotate: 0 }]),
    ).rejects.toThrow("password");
  });
});
