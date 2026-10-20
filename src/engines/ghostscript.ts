import type { Candidate } from "../lib/pdf";

export type Preference = "quality" | "balanced" | "smallest";
export type ImageQuality = "auto" | "high" | "medium" | "low";
export type CompressOptions = {
  preference: Preference;
  imageQuality: ImageQuality;
  target?: number;
  password?: string;
  /** Convert to grayscale: smaller, but ~10x slower in Ghostscript. */
  gray?: boolean;
};
export type RunResult = {
  /** The released output; undefined when the original should be kept. */
  bytes?: Uint8Array;
  achieved: boolean;
  attempts: number;
  heapBytes: number;
  lossy: boolean;
};
export type Profile = {
  quality: number;
  dpi: number;
  qfactor?: number;
  gray?: boolean;
};
// "Recommended" screen resolution: scans are usually 300 dpi, and 150 dpi
// cut a 23-page passport scan from 33 MB to 7 MB with text still legible.
const SCREEN_DPI = 150;

const fullResolution: Profile[] = [
  { quality: 90, dpi: 0, qfactor: 0.25 },
  { quality: 82, dpi: 0, qfactor: 0.4 },
  { quality: 72, dpi: 0, qfactor: 0.6 },
  { quality: 60, dpi: 0, qfactor: 0.9 },
  { quality: 45, dpi: 0, qfactor: 1.4 },
];
// Size-limit ladder, best looking first. For scans a 150 dpi copy at good
// JPEG quality looks better than a full-resolution one at heavy quality,
// and is smaller, so resolution steps sit between quality steps.
const targetLadder: Profile[] = [
  { quality: 90, dpi: 0, qfactor: 0.25 },
  { quality: 82, dpi: 0, qfactor: 0.4 },
  { quality: 72, dpi: 0, qfactor: 0.6 },
  { quality: 68, dpi: 200, qfactor: 0.4 },
  { quality: 62, dpi: 150, qfactor: 0.4 },
  { quality: 50, dpi: 150, qfactor: 0.9 },
  { quality: 40, dpi: 110, qfactor: 1.4 },
  { quality: 25, dpi: 96, qfactor: 1.4 },
];
function targetAttempts(options: CompressOptions): Profile[] {
  const rows =
    options.imageQuality === "high"
      ? targetLadder.slice(0, 2)
      : options.imageQuality === "medium"
        ? targetLadder.slice(1, 6)
        : options.imageQuality === "low"
          ? targetLadder.slice(2)
          : targetLadder;
  return [
    { quality: 101, dpi: 0 },
    ...rows.map((row) => (options.gray ? { ...row, gray: true } : row)),
  ];
}
export function attemptsFor(options: CompressOptions): Profile[] {
  if (options.target) return targetAttempts(options);
  let rows =
    options.target || options.preference === "smallest"
      ? fullResolution
      : options.preference === "quality"
        ? fullResolution.slice(0, 2)
        : fullResolution.slice(1, 3);
  if (options.imageQuality === "high")
    rows = rows.filter((row) => row.quality >= 82);
  if (options.imageQuality === "medium")
    rows = fullResolution.filter(
      (row) => row.quality >= 60 && row.quality <= 82,
    );
  if (options.imageQuality === "low")
    rows = fullResolution.filter((row) => row.quality <= 72);
  if (!rows.length) rows = [fullResolution[0]];
  // Resolution is the last resort after trying quality at original dimensions.
  if (
    (options.target || options.preference === "smallest") &&
    options.imageQuality !== "high"
  ) {
    rows = [
      ...rows,
      { quality: 35, dpi: 150, qfactor: 0.9 },
      { quality: 25, dpi: 96, qfactor: 1.4 },
    ];
  }
  // "Smallest" keeps only the smallest output, which in practice comes from
  // the most aggressive profiles; the middle of the ladder only costs time.
  if (options.preference === "smallest" && !options.target)
    rows = rows.slice(-2);
  if (options.preference === "balanced" && !options.target)
    rows = rows.map((row) => (row.dpi ? row : { ...row, dpi: SCREEN_DPI }));
  // Grayscale is lossy for color content, so there is no lossless pass.
  if (options.gray) return rows.map((row) => ({ ...row, gray: true }));
  return [{ quality: 101, dpi: 0 }, ...rows];
}

