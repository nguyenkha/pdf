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
  await page.locator(".merge-toolbar input[type=file]").setInputFiles(["tests/fixtures/text-vector.pdf", "tests/fixtures/password.pdf"]);
  await expect(rows).toHaveCount(4);
  await expect(page.getByText(/password-protected: remove it to continue/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Merge 4 PDFs" })).toBeDisabled();
  await page.getByRole("button", { name: "Remove password.pdf" }).click();
  // Arrange: scan first, then text-vector, then multipage.
  await page.getByRole("button", { name: "Move scan.pdf up" }).click();
  await page.getByRole("button", { name: "Move multipage.pdf down" }).click();
  await expect(rows.locator("strong")).toHaveText(["scan.pdf", "text-vector.pdf", "multipage.pdf"]);
  await expect(page.getByText("PDFs: 3 · Pages: 5")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Merge 3 PDFs" }).click();
  await expect(page.getByText("3 PDFs merged into one: 5 pages")).toBeVisible({ timeout: 60000 });
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
