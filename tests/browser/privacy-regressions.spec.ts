import { expect, test, type Page } from "@playwright/test";

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

async function message(page: Page, data: object): Promise<unknown> {
  return page.evaluate((data) => new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = ({ data }) => { channel.port1.close(); resolve(data); };
    const payload = data as { type: string; name?: string };
    navigator.serviceWorker.controller!.postMessage(payload.type === "hand-over"
      ? { ...data, files: [new File(["%PDF-local"], payload.name!, { type: "application/pdf" })] }
      : data, [channel.port2]);
  }), data);
}

test("handover keeps concurrent files separate and rejects another tab even with its token", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "service worker navigation covered in Chromium");
  await page.goto("/en/compress/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  const other = await context.newPage();
  await other.goto("/en/compress/");
  const a = await message(page, { type: "hand-over", path: "/en/compress/", name: "a.pdf" });
  const b = await message(other, { type: "hand-over", path: "/en/compress/", name: "b.pdf" });
  expect(a).not.toBe(b);
  expect(await message(other, { type: "take-shared", token: a })).toEqual([]);
  expect(await message(page, { type: "take-shared" })).toEqual([]);
  const names = async (tab: Page, token: unknown) => tab.evaluate((token) => new Promise<string[]>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = ({ data }) => { channel.port1.close(); resolve(data.map((file: File) => file.name)); };
    navigator.serviceWorker.controller!.postMessage({ type: "take-shared", token }, [channel.port2]);
  }), token);
  expect(await names(page, a)).toEqual(["a.pdf"]);
  expect(await names(other, b)).toEqual(["b.pdf"]);
  expect(await names(page, a)).toEqual([]);
});
