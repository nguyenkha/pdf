export type PageShape = {
  text: string;
  width: number;
  height: number;
  /** Only for sampled pages; see samplePages. */
  operators?: number;
  imageCount?: number;
  annotations: string[];
  thumbnail?: Uint8Array;
};
/** linked: has bookmarks or page-to-page links, which splitting would cut. */
export type PdfShape = { pages: PageShape[]; linked?: boolean };

export function verifyShape(before: PdfShape, after: PdfShape): void {
  if (before.pages.length !== after.pages.length)
    throw new Error("preservation");
  for (const [index, page] of before.pages.entries()) {
    const result = after.pages[index];
    if (
      page.text !== result.text ||
      Math.abs(page.width - result.width) > 1 ||
      Math.abs(page.height - result.height) > 1
    )
      throw new Error("preservation");
    if ((page.operators ?? 0) > 0 && result.operators === 0)
      throw new Error("preservation");
    if (JSON.stringify(page.annotations) !== JSON.stringify(result.annotations))
      throw new Error("preservation");
    if (page.thumbnail && result.thumbnail) {
      if (page.thumbnail.length !== result.thumbnail.length)
        throw new Error("preservation");
      // Compare luminance, so a requested grayscale conversion is not a
      // regression while missing or blank content still is.
      let difference = 0;
      const luma = (data: Uint8Array, i: number) =>
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      for (let pixel = 0; pixel < page.thumbnail.length; pixel += 4)
        difference += Math.abs(luma(page.thumbnail, pixel) - luma(result.thumbnail, pixel));
      // A coarse check for missing/blank content, never a pixel-perfect promise.
      if (difference / (page.thumbnail.length / 4) > 18)
        throw new Error("preservation");
    }
  }
}
