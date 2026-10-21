import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFSignature, PDFStream, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from "pdf-lib";
import { pruneCopiedObjects } from "./prune";

/**
 * Draws each digital signature's visible appearance (stamp, signature image)
 * into its page and removes the signature fields. Any change to a signed PDF
 * breaks its signatures anyway; this keeps what readers see and leaves no
 * broken signature behind. Returns how many signatures were removed.
 */
export function flattenSignatureFields(doc: PDFDocument): number {
  const form = doc.getForm();
  const signatures = form.getFields().filter((field) => field instanceof PDFSignature);
  if (!signatures.length) return 0;
  for (const field of signatures) {
    for (const widget of field.acroField.getWidgets()) {
      const ap = widget.dict.lookup(PDFName.of("AP"));
      let appearance = ap instanceof PDFDict ? ap.get(PDFName.of("N")) : undefined;
      if (!appearance) continue; // An invisible signature has no stamp to draw.
      const rectangle = widget.getRectangle();
      const flags = widget.getFlags();
      if (rectangle.width <= 0 || rectangle.height <= 0 || (flags & (2 | 32))) continue;
      const normal = doc.context.lookup(appearance);
      if (normal instanceof PDFDict) {
        const state = widget.dict.lookup(PDFName.of("AS"));
        appearance = normal.get(state instanceof PDFName ? state : PDFName.of("Off"));
      }
      if (!(appearance instanceof PDFRef) || !(doc.context.lookup(appearance) instanceof PDFStream))
        throw new Error("signature appearance");
      const widgetRef = doc.context.getObjectRef(widget.dict);
      const page = doc.getPages().find((page) => page.ref === widget.P()) ??
        (widgetRef && doc.findPageForAnnotationRef(widgetRef));
      if (!page) throw new Error("signature page");
      const key = page.node.newXObject("Signature", appearance);
      const stream = doc.context.lookup(appearance, PDFStream);
      const numbers = (key: string, fallback: number[]) => {
        const value = stream.dict.lookup(PDFName.of(key));
        return value instanceof PDFArray ? value.asArray().map((number) => {
          const resolved = doc.context.lookup(number);
          if (!(resolved instanceof PDFNumber)) throw new Error("signature geometry");
          return resolved.asNumber();
        }) : fallback;
      };
      const bbox = numbers("BBox", [0, 0, rectangle.width, rectangle.height]);
      const matrix = numbers("Matrix", [1, 0, 0, 1, 0, 0]);
      if (bbox.length !== 4 || matrix.length !== 6) throw new Error("signature geometry");
      const [a, b, c, d, e, f] = matrix;
      const corners = [[bbox[0], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[1]], [bbox[2], bbox[3]]];
      const xs = corners.map(([x, y]) => a * x + c * y + e);
      const ys = corners.map(([x, y]) => b * x + d * y + f);
      const x = Math.min(...xs), y = Math.min(...ys);
      const width = Math.max(...xs) - x, height = Math.max(...ys) - y;
      if (!(width > 0 && height > 0)) continue;
      const sx = rectangle.width / width, sy = rectangle.height / height;
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, rectangle.x - x * sx, rectangle.y - y * sy), drawObject(key), popGraphicsState());
    }
    // removeField expects an appearance even for invisible widgets, and can
    // leave separate widget annotations behind. Remove their actual refs.
    const widgets = new Set(field.acroField.getWidgets().map((widget) => widget.dict));
    for (const page of doc.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;
      for (let i = annots.size() - 1; i >= 0; i--)
        if (widgets.has(annots.lookup(i) as PDFDict) || annots.get(i) === field.ref) annots.remove(i);
    }
    form.acroForm.removeField(field.acroField);
    form.markFieldAsClean(field.ref);
  }
  // Certification permissions refer to the signatures just removed.
  doc.catalog.delete(PDFName.of("Perms"));
  if (!form.getFields().length) doc.catalog.delete(PDFName.of("AcroForm"));
  return signatures.length;
}
/** A copy of a signed PDF with its signatures flattened, ready to rewrite. */
export async function withoutSignatures(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  flattenSignatureFields(doc);
  pruneCopiedObjects(doc);
  return doc.save();
}
