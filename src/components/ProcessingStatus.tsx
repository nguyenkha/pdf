import type { Messages } from "../i18n";
export type Stage =
  | "reading"
  | "analyzing"
  | "loading"
  | "optimizing"
  | "finalizing";
export function ProcessingStatus({
  t,
  stage,
  onCancel,
}: {
  t: Messages;
  stage: Stage;
  onCancel: () => void;
}) {
  return (
    <div className="processing">
      <span className="spinner" aria-hidden="true" />
      <strong role="status" aria-live="polite">
        {t[stage]}
      </strong>
      <button type="button" className="secondary" onClick={onCancel}>
        {t.cancel}
      </button>
    </div>
  );
}
