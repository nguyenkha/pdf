/** Where a page paints its raster images, in viewport coordinates. No decoding here. */
export type ImagePlacement = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
/** An image kept for the Markdown: its file in the ZIP and its place on the page. */
export type PageImage = {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The same image on many pages: a logo or background, treated like a header. */
  repeated?: boolean;
};
type Matrix = number[];
type OperatorList = { fnArray: ArrayLike<number>; argsArray: unknown[][] };
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
// Smaller than this on the page is an icon, bullet or rule, not content.
const MIN_SIDE = 24;
export function findImages(
  list: OperatorList,
  viewport: number[],
  ops: Record<string, number>,
): ImagePlacement[] {
  let matrix = viewport;
  const stack: Matrix[] = [];
  const found: ImagePlacement[] = [];
  for (let i = 0; i < list.fnArray.length; i++) {
    const op = list.fnArray[i],
      args = list.argsArray[i];
    if (op === ops.save) stack.push(matrix);
    else if (op === ops.paintFormXObjectBegin) {
      stack.push(matrix);
      if (Array.isArray(args?.[0])) matrix = multiply(matrix, args[0] as number[]);
    } else if (op === ops.restore || op === ops.paintFormXObjectEnd)
      matrix = stack.pop() ?? matrix;
    else if (op === ops.transform) matrix = multiply(matrix, args as number[]);
    else if (op === ops.paintImageXObject && typeof args?.[0] === "string") {
      // Images are drawn into the unit square of the current matrix.
      const xs = [matrix[4], matrix[0] + matrix[4], matrix[2] + matrix[4], matrix[0] + matrix[2] + matrix[4]];
      const ys = [matrix[5], matrix[1] + matrix[5], matrix[3] + matrix[5], matrix[1] + matrix[3] + matrix[5]];
      const x = Math.min(...xs),
        y = Math.min(...ys);
      const width = Math.max(...xs) - x,
        height = Math.max(...ys) - y;
      if (width >= MIN_SIDE && height >= MIN_SIDE)
        found.push({ id: args[0], x, y, width, height });
    }
  }
  return found;
}
