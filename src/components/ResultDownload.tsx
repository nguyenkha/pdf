import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Columns2, RotateCcw } from "lucide-react";
import { formatSize, savings, outputName } from "../lib/pdf";
import { ResultActions } from "./ResultActions";
import type { Messages } from "../i18n";
import { fill } from "../i18n/fill";
export type CompressionResult = {
  blob: Blob;
  achieved: boolean;
  target?: number;
  lossy: boolean;
  unlocked?: boolean;
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
  // Move focus to the outcome, so keyboard and screen reader users land on it.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="result" aria-live="polite">
      <h3 className="result-heading" ref={heading} tabIndex={-1}>
        {t.complete}
      </h3>
      <div className="result-grid">
        <span>
          {t.original}
          <strong>{formatSize(file.size, locale)}</strong>
        </span>
        <span>
          {t.result}
          <strong>{formatSize(result.blob.size, locale)}</strong>
        </span>
      </div>
      {reduced ? (
        <p className="success">
          {fill(t.saved, {
            percent: new Intl.NumberFormat(locale, {
              style: "percent",
              maximumFractionDigits: 0,
            }).format(savings(file.size, result.blob.size) / 100),
          })}
        </p>
      ) : (
        <p>{t.noReduction}</p>
      )}
      {result.target !== undefined && (
        <p>{result.achieved ? t.targetMet : t.targetMiss}</p>
      )}
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
      <button type="button" className="secondary" onClick={onReset}>
        <RotateCcw size={16} aria-hidden="true" />
        {t.another}
      </button>
    </div>
  );
}
