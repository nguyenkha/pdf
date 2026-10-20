import { describe, it, expect } from "vitest";
import {
  formatSize,
  savings,
  targetBytes,
  validateFile,
  chooseCandidate,
  outputName,
} from "../src/lib/pdf";
import { resolveLocale, locales } from "../src/i18n/config";
import { verifyShape, type PdfShape } from "../src/lib/shape";
import {
  attemptsFor,
  ghostscriptArgs,
  compressWithGhostscript,
} from "../src/engines/ghostscript";
import {
  limitChoices,
  recommendedPreference,
  suggestedLimit,
} from "../src/lib/plan";

const page = {
  text: "Text",
  width: 595,
  height: 842,
  operators: 4,
  imageCount: 0,
  annotations: [],
};
const original: PdfShape = { pages: [page] };
describe("PDF helpers", () => {
  it("formats sizes by locale", () => {
    expect(formatSize(1048576, "en")).toBe("1 MB");
    expect(formatSize(1536, "de")).toBe("1,5 KB");
    expect(formatSize(0)).toBe("0 B");
  });
  it("never reports negative savings", () => {
    expect(savings(100, 60)).toBe(40);
    expect(savings(100, 110)).toBe(0);
  });
  it.each(["", "-2", "NaN", "Infinity", "0"])(
    "rejects invalid target %s",
    (value) => expect(targetBytes(value, "MB")).toBeUndefined(),
  );
  it("parses optional fractional targets", () =>
    expect(targetBytes("1.5", "MB")).toBe(1572864));
  it("resolves regional and unsupported locales", () => {
    expect(resolveLocale("xx")).toBe("en");
    expect(resolveLocale("zh-TW")).toBe("zh-CN");
    expect(resolveLocale("vi-VN")).toBe("vi");
    expect(resolveLocale("VI")).toBe("vi");
    expect(locales.at(-1)).toBe("vi");
  });
  it("validates files", () => {
    expect(
      validateFile(
        new File(["%PDF-test"], "a.pdf", { type: "application/pdf" }),
      ),
    ).toBeUndefined();
    expect(validateFile(new File(["hello"], "a.txt"))).toBe("invalid");
  });
  it("selects quality under target or smallest when missed", () => {
    const candidate = (size: number, quality: number) => ({
      bytes: new Uint8Array(size),
      quality,
      dpi: 0,
    });
    const choices = [candidate(60, 90), candidate(40, 70)];
    expect(chooseCandidate(choices, 100, 70)?.quality).toBe(90);
    expect(chooseCandidate(choices, 100, 50)?.bytes.length).toBe(40);
    expect(chooseCandidate(choices, 100, 30)?.bytes.length).toBe(40);
    expect(chooseCandidate([candidate(120, 90)], 100)).toBeUndefined();
  });
  it("preserves the original filename", () =>
    expect(outputName("A.PDF")).toBe("A-compressed.pdf"));
});

describe("preservation checks", () => {
  it("accepts unchanged content", () =>
    expect(() => verifyShape(original, original)).not.toThrow());
  it.each([
    { pages: [] },
    { pages: [{ ...page, text: "Lost text" }] },
    { pages: [{ ...page, operators: 0 }] },
    { pages: [{ ...page, width: 600 }] },
    { pages: [{ ...page, annotations: ["new action"] }] },
  ])("rejects changed document structure", (result) =>
    expect(() => verifyShape(original, result)).toThrow("preservation"),
  );
  it("rejects a severe visual regression", () => {
    expect(() =>
      verifyShape(
        { pages: [{ ...page, thumbnail: new Uint8Array([0, 0, 0]) }] },
        { pages: [{ ...page, thumbnail: new Uint8Array([255, 255, 255]) }] },
      ),
    ).toThrow("preservation");
  });
});

