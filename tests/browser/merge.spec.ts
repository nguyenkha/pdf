import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

test("merges PDFs in the arranged order", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/en/merge/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Merge PDF files without uploading them");
  await page.locator("input[type=file]").setInputFiles(["tests/fixtures/multipage.pdf", "tests/fixtures/scan.pdf"]);
  const rows = page.locator(".merge-list li");
  await expect(rows).toHaveCount(2);
  // Add a third file from the toolbar, then a locked one that blocks merging.
  await page.locator(".drop.compact input[type=file]").setInputFiles(["tests/fixtures/text-vector.pdf", "tests/fixtures/password.pdf"]);
  await expect(rows).toHaveCount(4);
  await expect(page.getByText("password.pdf is password-protected. Enter its password to merge it.")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Merge 4 PDFs" })).toBeDisabled();
  await page.getByRole("button", { name: "Remove password.pdf" }).click();
  // Arrange: scan first, then text-vector, then multipage.
  await page.getByRole("button", { name: "Move scan.pdf up" }).click();
  await page.getByRole("button", { name: "Move multipage.pdf down" }).click();
  await expect(rows.locator("strong")).toHaveText(["scan.pdf", "text-vector.pdf", "multipage.pdf"]);
  await expect(page.getByText("PDFs: 3 · Pages: 5")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Merge 3 PDFs" }).click();
  await expect(page.getByRole("heading", { name: "Merged 3 PDFs" })).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".outcome p")).toContainText("5 pages");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("scan-merged.pdf");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await readFile((await saved.path())!)), verbosity: 0 }).promise;
  expect(doc.numPages).toBe(5);
  // multipage.pdf's selectable text lands on pages 3-5.
  const text = async (n: number) => (await (await doc.getPage(n)).getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join("");
  expect(await text(3)).toContain("Selectable page 1");
  expect(await text(5)).toContain("Selectable page 3");
});
test("sorts by name in natural order", async ({ page }) => {
  await page.goto("/en/merge/");
  const bytes = await readFile("tests/fixtures/text-vector.pdf");
  await page.locator("input[type=file]").setInputFiles(
    ["scan10.pdf", "scan2.pdf", "scan1.pdf"].map((name) => ({ name, mimeType: "application/pdf", buffer: bytes })),
  );
  await page.getByRole("button", { name: "Sort by name" }).click();
  await expect(page.locator(".merge-list li strong")).toHaveText(["scan1.pdf", "scan2.pdf", "scan10.pdf"]);
});
test("loads merge code only on demand", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\.(m?js)$/.test(path)) scripts.push(path);
  });
  await page.goto("/en/");
  await expect(page.locator(".drop")).toBeVisible();
  expect(scripts.some((path) => /MergeTool|merge\.worker|summary\.worker/.test(path))).toBe(false);
  await page.goto("/en/merge/");
  await expect(page.locator(".drop")).toBeVisible();
  expect(scripts.some((path) => /merge\.worker|summary\.worker|pdf\.worker/.test(path))).toBe(false);
  await page.locator("input[type=file]").setInputFiles(["tests/fixtures/text-vector.pdf", "tests/fixtures/scan.pdf"]);
  await expect(page.locator(".merge-list li")).toHaveCount(2);
  expect(scripts.some((path) => path.includes("merge.worker"))).toBe(false);
  await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
  await expect(page.locator(".result")).toBeVisible({ timeout: 60000 });
  expect(scripts.some((path) => path.includes("merge.worker"))).toBe(true);
});

test("unlocks a password-protected file in the list, as compress does", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/en/merge/");
  await page.locator("input[type=file]").setInputFiles(["tests/fixtures/scan.pdf", "tests/fixtures/password.pdf"]);
  const field = page.getByLabel("PDF password");
  await expect(field).toBeVisible({ timeout: 30000 });
  await field.fill("wrong");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert")).toHaveText("Incorrect password. Try again.", { timeout: 60000 });
  await field.fill("secret");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(field).toHaveCount(0, { timeout: 120000 });
  await expect(page.getByText("PDFs: 2 · Pages: 4")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
  await expect(page.getByRole("heading", { name: "Merged 2 PDFs" })).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".result .result-note")).toHaveText(/merged PDF has no password/);
});
test("hands the merged PDF to compress without storing it", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "covered once; the hand-over uses the service worker");
  test.setTimeout(180000);
  await page.goto("/en/merge/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.locator("input[type=file]").setInputFiles(["tests/fixtures/scan.pdf", "tests/fixtures/text-vector.pdf"]);
  await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
  await page.getByRole("button", { name: "Compress this PDF" }).click();
  await expect(page).toHaveURL(/\/en\/compress\/$/);
  await expect(page.getByText("scan-merged.pdf", { exact: true })).toBeVisible({ timeout: 30000 });
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (key) => (await (await caches.open(key)).keys()).map((request) => request.url)))).flat());
  expect(cached.some((url) => url.includes("shared") || url.includes("merged"))).toBe(false);
});
