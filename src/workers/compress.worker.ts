import {
  compressWithGhostscript,
  ghostscriptArgs,
  type CompressOptions,
  type EnginePass,
} from "../engines/ghostscript";
import { inspectPdf } from "../engines/validate";
import { verifyShape } from "../lib/shape";

let child: Worker | undefined;
let cancelled = false;
const runPass: EnginePass = (bytes, profile) =>
  new Promise((resolve, reject) => {
    child = new Worker(new URL("./ghostscript.worker.ts", import.meta.url), {
      type: "module",
    });
    const timeout = setTimeout(() => {
      child?.terminate();
      reject(new Error("timeout"));
    }, 120_000);
    const finish = () => {
      clearTimeout(timeout);
      child?.terminate();
      child = undefined;
    };
    child.onmessage = (event) => {
      const result = event.data;
      finish();
      if (result.type === "error") reject(new Error(result.code));
      else resolve({ bytes: result.bytes, heapBytes: result.heapBytes });
    };
    child.onerror = () => {
      finish();
      reject(new Error("initialization"));
    };
    child.postMessage({ bytes, args: ghostscriptArgs(profile) });
  });
self.onmessage = async (
  event: MessageEvent<{ type?: string; file: File; options: CompressOptions }>,
) => {
  if (event.data.type === "cancel") {
    cancelled = true;
    child?.terminate();
    self.postMessage({ type: "cancelled" });
    self.close();
    return;
  }
  try {
    self.postMessage({ type: "stage", stage: "reading" });
    const input = new Uint8Array(await event.data.file.arrayBuffer());
    if (cancelled) return;
    self.postMessage({ type: "stage", stage: "analyzing" });
    const before = await inspectPdf(input);
    if (cancelled) return;
    const result = await compressWithGhostscript(
      input,
      event.data.options,
      (stage) => self.postMessage({ type: "stage", stage }),
      runPass,
      async (bytes) => {
        const after = await inspectPdf(bytes);
        verifyShape(before, after);
      },
      before.pages.some(page=>page.imageCount>0),
    );
    if (!cancelled) {
      const { bytes, ...statistics } = result;
      self.postMessage({
        type: "result",
        result: {
          ...statistics,
          blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        },
      });
    }
  } catch (error) {
    if (!cancelled)
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "processing",
      });
  } finally {
    child?.terminate();
  }
};
