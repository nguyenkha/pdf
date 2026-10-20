import { createElement } from "react";

function readable(text: string): string {
  return text
    .replace(/\\([\\`*_{}[\]()#+.!|~-])/g, "$1")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/** Renders the headings, page breaks and text emitted by makeMarkdown. */
export function MarkdownPreview({ markdown }: { markdown: string }) {
  return (
    <article className="md-preview" aria-label="Xem trước Markdown">
      {markdown
        .trim()
        .split(/\n\s*\n/)
        .map((block, index) => {
          if (block === "---") return <hr key={index} />;
          const heading = /^(#{1,6}) (.*)$/.exec(block);
          if (heading)
            return createElement(
              `h${Math.min(6, heading[1].length + 1)}`,
              { key: index },
              readable(heading[2]),
            );
          if (/^\*[^*]+\*$/.test(block))
            return (
              <p key={index}>
                <em>{readable(block.slice(1, -1))}</em>
              </p>
            );
          // React inserts text nodes; decoded PDF content never becomes HTML.
          return <p key={index}>{readable(block)}</p>;
        })}
    </article>
  );
}
