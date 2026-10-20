import { startJob } from "../compress/run";

export type FileSummary = { pages: number; thumbnail?: Blob; locked?: boolean };
export function summarizeFile(file: File) {
  return startJob<FileSummary>({ file }, 60_000, undefined, () =>
    new Worker(new URL("../../workers/summary.worker.ts", import.meta.url), {
      type: "module",
    }),
  );
}
export function mergeFiles(files: File[], onProgress: (value: number) => void) {
  return startJob<{ blob: Blob; pages: number }>(
    { files },
    10 * 60_000,
    (progress) => onProgress(progress.value),
    () =>
      new Worker(new URL("../../workers/merge.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}
