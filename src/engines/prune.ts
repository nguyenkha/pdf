import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFRef, PDFStream } from "pdf-lib";

/** Remove copied page objects outside the page tree, then unreferenced objects.
 * pdf-lib copies destinations and annotation back-references recursively and
 * saves every object in its context, including objects no longer in use.
 */
export function pruneCopiedObjects(doc: PDFDocument): void {
  const pages = new Set<PDFObject>(doc.getPages().map((page) => page.node));
  const omitted = new Set(doc.context.enumerateIndirectObjects().flatMap(([ref, object]) =>
    object instanceof PDFDict && object.get(PDFName.of("Type")) === PDFName.of("Page") && !pages.has(object) ? [ref] : [],
  ));
  const seen = new Set<PDFObject>();
  const pending: PDFObject[] = doc.context.enumerateIndirectObjects().map(([, object]) => object);
  while (pending.length) {
    const object = pending.pop()!;
    if (seen.has(object)) continue;
    seen.add(object);
    if (object instanceof PDFStream) pending.push(object.dict);
    else if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        if (value instanceof PDFRef && omitted.has(value)) object.delete(key);
        else pending.push(value);
      }
    } else if (object instanceof PDFArray) {
      for (let i = object.size() - 1; i >= 0; i--) {
        const value = object.get(i);
        if (value instanceof PDFRef && omitted.has(value)) object.remove(i);
        else pending.push(value);
      }
    }
  }
  const reachable = new Set<PDFObject>();
  pending.push(...Object.values(doc.context.trailerInfo).filter((value): value is PDFObject => value !== undefined));
  while (pending.length) {
    const object = pending.pop()!;
    if (reachable.has(object)) continue;
    reachable.add(object);
    if (object instanceof PDFRef) {
      const value = doc.context.lookup(object);
      if (value) pending.push(value);
    } else if (object instanceof PDFStream) pending.push(object.dict);
    else if (object instanceof PDFDict) pending.push(...object.values());
    else if (object instanceof PDFArray) pending.push(...object.asArray());
  }
  for (const [ref] of doc.context.enumerateIndirectObjects())
    if (!reachable.has(ref)) doc.context.delete(ref);
}
