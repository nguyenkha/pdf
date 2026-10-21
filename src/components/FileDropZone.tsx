import { useState } from "react";
import { UploadCloud } from "lucide-react";
import type { Messages } from "../i18n";
export function FileDropZone({
  t,
  onSelect,
  title = t.drop,
  hint = t.hint,
  compact = false,
  accept = ".pdf,application/pdf",
}: {
  t: Messages;
  onSelect: (files: File[]) => void;
  /** Tool-specific wording; defaults to the compress text. */
  title?: string;
  hint?: string;
  /** A slim zone for adding more files under a list. */
  compact?: boolean;
  /** The file picker's filter; PDFs unless a tool takes other files. */
  accept?: string;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`drop${compact ? " compact" : ""}${dragging ? " drag" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        onSelect(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        type="file"
        accept={accept}
        multiple
        onChange={(event) => onSelect(Array.from(event.target.files ?? []))}
        aria-label={title}
      />
      <UploadCloud size={31} strokeWidth={1.5} aria-hidden="true" />
      <strong>{title}</strong>
      {!compact && (
        <>
          <small>{hint}</small>
          <span className="browse" aria-hidden="true">
            {t.browse}
          </span>
        </>
      )}
    </div>
  );
}
