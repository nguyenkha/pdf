import { describe, expect, it } from "vitest";
import { markdownToText } from "../src/tools/pdf-to-md/plain";
import { escapeMarkdown } from "../src/tools/pdf-to-md/markdown";

describe("Markdown as plain text", () => {
  it("drops markup and keeps the words, escapes undone", () => {
    const markdown = [
      "# Report",
      "",
      "<!-- Page 1 -->",
      "",
      "## Results",
      "",
      escapeMarkdown("Cost: 5 * 3 = 15 [approx] | #1 _note_"),
      "",
      "- first item",
      "1\\. not a list",
      "",
      "See [the site](<https://example.org/>) and [https://kha.do/](<https://kha.do/>).[^1]",
      "",
      "[^1]: " + escapeMarkdown("A footnote."),
      "",
      "![Image 1, page 1](images/page-1-1.png)",
      "",
      "*No text layer on this page (scans need OCR).*",
      "",
      "---",
      "",
      "<!-- Page 2 -->",
      "",
      "| Name | Qty |",
      "| --- | --- |",
      "| A \\| B | 2 |",
      "",
      '<table data-pdf-table="true">',
      '<tr><td rowspan="1" colspan="2">Total &amp; tax<br>2026</td></tr>',
      "</table>",
    ].join("\n");
    expect(markdownToText(markdown)).toBe(
      [
        "Report",
        "",
        "Results",
        "",
        "Cost: 5 * 3 = 15 [approx] | #1 _note_",
        "",
        "- first item",
        "1. not a list",
        "",
        "See the site (https://example.org/) and https://kha.do/.[1]",
        "",
        "[1] A footnote.",
        "",
        "No text layer on this page (scans need OCR).",
        "",
        "Name\tQty",
        "A | B\t2",
        "",
        "Total & tax 2026",
        "",
      ].join("\n"),
    );
  });
  it("keeps text that only looks like markup", () => {
    const text = "<b>bold</b> & 3 < 4 -- a---b";
    expect(markdownToText(escapeMarkdown(text))).toBe(text + "\n");
  });
});
