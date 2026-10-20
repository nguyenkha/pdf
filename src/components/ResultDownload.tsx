import { Download, RotateCcw } from "lucide-react";
import { formatSize, savings, outputName } from "../lib/pdf";
import { useObjectUrl } from "../hooks/useObjectUrl";
import type { Messages } from "../i18n";
export type CompressionResult = {
  blob: Blob;
  achieved: boolean;
  target?: number;
  lossy: boolean;
};
export function ResultDownload({
  file,
  result,
  t,
  locale,
  onReset,
}: {
  file: File;
  result: CompressionResult;
  t: Messages;
  locale: string;
  onReset: () => void;
}) {
  const url = useObjectUrl(result.blob);
  const reduced = result.blob.size < file.size;
  return (
    <div className="result" aria-live="polite">
      <h3 className="result-heading">{t.complete}</h3>
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
          {new Intl.NumberFormat(locale, {
            style: "percent",
            maximumFractionDigits: 0,
          }).format(savings(file.size, result.blob.size) / 100)}{" "}
          {t.saved}
        </p>
      ) : (
        <p>{t.noReduction}</p>
      )}
      {result.target !== undefined && (
        <p>{result.achieved ? t.targetMet : t.targetMiss}</p>
      )}
      {reduced && url && (
        <a className="primary" href={url} download={outputName(file.name)}>
          <Download size={18} aria-hidden="true" />
          {t.download}
        </a>
      )}
      {result.lossy && <p className="result-note">{t.lossyNotice}</p>}
      <button type="button" className="secondary" onClick={onReset}>
        <RotateCcw size={16} aria-hidden="true" />
        {t.another}
      </button>
    </div>
  );
}
