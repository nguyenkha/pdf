import { createElement } from "react";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownPreview } from "../src/tools/pdf-to-md/MarkdownPreview";
import { makeMarkdown } from "../src/tools/pdf-to-md/markdown";

it("renders generated headings, page breaks and plain text", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownPreview, {
      markdown: makeMarkdown("test.pdf", ["Some text", "Next page"]),
    }),
  );
  expect(html).toContain("<h2>test</h2>");
  expect(html).toContain("<h3>Trang 2</h3>");
  expect(html).toContain("<hr/>");
});

it("keeps malicious PDF text inert without images, links or raw HTML", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownPreview, {
      markdown: makeMarkdown("test.pdf", [
        '<img src="https://example.invalid/leak" onerror="alert(1)"> [click](javascript:alert(1)) &lt;script&gt;',
      ]),
    }),
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<a ");
  expect(html).toContain("&lt;img");
  expect(html).toContain("[click](javascript:alert(1))");
  expect(html).toContain("&amp;lt;script&amp;gt;");
});
