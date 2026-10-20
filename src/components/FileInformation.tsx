import { FileText, X } from "lucide-react";
import { formatSize } from "../lib/pdf";
import type { Messages } from "../i18n";
import { fill } from "../i18n/fill";
export function FileInformation({
  file,
  locale,
  t,
  pages,
  busy,
  onRemove,
  onSelect,
}: {
  file: File;
  locale: string;
  t: Messages;
  pages?: number;
  busy: boolean;
  onRemove: () => void;
  onSelect: (files: File[]) => void;
}) {
  return (
    <div className="file-row">
      <FileText aria-hidden="true" />
      <div className="file-details">
        <strong>{file.name}</strong>
        <small>
          {formatSize(file.size, locale)}
          {pages !== undefined &&
            ` · ${fill(t.pagesCount, { pages: new Intl.NumberFormat(locale).format(pages) })}`}
        </small>
      </div>
      {!busy && (
        <label className="replace-file">
          <span>{t.replace}</span>
          <input
            type="file"
            accept=".pdf,application/pdf"
            aria-label={t.replace}
            onChange={(event) => onSelect(Array.from(event.target.files ?? []))}
          />
        </label>
      )}
      <button
        type="button"
        className="icon-button"
        onClick={onRemove}
        aria-label={t.remove}
      >
        <X size={19} />
      </button>
    </div>
  );
}
