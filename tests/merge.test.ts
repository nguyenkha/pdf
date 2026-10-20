import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
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
      await mergePdfs([
        { name: "b.pdf", bytes: b },
        { name: "a.pdf", bytes: a },
      ]),
    );
    expect(merged.getPages().map((page) => page.getWidth())).toEqual([300, 100, 200]);
  });
  it("merges real fixtures with their pages intact", async () => {
    const bytes = await mergePdfs([
      { name: "multipage.pdf", bytes: new Uint8Array(await readFile("tests/fixtures/multipage.pdf")) },
      { name: "mixed.pdf", bytes: new Uint8Array(await readFile("tests/fixtures/mixed.pdf")) },
    ]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(4);
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
