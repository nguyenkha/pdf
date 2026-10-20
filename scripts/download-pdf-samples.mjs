import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
const root =
  process.env.PDF_CORPUS_DIR ??
  path.join(os.homedir(), ".local/share/pdf-test-corpus/tables");
const revision = "2cdf3b4fd3f7e921dca8cc6814cdd9316be40f0f";
const names = [
  "AnimalSounds.pdf",
  "twotables.pdf",
  "spreadsheet_no_bounding_frame.pdf",
  "spanning_cells.pdf",
  "MultiColumn.pdf",
  "12s0324.pdf",
];
const sources = names.map((name) => ({
  name,
  url: `https://raw.githubusercontent.com/tabulapdf/tabula-java/${revision}/src/test/resources/technology/tabula/${name}`,
  license:
    "Upstream repository MIT; individual PDF redistribution rights not verified. Local testing only.",
}));
sources.push({
  name: "w3c-table.pdf",
  url: "https://w3c.github.io/wcag/working-examples/pdf-table-headers/table-example-repaired.pdf",
  license:
    "W3C WAI public working example; retain W3C notices. Local testing only.",
});
await fs.mkdir(root, { recursive: true });
const manifest = [];
for (const source of sources) {
  const response = await fetch(source.url, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`Download failed: ${source.name} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 5).toString() !== "%PDF-")
    throw new Error(`Invalid PDF: ${source.name}`);
  await fs.writeFile(path.join(root, source.name), bytes);
  manifest.push({
    ...source,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await fs.writeFile(
  path.join(root, "sources.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Saved ${manifest.length} public samples and source checksums to ${root}`,
);
