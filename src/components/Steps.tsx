import { Check } from "lucide-react";
import type { Messages } from "../i18n";
export function Steps({ t, current }: { t: Messages; current: number }) {
  return (
    <ol className="steps">
      {[t.stepFile, t.stepLevel, t.stepDownload].map((label, index) => {
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
