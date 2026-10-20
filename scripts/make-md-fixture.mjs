import fs from "node:fs";
const objects = [];
const add = (value) => {
  objects.push(value);
  return objects.length;
};
const catalog = add("");
const tree = add("");
const normal = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
const pages = [];
const line = (text, x, y, size = 12, font = "F1") =>
  `BT /${font} ${size} Tf ${x} ${y} Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET\n`;
for (let i = 1; i <= 4; i++) {
  const content =
    line("SYNTHETIC REPORT", 50, 770, 9) +
    line("Project report", 50, 690, 24, "F2") +
    line("This paragraph was wrapped", 50, 650) +
    line("onto a second line.", 50, 634) +
    line("Another paragraph remains separate.", 50, 600) +
    line("Subsection", 50, 550, 16, "F2") +
    line("privacy-", 50, 516) +
    line("first tools stay local.", 50, 500) +
    line(`Page ${i} of 4`, 270, 20, 9);
  const stream = add(
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  );
  pages.push(
    add(
      `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${normal} 0 R /F2 ${bold} 0 R >> >> /Contents ${stream} 0 R >>`,
    ),
  );
}
objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
objects[tree - 1] =
  `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((p) => `${p} 0 R`).join(" ")}] >>`;
let pdf = "%PDF-1.4\n";
const offsets = [0];
objects.forEach((obj, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf +=
  `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
  offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("") +
  `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.mkdirSync("experiments/pdf-to-md/fixtures", { recursive: true });
fs.writeFileSync("experiments/pdf-to-md/fixtures/structured.pdf", pdf);
