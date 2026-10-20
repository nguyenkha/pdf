import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  type PDFObject,
} from "pdf-lib";

import { flattenSignatureFields } from "./signatures";

export type MergeSource = { name: string; bytes: Uint8Array };
const name = (key: string) => PDFName.of(key);
const text = (value: PDFObject | undefined) =>
  value instanceof PDFString || value instanceof PDFHexString
    ? value.decodeText()
    : value instanceof PDFName
      ? value.decodeText()
      : undefined;
/** Looks a key up in a PDF name tree (/Names arrays under /Kids). */
function nameTree(node: PDFObject | undefined, key: string, depth = 0): PDFObject | undefined {
  if (!(node instanceof PDFDict) || depth > 32) return undefined;
  const names = node.lookup(name("Names"));
  if (names instanceof PDFArray)
    for (let i = 0; i + 1 < names.size(); i += 2)
      if (text(names.lookup(i)) === key) return names.lookup(i + 1);
  const kids = node.lookup(name("Kids"));
  if (kids instanceof PDFArray)
    for (let i = 0; i < kids.size(); i++) {
      const found = nameTree(kids.lookup(i), key, depth + 1);
      if (found) return found;
    }
  return undefined;
}
/** The explicit destination array of a link, resolving named ones. */
function destination(doc: PDFDocument, annot: PDFDict): PDFArray | undefined {
  let dest = annot.lookup(name("Dest"));
  if (!dest) {
    const action = annot.lookup(name("A"));
    if (action instanceof PDFDict && text(action.lookup(name("S"))) === "GoTo")
      dest = action.lookup(name("D"));
  }
  const key = text(dest);
  if (key !== undefined) {
    const catalog = doc.catalog;
    const dests = catalog.lookup(name("Dests"));
    const names = catalog.lookup(name("Names"));
    dest =
      (dests instanceof PDFDict ? dests.lookup(name(key)) : undefined) ??
      (names instanceof PDFDict ? nameTree(names.lookup(name("Dests")), key) : undefined);
  }
  if (dest instanceof PDFDict) dest = dest.lookup(name("D"));
  return dest instanceof PDFArray ? dest : undefined;
}
const isInternalLink = (annot: PDFDict) => {
  if (text(annot.lookup(name("Subtype"))) !== "Link") return false;
  const action = annot.lookup(name("A"));
  return (
    annot.has(name("Dest")) ||
    (action instanceof PDFDict && text(action.lookup(name("S"))) === "GoTo")
  );
};
/**
 * Copies every page of each source, in order, into one new document.
 * Pages are copied as objects (not re-rendered), so text, images, links and
 * annotations stay as they were. Links to another page of the same source
 * are re-pointed at that page in the merged file: copied as is, named
 * destinations would dangle, which also stops strict readers such as the
 * compress engine. Links that cannot be resolved are dropped. Bookmarks and form fields are
 * not carried over; encrypted sources must be unlocked first. Digital
 * signatures cannot survive a merge: their appearance is drawn into the page
 * first, so stamps and signature images still show, and `signed` lists the
 * sources that had them.
 */
export async function mergePdfs(
  sources: MergeSource[],
  onSource: (index: number) => void = () => {},
): Promise<{ bytes: Uint8Array; pages: number; signed: number[] }> {
  const output = await PDFDocument.create();
  const signed: number[] = [];
  for (const [index, source] of sources.entries()) {
    onSource(index);
    try {
      const input = await PDFDocument.load(source.bytes);
      if (!input.getPageCount()) throw new Error("no pages");
      if (flattenSignatureFields(input)) signed.push(index);
      const sourcePages = input.getPages();
      const pages = await output.copyPages(input, input.getPageIndices());
      for (const page of pages) output.addPage(page);
      sourcePages.forEach((sourcePage, pageIndex) => {
        const before = sourcePage.node.lookup(name("Annots"));
        const after = pages[pageIndex].node.lookup(name("Annots"));
        if (!(before instanceof PDFArray) || !(after instanceof PDFArray)) return;
        // Walk backwards so dropping a link keeps earlier indices valid.
        for (let i = before.size() - 1; i >= 0; i--) {
          const original = before.lookup(i);
          const copy = after.lookup(i);
          if (!(original instanceof PDFDict) || !(copy instanceof PDFDict)) continue;
          if (!isInternalLink(original)) continue;
          const dest = destination(input, original);
          const target = dest?.get(0);
          const page = target instanceof PDFRef
            ? sourcePages.findIndex((candidate) => candidate.ref === target)
            : -1;
          if (!dest || page < 0) {
            after.remove(i);
            continue;
          }
          copy.set(
            name("Dest"),
            output.context.obj([pages[page].ref, ...dest.asArray().slice(1)]),
          );
          copy.delete(name("A"));
        }
      });
    } catch (error) {
      // Name the source, so the interface can point at the file to fix.
      throw new Error(
        error instanceof Error && /encrypt/i.test(error.message)
          ? `password:${index}`
          : `corrupt:${index}`,
      );
    }
  }
  output.setProducer("pdf.kha.do");
  output.setCreator("pdf.kha.do");
  return { bytes: await output.save(), pages: output.getPageCount(), signed };
}
