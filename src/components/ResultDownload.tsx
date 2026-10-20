import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Columns2, Download, Eye, RotateCcw, Share2 } from "lucide-react";
import { formatSize, savings, outputName } from "../lib/pdf";
import { useObjectUrl } from "../hooks/useObjectUrl";
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
  const url = useObjectUrl(result.blob);
  const reduced = result.blob.size < file.size;
  const [comparing, setComparing] = useState(false);
  // Move focus to the outcome, so keyboard and screen reader users land on it.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  // The system share sheet reaches Drive, Dropbox, OneDrive, Files, Mail...
  const shareFile = useMemo(
    () => new File([result.blob], outputName(file.name), { type: "application/pdf" }),
    [result.blob, file.name],
  );
  const canShare =
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [shareFile] });
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
      {reduced && url && (
        <div className="result-actions">
          <a className="primary" href={url} download={outputName(file.name)}>
            <Download size={18} aria-hidden="true" />
            {t.download}
          </a>
          {/* Opens the browser's own PDF viewer; CSP forbids blob: frames. */}
          <a className="secondary" href={url} target="_blank" rel="noopener">
            <Eye size={18} aria-hidden="true" />
            {t.preview}
          </a>
          {canShare && (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                navigator.share({ files: [shareFile], title: shareFile.name }).catch(() => {})
              }
            >
              <Share2 size={18} aria-hidden="true" />
              {t.share}
            </button>
          )}
          <button
            type="button"
            className="secondary"
            aria-expanded={comparing}
            onClick={() => setComparing(!comparing)}
          >
            <Columns2 size={18} aria-hidden="true" />
            {t.compare}
          </button>
        </div>
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
