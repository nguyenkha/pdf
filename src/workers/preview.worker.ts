// A small upright preview of a photo, decoded here rather than on the page:
// a full phone photo took ~100 ms of the page's main thread in Safari.
self.onmessage = async (event: MessageEvent<{ file: File; side: number }>) => {
  try {
    const bitmap = await createImageBitmap(event.data.file);
    const scale = Math.min(1, event.data.side / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    self.postMessage({ type: "result", result: await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 }) });
  } catch {
    self.postMessage({ type: "error", message: "unsupported" });
  }
};
