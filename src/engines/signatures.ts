import { PDFDocument, PDFName, PDFSignature } from "pdf-lib";

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
  if (signatures.length === form.getFields().length) {
    try {
      // Appearances are drawn as they are; signature fields have nothing to regenerate.
      form.flatten({ updateFieldAppearances: false });
    } catch {
      // A signature without an appearance has nothing to draw: drop the fields.
      for (const field of form.getFields()) form.removeField(field);
    }
  } else for (const field of signatures) form.removeField(field);
  // Certification permissions refer to the signatures just removed.
  doc.catalog.delete(PDFName.of("Perms"));
  if (!form.getFields().length) doc.catalog.delete(PDFName.of("AcroForm"));
  return signatures.length;
}
/** A copy of a signed PDF with its signatures flattened, ready to rewrite. */
export async function withoutSignatures(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  flattenSignatureFields(doc);
  return doc.save();
}
