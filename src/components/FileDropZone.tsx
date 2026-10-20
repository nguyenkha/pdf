import { useState } from "react";
import { UploadCloud } from "lucide-react";
import type { Messages } from "../i18n";
export function FileDropZone({
  t,
  onSelect,
}: {
  t: Messages;
  onSelect: (files: File[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`drop ${dragging ? "drag" : ""}`}
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
        accept=".pdf,application/pdf"
        onChange={(event) => onSelect(Array.from(event.target.files ?? []))}
        aria-label={t.drop}
      />
      <UploadCloud size={31} strokeWidth={1.5} aria-hidden="true" />
      <strong>{t.drop}</strong>
      <small>{t.hint}</small>
    </div>
  );
}
