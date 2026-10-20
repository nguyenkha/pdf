import { useContext, type ReactNode } from "react";
import { fillLabel, PreviewLabelsContext } from "./labels";
import { readableMarkdown } from "./text";
import { safeUrl } from "./structure";
export function InlineMarkdown({ text }: { text: string }) {
  const labels = useContext(PreviewLabelsContext);
  const nodes: ReactNode[] = [];
  let plain = "";
  let i = 0;
  const flush = () => {
    if (plain) {
      nodes.push(readableMarkdown(plain));
      plain = "";
    }
  };
  while (i < text.length) {
    if (text[i] === "\\") {
      plain += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    const reference = /^\[\^(p\d+-(\d+))\]/.exec(text.slice(i));
    if (reference) {
      flush();
      nodes.push(
        <sup key={i}>
          <a
            href={`#fn-${reference[1]}`}
            aria-label={fillLabel(labels.footnote, { note: reference[2] })}
          >
            {reference[2]}
          </a>
        </sup>,
      );
      i += reference[0].length;
      continue;
    }
    if (text[i] === "[") {
      let end = i + 1;
      while (end < text.length) {
        if (text[end] === "\\") {
          end += 2;
          continue;
        }
        if (text[end] === "]") break;
        end++;
      }
      if (text.slice(end, end + 3) === "](<") {
        const close = text.indexOf(">)", end + 3);
        if (close !== -1) {
          const url = safeUrl(text.slice(end + 3, close));
          if (url) {
            flush();
            nodes.push(
              <button
                type="button"
                role="link"
                className="md-inline-link"
                key={i}
                title={url}
                onClick={() =>
                  window.open(url, "_blank", "noopener,noreferrer")
                }
              >
                {readableMarkdown(text.slice(i + 1, end))}
              </button>,
            );
            i = close + 2;
            continue;
          }
        }
      }
    }
    plain += text[i++];
  }
  flush();
  return <>{nodes}</>;
}
