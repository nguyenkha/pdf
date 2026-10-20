import { lazy, Suspense, useState } from "react";
import { Columns2, RotateCcw } from "lucide-react";
import { formatSize, savings, outputName } from "../lib/pdf";
import { ResultActions } from "./ResultActions";
import { NextSteps } from "./NextSteps";
import { Outcome } from "./Outcome";
import type { Messages } from "../i18n";
import { fill } from "../i18n/fill";
export type CompressionResult = {
  blob: Blob;
  achieved: boolean;
  target?: number;
  lossy: boolean;
  unlocked?: boolean;
  /** Digital signatures were flattened before compressing. */
  unsigned?: boolean;
  /** The original restricted printing or copying; the copy does not. */
  restricted?: boolean;
};
// pdf.js for the comparison loads only when someone opens it.
const ComparePreview = lazy(() => import("./ComparePreview"));
export function ResultDownload({
  file,
  result,
  t,
  locale,
  pages,
  password,
  onReset,
}: {
  file: File;
  result: CompressionResult;
  t: Messages;
  locale: string;
  pages: number;
  password?: string;
  onReset: () => void;
}) {
  const reduced = result.blob.size < file.size;
  const [comparing, setComparing] = useState(false);
  return (
    <div className="result" aria-live="polite">
      <Outcome
        tone={reduced ? "success" : "neutral"}
        title={
          reduced
            ? fill(t.saved, {
                percent: new Intl.NumberFormat(locale, {
                  style: "percent",
                  maximumFractionDigits: 0,
                }).format(savings(file.size, result.blob.size) / 100),
              })
            : t.noReduction
        }
        detail={
          <>
            {formatSize(file.size, locale)} → {formatSize(result.blob.size, locale)}
            {result.target !== undefined && (
              <span className="outcome-note">
                {result.achieved ? t.targetMet : t.targetMiss}
              </span>
            )}
          </>
        }
      />
      {reduced && (
        <ResultActions t={t} blob={result.blob} name={outputName(file.name)}>
          <button
            type="button"
            className="secondary"
            aria-expanded={comparing}
            onClick={() => setComparing(!comparing)}
          >
            <Columns2 size={18} aria-hidden="true" />
            {t.compare}
          </button>
        </ResultActions>
      )}
      {comparing && (
        <Suspense fallback={<p className="hint">{t.loading}</p>}>
          <ComparePreview
            t={t}
            original={file}
            result={result.blob}
            pages={pages}
            password={password}
          />
        </Suspense>
      )}
      {result.lossy && <p className="result-note">{t.lossyNotice}</p>}
      {reduced && result.unlocked && (
        <p className="result-note">{t.unlockedNotice}</p>
      )}
      {reduced && result.unsigned && <p className="result-note">{t.signedNote}</p>}
      {reduced && result.restricted && !result.unlocked && (
        <p className="result-note">{t.restrictionsNote}</p>
      )}
      {reduced && (
        <NextSteps
          t={t}
          locale={locale}
          file={new File([result.blob], outputName(file.name), { type: "application/pdf" })}
          steps={[
            { tool: "merge", label: t.mergeWithOthers },
            { tool: "organize", label: t.organizeThis },
          ]}
        />
      )}
      <button type="button" className="link-button" onClick={onReset}>
        <RotateCcw size={15} aria-hidden="true" />
        {t.another}
      </button>
    </div>
  );
}
