import { test, expect, type Page } from "@playwright/test";
async function expectSuccess(page: Page) {
  await expect(page.locator('.result, .error')).toBeVisible({timeout:90000});
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.result')).toBeVisible();
}
test("upload and invalid file handling", async ({ page }) => {
  await page.goto("/en/");
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
  await page.goto("/en/");
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
  await page.goto("/en/");
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
  await page.goto("/en/");
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
  await page.goto("/en/");
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
  await page.goto("/en/");
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
  await page.goto("/en/");
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
  await page.goto("/en/");
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
  await page.goto("/en/");
  await page.evaluate(() => sessionStorage.setItem("compress-running", "1"));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("ran out of memory");
  await page.reload();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
