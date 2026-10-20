import { createElement } from "react";
import { splitTableRow } from "./tables";

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
          const rows = block.split("\n");
          if (rows.length >= 3 && rows.every(row => row.startsWith("|") && row.endsWith("|")) && splitTableRow(rows[1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
            const head = splitTableRow(rows[0]);
            return <div className="md-table-scroll" key={index}><table aria-label="Bảng dữ liệu nhận diện"><thead><tr>{head.map((cell,col)=><th scope="col" key={col}>{readable(cell)}</th>)}</tr></thead><tbody>{rows.slice(2).map((row,i)=><tr key={i}>{splitTableRow(row).map((cell,col)=><td key={col}>{readable(cell)}</td>)}</tr>)}</tbody></table></div>;
          }
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
