import { pageThumbnails } from "../engines/validate";

// Page count, then a preview per page as each is drawn, for arranging pages.
self.onmessage = async (event: MessageEvent<{ file: File; limit: number }>) => {
  try {
    await pageThumbnails(
      new Uint8Array(await event.data.file.arrayBuffer()),
      (count) => self.postMessage({ type: "pages", count }),
      (index, thumbnail) => self.postMessage({ type: "thumbnail", index, thumbnail }),
      event.data.limit,
    );
    self.postMessage({ type: "result", result: true });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "processing" });
  }
};
