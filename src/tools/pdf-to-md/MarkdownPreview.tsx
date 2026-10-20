import { parseTableHtml } from "./table-html";
import { createElement } from "react";
import { splitTableRow } from "./tables";

import { readableMarkdown as readable } from "./text";
import { InlineMarkdown } from "./InlineMarkdown";

/** Renders the headings, page breaks and text emitted by makeMarkdown. */
export function MarkdownPreview({ markdown }: { markdown: string }) {
  return (
    <article className="md-preview" aria-label="Xem trước Markdown">
      {markdown
        .trim()
        .split(/\n\s*\n/)
        .map((block, index) => {
          if (block === "---") return <hr key={index} />;
          const grid = parseTableHtml(block);
          if (grid)
            return (
              <div className="md-table-scroll" key={index}>
                <table aria-label="Bảng dữ liệu nhận diện">
                  <tbody>
                    {grid.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td
                            key={c}
                            rowSpan={cell.rowSpan}
                            colSpan={cell.colSpan}
                            style={{ whiteSpace: "pre-wrap" }}
                          >
                            {cell.text}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          const rows = block.split("\n");
          if (
            rows.length >= 3 &&
            rows.every((row) => row.startsWith("|") && row.endsWith("|")) &&
            splitTableRow(rows[1]).every((cell) => /^:?-{3,}:?$/.test(cell))
          ) {
            const head = splitTableRow(rows[0]);
            return (
              <div className="md-table-scroll" key={index}>
                <table aria-label="Bảng dữ liệu nhận diện">
                  <thead>
                    <tr>
                      {head.map((cell, col) => (
                        <th scope="col" key={col}>
                          {readable(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(2).map((row, i) => (
                      <tr key={i}>
                        {splitTableRow(row).map((cell, col) => (
                          <td key={col}>{readable(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          const note = /^\[\^(p\d+-(\d+))\]: (.+)$/s.exec(block);
          if (note)
            return (
              <p className="md-footnote" id={`fn-${note[1]}`} key={index}>
                <sup>{note[2]}</sup> <InlineMarkdown text={note[3]} />
              </p>
            );
          const items = block.split("\n");
          const list = items.map((row) => /^(-|\d+\.) (.+)$/.exec(row));
          if (list.every((item) => item !== null)) {
            const ordered = /^\d/.test(list[0]![1]);
            const content = list.map((item, i) => (
              <li key={i} value={ordered ? parseInt(item![1]) : undefined}>
                <InlineMarkdown text={item![2]} />
              </li>
            ));
            return ordered ? (
              <ol key={index} start={parseInt(list[0]![1])}>
                {content}
              </ol>
            ) : (
              <ul key={index}>{content}</ul>
            );
          }
          const heading = /^(#{1,6}) (.*)$/.exec(block);
          if (heading)
            return createElement(
              `h${Math.min(6, heading[1].length + 1)}`,
              { key: index },
              <InlineMarkdown text={heading[2]} />,
            );
          if (/^\*[^*]+\*$/.test(block))
            return (
              <p key={index}>
                <em>
                  <InlineMarkdown text={block.slice(1, -1)} />
                </em>
              </p>
            );
          // React inserts text nodes; decoded PDF content never becomes HTML.
          return (
            <p key={index}>
              <InlineMarkdown text={block} />
            </p>
          );
        })}
    </article>
  );
}
