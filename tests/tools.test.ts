import { describe, it, expect } from "vitest";
import { availableTools, toolFromPath, tools } from "../src/app/tools";

describe("tool registry", () => {
  it("routes home and size pages to compress", () => {
    expect(toolFromPath("/vi/").id).toBe("compress");
    expect(toolFromPath("/en/compress-pdf-to-1mb/").id).toBe("compress");
    expect(toolFromPath("/en/privacy/").id).toBe("compress");
  });
  it("never routes to a planned tool", () => {
    expect(toolFromPath("/en/pdf-to-jpg/").id).toBe("compress");
    expect(toolFromPath("/en/merge/").id).toBe("merge");
    expect(availableTools.every((tool) => tool.load)).toBe(true);
  });
  it("has unique ids and slugs", () => {
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(tools.length);
    expect(new Set(tools.map((tool) => tool.slug)).size).toBe(tools.length);
  });
});
