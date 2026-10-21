import { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Messages } from "../i18n";
import { availableTools } from "../app/tools";
import { canHandOver, handOver } from "../lib/handOver";
/**
 * Files meant for another tool ("that's a PDF, not an image"): one button
 * takes them there, already chosen. Without a service worker to carry them
 * it is a plain link to that tool.
 */
export function OtherToolOffer({
  t,
  locale,
  files,
  tool,
  text,
}: {
  t: Messages;
  locale: string;
  files: File[];
  tool: string;
  text: string;
}) {
  const [going, setGoing] = useState(false);
  const target = availableTools.find((candidate) => candidate.id === tool);
  if (!target) return null;
  const path = `/${locale}/${target.slug}/`;
  const name = t[target.nameKey] as string;
  return (
    <div className="suggestion other-tool" role="alert">
      <p>{text}</p>
      {canHandOver() ? (
        <button
          type="button"
          className="secondary"
          disabled={going}
          onClick={async () => {
            setGoing(true);
            if (!(await handOver(files, path))) location.assign(path);
          }}
        >
          {name}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      ) : (
        <a className="secondary" href={path}>
          {name}
          <ArrowRight size={15} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
