import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const path = "/experiments/pdf-to-md/";
test("extracts selectable text and downloads Markdown without transmitting PDF data", async ({
  page,
}) => {
  const requests: { url: string; method: string }[] = [];
  page
    .context()
    .on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
  await page.goto(path);
  expect(requests.some((r) => r.url.includes("extract.worker"))).toBe(false);
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/text-vector.pdf");
  await page.getByRole("button", { name: "Chuyển sang Markdown" }).click();
  await expect(
    page.getByRole("article", { name: "Xem trước Markdown" }),
  ).toContainText("Selectable page 1");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.getByLabel("Nội dung Markdown")).toHaveValue(
    /Selectable page 1/,
  );
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: "Tải Markdown" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("text-vector.md");
  expect(await readFile((await download.path())!, "utf8")).toContain(
    "## Trang 1",
  );
  const origin = new URL(page.url()).origin;
  expect(
    requests.every(
      (r) =>
        r.method === "GET" &&
        (!r.url.startsWith("http") || new URL(r.url).origin === origin),
    ),
  ).toBe(true);
  expect(requests.some((r) => r.url.includes("text-vector.pdf"))).toBe(false);
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker.getRegistrations().then((r) => r.length),
    ),
  ).toBe(0);
});
test("keeps all pages of a mixed PDF", async ({ page }) => {
  await page.goto(path);
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/multipage.pdf");
  await page.getByRole("button", { name: "Chuyển sang Markdown" }).click();
  await expect(
    page.getByRole("article", { name: "Xem trước Markdown" }),
  ).toContainText("Selectable page 3");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.getByLabel("Nội dung Markdown")).toHaveValue(
    /## Trang 3[\s\S]*Selectable page 3/,
  );
});
for (const [file, message] of [
  ["scan", "chưa hỗ trợ OCR"],
  ["password", "chưa hỗ trợ PDF có mật khẩu"],
  ["corrupted", "Không đọc được PDF"],
]) {
  test(`${file}: explains the limitation without a misleading download`, async ({
    page,
  }) => {
    await page.goto(path);
    await page
      .locator("input[type=file]")
      .setInputFiles(`tests/fixtures/${file}.pdf`);
    await page.getByRole("button", { name: "Chuyển sang Markdown" }).click();
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(page.getByRole("link", { name: "Tải Markdown" })).toHaveCount(
      0,
    );
  });
}
test("rejects a non-PDF", async ({ page }) => {
  await page.goto(path);
  await page.locator("input[type=file]").setInputFiles({
    name: "text.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.getByRole("alert")).toHaveText("Chọn một file PDF hợp lệ.");
});

test("reflows paragraphs and headings and can restore repeated margins and original lines", async ({
  page,
}) => {
  await page.goto(path);
  await page
    .locator("input[type=file]")
    .setInputFiles("experiments/pdf-to-md/fixtures/structured.pdf");
  await page.getByRole("button", { name: "Chuyển sang Markdown" }).click();
  await expect(
    page.getByRole("article", { name: "Xem trước Markdown" }),
  ).toContainText("This paragraph was wrapped onto a second line.");
  await expect(
    page.getByRole("heading", { name: "Project report", exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(/Đã bỏ 8 dòng header\/footer/)).toBeVisible();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.getByLabel("Nội dung Markdown")).toHaveValue(
    /### Project report/,
  );
  await expect(page.getByLabel("Nội dung Markdown")).not.toHaveValue(
    /SYNTHETIC REPORT/,
  );
  await page.getByLabel("Giữ xuống dòng gốc").check();
  await expect(page.getByLabel("Nội dung Markdown")).toHaveValue(
    /This paragraph was wrapped\nonto a second line/,
  );
  await page.getByLabel("Bỏ header/footer lặp").uncheck();
  await expect(page.getByLabel("Nội dung Markdown")).toHaveValue(
    /SYNTHETIC REPORT/,
  );
  await expect(page.getByLabel("Nội dung Markdown")).toHaveValue(/Page 4 of 4/);
  await page.getByLabel("Nhận diện tiêu đề").uncheck();
  await expect(page.getByLabel("Nội dung Markdown")).not.toHaveValue(
    /### Project report/,
  );
});

test("shows PDF and matching Markdown pages without retaining a closed parser worker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = window.Worker;
    const records: { url: string; terminated: boolean }[] = [];
    Object.assign(window, { previewWorkers: records });
    window.Worker = class extends Original {
      record: { url: string; terminated: boolean };
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.record = { url: String(url), terminated: false };
        records.push(this.record);
      }
      terminate() {
        this.record.terminated = true;
        super.terminate();
      }
    };
  });
  await page.goto(path);
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/multipage.pdf");
  await page.getByRole("button", { name: "Chuyển sang Markdown" }).click();
  await expect(
    page.getByRole("article", { name: "Xem trước Markdown" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "So sánh với PDF" }).click();
  await expect(page.getByLabel("PDF gốc, trang 1")).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByLabel("PDF gốc, trang 1")
        .evaluate((canvas: HTMLCanvasElement) => canvas.height),
    )
    .toBeGreaterThan(150);
  await page.getByRole("button", { name: "Trang sau" }).click();
  await expect(
    page.getByRole("article", { name: "Xem trước Markdown" }),
  ).toContainText("Selectable page 2");
  await expect(
    page.getByRole("article", { name: "Xem trước Markdown" }),
  ).not.toContainText("Selectable page 1");
  await page.getByRole("button", { name: "So sánh với PDF" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          Reflect.get(window, "previewWorkers") as {
            url: string;
            terminated: boolean;
          }[]
        )
          .filter((worker) => worker.url.includes("pdf.worker"))
          .every((worker) => worker.terminated),
      ),
    )
    .toBe(true);
  await page.route("**/pdf.worker.mjs*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue().catch(() => {});
  });
  await page.getByRole("button", { name: "So sánh với PDF" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            Reflect.get(window, "previewWorkers") as {
              url: string;
              terminated: boolean;
            }[]
          ).filter((worker) => worker.url.includes("pdf.worker")).length,
      ),
    )
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "So sánh với PDF" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          Reflect.get(window, "previewWorkers") as {
            url: string;
            terminated: boolean;
          }[]
        )
          .filter((worker) => worker.url.includes("pdf.worker"))
          .every((worker) => worker.terminated),
      ),
    )
    .toBe(true);
});

