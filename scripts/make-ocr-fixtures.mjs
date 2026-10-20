// Scanned-page fixtures for the OCR path: text drawn by Chromium, saved as a
// JPEG and wrapped as an image-only page, the way a scanner would. Run:
// node scripts/make-ocr-fixtures.mjs (needs Playwright's Chromium locally).
import fs from "node:fs";
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
await page.setContent(`<body style="margin:0;padding:140px 120px;background:#fdfdfb;color:#111;font:34px/1.5 Georgia,serif">
  <h1 style="font:bold 64px/1.2 Arial,sans-serif;margin:0 0 60px">Scanned Report</h1>
  <p>This page has no text layer. It was printed and scanned, so its words exist only as pixels in an image.</p>
  <p>Optical character recognition reads those pixels back into text that can be searched and copied.</p>
</body>`);
const scan = await page.screenshot({ type: "jpeg", quality: 80 });
// A ruled table, scanned a little crooked, with empty cells in the total rows.
const cell = 'style="border:2px solid #222;padding:10px 16px"';
await page.setContent(`<body style="margin:0;padding:140px 120px;background:#fdfdfb;color:#111;font:30px/1.4 Georgia,serif">
  <div style="transform:rotate(0.6deg);transform-origin:top left">
  <h1 style="font:bold 56px/1.2 Arial,sans-serif;margin:0 0 50px">Invoice</h1>
  <table style="border-collapse:collapse;width:100%">
    ${[["Item", "Qty", "Price", "Amount"], ["Paper", "10", "8.50", "85.00"], ["Toner", "2", "62.00", "124.00"], ["Folders", "50", "0.60", "30.00"], ["Total", "", "", "239.00"]]
      .map((row) => `<tr>${row.map((value) => `<td ${cell}>${value}</td>`).join("")}</tr>`)
      .join("")}
  </table></div>
</body>`);
const table = await page.screenshot({ type: "jpeg", quality: 80 });
await browser.close();

/** A minimal PDF: pages are either the scan image or one line of real text. */
function pdf(pages) {
  const objects = [];
  const add = (body) => objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body)) && objects.length;
  const stream = (data, extra = "") =>
    Buffer.concat([Buffer.from(`<< /Length ${data.length} ${extra} >>\nstream\n`), data, Buffer.from("\nendstream")]);
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const picture = pages.includes("table") ? table : scan;
  const image = add(stream(picture, "/Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode"));
  const kids = pages.map((kind) => {
    const content =
      kind !== "text"
        ? "q 595 0 0 842 0 0 cm /Im1 Do Q"
        : "BT /F1 24 Tf 72 760 Td (Typed Introduction) Tj ET BT /F1 12 Tf 72 720 Td (This first page has a real text layer.) Tj ET";
    const contents = add(stream(Buffer.from(content)));
    return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contents} 0 R /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >> >>`);
  });
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const chunks = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let length = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    chunks.push(chunk);
    length += chunk.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  return Buffer.concat([...chunks, Buffer.from(xref)]);
}
fs.writeFileSync("tests/fixtures/scanned-text.pdf", pdf(["scan"]));
fs.writeFileSync("tests/fixtures/mixed-scan.pdf", pdf(["text", "scan"]));
fs.writeFileSync("tests/fixtures/scanned-table.pdf", pdf(["table"]));
