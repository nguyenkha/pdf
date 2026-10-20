import { test, expect } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
const root =
  process.env.PDF_CORPUS_DIR ??
  path.join(os.homedir(), ".local/share/pdf-test-corpus/tables");
const names = [
  "w3c-table.pdf",
  "AnimalSounds.pdf",
  "twotables.pdf",
  "spreadsheet_no_bounding_frame.pdf",
  "spanning_cells.pdf",
  "MultiColumn.pdf",
  "12s0324.pdf",
];
for (const name of names)
  test(`public corpus: ${name}`, async ({ page }) => {
    test.skip(
      !fs.existsSync(path.join(root, name)),
      "Run node scripts/download-pdf-samples.mjs first. Public samples are not vendored.",
    );
    await page.goto("/experiments/pdf-to-md/");
    await page.locator("input[type=file]").setInputFiles(path.join(root, name));
    await page.getByRole("button", { name: "Chuyển sang Markdown" }).click();
    await expect(
      page.getByRole("article", { name: "Xem trước Markdown" }),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
    if (name === "w3c-table.pdf") {
      await expect(
        page.getByRole("table", { name: "Bảng dữ liệu nhận diện" }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("cell", { name: "Elm Street", exact: true }),
      ).toBeVisible();
      const download = page.waitForEvent("download");
      await page.getByRole("link", { name: "CSV · Bảng 1 · Trang 1" }).click();
      const result = await download;
      expect(fs.readFileSync((await result.path())!, "utf8")).toContain(
        '"Elm Street","23","24","26","22"',
      );
    } else if (name === "twotables.pdf" || name === "spanning_cells.pdf") {
      const tables = page.getByRole("table", {
        name: "Bảng dữ liệu nhận diện",
      });
      await expect(tables).toHaveCount(2);
      if (name === "twotables.pdf") {
        await expect(
          tables.nth(0).getByRole("cell", { name: "18,512", exact: true }),
        ).toBeVisible();
        await expect(
          tables.nth(1).getByRole("cell", { name: "18,683", exact: true }),
        ).toBeVisible();
        await expect(tables.nth(0).locator('td[colspan="5"]')).toContainText(
          "株主資本",
        );
      } else {
        await expect(tables.nth(0).locator('td[colspan="6"]')).toHaveCount(3);
        await expect(
          tables.nth(1).getByRole("cell", { name: "98,864", exact: true }),
        ).toBeVisible();
      }
      const download = page.waitForEvent("download");
      await page.getByRole("link", { name: "CSV · Bảng 1 · Trang 1" }).click();
      const file = await download;
      const csv = fs.readFileSync((await file.path())!, "utf8");
      if (name === "twotables.pdf")
        expect(csv).toContain(
          '"当期末残高","5,664","749","12,846","△747","18,512"',
        );
      else
        expect(csv).toContain(
          '"Server closets","1,505","1,580","1,643","1,673","1,689"',
        );
    } else
      await expect(page.getByRole("link", { name: /CSV · Bảng/ })).toHaveCount(
        0,
      );
  });
