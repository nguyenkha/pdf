import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { createWorker } from "tesseract.js";

/** The text in an image, read with the OCR engine the Markdown tool uses. */
async function readText(image: Buffer) {
  const worker = await createWorker("eng", 1, {
    langPath: "node_modules/@tesseract.js-data/eng/4.0.0_best_int",
    gzip: true,
    cacheMethod: "none",
  });
  try {
    return (await worker.recognize(image)).data.text;
  } finally {
    await worker.terminate();
  }
}

/** Entries of a store-only ZIP, as zipBlobs writes them. */
function unzip(bytes: Buffer) {
  const entries: { name: string; data: Buffer }[] = [];
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extra = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extra;
    entries.push({ name: bytes.subarray(offset + 30, offset + 30 + nameLength).toString(), data: bytes.subarray(start, start + size) });
    offset = start + size;
  }
  return entries;
}
/** Width and height from a JPEG's frame header. */
function jpegSize(bytes: Buffer) {
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1];
    if (marker >= 0xc0 && marker <= 0xc2) return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
}
/** A photo drawn in the page: blue, red on the left half (or only the top-left quarter). */
async function photo(page: Page, type: "image/jpeg" | "image/png", width: number, height: number, corner = false) {
  const data = await page.evaluate(
    async ({ type, width, height, corner }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#1d4ed8";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#dc2626";
      context.fillRect(0, 0, width / 2, corner ? height / 2 : height);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, 0.9));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { type, width, height, corner },
  );
  return Buffer.from(data);
}
/** The same JPEG with an EXIF segment saying "turn 90° clockwise to view". */
function withOrientation(jpeg: Buffer, orientation: number) {
  const tiff = Buffer.alloc(26);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const header = Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]);
  return Buffer.concat([jpeg.subarray(0, 2), header, body, jpeg.subarray(2)]);
}

test.describe("PDF to JPG", () => {
  test("converts the picked pages to a ZIP of JPGs, sending nothing", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/en/pdf-to-jpg/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Convert PDF to JPG without uploading");
    const origin = new URL(page.url()).origin;
    const requests: { url: string; method: string }[] = [];
    page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
    await page.locator("input[type=file]").setInputFiles("tests/fixtures/multipage.pdf");
    await expect(page.locator(".pick-grid img")).toHaveCount(3, { timeout: 30000 });
    await expect(page.getByText("Pages selected: 3 of 3")).toBeVisible();
    await page.getByRole("button", { name: "Page 2", exact: true }).click();
    await expect(page.getByRole("button", { name: "Page 2", exact: true })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Convert 2 pages to JPG" }).click();
    await expect(page.getByRole("heading", { name: "Converted 2 pages to JPG" })).toBeVisible({ timeout: 60000 });
    await expect(page.locator(".image-results li")).toHaveCount(2);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download all (.zip)" }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe("multipage-jpg.zip");
    const entries = unzip(await readFile((await saved.path())!));
    expect(entries.map((entry) => entry.name)).toEqual(["multipage-1.jpg", "multipage-3.jpg"]);
    // A4 at 150 dpi.
    expect(jpegSize(entries[0].data)).toEqual([1240, 1754]);
    expect(requests.filter(({ method }) => method !== "GET")).toEqual([]);
    expect(requests.filter(({ url }) => !url.startsWith(origin) && !url.startsWith("blob:") && !url.startsWith("data:"))).toEqual([]);
    // Back to the pages keeps the file and the choice.
    await page.getByRole("button", { name: "Change pages or format" }).click();
    await expect(page.getByText("Pages selected: 2 of 3")).toBeVisible();
  });
  test("saves one page as a PNG at high resolution", async ({ page }) => {
    test.setTimeout(60000);
    await page.goto("/en/pdf-to-jpg/");
    await page.locator("input[type=file]").setInputFiles("tests/fixtures/text-vector.pdf");
    await page.getByRole("button", { name: "PNG" }).click();
    await page.getByRole("button", { name: "High (300 dpi)" }).click();
    await page.getByRole("button", { name: "Convert 1 page to PNG" }).click();
    await expect(page.getByRole("heading", { name: "Converted 1 page to PNG" })).toBeVisible({ timeout: 60000 });
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download PNG" }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe("text-vector-1.png");
    const bytes = await readFile((await saved.path())!);
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([2479, 3508]);
    // Text is drawn as letters: the worker has no document for PDF fonts,
    // and without glyph paths every letter came out as an empty box.
    expect(await readText(bytes)).toContain("Selectable page 1");
  });
  test("unlocks a password-protected PDF first", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/en/pdf-to-jpg/");
    await page.locator("input[type=file]").setInputFiles("tests/fixtures/password.pdf");
    await page.getByLabel("PDF password").fill("secret");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.locator(".pick-grid li")).toHaveCount(3, { timeout: 60000 });
    await page.getByRole("button", { name: "Select none" }).click();
    await expect(page.getByRole("button", { name: /Convert/ })).toBeDisabled();
    await page.getByRole("button", { name: "Page 1", exact: true }).click();
    await page.getByRole("button", { name: "Convert 1 page to JPG" }).click();
    await expect(page.getByRole("link", { name: "Download JPG" })).toBeVisible({ timeout: 60000 });
  });
});