describe("quality-first pipeline", () => {
  it("tries original dimensions before downsampling", () => {
    const attempts = attemptsFor({
      preference: "quality",
      imageQuality: "auto",
      target: 50,
    });
    const firstDownsample = attempts.findIndex((profile) => profile.dpi > 0);
    expect(firstDownsample).toBeGreaterThan(3);
    expect(
      attempts.slice(0, firstDownsample).every((profile) => profile.dpi === 0),
    ).toBe(true);
    expect(ghostscriptArgs(attempts[0])).toContain(
      "-dDownsampleColorImages=false",
    );
    expect(ghostscriptArgs(attempts[0])).toContain(
      "-dColorImageFilter=/FlateEncode",
    );
  });
  it("retains the original when every result is larger", async () => {
    const bytes = new Uint8Array(100);
    const result = await compressWithGhostscript(
      bytes,
      { preference: "quality", imageQuality: "auto" },
      () => {},
      async () => ({ bytes: new Uint8Array(110), heapBytes: 64 }),
      async () => {},
    );
    expect(result.bytes).toBe(bytes);
    expect(result.lossy).toBe(false);
  });
  it("handles non-monotonic sizes and stops at the highest ranked valid result", async () => {
    const sizes = [120, 90, 95, 40];
    let index = 0;
    const result = await compressWithGhostscript(
      new Uint8Array(100),
      { preference: "quality", imageQuality: "auto", target: 50 },
      () => {},
      async () => ({ bytes: new Uint8Array(sizes[index++]), heapBytes: 64 }),
      async () => {},
    );
    expect(result.bytes.length).toBe(40);
    expect(result.attempts).toBe(4);
    expect(result.achieved).toBe(true);
  });
  it("never releases a result after a preservation failure", async () => {
    await expect(
      compressWithGhostscript(
        new Uint8Array(100),
        { preference: "quality", imageQuality: "auto" },
        () => {},
        async () => ({ bytes: new Uint8Array(50), heapBytes: 64 }),
        async () => {
          throw new Error("preservation");
        },
      ),
    ).rejects.toThrow("preservation");
  });
});

describe("page progress and passwords", () => {
  it("passes the password to Ghostscript only when given", () => {
    const profile = { quality: 101, dpi: 0 };
    expect(ghostscriptArgs(profile)).not.toContainEqual(
      expect.stringContaining("PDFPassword"),
    );
    expect(ghostscriptArgs(profile, "s3cret")).toContain(
      "-sPDFPassword=s3cret",
    );
    expect(ghostscriptArgs(profile, "s3cret").at(-1)).toBe("/input.pdf");
  });
  it("reports monotonic progress that ends at 100%", async () => {
    const values: number[] = [];
    const sizes = [120, 80, 60];
    let index = 0;
    await compressWithGhostscript(
      new Uint8Array(100),
      { preference: "smallest", imageQuality: "auto" },
      (progress) => values.push(progress.value),
      async (_input, _profile, onPage) => {
        for (let page = 1; page <= 4; page++) onPage(page);
        return { bytes: new Uint8Array(sizes[index++] ?? 50), heapBytes: 64 };
      },
      async (_bytes, onPage) => {
        for (let page = 1; page <= 4; page++) onPage(page);
      },
      true,
      4,
    );
    expect(values.at(-1)).toBe(1);
    expect(values.every((value, i) => i === 0 || value >= values[i - 1])).toBe(
      true,
    );
    expect(new Set(values).size).toBeGreaterThan(10);
  });
});

describe("compression plan", () => {
  const MB = 1048576;
  it("recommends image recompression only for image-heavy pages", () => {
    expect(recommendedPreference(10 * MB, 10, true)).toBe("balanced");
    expect(recommendedPreference(10 * MB, 10, false)).toBe("quality");
    expect(recommendedPreference(1 * MB, 20, true)).toBe("quality");
  });
  it("offers only limits below the file size", () => {
    expect(limitChoices(3 * MB)).toEqual([0.5 * MB, 1 * MB, 2 * MB]);
    expect(limitChoices(0.4 * MB)).toEqual([]);
  });
  it("suggests the tightest limit the page count can reach", () => {
    expect(suggestedLimit(30 * MB, 3)).toBe(0.5 * MB);
    expect(suggestedLimit(30 * MB, 40)).toBe(5 * MB);
    expect(suggestedLimit(3 * MB, 100)).toBe(2 * MB);
    expect(suggestedLimit(0.3 * MB, 1)).toBeUndefined();
  });
});