export type PageRange = { first: number; last: number };
/** Splits pages into `parts` contiguous ranges of near-equal size. */
export function splitPages(pages: number, parts: number): PageRange[] {
  const count = Math.max(1, Math.min(parts, pages));
  return Array.from({ length: count }, (_, i) => ({
    first: Math.floor((i * pages) / count) + 1,
    last: Math.floor(((i + 1) * pages) / count),
  }));
}
/** Joins already-compressed parts without touching their images again. */
export function mergeArgs(parts: number): string[] {
  const args = ghostscriptArgs({ quality: 101, dpi: 0 });
  return [
    ...args.slice(0, -1),
    ...Array.from({ length: parts }, (_, i) => `/part${i}.pdf`),
  ];
}
export function ghostscriptArgs(
  profile: Profile,
  password?: string,
  range?: PageRange,
): string[] {
  // No -q: the worker counts "Page N" lines for progress and discards the rest.
  const args = [
    "-dSAFER",
    "-dBATCH",
    "-dNOPAUSE",
    "-dPDFSTOPONERROR",
    "-sDEVICE=pdfwrite",
    "-dCompatibilityLevel=1.7",
    "-dAutoRotatePages=/None",
    "-dDetectDuplicateImages=true",
    "-dCompressFonts=true",
    "-dSubsetFonts=true",
    "-dPreserveAnnots=true",
    "-sOutputFile=/result.pdf",
    `-dDownsampleColorImages=${profile.dpi > 0}`,
    `-dDownsampleGrayImages=${profile.dpi > 0}`,
  ];
  if (password) args.push(`-sPDFPassword=${password}`);
  if (range) args.push(`-dFirstPage=${range.first}`, `-dLastPage=${range.last}`);
  if (profile.dpi)
    args.push(
      "-dColorImageDownsampleType=/Bicubic",
      "-dGrayImageDownsampleType=/Bicubic",
      `-dColorImageResolution=${profile.dpi}`,
      `-dGrayImageResolution=${profile.dpi}`,
      // Downsample anything above ~1.1x the target, not gs's default 1.5x:
      // a 300 dpi scan would otherwise be left alone at a 200 dpi target.
      "-dColorImageDownsampleThreshold=1.1",
      "-dGrayImageDownsampleThreshold=1.1",
    );
  if (profile.gray)
    args.push("-sColorConversionStrategy=Gray", "-dUseFastColor=true");
  if (profile.qfactor === undefined) {
    args.push(
      "-dPassThroughJPEGImages=true",
      "-dPassThroughJPXImages=true",
      "-dAutoFilterColorImages=false",
      "-dAutoFilterGrayImages=false",
      "-dColorImageFilter=/FlateEncode",
      "-dGrayImageFilter=/FlateEncode",
    );
  } else {
    args.push(
      "-dPassThroughJPEGImages=false",
      "-dPassThroughJPXImages=false",
      "-dAutoFilterColorImages=false",
      "-dAutoFilterGrayImages=false",
      "-dColorImageFilter=/DCTEncode",
      "-dGrayImageFilter=/DCTEncode",
      "-c",
      `<< /ColorImageDict << /QFactor ${profile.qfactor} /Blend 1 /HSamples [1 1 1 1] /VSamples [1 1 1 1] >> /GrayImageDict << /QFactor ${profile.qfactor} /Blend 1 >> >> setdistillerparams`,
      "-f",
    );
  }
  return [...args, "/input.pdf"];
}

