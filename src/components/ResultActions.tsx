import { useMemo, type ReactNode } from "react";
import { Download, Eye, Share2 } from "lucide-react";
import { useObjectUrl } from "../hooks/useObjectUrl";
import type { Messages } from "../i18n";
/** Download, open in the browser's viewer, and share: shared by every tool. */
export function ResultActions({
  t,
  blob,
  name,
  download,
  preview = true,
  children,
}: {
  t: Messages;
  blob: Blob;
  name: string;
  /** Overrides the download label, e.g. for a file that is not a PDF. */
  download?: string;
  /** The browser viewer only makes sense for PDFs. */
  preview?: boolean;
  /** Tool-specific extra buttons, after the shared ones. */
  children?: ReactNode;
}) {
  const url = useObjectUrl(blob);
  // The system share sheet reaches Drive, Dropbox, OneDrive, Files, Mail...
  const shareFile = useMemo(
    () => new File([blob], name, { type: blob.type || "application/pdf" }),
    [blob, name],
  );
  const canShare =
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [shareFile] });
  if (!url) return null;
  return (
    <div className="result-actions">
      <a className="primary" href={url} download={name}>
        <Download size={18} aria-hidden="true" />
        {download ?? t.download}
      </a>
      {/* Opens the browser's own PDF viewer; CSP forbids blob: frames. */}
      {preview && (
        <a className="secondary" href={url} target="_blank" rel="noopener">
          <Eye size={18} aria-hidden="true" />
          {t.preview}
        </a>
      )}
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
      {children}
    </div>
  );
}
