import { ENGINE_BASE, type CoreFactory } from "../engines/core";

self.onmessage = async (
  event: MessageEvent<{ inputs: { path: string; blob: Blob }[]; args: string[] }>,
) => {
  try {
    const { default: createCore } = (await import(
      /* @vite-ignore */ `${ENGINE_BASE}core.js`
    )) as { default: CoreFactory };
    const load = async (init?: RequestInit) => {
      const response = await fetch(`${ENGINE_BASE}core.wasm`, init);
      if (!response.ok) throw new Error("initialization");
      return new Uint8Array(await response.arrayBuffer());
    };
    // Chrome can drop a streamed body when another fetch (the page's warm-up,
    // a sibling worker) writes the same HTTP cache entry
    // (ERR_CACHE_WRITE_FAILURE). The retry stays out of that cache.
    const wasmBinary = await load().catch(() => load({ cache: "no-store" }));
    const core = await createCore({
      wasmBinary,
      // PDFs can contain sensitive text in diagnostics. Never expose engine
      // logs; only the page number of pdfwrite's "Page N" lines leaves here.
      print: (line: string) => {
        const page = /^Page (\d+)$/.exec(line.trim());
        if (page) self.postMessage({ type: "page", page: Number(page[1]) });
      },
      printErr: () => {},
    });
    // Read the File here rather than receiving a copy: on phones every extra
    // copy of a large scan counts against the tab's memory limit.
    for (const { path, blob } of event.data.inputs)
      core.FS.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    let status = 0;
    try {
      status = core.callMain(event.data.args);
    } catch (error) {
      if (typeof error === "object" && error !== null && "status" in error) {
        status = Number(error.status);
      } else {
        throw error;
      }
    }
    if (status !== 0) throw new Error("processing");
    for (const { path } of event.data.inputs) core.FS.unlink(path);
    // readFile returns a fresh array, so it can be transferred as is.
    const bytes = core.FS.readFile("/result.pdf");
    core.FS.unlink("/result.pdf");
    self.postMessage(
      { type: "result", bytes, heapBytes: core.getHeapBytes() },
      [bytes.buffer],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    self.postMessage({
      type: "error",
      code: /memory|allocation|out of bounds/.test(message)
        ? "memory"
        : "processing",
    });
  }
};
