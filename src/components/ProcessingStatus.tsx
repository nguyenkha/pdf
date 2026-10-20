import { useEffect, useRef, useState } from "react";
import type { Messages } from "../i18n";
import type { JobProgress } from "../tools/compress/run";
import { fill } from "../i18n/fill";
export type Stage =
  | "reading"
  | "analyzing"
  | "loading"
  | "optimizing"
  | "finalizing";
function remaining(locale: string, seconds: number) {
  const minutes = Math.round(seconds / 60);
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: minutes >= 1 ? "minute" : "second",
    unitDisplay: "long",
  }).format(minutes >= 1 ? minutes : Math.max(5, Math.ceil(seconds / 5) * 5));
}
export function ProcessingStatus({
  t,
  locale,
  progress,
  onCancel,
}: {
  t: Messages;
  locale: string;
  progress: JobProgress;
  onCancel: () => void;
}) {
  const started = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const percent = Math.min(99, Math.floor(progress.value * 100));
  const elapsed = (now - started.current) / 1000;
  // Only estimate once the rate is meaningful; early passes are uneven.
  const left =
    progress.value > 0.1 && elapsed > 4
      ? (elapsed / progress.value) * (1 - progress.value)
      : undefined;
  // Keep one label while page counters restart between compression passes.
  const once = ["reading", "analyzing", "loading"].includes(progress.stage);
  const stage = once ? t[progress.stage as Stage] : t.optimizing;
  return (
    <div className="processing">
      <div className="progress-head">
        <strong>{t.compressing}</strong>
        <span aria-hidden="true">{percent}%</span>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-label={t.compressing}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="progress-detail" role="status" aria-live="polite">
        {progress.stage === "analyzing" && progress.page && progress.pages
          ? `${stage} · ${fill(t.pageOf, { page: progress.page, pages: progress.pages })}`
          : stage}
        {left !== undefined && (
          <span>{fill(t.remaining, { time: remaining(locale, left) })}</span>
        )}
      </p>
      <button type="button" className="secondary" onClick={onCancel}>
        {t.cancel}
      </button>
    </div>
  );
}
