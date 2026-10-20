import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
async function expectSuccess(page: Page) {
  await expect(page.locator('.result, .error')).toBeVisible({timeout:90000});
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.result')).toBeVisible();
}
test("upload and invalid file handling", async ({ page }) => {
  await page.goto("/en/compress/");
  await expect(
    page.getByText("Your files never leave your device.").filter({ visible: true }).first(),
  ).toBeVisible();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "bad.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("bad"),
    });
  await expect(page.getByRole("alert")).toContainText("valid PDF");
});
test("language switching and RTL", async ({ page }) => {
  await page.goto("/en/compress/");
  await page.getByLabel("Language").selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByText("ملفاتك لا تغادر جهازك أبدًا.").filter({ visible: true }).first(),
  ).toBeVisible();
  await page.locator(".language select").selectOption("vi");
  await expect(
    page.getByText("File của bạn không bao giờ rời thiết bị.").filter({ visible: true }).first(),
  ).toBeVisible();
});
test("theme and mobile", async ({ page }) => {
  await page.goto("/en/compress/");
  await page.getByRole("button", { name: "System theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".drop")).toBeVisible();
  // The drop zone must start above the fold on a phone.
  const drop = await page.locator(".drop").boundingBox();
  expect(drop && drop.y + drop.height).toBeLessThan(844);
});
test("compresses a real scan and downloads a PDF", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/en/compress/");
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/scan.pdf");
  await page.getByRole("button", { name: "Compress PDF" }).click();
  await expectSuccess(page);
  const preview = page.getByRole("link", { name: "Preview" });
  await expect(preview).toHaveAttribute("target", "_blank");
  await expect(preview).toHaveAttribute("href", /^blob:/);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF" }).click();
  expect((await download).suggestedFilename()).toBe("scan-compressed.pdf");
});
test("target size attempt reports its result", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/en/compress/");
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/scan.pdf");
  await page.getByRole("radio", { name: /Size limit/ }).check();
  await page.locator("input[type=number]").fill("200");
  await page.locator(".target-row select").selectOption("KB");
  await page.getByRole("button", { name: "Compress PDF" }).click();
  await expectSuccess(page);
  await expect(page.getByText(/Target achieved|Target not achieved/)).toBeVisible();
});
test("corrupted PDF fails without a download", async ({ page }) => {
  await page.goto("/en/compress/");
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/corrupted.pdf");
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Compress PDF" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Download PDF" })).toHaveCount(0);
});
test("worker initialization failure is explained", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Worker", {
      value: class {
        constructor() {
          throw new Error("worker unavailable");
        }
      },
    });
  });
  await page.goto("/en/compress/");
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/text-vector.pdf");
  await expect(page.getByRole("alert")).toContainText("Compression failed");
});
test("processing sends no PDF bytes or metadata over the network", async ({
  page,
}) => {
  test.setTimeout(180000);
  const requests: { url: string; method: string; body: string }[] = [];
  page
    .context()
    .on("request", (request) =>
      requests.push({
        url: request.url(),
        method: request.method(),
        body: request.postData() ?? "",
      }),
    );
  await page.goto("/en/compress/");
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/scan.pdf");
  await page.getByRole("button", { name: "Compress PDF" }).click();
  await expectSuccess(page);
  const origin = new URL(page.url()).origin;
  expect(requests.filter((r) => /^https?:/.test(r.url) && new URL(r.url).origin !== origin)).toEqual([]);
  expect(requests.every((r) => r.method === "GET")).toBe(true);
  expect(
    requests.every(
      (r) => !r.url.includes("scan.pdf") && !r.body.includes("%PDF"),
    ),
  ).toBe(true);
});
test("size landing page preselects its limit and keeps its URL", async ({ page }) => {
  await page.goto("/en/compress-pdf-to-200kb/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Compress PDF to 200 KB");
  await expect(page).toHaveURL(/\/en\/compress-pdf-to-200kb\/$/);
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/scan.pdf");
  await expect(page.getByRole("radio", { name: /Size limit/ })).toBeChecked();
  await expect(page.locator("input[type=number]")).toHaveValue("200");
  await expect(page.locator(".target-row select")).toHaveValue("KB");
  await page.getByLabel("Language").selectOption("vi");
  await expect(page).toHaveURL(/\/vi\/compress-pdf-to-200kb\/$/);
});
test("explains a reload caused by running out of memory mid-job", async ({ page }) => {
  await page.goto("/en/compress/");
  // The app may mount after "load"; set the marker only once it has, or the
  // first page would consume it before the reload.
  await expect(page.locator(".drop")).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("compress-running", "1"));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("ran out of memory");
  await page.reload();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("privacy page keeps the site header, footer and credits", async ({ page }) => {
  await page.goto("/vi/privacy/");
  await expect(page.locator(".site-header")).toBeVisible();
  await expect(page.locator("footer")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ghostscript" }).first()).toBeVisible();
  await page.getByLabel("Ngôn ngữ").selectOption("en");
  await expect(page).toHaveURL(/\/en\/privacy\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");
});
test("estimates the result and compares before/after", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/en/compress/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/scan.pdf");
  await expect(page.locator(".estimate")).toContainText(/Expected result: about .* smaller/, { timeout: 60000 });
  await page.getByRole("button", { name: "Compress PDF", exact: true }).click();
  await expectSuccess(page);
  await page.getByRole("button", { name: "Compare before/after" }).click();
  await expect(page.locator(".compare canvas")).toHaveCount(2);
  await expect(page.getByText("page 1 of 1")).toBeVisible({ timeout: 30000 });
});
test("offers to compress a signed PDF without its signatures", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/en/compress/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/signed.pdf");
  await expect(page.getByText("This PDF is digitally signed.")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Compress without the signatures" }).click();
  await page.getByRole("button", { name: "Compress PDF", exact: true }).click();
  await expectSuccess(page);
  await expect(page.getByText(/digital signatures were removed/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF" }).click();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await readFile((await (await download).path())!)), verbosity: 0 }).promise;
  // No signature field is left, but the stamp it showed is drawn on the page.
  expect(await doc.getFieldObjects()).toBeNull();
  const pdfPage = await doc.getPage(1);
  expect(await pdfPage.getAnnotations()).toEqual([]);
  const text = (await pdfPage.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join(" ");
  expect(text).toContain("SYNTHETIC STAMP");
  expect(text).toContain("Signed fixture");
});
test("compresses several PDFs and downloads them as one ZIP", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto("/en/compress/");
  await page.locator("input[type=file]").setInputFiles([
    "tests/fixtures/scan.pdf",
    "tests/fixtures/text-vector.pdf",
    "tests/fixtures/password.pdf",
    "tests/fixtures/signed.pdf",
  ]);
  await expect(page.getByText("PDFs: 4")).toBeVisible();
  await page.getByRole("button", { name: "Compress 4 PDFs" }).click();
  const zip = page.getByRole("link", { name: "Download all (ZIP)" });
  await expect(zip).toBeVisible({ timeout: 180000 });
  await expect(page.getByText(/already optimized, original kept/)).toBeVisible();
  await expect(page.getByText(/password-protected, compress it on its own/)).toBeVisible();
  await expect(page.getByText(/digitally signed, compress it on its own/)).toBeVisible();
  const download = page.waitForEvent("download");
  await zip.click();
  const file = await (await download).path();
  const bytes = await readFile(file!);
  // Local file header signature, then the one compressed PDF's name.
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  expect(bytes.includes(Buffer.from("scan-compressed.pdf"))).toBe(true);
});
test("closing the comparison early leaves no pdf.js worker behind", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/en/compress/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/long.pdf");
  await page.getByRole("button", { name: "Compress PDF", exact: true }).click();
  await expectSuccess(page);
  await expect.poll(() => page.workers().length, { timeout: 15000 }).toBe(0);
  const compare = page.getByRole("button", { name: "Compare before/after" });
  await compare.click();
  await compare.click();
  await expect.poll(() => page.workers().length, { timeout: 15000 }).toBe(0);
  await compare.click();
  await expect(page.locator(".compare canvas")).toHaveCount(2);
  await compare.click();
  await expect.poll(() => page.workers().length, { timeout: 15000 }).toBe(0);
});
test("tool switcher shows the tool in use and the rest behind +", async ({ page }) => {
  await page.goto("/en/compress/");
  const switcher = page.locator(".tool-switcher");
  await expect(switcher.locator("> a")).toHaveText("Compress PDF");
  await expect(switcher.locator("> a")).toHaveAttribute("aria-current", "page");
  await expect(switcher.getByRole("link", { name: "Merge PDF" })).toBeHidden();
  // The "+" says how many other tools there are.
  const more = switcher.getByRole("button", { name: "3 more tools" });
  // Tap or click unfolds the rest, which take the place of +.
  await more.click();
  await expect(switcher.getByRole("link", { name: "Merge PDF" })).toBeVisible();
  // With a mouse the others take the place of +; on phones a sheet opens and + stays.
  const phone = await page.evaluate(() => matchMedia("(max-width: 680px)").matches);
  if (phone) await expect(more).toBeVisible();
  else await expect(more).toBeHidden();
  await expect(switcher.locator(".tool-more-list a")).toHaveText(["Merge PDF", "PDF to Markdown", "Organize PDF pages"]);
  await page.keyboard.press("Escape");
  await expect(switcher.getByRole("link", { name: "Merge PDF" })).toBeHidden();
  await expect(more).toBeVisible();
  // From the keyboard, focus moves into the list and back to + on Escape.
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(switcher.getByRole("link", { name: "Merge PDF" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  // With a mouse, hovering is enough.
  if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
    await page.mouse.move(5, 5);
    await more.hover();
    await expect(switcher.getByRole("link", { name: "Merge PDF" })).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(switcher.getByRole("link", { name: "Merge PDF" })).toBeHidden();
  }
  await page.goto("/en/merge/");
  await expect(switcher.locator("> a")).toHaveText("Merge PDF");
  // The prerendered page carries the same links for crawlers and no-JS readers.
  const html = await (await page.request.get("/en/merge/")).text();
  expect(html).toContain('<details class="tool-more">');
  expect(html).toContain('href="/en/compress/"');
});
test("the site and locale homes go straight to compress", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/[a-zA-Z-]+\/compress\/$/);
  await page.goto("/vi/");
  await expect(page).toHaveURL(/\/vi\/compress\/$/);
  await expect(page.locator(".drop")).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://pdf.kha.do/vi/compress/");
});
