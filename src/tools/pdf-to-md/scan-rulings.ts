import type { Ruling } from "./rulings";

type Run = { at: number; from: number; to: number };
// Ink gaps this small still count as one stroke: scans break thin lines.
const GAP = 3;
// Thicker than this is a filled shape or a photo, not a table rule.
const MAX_THICKNESS = 8;
/**
 * Long, thin, straight strokes in a scanned page (grayscale pixels, already
 * level): the drawn rules of tables and forms, which a scan keeps only as
 * pixels. `minLength` keeps letters out; callers pass a few text heights.
 */
export function scanRulings(
  gray: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  minLength: { horizontal: number; vertical: number },
  /** Breaks shorter than this along one rule are bridged (about a text height). */
  bridge = 0,
): Ruling[] {
  // Ink is judged against this page's paper: thin rules on gray paper come out
  // light after JPEG and rotation.
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 7) histogram[gray[i]]++;
  let seen = 0,
    paper = 255;
  const half = Math.ceil(gray.length / 7) / 2;
  for (let value = 0; value < 256; value++)
    if ((seen += histogram[value]) >= half) {
      paper = value;
      break;
    }
  const dark = Math.max(100, paper - 60);
  const runs = (count: number, length: number, dark: (line: number, at: number) => boolean, min: number) => {
    const found: Run[] = [];
    for (let line = 0; line < count; line++) {
      let start = -1,
        last = -1;
      for (let at = 0; at <= length; at++) {
        if (at < length && dark(line, at)) {
          if (start < 0) start = at;
          last = at;
        } else if (start >= 0 && (at === length || at - last > GAP)) {
          if (last - start + 1 >= min) found.push({ at: line, from: start, to: last });
          start = -1;
        }
      }
    }
    return found;
  };
  // Runs that touch from one row (or column) to the next are one stroke,
  // however the scan split it; a stroke taller than a rule is a shape.
  const merge = (found: Run[]) => {
    const parent = found.map((_, i) => i);
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    let previous: number[] = [],
      current: number[] = [];
    found.forEach((run, i) => {
      if (current.length && found[current[0]].at !== run.at) {
        previous = found[current[0]].at === run.at - 1 ? current : [];
        current = [];
      }
      for (const j of previous)
        if (found[j].from <= run.to && run.from <= found[j].to) parent[root(i)] = root(j);
      current.push(i);
    });
    const strokes = new Map<number, { first: number; last: number; from: number; to: number; ink: number; sum: number }>();
    found.forEach((run, i) => {
      const key = root(i);
      const length = run.to - run.from + 1;
      const stroke = strokes.get(key);
      if (!stroke) strokes.set(key, { first: run.at, last: run.at, from: run.from, to: run.to, ink: length, sum: run.at * length });
      else {
        stroke.last = Math.max(stroke.last, run.at);
        stroke.from = Math.min(stroke.from, run.from);
        stroke.to = Math.max(stroke.to, run.to);
        stroke.ink += length;
        stroke.sum += run.at * length;
      }
    });
    return [...strokes.values()]
      .filter((stroke) => stroke.last - stroke.first + 1 <= MAX_THICKNESS)
      // Placed where most of its ink is, not halfway between its extremes.
      .map((stroke) => ({ ...stroke, middle: stroke.sum / stroke.ink }));
  };
  const horizontal = merge(
    // A rule leveled by a slightly wrong angle wanders by a pixel: look at two rows.
    runs(
      height,
      width,
      (y, x) => gray[y * width + x] < dark || (y + 1 < height && gray[(y + 1) * width + x] < dark),
      minLength.horizontal,
    ),
  ).map(({ middle, from, to }) => ({ x1: from, y1: middle, x2: to, y2: middle }));
  const vertical = merge(
    runs(
      width,
      height,
      (x, y) => gray[y * width + x] < dark || (x + 1 < width && gray[y * width + x + 1] < dark),
      minLength.vertical,
    ),
  ).map(({ middle, from, to }) => ({ x1: middle, y1: from, x2: middle, y2: to }));
  return [...join(horizontal, "y1", "x1", "x2", bridge), ...join(vertical, "x1", "y1", "y2", bridge)];
}
/** Joins pieces of one rule broken by faint spots or by crossings. */
function join(rules: Ruling[], line: "x1" | "y1", from: "x1" | "y1", to: "x2" | "y2", bridge: number) {
  // Pieces of one slightly wavy rule sit within a pixel or two of each other.
  const band = (rule: Ruling) => Math.round(rule[line] / 3);
  const sorted = [...rules].sort((a, b) => band(a) - band(b) || a[from] - b[from]);
  const joined: Ruling[] = [];
  for (const rule of sorted) {
    const last = joined.at(-1);
    if (last && Math.abs(last[line] - rule[line]) <= 2 && rule[from] - last[to] <= bridge)
      last[to] = Math.max(last[to], rule[to]);
    else joined.push({ ...rule });
  }
  return joined;
}
