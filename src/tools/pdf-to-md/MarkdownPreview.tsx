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
          if (block.startsWith("## "))
            return <h3 key={index}>{readable(block.slice(3))}</h3>;
          if (block.startsWith("# "))
            return <h2 key={index}>{readable(block.slice(2))}</h2>;
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
