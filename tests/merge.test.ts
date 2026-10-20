import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { mergePdfs } from "../src/engines/merge";

async function make(sizes: [number, number][]) {
  const doc = await PDFDocument.create();
  for (const size of sizes) doc.addPage(size);
  return doc.save();
}
describe("merge", () => {
  it("keeps every page, in the order given", async () => {
    const a = await make([[100, 100], [200, 200]]);
    const b = await make([[300, 300]]);
    const merged = await PDFDocument.load(
      (await mergePdfs([
        { name: "b.pdf", bytes: b },
        { name: "a.pdf", bytes: a },
      ])).bytes,
    );
    expect(merged.getPages().map((page) => page.getWidth())).toEqual([300, 100, 200]);
  });
  it("merges real fixtures with their pages intact", async () => {
    const { bytes, pages } = await mergePdfs([
      { name: "multipage.pdf", bytes: new Uint8Array(await readFile("tests/fixtures/multipage.pdf")) },
      { name: "mixed.pdf", bytes: new Uint8Array(await readFile("tests/fixtures/mixed.pdf")) },
    ]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(4);
    expect(pages).toBe(4);
  });
  it("re-points internal links, named or explicit, at the merged pages", async () => {
    // A two-page source whose first page links to its second page twice:
    // once by a named destination (as Word exports do), once explicitly.
    const doc = await PDFDocument.create();
    const [first, second] = [doc.addPage([100, 100]), doc.addPage([100, 100])];
    const dests = doc.context.obj({ Names: [PDFString.of("chapter"), doc.context.obj([second.ref, PDFName.of("Fit")])] });
    doc.catalog.set(PDFName.of("Names"), doc.context.obj({ Dests: dests }));
    const link = (dest: unknown) =>
      doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], Dest: dest as never }));
    first.node.set(PDFName.of("Annots"), doc.context.obj([link(PDFString.of("chapter")), link(doc.context.obj([second.ref, PDFName.of("Fit")]))]));
    const source = await doc.save();
    const cover = await make([[50, 50]]);
    const merged = await PDFDocument.load(
      (await mergePdfs([{ name: "cover.pdf", bytes: cover }, { name: "doc.pdf", bytes: source }])).bytes,
    );
    const target = merged.getPage(2).ref;
    const annots = merged.getPage(1).node.lookup(PDFName.of("Annots"), PDFArray);
    expect(annots.size()).toBe(2);
    for (let i = 0; i < annots.size(); i++) {
      const dest = annots.lookup(i, PDFDict).lookup(PDFName.of("Dest"), PDFArray);
      expect(dest.get(0)).toBe(target);
    }
  });
  it("names the source that is password-protected or damaged", async () => {
    const good = await make([[100, 100]]);
    await expect(
      mergePdfs([
        { name: "ok.pdf", bytes: good },
        { name: "locked.pdf", bytes: new Uint8Array(await readFile("tests/fixtures/password.pdf")) },
      ]),
    ).rejects.toThrow("password:1");
    await expect(
      mergePdfs([{ name: "bad.pdf", bytes: new Uint8Array(await readFile("tests/fixtures/corrupted.pdf")) }]),
    ).rejects.toThrow("corrupt:0");
  });
});
