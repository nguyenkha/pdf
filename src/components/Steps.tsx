import { Check } from "lucide-react";
import type { Messages } from "../i18n";
export function Steps({
  t,
  current,
  labels = [t.stepFile, t.stepLevel, t.stepDownload],
}: {
  t: Messages;
  current: number;
  labels?: string[];
}) {
  return (
    <ol className="steps">
      {labels.map((label, index) => {
        const number = index + 1;
        const state =
          number < current ? "done" : number === current ? "current" : "next";
        return (
          <li
            key={label}
            className={state}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span aria-hidden="true">
              {state === "done" ? <Check size={12} strokeWidth={3} /> : number}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
