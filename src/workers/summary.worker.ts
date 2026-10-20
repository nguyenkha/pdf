import { firstPage } from "../engines/validate";

// Page count and first-page preview for a file list; started on the first
// file a user adds.
self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const result = await firstPage(new Uint8Array(await event.data.file.arrayBuffer()));
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "processing" });
  }
};
