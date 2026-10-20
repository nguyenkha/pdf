export const LARGE_FILE_BYTES = 80 * 1024 * 1024;
export function formatSize(bytes: number, locale = "en"): string {
  const unit = bytes >= 1048576 ? "MB" : bytes >= 1024 ? "KB" : "B";
  const value =
    unit === "MB" ? bytes / 1048576 : unit === "KB" ? bytes / 1024 : bytes;
  return (
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: unit === "B" ? 0 : 1,
    }).format(value) +
    " " +
    unit
  );
}
export function savings(original: number, output: number): number {
  return original > 0
    ? Math.max(0, Math.round((1 - output / original) * 100))
    : 0;
}
export function targetBytes(
  value: string,
  unit: "KB" | "MB",
): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0
    ? Math.round(n * (unit === "MB" ? 1048576 : 1024))
    : undefined;
}
export function validateFile(file: File): "invalid" | undefined {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf")
    return "invalid";
  if (file.size < 8) return "invalid";
}
export type Candidate = {
  bytes: Uint8Array;
  quality: number;
  dpi: number;
  lossless?: boolean;
};
export function chooseCandidate(
  candidates: Candidate[],
  originalSize: number,
  target?: number,
): Candidate | undefined {
  const smaller = candidates.filter((c) => c.bytes.length < originalSize);
  if (!smaller.length) return undefined;
  const eligible = target
    ? smaller.filter((c) => c.bytes.length <= target)
    : smaller;
  if (target && !eligible.length)
    return [...smaller].sort((a, b) => a.bytes.length - b.bytes.length)[0];
  const pool = eligible.length ? eligible : smaller;
  return [...pool].sort(
    (a, b) =>
      b.quality - a.quality || b.dpi - a.dpi || a.bytes.length - b.bytes.length,
  )[0];
}
export function outputName(name: string): string {
  return name.replace(/\.pdf$/i, "") + "-compressed.pdf";
}
