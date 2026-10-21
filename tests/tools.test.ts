import { describe, it, expect } from "vitest";
import { availableTools, pageFromPath, relatedPages, toolFromPath, tools } from "../src/app/tools";

describe("tool registry", () => {
  it("routes home and size pages to compress", () => {
    expect(toolFromPath("/vi/").id).toBe("compress");
    expect(toolFromPath("/en/compress-pdf-to-1mb/").id).toBe("compress");
    expect(toolFromPath("/en/privacy/").id).toBe("compress");
  });
  it("routes every built tool by its slug", () => {
    expect(toolFromPath("/en/pdf-to-jpg/").id).toBe("pdf-to-images");
    expect(toolFromPath("/en/jpg-to-pdf/").id).toBe("images-to-pdf");
    expect(toolFromPath("/en/merge/").id).toBe("merge");
    expect(availableTools.every((tool) => tool.load)).toBe(true);
  });
  it("routes landing pages to their tool with their own texts", () => {
    expect(toolFromPath("/vi/rotate-pdf/").id).toBe("organize");
    expect(pageFromPath("/vi/rotate-pdf/").nameKey).toBe("toolRotate");
    expect(toolFromPath("/en/delete-pdf-pages/").id).toBe("organize");
    expect(pageFromPath("/en/organize/").nameKey).toBe("toolOrganize");
    expect(pageFromPath("/en/merge/").id).toBe("merge");
    expect(toolFromPath("/en/png-to-pdf/").id).toBe("images-to-pdf");
    expect(toolFromPath("/en/pdf-to-png/").id).toBe("pdf-to-images");
    expect(pageFromPath("/en/pdf-to-image/").nameKey).toBe("toolPdfToImage");
  });
  it("links a tool's pages and its reverse tool's", () => {
    const tool = (id: string) => tools.find((item) => item.id === id)!;
    expect(relatedPages(tool("images-to-pdf")).map((page) => page.slug)).toEqual([
      "jpg-to-pdf", "png-to-pdf", "image-to-pdf", "pdf-to-jpg", "pdf-to-png", "pdf-to-image",
    ]);
    expect(relatedPages(tool("organize")).map((page) => page.slug)).toEqual(["organize", "rotate-pdf", "delete-pdf-pages"]);
    expect(relatedPages(tool("merge"))).toEqual([]);
  });
  it("has unique ids and slugs", () => {
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(tools.length);
    const slugs = tools.flatMap((tool) => [tool.slug, ...(tool.pages ?? []).map((page) => page.slug)]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
