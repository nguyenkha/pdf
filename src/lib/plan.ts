import type { Preference } from "../engines/ghostscript";

export type Goal = "recommended" | "quality" | "smallest" | "limit";
const MB = 1048576;
// Common upload ceilings: web forms and portals 1-5 MB, email 20-25 MB.
export const LIMITS_MB = [0.5, 1, 2, 5, 10, 20] as const;
// Above this many bytes per page, images dominate and recompression pays off.
const IMAGE_HEAVY_PER_PAGE = 200 * 1024;
// A rough floor for screen-resolution pages with images (~150 dpi JPEG).
const REACHABLE_PER_PAGE = 100 * 1024;

export function recommendedPreference(
  size: number,
  pages: number,
  hasImages: boolean,
): Preference {
  return hasImages && size / Math.max(1, pages) > IMAGE_HEAVY_PER_PAGE
    ? "balanced"
    : "quality";
}
/** Limits worth offering: strictly smaller than the file, smallest first. */
export function limitChoices(size: number): number[] {
  return LIMITS_MB.map((mb) => mb * MB).filter((bytes) => bytes < size);
}
/** The tightest common limit the document can plausibly reach. */
export function suggestedLimit(size: number, pages: number): number | undefined {
  const choices = limitChoices(size);
  return (
    choices.find((bytes) => bytes >= pages * REACHABLE_PER_PAGE) ??
    choices.at(-1)
  );
}
