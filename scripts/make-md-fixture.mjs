import fs from "node:fs";
const line = (text, x, y, size = 12, font = "F1") =>
  `BT /${font} ${size} Tf ${x} ${y} Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET\n`;
function writePdf(name, contents, links = {}) {
  const objects = [];
  const add = (value) => {
    objects.push(value);
    return objects.length;
  };
  const catalog = add("");
  const tree = add("");
  const normal = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const bold = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  );
  const pages = [];
  contents.forEach((content, i) => {
    const stream = add(
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    );
    const annots = (links[i] ?? []).map((link) =>
      add(
        `<< /Type /Annot /Subtype /Link /Rect [${link.rect.join(" ")}] /A << /S /URI /URI (${link.url.replace(/[\\()]/g, "\\$&")}) >> >>`,
      ),
    );
    pages.push(
      add(
        `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${normal} 0 R /F2 ${bold} 0 R >> >> /Contents ${stream} 0 R ${annots.length ? `/Annots [${annots.map((n) => `${n} 0 R`).join(" ")}]` : ""} >>`,
      ),
    );
  });
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
  fs.writeFileSync(`experiments/pdf-to-md/fixtures/${name}`, pdf);
}
writePdf(
  "structured.pdf",
  Array.from(
    { length: 4 },
    (_, i) =>
      line("SYNTHETIC REPORT", 50, 770, 9) +
      line("Project report", 50, 690, 24, "F2") +
      line("This paragraph was wrapped", 50, 650) +
      line("onto a second line.", 50, 634) +
      line("Another paragraph remains separate.", 50, 600) +
      line("Subsection", 50, 550, 16, "F2") +
      line("privacy-", 50, 516) +
      line("first tools stay local.", 50, 500) +
      line(`Page ${i + 1} of 4`, 270, 20, 9),
  ),
);
writePdf("simple-table.pdf", [
  line("Synthetic table", 50, 720, 24, "F2") +
    [
      ["Product", "Count", "Price"],
      ["Apple", "12", "$24"],
      ["Pear", "8", "$16"],
      ["Plum", "5", "$10"],
    ]
      .map((row, r) =>
        row.map((cell, c) => line(cell, 50 + c * 150, 650 - r * 22)).join(""),
      )
      .join(""),
]);
writePdf("two-column.pdf", [
  line("Synthetic two-column reading order", 50, 740, 24, "F2") +
    [0, 1, 2, 3]
      .map(
        (i) =>
          line(`Left column sentence ${i + 1}.`, 50, 670 - i * 18) +
          line(`Right column sentence ${i + 1}.`, 340, 670 - i * 18),
      )
      .join(""),
]);
writePdf(
  "links-lists-notes.pdf",
  [
    line("Links lists and notes", 50, 740, 24, "F2") +
      line("Visit the reference website", 50, 680) +
      line("1. First ordered item", 50, 640) +
      line("2. Second ordered item", 50, 620) +
      line("- First bullet", 50, 580) +
      line("- Second bullet", 50, 560) +
      line("This statement has a note", 50, 500) +
      line("1", 195, 505, 8) +
      line("1 A synthetic explanatory footnote.", 50, 50, 9),
  ],
  { 0: [{ rect: [50, 677, 200, 695], url: "https://example.com/reference" }] },
);
// Closed ruled grids: merged cells, multiline text, blanks and a second table.
const rule = (x1, y1, x2, y2) => `${x1} ${y1} m ${x2} ${y2} l S\n`;
writePdf("ruled-tables.pdf", [
  line("Ruled tables", 50, 750, 24, "F2") +
    "0.5 w\n" +
    [700, 660, 610, 570].map((y) => rule(50, y, 500, y)).join("") +
    [50, 500].map((x) => rule(x, 570, x, 700)).join("") +
    rule(200, 570, 200, 660) +
    rule(350, 570, 350, 700) +
    line("Merged heading", 60, 678) +
    line("Value", 360, 678) +
    line("First line", 60, 640) +
    line("Second line", 60, 624) +
    line("42", 360, 638) +
    line("Last row", 60, 584) +
    line("8", 210, 584) +
    line("16", 360, 584) +
    [480, 440, 400].map((y) => rule(50, y, 350, y)).join("") +
    [50, 200, 350].map((x) => rule(x, 400, x, 480)).join("") +
    line("Name", 60, 455) +
    line("Count", 210, 455) +
    line("Pear", 60, 415) +
    line("2", 210, 415),
]);
