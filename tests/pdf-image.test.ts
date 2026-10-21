import { afterEach, describe, expect, it, vi } from "vitest";
import { imageSource } from "../src/tools/pdf-to-md/pdf-image";

afterEach(() => vi.unstubAllGlobals());
describe("bounded PDF image buffers", () => {
  it("rejects huge and invalid dimensions before creating a canvas", () => {
    const canvas = vi.fn();
    for (const [width, height] of [[20000, 20000], [Infinity, 1], [-1, 1], [0, 1], [1.5, 1]])
      expect(imageSource({ width, height, kind: 1, data: new Uint8Array(1) }, canvas)).toBeUndefined();
    expect(canvas).not.toHaveBeenCalled();
  });
  it("bounds the RGBA buffer as well as the output canvas", () => {
    const putImageData = vi.fn();
    vi.stubGlobal("ImageData", class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    const canvas = vi.fn(() => ({ getContext: () => ({ putImageData }) }) as unknown as HTMLCanvasElement);
    const source = { width: 4000, height: 4000, kind: 1, data: new Uint8Array(2_000_000).fill(255) };
    imageSource(source, canvas, 1000);
    expect(canvas).toHaveBeenCalledWith(1000, 1000);
    expect(putImageData.mock.calls[0][0].data.length).toBe(4_000_000);
    expect(putImageData.mock.calls[0][0].data[0]).toBe(255);
  });
  it("does not allocate for truncated pixel buffers", () => {
    const canvas = vi.fn();
    expect(imageSource({ width: 100, height: 100, kind: 3, data: new Uint8Array(4) }, canvas)).toBeUndefined();
    expect(canvas).not.toHaveBeenCalled();
  });
  it("accepts high-resolution scans above sixteen megapixels", () => {
    const bitmap = {} as ImageBitmap;
    expect(imageSource({ width: 4000, height: 5000, bitmap }, vi.fn())).toBe(bitmap);
  });
});