// The pass reads the input itself, so the caller never holds a copy of
// the (possibly very large) original while passes run.
export type EnginePass = (
  profile: Profile,
  onPage: (page: number) => void,
) => Promise<{ bytes: Uint8Array; heapBytes: number }>;
export type Progress = {
  stage: "loading" | "optimizing" | "finalizing";
  /** Fraction of the planned passes, 0..1, never decreasing. */
  value: number;
  page?: number;
};
const IMAGE_HEAVY_PER_PAGE = 200 * 1024;
const WORTHWHILE = 0.1;
// Share of the progress bar for the passes; the rest is the one
// preservation check of the chosen result.
const PASS_SHARE = 0.85;
export async function compressWithGhostscript(
  inputSize: number,
  options: CompressOptions,
  onProgress: (progress: Progress) => void,
  runPass: EnginePass,
  validate: (bytes: Uint8Array, onPage: (page: number) => void) => Promise<void>,
  hasImages = true,
  pages = 1,
): Promise<RunResult> {
  let selected: Candidate | undefined;
  let attempts = 0;
  let heapBytes = 0;
  // On image-heavy scans the lossless rewrite only re-wraps the same images:
  // a whole extra engine run (and its memory) for no saving.
  const imageHeavy = inputSize / Math.max(1, pages) > IMAGE_HEAVY_PER_PAGE;
  const skipLossless =
    imageHeavy && !options.target && options.preference !== "quality";
  const profiles = !hasImages
    ? attemptsFor(options).slice(0, 1)
    : attemptsFor(options).slice(skipLossless ? 1 : 0);
  const total = Math.max(1, pages);
  let reported = 0;
  const report = (stage: Progress["stage"], value: number, page?: number) => {
    reported = Math.max(reported, Math.min(1, value));
    onProgress({ stage, value: reported, page });
  };
  // A size limit is met by a binary search over the quality-ordered ladder
  // (about 3 passes instead of up to 9); the lossless pass is only worth a
  // run when the limit is close to the original size.
  const search = Boolean(options.target) && hasImages;
  const lossless = profiles[0].quality > 100 ? profiles[0] : undefined;
  const ladder = search ? profiles.slice(lossless ? 1 : 0) : profiles;
  const tryLossless =
    search && lossless && options.target! >= inputSize * (1 - WORTHWHILE);
  const planned = search
    ? Math.ceil(Math.log2(ladder.length + 1)) + (tryLossless ? 1 : 0)
    : profiles.length;
  let smallest: Candidate | undefined;
  const pass = async (profile: Profile): Promise<Candidate | undefined> => {
    const slot = Math.min(attempts, planned - 1);
    const span = (share: number) => (PASS_SHARE * (slot + share)) / planned;
    report(attempts ? "optimizing" : "loading", span(0));
    const output = await runPass(profile, (page) =>
      report("optimizing", span(Math.min(page, total) / total), page),
    );
    attempts++;
    heapBytes = Math.max(heapBytes, output.heapBytes);
    if (output.bytes.length >= inputSize) return undefined;
    const candidate = { bytes: output.bytes, quality: profile.quality, dpi: profile.dpi, lossless: profile.quality > 100 };
    if (!smallest || candidate.bytes.length < smallest.bytes.length) smallest = candidate;
    return candidate;
  };
  if (search) {
    const target = options.target!;
    if (tryLossless) {
      const candidate = await pass(lossless!);
      if (candidate && candidate.bytes.length <= target) selected = candidate;
    }
    // Each hit moves the search toward better-looking profiles, so the last
    // hit is the best-looking result found under the limit.
    let low = 0;
    let high = ladder.length - 1;
    while (!selected?.lossless && low <= high) {
      const middle = (low + high) >> 1;
      const candidate = await pass(ladder[middle]);
      if (candidate && candidate.bytes.length <= target) {
        selected = candidate;
        high = middle - 1;
      } else low = middle + 1;
    }
    selected ??= smallest;
  } else
    for (const profile of profiles) {
      const candidate = await pass(profile);
      if (!candidate) continue;
      if (options.preference === "quality") {
        // Stop at the gentlest pass that saves something worth having; a
        // lossless rewrite that trims 0.1 MB off a 42 MB scan is not that.
        if (!selected || candidate.bytes.length < selected.bytes.length)
          selected = candidate;
        if (candidate.bytes.length <= inputSize * (1 - WORTHWHILE)) break;
      } else if (!selected || candidate.bytes.length < selected.bytes.length) {
        selected = candidate;
      }
    }
  // Only the released result needs the (slow, per-page) preservation check;
  // a failure still stops the job rather than falling back silently.
  if (selected) {
    report("finalizing", PASS_SHARE);
    await validate(selected.bytes, (page) =>
      report(
        "finalizing",
        PASS_SHARE + ((1 - PASS_SHARE) * Math.min(page, total)) / total,
        page,
      ),
    );
  }
  report("finalizing", 1);
  const size = selected?.bytes.length ?? inputSize;
  return {
    bytes: selected?.bytes,
    achieved: options.target !== undefined && size <= options.target,
    attempts,
    heapBytes,
    lossy: selected !== undefined && selected.quality <= 100,
  };
}
