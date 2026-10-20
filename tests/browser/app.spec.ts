import { test, expect, type Page } from "@playwright/test";
async function expectSuccess(page: Page) {
  await expect(page.locator('.result, .error')).toBeVisible({timeout:90000});
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.result')).toBeVisible();
}
test("upload and invalid file handling", async ({ page }) => {
  await page.goto("/en/");
  await expect(
    page.getByText("Your files never leave your device.").first(),
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
    page.getByText("ملفاتك لا تغادر جهازك أبدًا.").first(),
  ).toBeVisible();
  await page.locator(".language select").selectOption("vi");
  await expect(
    page.getByText("Tệp của bạn không bao giờ rời thiết bị.").first(),
  ).toBeVisible();
});
test("theme and mobile", async ({ page }) => {
  await page.goto("/en/");
  await page.getByRole("button", { name: "System theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".drop")).toBeVisible();
});
test("compresses a real scan and downloads a PDF", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/en/");
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/scan.pdf");
  await page.getByRole("button", { name: "Compress PDF" }).click();
  await expectSuccess(page);
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
  await page.getByText("More options").click();
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
  await page.getByRole("button", { name: "Compress PDF" }).click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 30000 });
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
  await page.getByRole("button", { name: "Compress PDF" }).click();
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
