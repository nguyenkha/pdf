import {
  concatTransformationMatrix,
  degrees,
  drawObject,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  type PDFImage,
} from "pdf-lib";

export type PageSize = "a4" | "letter" | "fit";
/** An image ready for pdf-lib: JPEG bytes go in as they are, PNG is decoded. */
export type ImageSource = {
  bytes: Uint8Array;
  kind: "jpg" | "png";
  /** EXIF orientation of a JPEG (1-8): how to turn or mirror it upright. */
  orientation: number;
  /** The person's extra turn, stored as the page's rotation. */
  rotate: number;
};
const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;
// "fit" pages are the image at 96 dpi, at most A4's long side.
const FIT_LONG_SIDE = 841.89;

// Where each EXIF orientation puts a stored point (s across, t down, 0..1)
// in the upright picture (x across, y down).
const UPRIGHT: Record<number, (s: number, t: number) => [number, number]> = {
  1: (s, t) => [s, t],
  2: (s, t) => [1 - s, t],
  3: (s, t) => [1 - s, 1 - t],
  4: (s, t) => [s, 1 - t],
  5: (s, t) => [t, s],
  6: (s, t) => [1 - t, s],
  7: (s, t) => [1 - t, 1 - s],
  8: (s, t) => [t, 1 - s],
};

/** One page per image, in order, each image as large as its page allows. */
export async function imagesToPdf(
  sources: ImageSource[],
  size: PageSize,
  onImage: (index: number) => void = () => {},
): Promise<Uint8Array> {
  // No creation date: the file does not say when the photos were turned into it.
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const [index, source] of sources.entries()) {
    onImage(index);
    let image: PDFImage;
    try {
      image = source.kind === "jpg" ? await doc.embedJpg(source.bytes) : await doc.embedPng(source.bytes);
    } catch {
      throw new Error(`image:${index}`);
    }
    // The upright size, after the EXIF orientation.
    const upright = UPRIGHT[source.orientation] ?? UPRIGHT[1];
    const sideways = source.orientation >= 5 && source.orientation <= 8;
    const [width, height] = sideways ? [image.height, image.width] : [image.width, image.height];
    let pageWidth: number;
    let pageHeight: number;
    if (size === "fit") {
      const scale = Math.min(0.75, FIT_LONG_SIDE / Math.max(width, height));
      [pageWidth, pageHeight] = [width * scale, height * scale];
    } else {
      // The page takes the image's orientation.
      const [short, long] = SIZES[size];
      [pageWidth, pageHeight] = width > height ? [long, short] : [short, long];
    }
    const scale = Math.min(pageWidth / width, pageHeight / height);
    const [drawnWidth, drawnHeight] = [width * scale, height * scale];
    const x = (pageWidth - drawnWidth) / 2;
    const y = (pageHeight - drawnHeight) / 2;
    const page = doc.addPage([pageWidth, pageHeight]);
    // The image's unit square (u right, v up; its first row is at v = 1)
    // mapped onto the drawn area, turned and mirrored as EXIF says.
    const point = (u: number, v: number) => {
      const [across, down] = upright(u, 1 - v);
      return [x + across * drawnWidth, y + (1 - down) * drawnHeight];
    };
    const [e, f] = point(0, 0);
    const [ux, uy] = point(1, 0);
    const [vx, vy] = point(0, 1);
    const name = page.node.newXObject("Image", image.ref);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(ux - e, uy - f, vx - e, vy - f, e, f),
      drawObject(name),
      popGraphicsState(),
    );
    if (source.rotate % 360) page.setRotation(degrees(source.rotate % 360));
  }
  doc.setProducer("pdf.kha.do");
  doc.setCreator("pdf.kha.do");
  return doc.save({ useObjectStreams: true });
}
