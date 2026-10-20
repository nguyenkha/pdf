/** Visible, thin, axis-aligned PDF paths in viewport coordinates. No rasterization. */
export type Ruling = { x1: number; y1: number; x2: number; y2: number };
type Matrix = number[];
type OperatorList = { fnArray: ArrayLike<number>; argsArray: unknown[][] };
type State = {
  matrix: Matrix;
  width: number;
  stroke: number;
  fill: number;
  dashed: boolean;
  clip?: number[];
  blocked: boolean;
};
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
export function extractRulings(
  list: OperatorList,
  viewport: number[],
  ops: Record<string, number>,
): Ruling[] {
  let state: State = {
    matrix: viewport,
    width: 1,
    stroke: 1,
    fill: 1,
    dashed: false,
    blocked: false,
  };
  const stack: State[] = [];
  let path: Ruling[] = [],
    rectangles: number[][] = [],
    curved = false;
  let point = [0, 0],
    start = point,
    subpathStart = 0;
  const rectangleBounds = (edges: Ruling[]): number[] | undefined => {
    if (
      edges.length !== 4 ||
      edges.some(
        (l) => Math.abs(l.x1 - l.x2) > 0.01 && Math.abs(l.y1 - l.y2) > 0.01,
      )
    )
      return;
    const xs = [...new Set(edges.flatMap((l) => [l.x1, l.x2]))],
      ys = [...new Set(edges.flatMap((l) => [l.y1, l.y2]))];
    if (xs.length !== 2 || ys.length !== 2) return;
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const output: Ruling[] = [];
  const transform = (x: number, y: number) => [
    state.matrix[0] * x + state.matrix[2] * y + state.matrix[4],
    state.matrix[1] * x + state.matrix[3] * y + state.matrix[5],
  ];
  const segment = (a: number[], b: number[]) => {
    path.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
  };
  const clear = () => {
    path = [];
    rectangles = [];
    curved = false;
  };
  const add = (line: Ruling) => {
    if (state.blocked || output.length >= 4000) return;
    let { x1, y1, x2, y2 } = line;
    if (Math.abs(y1 - y2) < 0.5) {
      y1 = y2 = (y1 + y2) / 2;
      [x1, x2] = [Math.min(x1, x2), Math.max(x1, x2)];
    } else if (Math.abs(x1 - x2) < 0.5) {
      x1 = x2 = (x1 + x2) / 2;
      [y1, y2] = [Math.min(y1, y2), Math.max(y1, y2)];
    } else return;
    if (state.clip) {
      const [left, top, right, bottom] = state.clip;
      if (x2 < left || x1 > right || y2 < top || y1 > bottom) return;
      x1 = Math.max(x1, left);
      x2 = Math.min(x2, right);
      y1 = Math.max(y1, top);
      y2 = Math.min(y2, bottom);
    }
    if (Math.hypot(x2 - x1, y2 - y1) >= 4) output.push({ x1, y1, x2, y2 });
  };
  const clip = (rect: number[]) => {
    const m = state.matrix;
    if (
      !(
        Math.abs(m[1]) + Math.abs(m[2]) < 0.01 ||
        Math.abs(m[0]) + Math.abs(m[3]) < 0.01
      )
    ) {
      state.blocked = true;
      return;
    }
    const p = transform(rect[0], rect[1]),
      q = transform(rect[2], rect[3]);
    const bounds = [
      Math.min(p[0], q[0]),
      Math.min(p[1], q[1]),
      Math.max(p[0], q[0]),
      Math.max(p[1], q[1]),
    ];
    state.clip = state.clip
      ? [
          Math.max(bounds[0], state.clip[0]),
          Math.max(bounds[1], state.clip[1]),
          Math.min(bounds[2], state.clip[2]),
          Math.min(bounds[3], state.clip[3]),
        ]
      : bounds;
  };
  for (let i = 0; i < list.fnArray.length; i++) {
    const op = list.fnArray[i],
      args = list.argsArray[i];
    if (op === ops.save || op === ops.paintFormXObjectBegin) {
      stack.push({ ...state });
      if (op === ops.paintFormXObjectBegin) {
        if (Array.isArray(args[0]))
          state.matrix = multiply(state.matrix, args[0] as number[]);
        if (Array.isArray(args[1])) clip(args[1] as number[]);
      }
    } else if (op === ops.restore || op === ops.paintFormXObjectEnd)
      state = stack.pop() ?? state;
    else if (op === ops.transform)
      state.matrix = multiply(state.matrix, args as number[]);
    else if (op === ops.setLineWidth) state.width = Number(args[0]);
    else if (op === ops.setDash)
      state.dashed = (args[0] as number[]).some((n) => n > 0);
    else if (op === ops.setGState) {
      for (const [key, value] of args[0] as [string, unknown][]) {
        if (key === "CA") state.stroke = Number(value);
        if (key === "ca") state.fill = Number(value);
        if (key === "LW") state.width = Number(value);
        if (key === "D")
          state.dashed = (value as [number[], number])[0].some((n) => n > 0);
      }
    } else if (op === ops.constructPath) {
      const commands = args[0] as number[],
        values = args[1] as number[];
      let j = 0;
      for (const command of commands) {
        if (command === ops.rectangle) {
          const [x, y, w, h] = values.slice(j, j + 4);
          j += 4;
          const a = transform(x, y),
            b = transform(x + w, y),
            c = transform(x + w, y + h),
            d = transform(x, y + h);
          segment(a, b);
          segment(b, c);
          segment(c, d);
          segment(d, a);
          const bounds = rectangleBounds(path.slice(-4));
          if (bounds) rectangles.push(bounds);
          point = a;
          start = a;
        } else if (command === ops.moveTo) {
          point = transform(values[j++], values[j++]);
          start = point;
          subpathStart = path.length;
        } else if (command === ops.lineTo) {
          const next = transform(values[j++], values[j++]);
          segment(point, next);
          point = next;
        } else if (command === ops.closePath) {
          segment(point, start);
          point = start;
          const bounds = rectangleBounds(path.slice(subpathStart));
          if (bounds) rectangles.push(bounds);
        } else {
          const count = command === ops.curveTo ? 6 : 4;
          j += count;
          curved = true;
        }
      }
    } else if (op === ops.clip || op === ops.eoClip) {
      // Complex clipping is deliberately declined; it could hide alleged table borders.
      if (
        rectangles.length === 1 &&
        path.length === 4 &&
        !curved &&
        rectangleBounds(path)
      ) {
        const r = rectangles[0];
        const b = [
          Math.min(r[0], r[2]),
          Math.min(r[1], r[3]),
          Math.max(r[0], r[2]),
          Math.max(r[1], r[3]),
        ];
        state.clip = state.clip
          ? [
              Math.max(b[0], state.clip[0]),
              Math.max(b[1], state.clip[1]),
              Math.min(b[2], state.clip[2]),
              Math.min(b[3], state.clip[3]),
            ]
          : b;
      } else state.blocked = true;
    } else if (
      [
        ops.stroke,
        ops.closeStroke,
        ops.fill,
        ops.eoFill,
        ops.fillStroke,
        ops.eoFillStroke,
        ops.closeFillStroke,
        ops.closeEOFillStroke,
      ].includes(op)
    ) {
      if (
        [ops.closeStroke, ops.closeFillStroke, ops.closeEOFillStroke].includes(
          op,
        )
      )
        segment(point, start);
      const stroke = ![ops.fill, ops.eoFill].includes(op);
      const fill = ![ops.stroke, ops.closeStroke].includes(op);
      const width =
        state.width *
        Math.max(
          Math.hypot(...state.matrix.slice(0, 2)),
          Math.hypot(...state.matrix.slice(2, 4)),
        );
      if (
        stroke &&
        !curved &&
        !state.dashed &&
        state.stroke >= 0.95 &&
        width <= 3
      )
        path.forEach(add);
      if (fill && state.fill >= 0.95)
        for (const r of rectangles) {
          const w = Math.abs(r[2] - r[0]),
            h = Math.abs(r[3] - r[1]);
          if (w <= 3 && h > 4)
            add({
              x1: (r[0] + r[2]) / 2,
              x2: (r[0] + r[2]) / 2,
              y1: Math.min(r[1], r[3]),
              y2: Math.max(r[1], r[3]),
            });
          else if (h <= 3 && w > 4)
            add({
              x1: Math.min(r[0], r[2]),
              x2: Math.max(r[0], r[2]),
              y1: (r[1] + r[3]) / 2,
              y2: (r[1] + r[3]) / 2,
            });
        }
      clear();
    } else if (op === ops.endPath) clear();
  }
  // Very complex drawings are not a reliable table signal and must stay bounded.
  return output.length >= 4000 ? [] : output;
}
