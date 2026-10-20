import { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Messages } from "../i18n";
import { availableTools } from "../app/tools";
import { canHandOver, handOver } from "../lib/handOver";
/**
 * "Next:" with up to two related tools, as quiet links under a result. The
 * finished file goes along in memory (see handOver), so the next tool opens
 * with it already chosen. Hidden where no service worker can carry it.
 */
export function NextSteps({
  t,
  locale,
  file,
  steps,
}: {
  t: Messages;
  locale: string;
  file: File;
  steps: { tool: string; label: string }[];
}) {
  const [going, setGoing] = useState(false);
  const shown = steps.filter((step) => availableTools.some((tool) => tool.id === step.tool)).slice(0, 2);
  if (!shown.length || !canHandOver()) return null;
  return (
    <p className="next-steps">
      <span>{t.nextSteps}</span>
      {shown.map((step) => {
        const tool = availableTools.find((candidate) => candidate.id === step.tool)!;
        return (
          <button
            type="button"
            key={step.tool}
            disabled={going}
            onClick={async () => {
              setGoing(true);
              if (!(await handOver([file], `/${locale}/${tool.slug}/`))) setGoing(false);
            }}
          >
            {step.label}
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        );
      })}
    </p>
  );
}
