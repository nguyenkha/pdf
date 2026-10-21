import {
  imagesToPdf,
  isJpeg,
  isPng,
  jpegOrientation,
  stripJpegMetadata,
  TURNS,
  type ImageSource,
  type PageSize,
} from "../engines/images";

type Item = { file: File; rotate: number };
// Photos in other formats (WebP, HEIC where the browser reads it, GIF, BMP,
// AVIF) and mirrored JPEGs are redrawn upright; JPEG and PNG go in as they
// are. Neither path carries camera metadata (EXIF, GPS) into the PDF: JPEG
// metadata segments are dropped, PNG and redrawn images are decoded pixels.
async function redraw(file: File, index: number): Promise<ImageSource> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`unsupported:${index}`);
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("memory");
  const flat = /gif|bmp/i.test(file.type);
  if (!flat) {
    // JPEG has no transparency: see-through areas become white, not black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvas.convertToBlob(flat ? { type: "image/png" } : { type: "image/jpeg", quality: 0.92 });
  canvas.width = canvas.height = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), kind: flat ? "png" : "jpg", turn: 0, rotate: 0 };
}
async function prepare({ file, rotate }: Item, index: number): Promise<ImageSource> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isPng(bytes)) return { bytes, kind: "png", turn: 0, rotate };
  if (isJpeg(bytes)) {
    const turn = TURNS[jpegOrientation(bytes)];
    // Read the turn first: it lives in the EXIF segment that is dropped.
    if (turn !== undefined) return { bytes: stripJpegMetadata(bytes), kind: "jpg", turn, rotate };
  }
  return { ...(await redraw(file, index)), rotate };
}
self.onmessage = async (event: MessageEvent<{ items: Item[]; size: PageSize }>) => {
  const { items, size } = event.data;
  try {
    const sources: ImageSource[] = [];
    for (const [index, item] of items.entries()) {
      self.postMessage({ type: "progress", value: (index / items.length) * 0.5 });
      sources.push(await prepare(item, index));
    }
    const redrawn = new Set<number>();
    let bytes: Uint8Array | undefined;
    while (!bytes) {
      try {
        bytes = await imagesToPdf(sources, size, (index) =>
          self.postMessage({ type: "progress", value: 0.5 + (index / items.length) * 0.5 }),
        );
      } catch (error) {
        // A JPEG or PNG pdf-lib cannot read (rare encodings) is redrawn once.
        const [kind, at] = error instanceof Error ? error.message.split(":") : [];
        const index = Number(at);
        if (kind !== "image" || redrawn.has(index)) throw error;
        redrawn.add(index);
        sources[index] = { ...(await redraw(items[index].file, index)), rotate: items[index].rotate };
      }
    }
    self.postMessage({
      type: "result",
      result: { blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), pages: items.length },
    });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "processing" });
  }
};
