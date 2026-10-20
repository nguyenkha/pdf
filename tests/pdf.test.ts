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
import { samplePages } from "../src/engines/validate";
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
        { pages: [{ ...page, thumbnail: new Uint8Array([0, 0, 0, 255]) }] },
        { pages: [{ ...page, thumbnail: new Uint8Array([255, 255, 255, 255]) }] },
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
    const result = await compressWithGhostscript(
      100,
      { preference: "quality", imageQuality: "auto" },
      () => {},
      async () => ({ bytes: new Uint8Array(110), heapBytes: 64 }),
      async () => {},
    );
    expect(result.bytes).toBeUndefined();
    expect(result.lossy).toBe(false);
  });
  it("finds the best-looking result under a limit by binary search", async () => {
    // Ladder (after lossless) has 8 rows; sizes fall with each row.
    const sizes = [95, 90, 80, 70, 55, 45, 30, 20];
    const tried: number[] = [];
    const result = await compressWithGhostscript(
      100,
      { preference: "quality", imageQuality: "auto", target: 50 },
      () => {},
      async (profile) => {
        const row = attemptsFor({ preference: "quality", imageQuality: "auto", target: 50 })
          .slice(1)
          .findIndex((p) => p.quality === profile.quality);
        tried.push(row);
        return { bytes: new Uint8Array(sizes[row]), heapBytes: 64 };
      },
      async () => {},
    );
    expect(result.bytes?.length).toBe(45);
    expect(result.achieved).toBe(true);
    expect(tried.length).toBeLessThanOrEqual(4);
    expect(tried).not.toContain(-1);
  });
  it("tries lossless first only when the limit is near the original size", async () => {
    const qualities: number[] = [];
    await compressWithGhostscript(
      100,
      { preference: "quality", imageQuality: "auto", target: 95 },
      () => {},
      async (profile) => {
        qualities.push(profile.quality);
        return { bytes: new Uint8Array(90), heapBytes: 64 };
      },
      async () => {},
    );
    expect(qualities).toEqual([101]);
  });
  it("falls back to the smallest result when the limit is out of reach", async () => {
    const result = await compressWithGhostscript(
      100,
      { preference: "quality", imageQuality: "auto", target: 1 },
      () => {},
      async (profile) => ({ bytes: new Uint8Array(profile.quality), heapBytes: 64 }),
      async () => {},
    );
    expect(result.bytes?.length).toBe(25);
    expect(result.achieved).toBe(false);
  });
  it("never releases a result after a preservation failure", async () => {
    await expect(
      compressWithGhostscript(
        100,
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
      100,
      { preference: "smallest", imageQuality: "auto" },
      (progress) => values.push(progress.value),
      async (_profile, onPage) => {
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
    expect(limitChoices(3 * MB)).toEqual([0.1 * MB, 0.2 * MB, 0.5 * MB, 1 * MB, 2 * MB]);
    expect(limitChoices(0.05 * MB)).toEqual([]);
  });
  it("suggests the tightest limit the page count can reach", () => {
    expect(suggestedLimit(30 * MB, 3)).toBe(0.5 * MB);
    expect(suggestedLimit(30 * MB, 1)).toBe(0.1 * MB);
    expect(suggestedLimit(30 * MB, 40)).toBe(5 * MB);
    expect(suggestedLimit(3 * MB, 100)).toBe(2 * MB);
    expect(suggestedLimit(0.05 * MB, 1)).toBeUndefined();
  });
});

describe("attempt ladder", () => {
  it("smallest without a target tries lossless and the two strongest", () => {
    const attempts = attemptsFor({ preference: "smallest", imageQuality: "auto" });
    expect(attempts.map((profile) => profile.dpi)).toEqual([0, 150, 96]);
  });
  it("a target keeps the full quality-first ladder", () => {
    expect(
      attemptsFor({ preference: "smallest", imageQuality: "auto", target: 10 })
        .length,
    ).toBe(9);
  });
});

describe("lazy preservation check", () => {
  it("validates only the released result, once", async () => {
    const sizes = [90, 70, 60];
    let index = 0;
    const checked: number[] = [];
    const result = await compressWithGhostscript(
      100,
      { preference: "smallest", imageQuality: "auto" },
      () => {},
      async () => ({ bytes: new Uint8Array(sizes[index++] ?? 99), heapBytes: 64 }),
      async (bytes) => {
        checked.push(bytes.length);
      },
    );
    expect(result.bytes?.length).toBe(60);
    expect(checked).toEqual([60]);
  });
  it("skips the check when the original is kept", async () => {
    let checks = 0;
    await compressWithGhostscript(
      100,
      { preference: "balanced", imageQuality: "auto" },
      () => {},
      async () => ({ bytes: new Uint8Array(120), heapBytes: 64 }),
      async () => {
        checks++;
      },
    );
    expect(checks).toBe(0);
  });
});

describe("grayscale and screen resolution", () => {
  it("accepts a grayscale copy of a colored page of equal brightness", () =>
    expect(() =>
      verifyShape(
        { pages: [{ ...page, thumbnail: new Uint8Array([200, 100, 50, 255]) }] },
        { pages: [{ ...page, thumbnail: new Uint8Array([124, 124, 124, 255]) }] },
      ),
    ).not.toThrow());
  it("recommended downsamples to 150 dpi, quality keeps full resolution", () => {
    const dpi = (preference: "balanced" | "quality") =>
      attemptsFor({ preference, imageQuality: "auto" }).slice(1).map((p) => p.dpi);
    expect(dpi("balanced").every((value) => value === 150)).toBe(true);
    expect(dpi("quality").every((value) => value === 0)).toBe(true);
  });
  it("grayscale skips the lossless pass and converts every pass", () => {
    const attempts = attemptsFor({ preference: "balanced", imageQuality: "auto", gray: true });
    expect(attempts.every((p) => p.gray && p.quality <= 100)).toBe(true);
    expect(ghostscriptArgs(attempts[0])).toContain("-sColorConversionStrategy=Gray");
  });
});

describe("high quality", () => {
  it("does not settle for a negligible lossless saving", async () => {
    const sizes = [99, 80, 70];
    let index = 0;
    const result = await compressWithGhostscript(
      100,
      { preference: "quality", imageQuality: "auto" },
      () => {},
      async () => ({ bytes: new Uint8Array(sizes[index++]), heapBytes: 64 }),
      async () => {},
    );
    expect(result.bytes?.length).toBe(80);
    expect(result.attempts).toBe(2);
  });
});

describe("render sample", () => {
  it("checks every page of short documents", () =>
    expect([...samplePages(5)]).toEqual([1, 2, 3, 4, 5]));
  it("spreads eight pages over long ones, first and last included", () => {
    const sample = [...samplePages(23)];
    expect(sample).toHaveLength(8);
    expect(sample[0]).toBe(1);
    expect(sample.at(-1)).toBe(23);
  });
});

describe("image-heavy scans", () => {
  it("skip the lossless pass unless quality or a target is asked", async () => {
    const seen: number[] = [];
    const run = (options: Parameters<typeof compressWithGhostscript>[1]) =>
      compressWithGhostscript(
        10 * 1048576,
        options,
        () => {},
        async (profile) => {
          seen.push(profile.quality);
          return { bytes: new Uint8Array(10), heapBytes: 64 };
        },
        async () => {},
        true,
        10,
      );
    await run({ preference: "balanced", imageQuality: "auto" });
    expect(seen[0]).toBeLessThan(101);
    seen.length = 0;
    await run({ preference: "quality", imageQuality: "auto" });
    expect(seen[0]).toBe(101);
  });
});
