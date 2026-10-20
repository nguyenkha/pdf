export type PageShape = {
  text: string;
  width: number;
  height: number;
  operators: number;
  imageCount: number;
  annotations: string[];
  thumbnail?: Uint8Array;
};
export type PdfShape = { pages: PageShape[] };

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
    if (page.operators > 0 && result.operators === 0)
      throw new Error("preservation");
    if (JSON.stringify(page.annotations) !== JSON.stringify(result.annotations))
      throw new Error("preservation");
    if (page.thumbnail && result.thumbnail) {
      if (page.thumbnail.length !== result.thumbnail.length)
        throw new Error("preservation");
      let difference = 0;
      for (let pixel = 0; pixel < page.thumbnail.length; pixel++)
        difference += Math.abs(page.thumbnail[pixel] - result.thumbnail[pixel]);
      // A coarse check for missing/blank content, never a pixel-perfect promise.
      if (difference / page.thumbnail.length > 18)
        throw new Error("preservation");
    }
  }
}
