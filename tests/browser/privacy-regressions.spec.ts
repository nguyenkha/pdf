import { expect, test, type Page } from "@playwright/test";
import { concatTransformationMatrix, drawObject, PDFDocument, popGraphicsState, pushGraphicsState } from "pdf-lib";

test("Markdown keeps high-resolution scan images without full-size RGBA buffers", async ({ page }) => {
  const doc = await PDFDocument.create();
  const pdfPage = doc.addPage([400, 600]);
  pdfPage.drawText("High resolution scan", { x: 20, y: 560, size: 14 });
  const image = doc.context.register(doc.context.flateStream(new Uint8Array(2_500_000).fill(255), {
    Type: "XObject", Subtype: "Image", Width: 4000, Height: 5000, ColorSpace: "DeviceGray", BitsPerComponent: 1,
  }));
  const key = pdfPage.node.newXObject("Scan", image);
  pdfPage.pushOperators(pushGraphicsState(), concatTransformationMatrix(400, 0, 0, 500, 0, 0), drawObject(key), popGraphicsState());
  await page.goto("/en/markdown/");
  await page.locator("input[type=file]").setInputFiles({ name: "high-resolution.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
  await expect(page.locator(".md-preview")).toContainText("High resolution scan");
  await expect(page.locator(".md-preview img")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const tool of ["organize", "markdown"]) {
  test(`${tool}: replacing a PDF cancels an outstanding unlock`, async ({ page }) => {
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        postMessage(message: unknown, transfer?: Transferable[]) {
          if ((message as { type?: string })?.type === "unlock")
            setTimeout(() => super.postMessage(message, transfer ?? []), 1500);
          else super.postMessage(message, transfer ?? []);
        }
      };
    });
    await page.goto(`/en/${tool}/`);
    await page.locator("input[type=file]").setInputFiles("tests/fixtures/password.pdf");
    await page.getByLabel("PDF password", { exact: true }).fill("secret");
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await page.locator("input[type=file]").setInputFiles("tests/fixtures/text-vector.pdf");
    await expect(page.locator(".file-details strong")).toHaveText("text-vector.pdf");
    await page.waitForTimeout(2500);
    await expect(page.locator(".file-details strong")).toHaveText("text-vector.pdf");
    await expect(page.locator(".password")).toHaveCount(0);
  });
}

test("handover keeps concurrent files separate and rejects another tab even with its token", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "service worker navigation covered in Chromium");
  await context.addInitScript(() => {
    const post = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (data, transfer: Transferable[]) {
      // Hold automatic consumption until the test has tried the wrong tab.
      if (data.type === "take-shared" && !data.testClaim) {
        (window as unknown as { transferToken: string }).transferToken = data.token;
        return;
      }
      post.call(this, data, transfer);
    };
  });
  await page.goto("/en/compress/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  const other = await context.newPage();
  await other.goto("/en/compress/");
  const send = async (tab: Page, name: string) => {
    await tab.evaluate((name) => {
      const channel = new MessageChannel();
      navigator.serviceWorker.controller!.postMessage({ type: "hand-over", path: "/en/compress/", files: [new File(["%PDF-local"], name)] }, [channel.port2]);
    }, name);
    await tab.waitForFunction(() => Boolean((window as unknown as { transferToken: string }).transferToken));
    return tab.evaluate(() => (window as unknown as { transferToken: string }).transferToken);
  };
  const a = await send(page, "a.pdf");
  const b = await send(other, "b.pdf");
  expect(a).not.toBe(b);
  const names = async (tab: Page, token: unknown) => tab.evaluate((token) => new Promise<string[]>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = ({ data }) => { channel.port1.close(); resolve(data.map((file: File) => file.name)); };
    navigator.serviceWorker.controller!.postMessage({ type: "take-shared", token, testClaim: true }, [channel.port2]);
  }), token);
  expect(await names(other, a)).toEqual([]);
  expect(await names(page, undefined)).toEqual([]);
  expect(await names(page, a)).toEqual(["a.pdf"]);
  expect(await names(other, b)).toEqual(["b.pdf"]);
  expect(await names(page, a)).toEqual([]);
});
