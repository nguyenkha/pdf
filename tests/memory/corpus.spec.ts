import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { appendFileSync, readFile } from "node:fs";
import { promisify } from "node:util";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// Ceiling for one job's peak memory above the idle browser. Resident memory
// of browser processes swings by up to ~50% between identical runs (WebKit:
// 580-1350 MB for the 20-page scan), so this catches gross regressions only;
// the measured numbers go to the CI summary to follow the trend. A 44 MB,
// 23-page passport scan at ~1.0-1.4 GB here works on an iPhone 15.
const BUDGET_MB: Record<string, number> = { "iphone-webkit": 2000, "desktop-chromium": 2000 };
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
  test(`${sample.file}: stays in memory budget and keeps its structure`, async ({ playwright, browserName }, info) => {
    // A fresh browser per file, so memory left by an earlier file never
    // counts against this one.
    const browser = await playwright[browserName].launch();
    const context = await browser.newContext({ ...info.project.use, baseURL: "http://127.0.0.1:4173" });
    const page = await context.newPage();
    try {
    await page.goto("/en/compress/");
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
    if (sample.reduces) {
      // The before/after view of a big scan, zoomed, must fit the budget too.
      const before = browserMemory();
      let viewPeak = before;
      const viewSampler = setInterval(() => (viewPeak = Math.max(viewPeak, browserMemory())), 200);
      try {
        await page.getByRole("button", { name: "Compare before/after" }).click();
        await expect(page.locator(".compare canvas")).toHaveCount(2);
        await page.getByRole("button", { name: "Zoom in" }).click();
        await page.getByRole("button", { name: "Next page" }).click();
        await page.waitForTimeout(3000);
      } finally {
        clearInterval(viewSampler);
      }
      const viewUsed = viewPeak - idle;
      const viewLine = `| ${info.project.name} | ${sample.file} compare + zoom | | ${viewUsed} MB |`;
      console.log(viewLine);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, viewLine + "\n");
      expect(viewUsed, "peak memory while comparing").toBeLessThan(BUDGET_MB[info.project.name]);
    }
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
    } finally {
      await browser.close();
    }
  });
