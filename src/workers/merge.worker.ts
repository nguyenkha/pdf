import { mergePdfs } from "../engines/merge";

// pdf-lib lives only in this worker, which starts when the user merges.
self.onmessage = async (event: MessageEvent<{ files: File[] }>) => {
  const { files } = event.data;
  try {
    const sources = [];
    // pdf-lib needs the bytes of every source; read them one at a time.
    for (const [index, file] of files.entries()) {
      self.postMessage({ type: "progress", value: (index / files.length) * 0.4 });
      sources.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    const bytes = await mergePdfs(sources, (index) =>
      self.postMessage({ type: "progress", value: 0.4 + (index / files.length) * 0.6 }),
    );
    self.postMessage({
      type: "result",
      result: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "processing" });
  }
};
