import {
  compressWithGhostscript,
  ghostscriptArgs,
  mergeArgs,
  splitPages,
  estimateProfile,
  type CompressOptions,
  type PageRange,
  type EnginePass,
} from "../engines/ghostscript";
import { inspectPdf, probePdf } from "../engines/validate";
import type { PdfShape } from "../lib/shape";
import { verifyShape } from "../lib/shape";

// Overall progress: reading and the first preservation scan, then the passes.
const READ = 0.02;
const ANALYZE = 0.12;
const MIN_SPLIT_PAGES = 12;
const children = new Set<Worker>();
let cancelled = false;
async function inspect(
  source: Blob,
  secret: string | undefined,
  onPage: (page: number, total: number) => void,
): Promise<PdfShape> {
  // pdf.js owns the buffer it is given, so this worker keeps no copy.
  return inspectPdf(new Uint8Array(await source.arrayBuffer()), secret, onPage, true);
}
let input: File | undefined;
let split: PageRange[] = [];
// One Ghostscript run in its own worker; the worker is dropped afterwards.
function runGhostscript(
  inputs: { path: string; blob: Blob }[],
  args: string[],
  onPage: () => void,
) {
  return new Promise<{ bytes: Uint8Array; heapBytes: number }>((resolve, reject) => {
    const child = new Worker(new URL("./ghostscript.worker.ts", import.meta.url), {
      type: "module",
    });
    children.add(child);
    const timeout = setTimeout(() => {
      finish();
      reject(new Error("timeout"));
    }, 120_000 + pageCount * 3_000);
    const finish = () => {
      clearTimeout(timeout);
      child.terminate();
      children.delete(child);
    };
    child.onmessage = (event) => {
      const result = event.data;
      if (result.type === "page") return onPage();
      finish();
      if (result.type === "error") reject(new Error(result.code));
      else resolve({ bytes: result.bytes, heapBytes: result.heapBytes });
    };
    child.onerror = () => {
      finish();
      reject(new Error("initialization"));
    };
    child.postMessage({ inputs, args });
  });
}
// Desktop only: page ranges run side by side, then are joined. Phones keep
// one run at a time, since every Ghostscript worker holds the whole input.
function parallelism() {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { mobile?: boolean };
  };
  const mobile =
    nav.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad/i.test(nav.userAgent);
  if (mobile) return 1;
  const cores = Math.floor((nav.hardwareConcurrency || 2) / 2);
  const memory = nav.deviceMemory ? Math.floor(nav.deviceMemory / 2) : 4;
  return Math.max(1, Math.min(4, cores, memory));
}
const runPass: EnginePass = async (profile, onPage) => {
  let done = 0;
  const page = () => onPage(++done);
  if (split.length < 2)
    return runGhostscript(
      [{ path: "/input.pdf", blob: input! }],
      ghostscriptArgs(profile, password),
      page,
    );
  const parts = await Promise.all(
    split.map((range) =>
      runGhostscript(
        [{ path: "/input.pdf", blob: input! }],
        ghostscriptArgs(profile, password, range),
        page,
      ),
    ),
  );
  const merged = await runGhostscript(
    parts.map((part, i) => ({
      path: `/part${i}.pdf`,
      blob: new Blob([part.bytes as BlobPart]),
    })),
    mergeArgs(parts.length),
    () => {},
  );
  return {
    bytes: merged.bytes,
    heapBytes: Math.max(merged.heapBytes, ...parts.map((part) => part.heapBytes)),
  };
};
let password: string | undefined;
let pageCount = 0;
type Request =
  | { type: "cancel" }
  | { type: "probe"; file: File; password?: string }
  | { type: "estimate"; file: File; options: CompressOptions; pages: number }
  | { type: "unlock"; file: File; password: string }
  | { type?: "compress"; file: File; options: CompressOptions };
self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled = true;
    for (const child of children) child.terminate();
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
    if (request.type === "unlock") {
      // Check the password with pdf.js (a clear "incorrect" error), then
      // rewrite losslessly without encryption, as compressing does. The copy
      // goes through the same preservation check: a font rewrite can lose
      // the text mapping, and the other tools copy this copy's pages as is.
      const before = await inspect(request.file, request.password, () => {});
      const output = await runGhostscript(
        [{ path: "/input.pdf", blob: request.file }],
        ghostscriptArgs({ quality: 101, dpi: 0 }, request.password),
        () => {},
      );
      const unlocked = new Blob([output.bytes as BlobPart], { type: "application/pdf" });
      verifyShape(before, await inspect(unlocked, undefined, () => {}));
      self.postMessage({ type: "result", result: unlocked });
      return;
    }
    if (request.type === "estimate") {
      // Rewrite up to two middle pages losslessly and with the likely
      // profile; their ratio scales the whole file. A ratio, not a sum, so
      // resources shared by every page (fonts, a repeated logo) cancel out.
      const { file, options, pages } = request;
      const first = Math.max(1, Math.ceil(pages / 2));
      const range = { first, last: Math.min(pages, first + 1) };
      const sample = (profile: Parameters<typeof ghostscriptArgs>[0]) =>
        runGhostscript(
          [{ path: "/input.pdf", blob: file }],
          ghostscriptArgs(profile, options.password, range),
          () => {},
        ).then((output) => output.bytes.length);
      const reference = await sample({ quality: 101, dpi: 0 });
      const compressed = await sample(estimateProfile(options));
      const sampled = range.last - range.first + 1;
      // The per-page figure caps the ratio when the source repeats images
      // that the rewrite deduplicates; neither sees document-wide repeats.
      self.postMessage({
        type: "result",
        result: Math.round(
          Math.min(
            file.size,
            (file.size * compressed) / reference,
            (compressed * pages) / sampled,
          ),
        ),
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
    // Splitting cuts bookmarks and page-to-page links, and only pays off on
    // longer documents.
    split =
      !before.linked && pages >= MIN_SPLIT_PAGES
        ? splitPages(pages, parallelism())
        : [];
    if (cancelled) return;
    let released: Blob | undefined;
    const check = async (bytes: Uint8Array, onPage: (page: number) => void) => {
      // Park the output in a Blob and check that copy in its own workers,
      // so no extra in-memory copy is held here. The output is written
      // without encryption, so it opens without a password.
      released = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const after = await inspect(released, undefined, (page) => onPage(page));
      verifyShape(before, after);
    };
    const result = await compressWithGhostscript(
      input.size,
      request.options,
      ({ stage, value, page }) =>
        progress(stage, ANALYZE + (1 - ANALYZE) * value, page, pages),
      runPass,
      check,
      before.pages.some((page) => (page.imageCount ?? 0) > 0),
      pages,
    ).catch(async (error) => {
      // A full rewrite changed what the document says (a font lost its text
      // mapping): try re-encoding only its JPEG images, keeping fonts and
      // text as they are. pdf-lib loads only for this.
      if (!(error instanceof Error) || error.message !== "preservation" || password || cancelled) throw error;
      progress("optimizing", ANALYZE, undefined, pages);
      const { compressImagesOnly } = await import("../engines/images-only");
      const fallback = await compressImagesOnly(new Uint8Array(await input!.arrayBuffer()), request.options, (bytes) =>
        check(bytes, (page) => progress("finalizing", ANALYZE + ((1 - ANALYZE) * page) / pages, page, pages)),
      );
      // Nothing worth releasing: the original rewrite's verdict stands.
      if (!fallback.bytes) throw error;
      return fallback;
    });
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
    for (const child of children) child.terminate();
  }
};
