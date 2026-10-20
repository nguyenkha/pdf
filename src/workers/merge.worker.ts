import { mergePdfs } from "../engines/merge";
import { withoutSignatures } from "../engines/signatures";

// pdf-lib lives only in this worker, which starts when the user merges (or
// asks to compress a signed PDF without its signatures).
self.onmessage = async (event: MessageEvent<{ files: File[]; type?: "signatures" }>) => {
  const { files } = event.data;
  try {
    if (event.data.type === "signatures") {
      const bytes = await withoutSignatures(new Uint8Array(await files[0].arrayBuffer()));
      self.postMessage({ type: "result", result: new Blob([bytes as BlobPart], { type: "application/pdf" }) });
      return;
    }
    const sources = [];
    // pdf-lib needs the bytes of every source; read them one at a time.
    for (const [index, file] of files.entries()) {
      self.postMessage({ type: "progress", value: (index / files.length) * 0.4 });
      sources.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    const { bytes, pages, signed } = await mergePdfs(sources, (index) =>
      self.postMessage({ type: "progress", value: 0.4 + (index / files.length) * 0.6 }),
    );
    self.postMessage({
      type: "result",
      result: { blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), pages, signed },
    });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "processing" });
  }
};
