import type { Messages } from "../i18n";
import type { ImageQuality } from "../engines/ghostscript";
import type { PdfSummary } from "../engines/validate";
import { formatSize } from "../lib/pdf";
import { limitChoices, type Goal } from "../lib/plan";
export type PlanChoice = {
  goal: Goal;
  imageQuality: ImageQuality;
  limit?: number;
  custom: string;
  unit: "KB" | "MB";
};
export function CompressionPlan({
  t,
  locale,
  file,
  summary,
  value,
  onChange,
}: {
  t: Messages;
  locale: string;
  file: File;
  summary: PdfSummary;
  value: PlanChoice;
  onChange: (next: PlanChoice) => void;
}) {
  const set = (patch: Partial<PlanChoice>) => onChange({ ...value, ...patch });
  const limits = limitChoices(file.size);
  const goals: [Goal, string, string][] = [
    [
      "recommended",
      t.recommended,
      summary.hasImages ? t.recommendedImages : t.recommendedText,
    ],
    ["quality", t.quality, t.qualityHint],
    ["smallest", t.smallest, t.smallestHint],
    ["limit", t.limit, t.limitHint],
  ];
  return (
    <fieldset className="plan">
      <legend>{t.goal}</legend>
      {!summary.hasImages && <p className="hint">{t.textOnly}</p>}
      <div className="goals">
        {goals.map(([goal, label, hint]) => (
          <label key={goal} className={value.goal === goal ? "selected" : ""}>
            <input
              type="radio"
              name="goal"
              value={goal}
              checked={value.goal === goal}
              onChange={() => set({ goal })}
            />
            <strong>{label}</strong>
            <small>{hint}</small>
          </label>
        ))}
      </div>
      {value.goal === "limit" && (
        <div className="limits">
          <div className="chips" role="group" aria-label={t.limit}>
            {limits.map((bytes) => (
              <button
                type="button"
                key={bytes}
                aria-pressed={!value.custom && value.limit === bytes}
                onClick={() => set({ limit: bytes, custom: "" })}
              >
                {formatSize(bytes, locale)}
              </button>
            ))}
          </div>
          <label className="custom-limit">
            {t.custom}
            <span className="target-row">
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder={t.off}
                value={value.custom}
                onChange={(event) => set({ custom: event.target.value })}
              />
              <select
                value={value.unit}
                onChange={(event) =>
                  set({ unit: event.target.value as "KB" | "MB" })
                }
                aria-label={t.target}
              >
                <option>MB</option>
                <option>KB</option>
              </select>
            </span>
          </label>
          <small className="hint">{t.limitCommon}</small>
        </div>
      )}
      {summary.hasImages && (
        <details className="advanced">
          <summary>{t.advanced}</summary>
          <label>
            {t.image}
            <select
              value={value.imageQuality}
              onChange={(event) =>
                set({ imageQuality: event.target.value as ImageQuality })
              }
            >
              <option value="auto">{t.auto}</option>
              <option value="high">{t.high}</option>
              <option value="medium">{t.medium}</option>
              <option value="low">{t.low}</option>
            </select>
          </label>
        </details>
      )}
    </fieldset>
  );
}