test.describe("JPG to PDF", () => {
  test("keeps JPG bytes, turns phone photos upright and sends nothing", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/en/jpg-to-pdf/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Convert JPG to PDF without uploading");
    const origin = new URL(page.url()).origin;
    const requests: { url: string; method: string }[] = [];
    page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
    // Stored sideways (200x100) with "turn 90°": upright it is portrait.
    const sideways = withOrientation(await photo(page, "image/jpeg", 200, 100), 6);
    const wide = await photo(page, "image/png", 300, 120);
    await page.locator("input[type=file]").setInputFiles([
      { name: "b-wide.png", mimeType: "image/png", buffer: wide },
      { name: "a-phone.jpg", mimeType: "image/jpeg", buffer: sideways },
    ]);
    await expect(page.locator(".page-grid img")).toHaveCount(2, { timeout: 30000 });
    await page.getByRole("button", { name: "Sort by name" }).click();
    await expect(page.locator(".image-name")).toHaveText(["a-phone.jpg", "b-wide.png"]);
    await page.getByRole("button", { name: "Rotate b-wide.png" }).click();
    await page.getByRole("button", { name: "A4" }).click();
    await page.getByRole("button", { name: "Create PDF from 2 images" }).click();
    await expect(page.getByRole("heading", { name: "PDF created" })).toBeVisible({ timeout: 60000 });
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download PDF" }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe("a-phone.pdf");
    const bytes = await readFile((await saved.path())!);
    // The photo's image data is in the PDF byte for byte, not recompressed,
    // and its EXIF segment (where phones keep the GPS position) is not.
    const scan = sideways.subarray(sideways.indexOf(Buffer.from([0xff, 0xda])));
    expect(bytes.includes(scan)).toBe(true);
    expect(bytes.includes(Buffer.from("Exif\0\0", "latin1"))).toBe(false);
    const doc = await PDFDocument.load(bytes);
    const pages = doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight()), p.getRotation().angle]);
    expect(pages).toEqual([
      [595, 842, 0],
      [842, 595, 90],
    ]);
    expect(requests.filter(({ method }) => method !== "GET")).toEqual([]);
    expect(requests.filter(({ url }) => !url.startsWith(origin) && !url.startsWith("blob:") && !url.startsWith("data:"))).toEqual([]);
    await expect(page.getByRole("button", { name: "Compress this PDF" })).toBeVisible();
  });
  test("every EXIF orientation lands upright on the page, without redrawing", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/en/jpg-to-pdf/");
    // Red is the stored top-left quarter of a wide photo; each orientation
    // moves it to its own corner and shape.
    const jpeg = await photo(page, "image/jpeg", 200, 100, true);
    const orientations = [1, 2, 3, 4, 5, 6, 7, 8];
    await page.locator("input[type=file]").setInputFiles(
      orientations.map((orientation) => ({
        name: `turn-${orientation}.jpg`,
        mimeType: "image/jpeg",
        buffer: withOrientation(jpeg, orientation),
      })),
    );
    await expect(page.locator(".page-grid img")).toHaveCount(8, { timeout: 30000 });
    await page.getByRole("button", { name: "Same as image" }).click();
    await page.getByRole("button", { name: "Create PDF from 8 images" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download PDF" }).click();
    const pdf = await readFile((await (await download).path())!);
    // Mirrored ones too: the image data is the original, not a redrawn copy.
    expect(pdf.includes(jpeg.subarray(jpeg.indexOf(Buffer.from([0xff, 0xda]))))).toBe(true);
    // Drawn back with the PDF to JPG tool, then sampled.
    await page.goto("/en/pdf-to-jpg/");
    await page.locator("input[type=file]").setInputFiles({ name: "turned.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.getByRole("button", { name: "PNG" }).click();
    await page.getByRole("button", { name: "Convert 8 pages to PNG" }).click();
    await expect(page.locator(".image-results a")).toHaveCount(8, { timeout: 60000 });
    const red = await page.locator(".image-results a").evaluateAll(async (links) =>
      Promise.all(
        links.map(async (link) => {
          // CSP allows blob: images but not fetch(blob:).
          const bitmap = new Image();
          bitmap.src = (link as HTMLAnchorElement).href;
          await bitmap.decode();
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext("2d")!;
          context.drawImage(bitmap, 0, 0);
          const at = (x: number, y: number) =>
            context.getImageData(Math.floor(bitmap.width * x), Math.floor(bitmap.height * y), 1, 1).data[0] > 150;
          // Red in the centers of the four quarters: top-left, top-right, bottom-left, bottom-right.
          return [at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75), bitmap.width > bitmap.height];
        }),
      ),
    );
    // [top-left, top-right, bottom-left, bottom-right, wide] per orientation 1-8.
    expect(red).toEqual([
      [true, false, false, false, true],
      [false, true, false, false, true],
      [false, false, false, true, true],
      [false, false, true, false, true],
      [true, false, false, false, false],
      [false, true, false, false, false],
      [false, false, false, true, false],
      [false, false, true, false, false],
    ]);
  });
  test("leaves a motion photo's video and HDR extras out of the PDF", async ({ page }) => {
    test.setTimeout(60000);
    await page.goto("/en/jpg-to-pdf/");
    const jpeg = await photo(page, "image/jpeg", 120, 80);
    const trailer = Buffer.from("....ftypmp42 motion photo video with Exif GPS 1.2903N", "latin1");
    await page.locator("input[type=file]").setInputFiles({
      name: "PXL_motion.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.concat([withOrientation(jpeg, 1), trailer]),
    });
    await expect(page.locator(".page-grid img")).toHaveCount(1, { timeout: 30000 });
    await page.getByRole("button", { name: "Create PDF", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download PDF" }).click();
    const pdf = await readFile((await (await download).path())!);
    expect(pdf.includes(Buffer.from("ftypmp42", "latin1"))).toBe(false);
    expect(pdf.includes(Buffer.from("Exif", "latin1"))).toBe(false);
  });
  test("leaves out images the browser cannot open", async ({ page }) => {
    test.setTimeout(60000);
    await page.goto("/en/jpg-to-pdf/");
    await page.locator("input[type=file]").setInputFiles([
      { name: "IMG_0001.heic", mimeType: "image/heic", buffer: Buffer.from("not really a photo") },
      { name: "ok.png", mimeType: "image/png", buffer: await photo(page, "image/png", 40, 40) },
    ]);
    await expect(page.getByText("Can't open here")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/HEIC photos open in Safari/)).toBeVisible();
    await page.getByRole("button", { name: "Create PDF", exact: true }).click();
    await expect(page.getByRole("heading", { name: "PDF created" })).toBeVisible({ timeout: 60000 });
    await expect(page.locator(".outcome p")).toContainText("1 pages");
  });
  test("offers the other tool for files of the wrong kind, and goes back from the result", async ({ page, browserName }) => {
    test.setTimeout(90000);
    await page.goto("/en/jpg-to-pdf/");
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await page.locator("input[type=file]").setInputFiles("tests/fixtures/text-vector.pdf");
    await expect(page.getByText("That's a PDF. Turn its pages into images instead?")).toBeVisible();
    // The PDF goes along, already chosen (hand-over needs a service worker).
    if (browserName === "chromium") {
      await page.getByRole("button", { name: "PDF → image" }).click();
      await expect(page).toHaveURL(/\/en\/pdf-to-jpg\//);
      await expect(page.locator(".file-details strong")).toHaveText("text-vector.pdf", { timeout: 30000 });
    }
    await page.goto("/en/pdf-to-jpg/");
    await page.locator("input[type=file]").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: await photo(page, "image/png", 40, 30) });
    await expect(page.getByText("Those are images. Put them into a PDF instead?")).toBeVisible();
    // Camera-style names carry the capture time: the PDF gets a neutral one.
    await page.goto("/en/jpg-to-pdf/");
    await page.locator("input[type=file]").setInputFiles({ name: "PXL_20261021_143002123.png", mimeType: "image/png", buffer: await photo(page, "image/png", 40, 30) });
    await page.getByRole("button", { name: "Create PDF", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download PDF" }).click();
    expect((await download).suggestedFilename()).toBe("images.pdf");
    await page.getByRole("button", { name: "Change order or page size" }).click();
    await expect(page.locator(".page-grid li")).toHaveCount(1);
  });
  test("keyboard focus stays in the list after removing an image", async ({ page }) => {
    await page.goto("/en/jpg-to-pdf/");
    await page.locator("input[type=file]").setInputFiles(
      ["a.png", "b.png"].map((name) => ({ name, mimeType: "image/png", buffer: Buffer.from(PNG_1X1, "base64") })),
    );
    await page.getByRole("button", { name: "Remove a.png" }).click();
    await expect(page.getByRole("button", { name: "Remove b.png" })).toBeFocused();
  });
});
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("landing pages run the same tools with their own words and link each other", async ({ page }) => {
  await page.goto("/en/pdf-to-png/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Convert PDF to PNG without uploading");
  await expect(page.locator(".tool-switcher > a")).toHaveText("PDF → image");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/text-vector.pdf");
  // PNG is already chosen on the PNG page.
  await expect(page.getByRole("button", { name: "PNG", exact: true })).toHaveAttribute("aria-pressed", "true");
  const related = page.getByRole("navigation", { name: "Related" });
  await expect(related.getByRole("link", { name: "PDF → PNG" })).toHaveAttribute("aria-current", "page");
  await expect(related.getByRole("link")).toHaveText(["PDF → JPG", "PDF → PNG", "PDF → image", "JPG → PDF", "PNG → PDF", "Image → PDF"]);
  // Crawlers get the same links without running the app.
  const html = await (await page.request.get("/vi/png-to-pdf/")).text();
  for (const slug of ["jpg-to-pdf", "image-to-pdf", "pdf-to-jpg", "pdf-to-png", "pdf-to-image"])
    expect(html).toContain(`href="/vi/${slug}/"`);
  expect(html).toContain('<link rel="canonical" href="https://pdf.kha.do/vi/png-to-pdf/"');
  await page.goto("/en/png-to-pdf/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Convert PNG to PDF without uploading");
  await expect(page.locator("input[type=file]")).toHaveAttribute("accept", "image/*");
});
