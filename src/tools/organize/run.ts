import { startJob } from "../compress/run";
import type { PagePlan } from "../../engines/merge";

/** The arranged copy, built with pdf-lib in the merge worker. */
export function organizeFile(file: File, plan: PagePlan[]) {
  return startJob<{ blob: Blob; pages: number; signed: boolean }>(
    { type: "organize", files: [file], plan },
    10 * 60_000,
    undefined,
    () =>
      new Worker(new URL("../../workers/merge.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}
/**
 * Page count, then one preview per page as it is drawn. Previews arrive as
 * Blobs; the caller owns any object URLs it makes from them.
 */
export function readPages(
  file: File,
  limit: number,
  onPages: (count: number) => void,
  onThumbnail: (index: number, thumbnail: Blob) => void,
) {
  const worker = new Worker(new URL("../../workers/pages.worker.ts", import.meta.url), {
    type: "module",
  });
  const promise = new Promise<void>((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === "pages") onPages(data.count);
      else if (data.type === "thumbnail") onThumbnail(data.index, data.thumbnail);
      else if (data.type === "result") {
        worker.terminate();
        resolve();
      } else if (data.type === "error") {
        worker.terminate();
        reject(new Error(data.message));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("initialization"));
    };
  });
  worker.postMessage({ file, limit });
  return { promise, cancel: () => worker.terminate() };
}
