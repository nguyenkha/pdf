import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

async function audit(page: Page, state: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map(
    (violation) =>
      `${state}: ${violation.id} (${violation.impact}) ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(", ")}`,
  );
  expect(summary, summary.join("\n")).toEqual([]);
}
for (const scheme of ["light", "dark"] as const)
  test.describe(`accessibility, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });
    test("landing, level choice, result and comparison", async ({ page }) => {
      test.setTimeout(300000);
      await page.goto("/en/compress/");
      await audit(page, "landing");
      await page.locator("input[type=file]").setInputFiles("tests/fixtures/gray-scan.pdf");
      await expect(page.locator(".suggestion")).toBeVisible({ timeout: 60000 });
      await page.getByRole("radio", { name: /Size limit/ }).check();
      await page.getByText("Advanced").click();
      await audit(page, "level choice");
      await page.getByRole("radio", { name: /Recommended/ }).check();
      await page.getByRole("button", { name: "Compress PDF", exact: true }).click();
      // CI's WebKit runner can be several times slower than a laptop.
      await expect(page.locator(".result, .error")).toBeVisible({ timeout: 180000 });
      await page.getByRole("button", { name: "Compare before/after" }).click();
      await expect(page.locator(".compare canvas")).toHaveCount(2);
      await audit(page, "result");
    });
    test("merge tool", async ({ page }) => {
      await page.goto("/en/merge/");
      await audit(page, "merge empty");
      await page.locator("input[type=file]").setInputFiles(["tests/fixtures/scan.pdf", "tests/fixtures/password.pdf"]);
      await expect(page.getByText(/password-protected/)).toBeVisible({ timeout: 30000 });
      await audit(page, "merge list");
    });
    test("markdown tool", async ({ page }) => {
      await page.goto("/en/markdown/");
      await audit(page, "markdown empty");
      await page.locator("input[type=file]").setInputFiles("tests/fixtures/multipage.pdf");
      await expect(page.locator(".md-preview")).toBeVisible({ timeout: 60000 });
      await page.getByText("Options", { exact: true }).click();
      await page.getByRole("button", { name: "Compare with PDF" }).click();
      await expect(page.getByLabel("Original PDF, page 1")).toBeVisible({ timeout: 30000 });
      await audit(page, "markdown result");
    });
    test("organize tool", async ({ page }) => {
      await page.goto("/en/organize/");
      await audit(page, "organize empty");
      await page.locator("input[type=file]").setInputFiles("tests/fixtures/multipage.pdf");
      await expect(page.locator(".page-grid img")).toHaveCount(3, { timeout: 30000 });
      await page.getByRole("button", { name: "Delete page 2" }).click();
      await audit(page, "organize grid");
    });
    test("PDF to JPG tool", async ({ page }) => {
      test.setTimeout(120000);
      await page.goto("/en/pdf-to-jpg/");
      await audit(page, "pdf-to-jpg empty");
      await page.locator("input[type=file]").setInputFiles("tests/fixtures/multipage.pdf");
      await expect(page.locator(".pick-grid img")).toHaveCount(3, { timeout: 30000 });
      await page.getByRole("button", { name: "Page 2", exact: true }).click();
      await audit(page, "pdf-to-jpg pages");
      await page.getByRole("button", { name: "Convert 2 pages to JPG" }).click();
      await expect(page.locator(".result")).toBeVisible({ timeout: 60000 });
      await audit(page, "pdf-to-jpg result");
    });
    test("JPG to PDF tool", async ({ page }) => {
      await page.goto("/en/jpg-to-pdf/");
      await audit(page, "jpg-to-pdf empty");
      await page.locator("input[type=file]").setInputFiles([
        { name: "a.png", mimeType: "image/png", buffer: await readFile("public/icons/icon-192.png") },
        { name: "IMG_0001.heic", mimeType: "image/heic", buffer: Buffer.from("not a photo") },
      ]);
      await expect(page.getByText("Can't open here")).toBeVisible({ timeout: 30000 });
      await audit(page, "jpg-to-pdf list");
    });
    test("markdown OCR offer", async ({ page }) => {
      await page.goto("/en/markdown/");
      await page.locator("input[type=file]").setInputFiles("tests/fixtures/scanned-text.pdf");
      await expect(page.getByRole("button", { name: "Recognize text" })).toBeVisible({ timeout: 30000 });
      await audit(page, "markdown OCR offer");
    });
    test("password prompt, batch and privacy page", async ({ page }) => {
      test.setTimeout(180000);
      await page.goto("/en/compress/");
      await page.locator("input[type=file]").setInputFiles("tests/fixtures/password.pdf");
      await expect(page.getByLabel("PDF password")).toBeVisible({ timeout: 30000 });
      await audit(page, "password");
      await page.getByRole("button", { name: "Remove file" }).click();
      await page.locator("input[type=file]").setInputFiles(["tests/fixtures/scan.pdf", "tests/fixtures/text-vector.pdf"]);
      await audit(page, "batch");
      await page.getByRole("button", { name: "Compress 2 PDFs" }).click();
      await expect(page.getByRole("link", { name: "Download all (ZIP)" })).toBeVisible({ timeout: 120000 });
      await audit(page, "batch done");
      await page.goto("/en/privacy/");
      await audit(page, "privacy");
    });
  });
test("a level can be chosen and the PDF compressed with the keyboard only", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "WebKit does not move focus to form controls with Tab by default");
  test.setTimeout(180000);
  await page.goto("/en/compress/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/scan.pdf");
  const recommended = page.getByRole("radio", { name: /Recommended/ });
  await expect(recommended).toBeChecked({ timeout: 60000 });
  await recommended.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: /High quality/ })).toBeChecked();
  const compress = page.getByRole("button", { name: "Compress PDF", exact: true });
  for (let i = 0; i < 12 && !(await compress.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press("Tab");
  await expect(compress).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".outcome h3")).toBeFocused({ timeout: 90000 });
});
