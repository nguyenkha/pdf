import { ENGINE_BASE, type CoreFactory } from "../engines/core";

self.onmessage = async (
  event: MessageEvent<{ file: Blob; args: string[] }>,
) => {
  try {
    const { default: createCore } = (await import(
      /* @vite-ignore */ `${ENGINE_BASE}core.js`
    )) as { default: CoreFactory };
    const response = await fetch(`${ENGINE_BASE}core.wasm`);
    if (!response.ok) throw new Error("initialization");
    const core = await createCore({
      wasmBinary: new Uint8Array(await response.arrayBuffer()),
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
    core.FS.writeFile(
      "/input.pdf",
      new Uint8Array(await event.data.file.arrayBuffer()),
    );
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
    core.FS.unlink("/input.pdf");
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
