import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const path = "/experiments/pdf-to-md/";
test("extracts selectable text and downloads Markdown without transmitting PDF data", async ({
  page,
}) => {
  const requests: { url: string; method: string }[] = [];
  page
    .context()
    .on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
  await page.goto(path);
  expect(requests.some((r) => r.url.includes("extract.worker"))).toBe(false);
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/text-vector.pdf");
  await page.getByRole("button", { name: "Chuyển sang Markdown" }).click();
  await expect(
    page.getByRole("article", { name: "Xem trước Markdown" }),
  ).toContainText("Selectable page 1");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.getByLabel("Nội dung Markdown")).toHaveValue(
    /Selectable page 1/,
  );
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: "Tải Markdown" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("text-vector.md");
  expect(await readFile((await download.path())!, "utf8")).toContain(
    "## Trang 1",
  );
  const origin = new URL(page.url()).origin;
  expect(
    requests.every(
      (r) =>
        r.method === "GET" &&
        (!r.url.startsWith("http") || new URL(r.url).origin === origin),
    ),
  ).toBe(true);
  expect(requests.some((r) => r.url.includes("text-vector.pdf"))).toBe(false);
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker.getRegistrations().then((r) => r.length),
    ),
  ).toBe(0);
});
test("keeps all pages of a mixed PDF", async ({ page }) => {
  await page.goto(path);
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/multipage.pdf");
  await page.getByRole("button", { name: "Chuyển sang Markdown" }).click();
  await expect(
    page.getByRole("article", { name: "Xem trước Markdown" }),
  ).toContainText("Selectable page 3");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.getByLabel("Nội dung Markdown")).toHaveValue(
    /## Trang 3[\s\S]*Selectable page 3/,
  );
});
for (const [file, message] of [
  ["scan", "chưa hỗ trợ OCR"],
  ["password", "chưa hỗ trợ PDF có mật khẩu"],
  ["corrupted", "Không đọc được PDF"],
]) {
  test(`${file}: explains the limitation without a misleading download`, async ({
    page,
  }) => {
    await page.goto(path);
    await page
      .locator("input[type=file]")
      .setInputFiles(`tests/fixtures/${file}.pdf`);
    await page.getByRole("button", { name: "Chuyển sang Markdown" }).click();
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(page.getByRole("link", { name: "Tải Markdown" })).toHaveCount(
      0,
    );
  });
}
test("rejects a non-PDF", async ({ page }) => {
  await page.goto(path);
  await page.locator("input[type=file]").setInputFiles({
    name: "text.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.getByRole("alert")).toHaveText("Chọn một file PDF hợp lệ.");
});
