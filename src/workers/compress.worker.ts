import {
  compressWithGhostscript,
  ghostscriptArgs,
  type CompressOptions,
  type EnginePass,
} from "../engines/ghostscript";
import { inspectPdf, probePdf } from "../engines/validate";
import type { PdfShape } from "../lib/shape";
import { verifyShape } from "../lib/shape";

// Overall progress: reading and the first preservation scan, then the passes.
const READ = 0.02;
const ANALYZE = 0.12;
let child: Worker | undefined;
let cancelled = false;
let input: File | undefined;
async function inspect(
  source: Blob,
  secret: string | undefined,
  onPage: (page: number, total: number) => void,
): Promise<PdfShape> {
  // pdf.js owns the buffer it is given, so this worker keeps no copy.
  return inspectPdf(new Uint8Array(await source.arrayBuffer()), secret, onPage, true);
}
const runPass: EnginePass = (profile, onPage) =>
  new Promise((resolve, reject) => {
    child = new Worker(new URL("./ghostscript.worker.ts", import.meta.url), {
      type: "module",
    });
    const timeout = setTimeout(() => {
      child?.terminate();
      reject(new Error("timeout"));
    }, 120_000 + pageCount * 3_000);
    const finish = () => {
      clearTimeout(timeout);
      child?.terminate();
      child = undefined;
    };
    child.onmessage = (event) => {
      const result = event.data;
      if (result.type === "page") return onPage(result.page);
      finish();
      if (result.type === "error") reject(new Error(result.code));
      else resolve({ bytes: result.bytes, heapBytes: result.heapBytes });
    };
    child.onerror = () => {
      finish();
      reject(new Error("initialization"));
    };
    child.postMessage({ file: input, args: ghostscriptArgs(profile, password) });
  });
let password: string | undefined;
let pageCount = 0;
type Request =
  | { type: "cancel" }
  | { type: "probe"; file: File; password?: string }
  | { type?: "compress"; file: File; options: CompressOptions };
self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled = true;
    child?.terminate();
    self.postMessage({ type: "cancelled" });
    self.close();
    return;
  }
  try {
    if (request.type === "probe") {
      const input = new Uint8Array(await request.file.arrayBuffer());
      self.postMessage({
        type: "result",
        result: await probePdf(input, request.password),
      });
      return;
    }
    password = request.options.password;
    const progress = (stage: string, value: number, page?: number, pages?: number) =>
      self.postMessage({ type: "progress", stage, value, page, pages });
    progress("reading", 0);
    input = request.file;
    if (cancelled) return;
    progress("analyzing", READ);
    const before = await inspect(input, password, (page, pages) =>
      progress("analyzing", READ + ((ANALYZE - READ) * page) / pages, page, pages),
    );
    const pages = before.pages.length;
    pageCount = pages;
    if (cancelled) return;
    let released: Blob | undefined;
    const result = await compressWithGhostscript(
      input.size,
      request.options,
      ({ stage, value, page }) =>
        progress(stage, ANALYZE + (1 - ANALYZE) * value, page, pages),
      runPass,
      async (bytes, onPage) => {
        // Park the output in a Blob and check that copy in its own workers,
        // so no extra in-memory copy is held here. The output is written
        // without encryption, so it opens without a password.
        released = new Blob([bytes as BlobPart], { type: "application/pdf" });
        const after = await inspect(released, undefined, (page) => onPage(page));
        verifyShape(before, after);
      },
      before.pages.some((page) => (page.imageCount ?? 0) > 0),
      pages,
    );
    if (!cancelled) {
      const { bytes, ...statistics } = result;
      self.postMessage({
        type: "result",
        result: {
          ...statistics,
          pages,
          blob: bytes && released ? released : input,
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
