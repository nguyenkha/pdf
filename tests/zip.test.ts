import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, uniqueNames, zipBlobs } from "../src/lib/zip";

const hasUnzip = (() => {
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
describe("zip", () => {
  it("computes the standard CRC-32", () =>
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686));
  it("keeps names unique", () =>
    expect(uniqueNames(["a.pdf", "b.pdf", "a.pdf", "a.pdf"])).toEqual([
      "a.pdf",
      "b.pdf",
      "a (2).pdf",
      "a (3).pdf",
    ]));
  it.skipIf(!hasUnzip)("writes an archive unzip accepts, UTF-8 names intact", async () => {
    const zip = await zipBlobs([
      { name: "một.pdf", blob: new Blob(["%PDF-1.7 one"]) },
      { name: "two.pdf", blob: new Blob(["%PDF-1.7 second file"]) },
    ]);
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const path = join(dir, "out.zip");
    writeFileSync(path, new Uint8Array(await zip.arrayBuffer()));
    expect(execFileSync("unzip", ["-t", path]).toString()).toContain("No errors detected");
    expect(execFileSync("unzip", ["-p", path, "two.pdf"]).toString()).toBe("%PDF-1.7 second file");
    // macOS unzip ignores the UTF-8 flag; Python's zipfile honours it.
    const names = execFileSync("python3", [
      "-I",
      "-c",
      "import sys,zipfile;print(','.join(zipfile.ZipFile(sys.argv[1]).namelist()))",
      path,
    ]).toString();
    expect(names.trim()).toBe("một.pdf,two.pdf");
  });
});
