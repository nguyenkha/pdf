import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { appendFileSync, readFile } from "node:fs";
import { promisify } from "node:util";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// Peak memory budget for one job, above the idle browser. A 44 MB, 23-page
// passport scan measured ~1.04 GB in WebKit and passed on an iPhone 15;
// desktop runs page ranges in parallel and may use more.
const BUDGET_MB: Record<string, number> = { "iphone-webkit": 1200, "desktop-chromium": 2000 };
// Resident memory of Playwright's own browser processes, in MB.
function browserMemory() {
  return Math.round(
    execSync("ps -A -o rss=,command=")
      .toString()
      .split("\n")
      .filter((line) => line.includes("ms-playwright"))
      .reduce((sum, line) => sum + Number(line.trim().split(/\s+/)[0]), 0) / 1024,
  );
}
const corpus = [
  { file: "scan-color-20p", pages: 20, reduces: true },
  { file: "scan-gray-12p", pages: 12, reduces: true },
  { file: "text-80p", pages: 80, reduces: false },
  { file: "bookmarks-30p", pages: 30, reduces: false, outline: 30 },
];
for (const sample of corpus)
  test(`${sample.file}: stays in memory budget and keeps its structure`, async ({ page }, info) => {
    await page.goto("/en/");
    const idle = browserMemory();
    let peak = idle;
    const sampler = setInterval(() => (peak = Math.max(peak, browserMemory())), 200);
    const started = Date.now();
    try {
      await page.locator("input[type=file]").setInputFiles(`tests/corpus/${sample.file}.pdf`);
      await page.getByRole("button", { name: "Compress PDF", exact: true }).click({ timeout: 60_000 });
      await expect(page.locator(".result, .error")).toBeVisible({ timeout: 240_000 });
    } finally {
      clearInterval(sampler);
    }
    await expect(page.getByRole("alert")).toHaveCount(0);
    const seconds = (Date.now() - started) / 1000;
    const used = peak - idle;
    const line = `| ${info.project.name} | ${sample.file} | ${seconds.toFixed(1)} s | ${used} MB |`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n");
    expect(used, `peak memory above the idle browser`).toBeLessThan(BUDGET_MB[info.project.name]);
    const download = page.getByRole("link", { name: "Download PDF" });
    if (!sample.reduces && !(await download.count())) return;
    expect(await download.count()).toBe(1);
    const event = page.waitForEvent("download");
    await download.click();
    const bytes = new Uint8Array(await promisify(readFile)((await (await event).path())!));
    const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 });
    try {
      const doc = await task.promise;
      expect(doc.numPages).toBe(sample.pages);
      if (sample.outline) expect((await doc.getOutline())?.length).toBe(sample.outline);
    } finally {
      await task.destroy();
    }
  });
