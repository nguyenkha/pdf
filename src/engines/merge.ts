import { PDFDocument } from "pdf-lib";

export type MergeSource = { name: string; bytes: Uint8Array };
/**
 * Copies every page of each source, in order, into one new document.
 * Pages are copied as objects (not re-rendered), so text, images, links and
 * annotations stay as they were. Bookmarks and form fields are not carried
 * over; encrypted sources must be unlocked first.
 */
export async function mergePdfs(
  sources: MergeSource[],
  onSource: (index: number) => void = () => {},
): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  for (const [index, source] of sources.entries()) {
    onSource(index);
    try {
      const input = await PDFDocument.load(source.bytes);
      if (!input.getPageCount()) throw new Error("no pages");
      const pages = await output.copyPages(input, input.getPageIndices());
      for (const page of pages) output.addPage(page);
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
  return output.save();
}
