import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const open = async (path: string) =>
  pdfjs.getDocument({ data: new Uint8Array(await readFile(path)), verbosity: 0 }).promise;
const text = async (doc: Awaited<ReturnType<typeof open>>, n: number) =>
  (await (await doc.getPage(n)).getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join("");

test("reorders, rotates and deletes pages, and compress accepts the result", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto("/en/organize/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reorder, rotate and delete PDF pages without uploading");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/multipage.pdf");
  const cards = page.locator(".page-grid li");
  await expect(cards).toHaveCount(3, { timeout: 30000 });
  await expect(page.locator(".page-grid img")).toHaveCount(3, { timeout: 30000 });
  // Page 3 to the front, page 1 turned, page 2 removed.
  await page.getByRole("button", { name: "Move page 3 earlier" }).click();
  await page.getByRole("button", { name: "Move page 3 earlier" }).click();
  await page.getByRole("button", { name: "Rotate page 1" }).click();
  await page.getByRole("button", { name: "Delete page 2" }).click();
  await expect(page.getByText("Pages kept: 2 of 3")).toBeVisible();
  await expect(cards.locator(".page-number")).toHaveText(["Page 3", "Page 1", "Page 2"]);
  await page.getByRole("button", { name: "Save PDF" }).click();
  await expect(page.getByRole("heading", { name: "PDF saved" })).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".outcome p")).toContainText("2 pages");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("multipage-organized.pdf");
  const path = (await saved.path())!;
  const doc = await open(path);
  expect(doc.numPages).toBe(2);
  expect(await text(doc, 1)).toContain("Selectable page 3");
  expect(await text(doc, 2)).toContain("Selectable page 1");
  expect((await doc.getPage(2)).rotate).toBe(90);
  // Links on the kept pages still work: the external link survives.
  expect((await (await doc.getPage(1)).getAnnotations()).some((a) => a.url === "https://example.org/")).toBe(true);
  // The strict compress engine takes the new file.
  await page.goto("/en/compress/");
  await page.locator("input[type=file]").setInputFiles({
    name: "multipage-organized.pdf",
    mimeType: "application/pdf",
    buffer: await readFile(path),
  });
  await page.getByRole("button", { name: "Compress PDF", exact: true }).click();
  await expect(page.locator(".result")).toBeVisible({ timeout: 180000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("unlocks a password-protected PDF first", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/en/organize/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/password.pdf");
  await page.getByLabel("PDF password").fill("secret");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator(".page-grid li")).toHaveCount(3, { timeout: 60000 });
  await page.getByRole("button", { name: "Rotate all" }).click();
  await page.getByRole("button", { name: "Save PDF" }).click();
  await expect(page.getByText(/The new PDF has no password/)).toBeVisible({ timeout: 60000 });
});
test("keeps signature stamps and says the signatures no longer hold", async ({ page }) => {
  await page.goto("/en/organize/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/signed.pdf");
  await expect(page.locator(".page-grid li")).toHaveCount(1, { timeout: 30000 });
  await page.getByRole("button", { name: "Rotate page 1" }).click();
  await page.getByRole("button", { name: "Save PDF" }).click();
  await expect(page.getByText(/digital signatures are no longer valid/)).toBeVisible({ timeout: 60000 });
});
test("cannot save with every page deleted, and resets", async ({ page }) => {
  await page.goto("/en/organize/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/text-vector.pdf");
  await page.getByRole("button", { name: "Delete page 1" }).click();
  await expect(page.getByRole("button", { name: "Save PDF" })).toBeDisabled();
  await expect(page.getByText("Every page is deleted. Restore at least one to save.")).toBeVisible();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("button", { name: "Save PDF" })).toBeEnabled();
});
test("landing pages open the same tool with their own words", async ({ page }) => {
  await page.goto("/en/rotate-pdf/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rotate PDF pages without uploading");
  await expect(page.locator(".tool-switcher > a")).toHaveText("Organize PDF");
  await expect(page.locator(".faq summary").first()).toHaveText("How do I rotate pages?");
  await page.goto("/vi/delete-pdf-pages/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Xóa trang PDF không cần tải file lên");
  await expect(page).toHaveURL(/\/vi\/delete-pdf-pages\/$/);
  await expect(page.locator(".drop")).toBeVisible();
});
test("asks for one PDF at a time", async ({ page }) => {
  await page.goto("/en/organize/");
  await page.locator("input[type=file]").setInputFiles(["tests/fixtures/scan.pdf", "tests/fixtures/mixed.pdf"]);
  await expect(page.getByRole("alert")).toHaveText("Choose one PDF at a time.");
});
test("hands files over between organize and compress", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "covered once; the hand-over uses the service worker");
  test.setTimeout(180000);
  await page.goto("/en/organize/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/multipage.pdf");
  await page.getByRole("button", { name: "Delete page 3" }).click();
  await page.getByRole("button", { name: "Save PDF" }).click();
  await expect(page.locator(".next-steps")).toContainText("Next:", { timeout: 60000 });
  await page.getByRole("button", { name: "Compress this PDF" }).click();
  await expect(page).toHaveURL(/\/en\/compress\/$/);
  await expect(page.locator(".file-row strong")).toHaveText("multipage-organized.pdf", { timeout: 30000 });
  await page.getByRole("button", { name: "Compress PDF", exact: true }).click();
  await expect(page.locator(".result")).toBeVisible({ timeout: 120000 });
  await page.getByRole("button", { name: "Organize pages" }).click();
  await expect(page).toHaveURL(/\/en\/organize\/$/);
  await expect(page.locator(".page-grid li")).toHaveCount(2, { timeout: 30000 });
});
test("saves a PDF that is encrypted only to restrict printing", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/en/organize/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/restricted.pdf");
  await expect(page.locator(".page-grid li")).toHaveCount(3, { timeout: 30000 });
  await page.getByRole("button", { name: "Delete page 1" }).click();
  await page.getByRole("button", { name: "Save PDF" }).click();
  await expect(page.getByRole("heading", { name: "PDF saved" })).toBeVisible({ timeout: 90000 });
  // The person is told the copy no longer restricts printing or copying.
  await expect(page.getByText(/new file has no such restrictions/)).toBeVisible();
});
test("sends nothing off the device and loads pdf-lib only to save", async ({ page }) => {
  test.setTimeout(120000);
  const requests: { url: string; method: string }[] = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
  await page.goto("/en/organize/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/multipage.pdf");
  await expect(page.locator(".page-grid img")).toHaveCount(3, { timeout: 30000 });
  const beforeSave = requests.length;
  await page.getByRole("button", { name: "Save PDF" }).click();
  await expect(page.locator(".result")).toBeVisible({ timeout: 60000 });
  const origin = new URL(page.url()).origin;
  const away = requests.filter(({ url }) => !url.startsWith(origin) && !url.startsWith("blob:") && !url.startsWith("data:"));
  expect(away).toEqual([]);
  expect(requests.filter(({ method }) => method !== "GET")).toEqual([]);
  expect(requests.some(({ url }) => /multipage/.test(url))).toBe(false);
  // The merge worker (pdf-lib) is fetched only after "Save PDF".
  expect(requests.slice(0, beforeSave).some(({ url }) => /merge\.worker/.test(url))).toBe(false);
  expect(requests.slice(beforeSave).some(({ url }) => /merge\.worker/.test(url))).toBe(true);
});
