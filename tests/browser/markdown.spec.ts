import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("converts a PDF to Markdown and compares it page by page", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/en/markdown/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Convert PDF to Markdown without uploading it");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/multipage.pdf");
  await expect(page.getByRole("heading", { name: "Converted 3 pages" })).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".md-preview")).toContainText("Selectable page 1");
  // Pages 2 and 3 draw the same picture: one file, referenced twice.
  await expect(page.locator(".outcome p")).toContainText("Images: 2");
  await expect(page.locator(".md-preview img")).toHaveCount(3);
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download all (.zip)" }).click();
  const zip = await zipDownload;
  expect(zip.suggestedFilename()).toBe("multipage.zip");
  const archive = await readFile((await zip.path())!, "latin1");
  for (const entry of ["multipage.md", "images/page-1-1.jpg", "images/page-2-2.jpg"]) expect(archive).toContain(entry);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Markdown only (.md)" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("multipage.md");
  const markdown = await readFile((await saved.path())!, "utf8");
  expect(markdown).toContain("<!-- Page 1 -->");
  expect(markdown).toContain("![Image 1, page 1](images/page-1-1.jpg)");
  expect(markdown).toContain("Selectable page 3");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.getByLabel("Markdown source")).toHaveValue(markdown);
  // Options re-format the text already read, without reading the PDF again.
  await page.getByText("Options", { exact: true }).click();
  await page.getByLabel("Join pages (no page breaks)").check();
  await expect(page.getByLabel("Markdown source")).not.toHaveValue(/<!-- Page 1 -->/);
  await expect(page.getByText("1 changed")).toBeVisible();
  await page.getByLabel("Keep images").uncheck();
  await expect(page.getByRole("link", { name: "Download Markdown" })).toBeVisible();
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(page.getByLabel("Markdown source")).toHaveValue(markdown);
  await page.getByRole("button", { name: "Compare with PDF" }).click();
  await expect(page.getByLabel("Original PDF, page 1")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("page 2 of 3")).toBeVisible();
  await expect(page.getByLabel("Markdown source")).toHaveValue(/Selectable page 2/);
});
test("unlocks a password-protected PDF first", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/vi/markdown/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/password.pdf");
  await page.getByLabel("Mật khẩu PDF").fill("secret");
  await page.getByRole("button", { name: "Mở khóa" }).click();
  await expect(page.locator(".md-preview")).toContainText("Selectable page 1", { timeout: 60000 });
  // Words written into the Markdown follow the page language.
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.getByLabel("Nội dung Markdown")).toHaveValue(/<!-- Trang 1 -->/);
});
test("explains when a PDF has no text layer", async ({ page }) => {
  await page.goto("/en/markdown/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/scan.pdf");
  await expect(page.getByRole("alert")).toHaveText(/no text layer.*OCR/, { timeout: 30000 });
});
