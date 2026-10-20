import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

async function process(page: Page, fixture: string) {
  await page.goto('/en/');
  await page.locator('input[type=file]').setInputFiles(`tests/fixtures/${fixture}.pdf`);
  await page.getByRole('button', { name: 'Compress PDF', exact: true }).click();
  await expect(page.locator('.result, .error')).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
}
for (const [fixture, pages, selectable] of [['mixed', 1, true], ['multipage', 3, true], ['long', 15, true], ['scan', 1, false]] as const) {
  test(`${fixture}: output opens with all pages and selectable text/links preserved`, async ({ page }) => {
    await process(page, fixture);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download PDF' }).click();
    const download = await downloadEvent;
    const file = await download.path();
    expect(file).toBeTruthy();
    const bytes = new Uint8Array(await readFile(file!));
    const outputSize = bytes.length;
    const input = await readFile(`tests/fixtures/${fixture}.pdf`);
    expect(bytes.length).toBeLessThan(input.length);
    const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 });
    try {
      const document = await task.promise;
      expect(document.numPages).toBe(pages);
      for (let number = 1; number <= pages; number++) {
        const p = await document.getPage(number);
        expect((await p.getOperatorList()).fnArray.length).toBeGreaterThan(0);
        if (selectable) {
          const content = (await p.getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
          // long.pdf repeats multipage.pdf's three pages.
          expect(content).toContain(`Selectable page ${fixture === 'long' ? ((number - 1) % 3) + 1 : number}`);
          expect((await p.getAnnotations()).some(annotation => annotation.url === 'https://example.org/')).toBe(true);
        }
      }
      await expect(page.getByText(new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(outputSize / 1024) + ' KB', { exact: true })).toBeVisible();
    } finally { await task.destroy(); }
  });
}
for (const fixture of ['already-optimized', 'text-vector']) {
  test(`${fixture}: keeps original when no reduction is possible`, async ({ page }) => {
    await process(page, fixture);
    await expect(page.getByText(/No meaningful reduction/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download PDF' })).toHaveCount(0);
  });
}

test('WASM is absent before a PDF is chosen and cancellation leaves the UI usable', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', request => requested.push(request.url()));
  await page.goto('/en/');
  await page.waitForLoadState('networkidle');
  expect(requested.some(url => url.endsWith('.wasm'))).toBe(false);
  await page.route('**/engine/**/core.wasm', route => route.abort());
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/scan.pdf');
  await page.getByRole('button', { name: 'Compress PDF', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Compress PDF', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.unroute('**/engine/**/core.wasm');
  await page.getByRole('button', { name: 'Compress PDF', exact: true }).click();
  await expect(page.locator('.result, .error')).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('processes offline once application and engine assets have been cached', async ({ page, context }) => {
  await page.goto('/en/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await process(page, 'scan');
  await page.getByRole('button', { name: 'Compress another PDF' }).click();
  await context.setOffline(true);
  await page.reload();
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/scan.pdf');
  await page.getByRole('button', { name: 'Compress PDF', exact: true }).click();
  await expect(page.locator('.result, .error')).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible();
  const keys = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat());
  expect(keys.every(url => !url.includes('scan.pdf') && !url.startsWith('blob:'))).toBe(true);
});
test('form: stops before compression without changing the document', async ({ page }) => {
  await page.goto('/en/');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/form.pdf');
  await expect(page.getByRole('alert')).toHaveText('This document uses features that cannot be safely preserved during compression. Keep the original.', { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Compress PDF', exact: true })).toHaveCount(0);
});
test('password: unlocks with the right password and compresses', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/en/');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/password.pdf');
  const field = page.getByLabel('PDF password');
  await field.fill('wrong');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect password. Try again.', { timeout: 30000 });
  await field.fill('secret');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Pages: 3')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Compress PDF', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.locator('.result, .error')).toBeVisible({ timeout: 120000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/compressed copy has no password/)).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download PDF' }).click();
  const bytes = new Uint8Array(await readFile((await (await downloadEvent).path())!));
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 });
  try { expect((await task.promise).numPages).toBe(3); } finally { await task.destroy(); }
});
test('drag and drop works with a standard file',async({page})=>{
  await page.goto('/en/');
  const bytes=Array.from(await readFile('tests/fixtures/text-vector.pdf'));
  await page.locator('.drop').evaluate((drop,data)=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(data)],'dropped.pdf',{type:'application/pdf'}));drop.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));},bytes);
  await expect(page.getByText('dropped.pdf',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Compress PDF',exact:true})).toBeEnabled();
});
test('share target opens the shared PDF and keeps no copy', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Web Share Target is a Chromium (Android) feature');
  await page.goto('/en/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  const bytes = Array.from(await readFile('tests/fixtures/scan.pdf'));
  // What Android does when a PDF is shared to the installed app. The
  // site's CSP forbids its own forms, so post from a blank page instead.
  const origin = new URL(page.url()).origin;
  await page.goto('about:blank');
  await page.evaluate(({ data, action }) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = action;
    form.enctype = 'multipart/form-data';
    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'file';
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data)], 'shared scan.pdf', { type: 'application/pdf' }));
    input.files = transfer.files;
    form.append(input);
    document.body.append(form);
    form.submit();
  }, { data: bytes, action: `${origin}/share-target` });
  await expect(page.getByText('shared scan.pdf', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/en\/$/);
  await expect.poll(() => page.evaluate(() => caches.has('pdf-kha-do-shared'))).toBe(false);
});
