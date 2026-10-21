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
test("offers OCR for a scan and reads it on the device", async ({ page }) => {
  // CI runners are much slower than a laptop at recognition.
  test.setTimeout(240000);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/en/markdown/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/scanned-text.pdf");
  await expect(page.getByText("No text layer found: this looks like a scan.")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Language of the document")).toHaveValue("en");
  // Nothing of the recognizer loads until it is asked for.
  expect(requests.filter((url) => /\/ocr\/|tesseract/.test(url))).toEqual([]);
  await page.getByRole("button", { name: "Recognize text" }).click();
  await expect(page.getByRole("heading", { name: "Converted 1 pages" })).toBeVisible({ timeout: 180000 });
  const preview = page.locator(".md-preview");
  await expect(preview.getByRole("heading", { name: "Scanned Report" })).toBeVisible();
  // Wrapped lines of one paragraph are joined again.
  await expect(preview.locator("p")).toContainText([
    /^This page has no text layer\. It was printed and scanned, so its words exist only as pixels in an image\.$/,
    /^Optical character recognition reads those pixels back into text that can be searched and copied\.$/,
  ]);
  // The scan became text, so it is not repeated as a picture.
  await expect(preview.locator("img")).toHaveCount(0);
  await expect(page.getByText(/recognized with OCR and may contain mistakes/)).toBeVisible();
  // Everything, the recognizer included, came from this site.
  const origin = new URL(page.url()).origin + "/";
  expect(requests.filter((url) => !url.startsWith(origin) && !url.startsWith("blob:") && !url.startsWith("data:"))).toEqual([]);
  expect(requests.some((url) => url.includes("/ocr/lang/eng.traineddata.gz"))).toBe(true);
});
test("turns a scanned ruled table into a table", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto("/en/markdown/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/scanned-table.pdf");
  await page.getByRole("button", { name: "Recognize text" }).click();
  const table = page.locator(".md-preview table");
  await expect(table).toBeVisible({ timeout: 180000 });
  await expect(table.locator("tr")).toHaveCount(5);
  await expect(table.locator("tr").last().locator("td")).toHaveText(["Total", "", "", "239.00"]);
  await expect(page.getByRole("link", { name: /Table 1/ })).toBeVisible();
});
test("reads only the scanned pages of a mixed PDF", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto("/vi/markdown/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/mixed-scan.pdf");
  const preview = page.locator(".md-preview");
  await expect(preview).toContainText("Typed Introduction", { timeout: 30000 });
  await expect(page.getByText("1 trang không có lớp chữ. Nhận dạng chữ bằng OCR?")).toBeVisible();
  // The file is English although the page is Vietnamese: English is always read too.
  await expect(page.getByLabel("Ngôn ngữ trong file")).toHaveValue("vi");
  await page.getByRole("button", { name: "Nhận dạng chữ" }).click();
  await expect(preview).toContainText("Scanned Report", { timeout: 180000 });
  await expect(preview).toContainText("Optical character recognition reads those pixels");
  await expect(preview).toContainText("Typed Introduction");
  await expect(page.getByText("Nhận dạng chữ bằng OCR?")).toHaveCount(0);
});
test("PDF to text gives plain text first, the Markdown a link away", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/en/pdf-to-text/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Extract text from PDF without uploading");
  // The same tool, under its own name in the switcher.
  await expect(page.locator(".tool-switcher > a")).toHaveText("PDF → MD");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/multipage.pdf");
  await expect(page.getByRole("heading", { name: "Converted 3 pages" })).toBeVisible({ timeout: 60000 });
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download text (.txt)" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("multipage.txt");
  const text = await readFile((await saved.path())!, "utf8");
  expect(text).toContain("Selectable page 1");
  expect(text).toContain("Selectable page 3");
  // No Markdown: no page comments, image links or escapes.
  expect(text).not.toMatch(/<!--|!\[|\]\(|\\/);
  await expect(page.getByLabel("Text", { exact: true })).toHaveValue(text);
  await expect(page.getByRole("button", { name: "Preview" })).toHaveCount(0);
  const markdown = page.waitForEvent("download");
  await page.getByRole("link", { name: "Also as Markdown (.md)" }).click();
  expect((await markdown).suggestedFilename()).toBe("multipage.zip");
  await expect(page.getByRole("navigation", { name: "Related" }).getByRole("link")).toHaveText(["PDF → MD", "PDF → text", "OCR PDF"]);
});
test("OCR PDF reads a scan into plain text", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto("/en/ocr-pdf/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("OCR a scanned PDF without uploading it");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/scanned-text.pdf");
  await page.getByRole("button", { name: "Recognize text" }).click();
  await expect(page.getByRole("heading", { name: "Converted 1 pages" })).toBeVisible({ timeout: 180000 });
  await expect(page.getByLabel("Text", { exact: true })).toHaveValue(
    /^Scanned Report\n\nThis page has no text layer\. It was printed and scanned, so its words exist only as pixels in an image\./,
  );
});
