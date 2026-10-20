import type { Candidate } from "../lib/pdf";

export type Preference = "quality" | "balanced" | "smallest";
export type ImageQuality = "auto" | "high" | "medium" | "low";
export type CompressOptions = {
  preference: Preference;
  imageQuality: ImageQuality;
  target?: number;
};
export type RunResult = {
  bytes: Uint8Array;
  achieved: boolean;
  attempts: number;
  heapBytes: number;
  lossy: boolean;
};
export type Profile = { quality: number; dpi: number; qfactor?: number };

const fullResolution: Profile[] = [
  { quality: 90, dpi: 0, qfactor: 0.25 },
  { quality: 82, dpi: 0, qfactor: 0.4 },
  { quality: 72, dpi: 0, qfactor: 0.6 },
  { quality: 60, dpi: 0, qfactor: 0.9 },
  { quality: 45, dpi: 0, qfactor: 1.4 },
];
export function attemptsFor(options: CompressOptions): Profile[] {
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
  return [{ quality: 101, dpi: 0 }, ...rows];
}

export function ghostscriptArgs(profile: Profile): string[] {
  const args = [
    "-q",
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
  if (profile.dpi)
    args.push(
      "-dColorImageDownsampleType=/Bicubic",
      "-dGrayImageDownsampleType=/Bicubic",
      `-dColorImageResolution=${profile.dpi}`,
      `-dGrayImageResolution=${profile.dpi}`,
    );
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

export type EnginePass = (
  input: Uint8Array,
  profile: Profile,
) => Promise<{ bytes: Uint8Array; heapBytes: number }>;
export async function compressWithGhostscript(
  input: Uint8Array,
  options: CompressOptions,
  onStage: (stage: string) => void,
  runPass: EnginePass,
  validate: (bytes: Uint8Array) => Promise<void>,
  hasImages = true,
): Promise<RunResult> {
  let selected: Candidate | undefined;
  let attempts = 0;
  let heapBytes = 0;
  const profiles = hasImages ? attemptsFor(options) : attemptsFor(options).slice(0,1);
  for (const profile of profiles) {
    onStage(attempts ? "optimizing" : "loading");
    const output = await runPass(input, profile);
    attempts++;
    heapBytes = Math.max(heapBytes, output.heapBytes);
    if (output.bytes.length >= input.length) continue;
    onStage("finalizing");
    await validate(output.bytes);
    const candidate = {
      bytes: output.bytes,
      quality: profile.quality,
      dpi: profile.dpi,
    };
    if (options.target) {
      if (!selected || candidate.bytes.length < selected.bytes.length)
        selected = candidate;
      // Profiles are ordered by preservation/quality, not expected byte size.
      if (candidate.bytes.length <= options.target) {
        selected = candidate;
        break;
      }
    } else if (options.preference === "quality") {
      selected = candidate;
      break;
    } else if (!selected || candidate.bytes.length < selected.bytes.length) {
      selected = candidate;
    }
  }
  const bytes = selected?.bytes ?? input;
  return {
    bytes,
    achieved: options.target !== undefined && bytes.length <= options.target,
    attempts,
    heapBytes,
    lossy: selected !== undefined && selected.quality <= 100,
  };
}
