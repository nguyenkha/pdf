import type { CompressOptions, RunResult } from "../../engines/ghostscript";
import type { PdfSummary } from "../../engines/validate";
export type ProcessedResult = Omit<RunResult, "bytes"> & {
  blob: Blob;
  pages: number;
};
export type JobProgress = {
  stage: string;
  value: number;
  page?: number;
  pages?: number;
};
const compressWorker = () =>
  new Worker(new URL("../../workers/compress.worker.ts", import.meta.url), {
    type: "module",
  });
/**
 * Runs one request in a fresh worker. The factory keeps `new Worker(new
 * URL(...))` literal for the bundler; messages without a known type (such as
 * pdf.js announcing its in-worker fallback) are ignored.
 */
export function startJob<T>(
  message: object,
  timeoutMs: number,
  onProgress: (progress: JobProgress) => void = () => {},
  createWorker: () => Worker = compressWorker,
) {
  const worker = createWorker();
  let rejectJob: (error: Error) => void = () => {};
  let settled = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    worker.terminate();
    rejectJob(new Error("timeout"));
  }, timeoutMs);
  const finish = () => {
    settled = true;
    clearTimeout(timeout);
    clearTimeout(killTimer);
    worker.terminate();
  };
  const promise = new Promise<T>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = (event) => {
      if (event.data.type === "progress" && !settled) onProgress(event.data);
      if (event.data.type === "cancelled") finish();
      if (event.data.type === "error" && !settled) {
        finish();
        reject(new Error(event.data.message));
      }
      if (event.data.type === "result" && !settled) {
        finish();
        resolve(event.data.result);
      }
    };
    worker.onerror = () => {
      finish();
      reject(new Error("initialization"));
    };
    worker.postMessage(message);
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.postMessage({ type: "cancel" });
      // Give the responsive orchestration worker time to terminate its child.
      killTimer = setTimeout(() => worker.terminate(), 250);
      rejectJob(new Error("cancelled"));
    },
  };
}
export function runCompression(
  file: File,
  options: CompressOptions,
  onProgress: (progress: JobProgress) => void,
) {
  return startJob<ProcessedResult>(
    { type: "compress", file, options },
    // Progress shows liveness; the user can cancel a long job at any time.
    30 * 60_000,
    onProgress,
  );
}
/** Page count and support check before any options are shown. */
export function probeFile(file: File, password?: string) {
  return startJob<PdfSummary>({ type: "probe", file, password }, 60_000);
}
/** Approximate output size from a short sample run. */
export function estimateFile(file: File, options: CompressOptions, pages: number) {
  return startJob<number>({ type: "estimate", file, options, pages }, 60_000);
}
