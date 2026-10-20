import type { CompressOptions, RunResult } from "../../engines/ghostscript";
export type ProcessedResult = Omit<RunResult, "bytes"> & { blob: Blob };
export function runCompression(
  file: File,
  options: CompressOptions,
  onStage: (stage: string) => void,
) {
  const worker = new Worker(
    new URL("../../workers/compress.worker.ts", import.meta.url),
    { type: "module" },
  );
  let rejectJob: (error: Error) => void = () => {};
  let settled = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    worker.terminate();
    rejectJob(new Error("timeout"));
  }, 5 * 60_000);
  const finish = () => {
    settled = true;
    clearTimeout(timeout);
    clearTimeout(killTimer);
    worker.terminate();
  };
  const promise = new Promise<ProcessedResult>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = (event) => {
      if (event.data.type === "stage" && !settled) onStage(event.data.stage);
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
    worker.postMessage({ file, options });
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