test("Copy writes Markdown on request and has a manual fallback", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          Object.assign(window, { copiedMarkdown: text });
        },
      },
    }),
  );
  await page.goto(path);
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/text-vector.pdf");
  await page.getByRole("button", { name: "Chuyển sang Markdown" }).click();
  await page.getByRole("button", { name: "Copy Markdown" }).click();
  await expect(page.getByText("Đã copy Markdown.")).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, "copiedMarkdown")),
  ).toContain("Selectable page 1");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Copy Markdown" }).click();
  await expect(page.getByText(/Trình duyệt không cho phép copy/)).toBeVisible();
  await expect(page.getByLabel("Nội dung Markdown")).toBeFocused();
});

test("recognizes a simple table, previews it and exports its own CSV",async({page})=>{
 await page.goto(path);await page.locator('input[type=file]').setInputFiles('experiments/pdf-to-md/fixtures/simple-table.pdf');await page.getByRole('button',{name:'Chuyển sang Markdown'}).click();
 await expect(page.getByRole('table',{name:'Bảng dữ liệu nhận diện'})).toBeVisible();await expect(page.getByRole('cell',{name:'Apple',exact:true})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('link',{name:'CSV · Bảng 1 · Trang 1'}).click();const result=await download;expect(result.suggestedFilename()).toBe('table-page-1-1.csv');expect(await readFile((await result.path())!,'utf8')).toContain('"Apple","12","$24"');
 await page.getByLabel('Nhận diện bảng đơn giản').uncheck();await expect(page.getByRole('table')).toHaveCount(0);await expect(page.getByRole('article',{name:'Xem trước Markdown'})).toContainText('Apple');await expect(page.getByRole('link',{name:/CSV · Bảng/})).toHaveCount(0);
});
