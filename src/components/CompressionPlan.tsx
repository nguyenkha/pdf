import { Gauge, Gem, Minimize2, Sparkles, type LucideIcon } from "lucide-react";
import type { Messages } from "../i18n";
import type { ImageQuality } from "../engines/ghostscript";
import type { PdfSummary } from "../engines/validate";
import { formatSize } from "../lib/pdf";
import { limitChoices, type Goal, type PlanChoice } from "../lib/plan";
import { fill } from "../i18n/fill";
export type { PlanChoice } from "../lib/plan";
export function CompressionPlan({
  t,
  locale,
  size,
  summary,
  value,
  onChange,
  estimate,
}: {
  t: Messages;
  locale: string;
  /** File size, or the largest file of a batch. */
  size: number;
  summary: PdfSummary;
  value: PlanChoice;
  onChange: (next: PlanChoice) => void;
  estimate?: { size?: number; loading: boolean };
}) {
  const set = (patch: Partial<PlanChoice>) => onChange({ ...value, ...patch });
  const limits = limitChoices(size);
  const goals: [Goal, string, string, LucideIcon][] = [
    [
      "recommended",
      t.recommended,
      summary.hasImages ? t.recommendedImages : t.recommendedText,
      Sparkles,
    ],
    ["quality", t.quality, t.qualityHint, Gem],
    ["smallest", t.smallest, t.smallestHint, Minimize2],
    ["limit", t.limit, t.limitHint, Gauge],
  ];
  return (
    <fieldset className="plan">
      <legend>{t.goal}</legend>
      {!summary.hasImages && <p className="hint">{t.textOnly}</p>}
      {summary.tagged && <p className="hint">{t.taggedNotice}</p>}
      {summary.colorless && summary.hasImages && !value.gray && (
        <div className="suggestion">
          <p>{t.grayHint}</p>
          <button type="button" className="secondary" onClick={() => set({ gray: true })}>
            {t.grayApply}
          </button>
        </div>
      )}
      <div className="goals">
        {goals.map(([goal, label, hint, Icon]) => (
          <label
            key={goal}
            className={`goal-${goal}${value.goal === goal ? " selected" : ""}`}
          >
            <input
              type="radio"
              name="goal"
              value={goal}
              checked={value.goal === goal}
              onChange={() => set({ goal })}
            />
            <strong>
              <Icon size={15} aria-hidden="true" />
              {label}
            </strong>
            <small>{hint}</small>
          </label>
        ))}
      </div>
      {estimate && value.goal !== "limit" && (
        <p className="estimate" aria-live="polite">
          {estimate.loading || estimate.size === undefined
            ? t.estimating
            : fill(t.estimate, {
                size: formatSize(estimate.size, locale),
                percent: new Intl.NumberFormat(locale, {
                  style: "percent",
                  maximumFractionDigits: 0,
                }).format(Math.max(0, 1 - estimate.size / size)),
              })}
        </p>
      )}
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
          <label className="check">
            <input
              type="checkbox"
              checked={value.gray}
              onChange={(event) => set({ gray: event.target.checked })}
            />
            {t.grayscale}
          </label>
        </details>
      )}
    </fieldset>
  );
}
