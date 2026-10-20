import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { degrees, PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { organizePdf } from "../src/engines/merge";

async function make(widths: number[], rotations: number[] = []) {
  const doc = await PDFDocument.create();
  widths.forEach((width, index) => doc.addPage([width, 100]).setRotation(degrees(rotations[index] ?? 0)));
  return doc.save();
}
describe("organize", () => {
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
  it("names a locked file", async () => {
    await expect(
      organizePdf(new Uint8Array(await readFile("tests/fixtures/password.pdf")), [{ page: 0, rotate: 0 }]),
    ).rejects.toThrow("password");
  });
});
