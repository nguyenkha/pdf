// Builds a synthetic real-world corpus in tests/corpus/ with native
// Ghostscript: full-page 300 dpi scans (color and gray), a long text
// document, and one with bookmarks and page links. Nothing personal; every
// page is drawn from a seeded pattern, so runs are reproducible.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const out = "tests/corpus";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-"));
fs.mkdirSync(out, { recursive: true });
const gs = (args) => execFileSync("gs", ["-q", "-dBATCH", "-dNOPAUSE", ...args]);

// A "scanned page": paper tone, text lines, a photo-like block of many small
// shaded cells, a stamp. Seeded per page so every page differs.
const scanPage = (seed) => `
${seed} srand
/r { rand 2147483647 div } def
0.97 0.96 0.93 setrgbcolor 0 0 595 842 rectfill
/Helvetica findfont 9 scalefont setfont 0.15 setgray
40 1 75 { /i exch def 50 800 i 10 mul sub moveto
  (Synthetic scanned page ${seed} line - lorem ipsum dolor sit amet consectetur adipiscing) show } for
0 1 59 { /x exch def 0 1 39 { /y exch def
  r 0.6 mul 0.3 add r 0.5 mul 0.2 add r 0.4 mul 0.3 add setrgbcolor
  330 x 4 mul add 420 y 4 mul add 4 4 rectfill } for } for
0.7 0.1 0.1 setrgbcolor 3 setlinewidth 460 120 40 0 360 arc stroke
showpage
`;
function scans(name, pages, device) {
  const ps = path.join(work, `${name}.ps`);
  fs.writeFileSync(ps, Array.from({ length: pages }, (_, i) => scanPage(i + 1)).join("\n"));
  gs([`-sDEVICE=${device}`, "-r300", "-dJPEGQ=90", `-sOutputFile=${work}/${name}-%03d.jpg`, ps]);
  const viewer = execFileSync("gs", ["-q", "-dNODISPLAY", "-dNOSAFER", "-c", "(viewjpeg.ps) findlibfile { pop == } { (missing) = } ifelse quit"])
    .toString()
    .trim()
    .replace(/^\(|\)$/g, "");
  const list = path.join(work, `${name}-list.ps`);
  fs.writeFileSync(
    list,
    Array.from({ length: pages }, (_, i) => {
      const jpg = path.join(work, `${name}-${String(i + 1).padStart(3, "0")}.jpg`);
      return `<< /PageSize [595 842] >> setpagedevice gsave 595 2480 div 842 3508 div scale (${jpg}) viewJPEG grestore showpage`;
    }).join("\n"),
  );
  gs(["-dNOSAFER", "-sDEVICE=pdfwrite", "-dPassThroughJPEGImages=true", `-sOutputFile=${out}/${name}.pdf`, viewer, list]);
}
scans("scan-color-20p", 20, "jpeg");
scans("scan-gray-12p", 12, "jpeggray");

// Long vector text; and a document whose bookmarks and page links must
// survive (it is never split into page ranges).
const textPage = (n, marks) => `
/Times-Roman findfont 11 scalefont setfont
1 1 60 { /i exch def 60 790 i 12.5 mul sub moveto (Page ${n}: synthetic body text for the corpus, line ) show i 3 string cvs show } for
${marks ? `[ /Title (Chapter ${n}) /Page ${n} /View [/XYZ null null null] /OUT pdfmark
[ /Rect [60 40 200 60] /Page ${n === 1 ? 2 : 1} /View [/XYZ null null null] /Subtype /Link /LNK pdfmark
60 45 moveto (Go to page ${n === 1 ? 2 : 1}) show` : ""}
showpage`;
for (const [name, pages, marks] of [["text-80p", 80, false], ["bookmarks-30p", 30, true]]) {
  const ps = path.join(work, `${name}.ps`);
  fs.writeFileSync(ps, Array.from({ length: pages }, (_, i) => textPage(i + 1, marks)).join("\n"));
  gs(["-sDEVICE=pdfwrite", `-sOutputFile=${out}/${name}.pdf`, ps]);
}
fs.rmSync(work, { recursive: true, force: true });
for (const file of fs.readdirSync(out))
  console.log(file, (fs.statSync(path.join(out, file)).size / 1048576).toFixed(1), "MB");
