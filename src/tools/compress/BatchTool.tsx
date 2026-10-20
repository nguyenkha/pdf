import { useEffect, useRef, useState } from "react";
import { Archive, Check, FileText, RotateCcw, X } from "lucide-react";
import type { Messages } from "../../i18n";
import { fill } from "../../i18n/fill";
import { formatSize, outputName, savings } from "../../lib/pdf";
import { planOptions, type PlanChoice } from "../../lib/plan";
import { safeEntryName, uniqueNames, zipBlobs } from "../../lib/zip";
import { CompressionPlan } from "../../components/CompressionPlan";
import { useObjectUrl } from "../../hooks/useObjectUrl";
import { Outcome } from "../../components/Outcome";
import { probeFile, runCompression } from "./run";
import { errorMessage } from "./errors";

type Item = {
  file: File;
  status: "queued" | "working" | "done" | "kept" | "error";
  progress?: number;
  blob?: Blob;
  message?: string;
};
/** Several PDFs with one level, compressed one after another. */
export function BatchTool({
  t,
  locale,
  files,
  onReset,
  onComplete,
}: {
  t: Messages;
  locale: string;
  files: File[];
  onReset: () => void;
  onComplete: (complete: boolean) => void;
}) {
  const [plan, setPlan] = useState<PlanChoice>({
    goal: "recommended",
    imageQuality: "auto",
    gray: false,
    custom: "",
    unit: "MB",
  });
  const [items, setItems] = useState<Item[]>(() =>
    files.map((file) => ({ file, status: "queued" })),
  );
  const [running, setRunning] = useState(false);
  const [zip, setZip] = useState<Blob>();
  const zipUrl = useObjectUrl(zip);
  const job = useRef<{ cancel: () => void } | undefined>(undefined);
  const stopped = useRef(false);
  useEffect(
    () => () => {
      stopped.current = true;
      job.current?.cancel();
    },
    [],
  );
  const update = (index: number, patch: Partial<Item>) =>
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  async function start() {
    stopped.current = false;
    setRunning(true);
    setZip(undefined);
    // One at a time: on phones each run needs most of the tab's memory.
    for (const [index, file] of files.entries()) {
      if (stopped.current) break;
      update(index, { status: "working", progress: 0, message: undefined });
      try {
        const probing = probeFile(file);
        job.current = probing;
        const summary = await probing.promise;
        const options = planOptions(plan, file.size, summary);
        if (!options) throw new Error("target");
        const active = runCompression(file, options, (progress) =>
          update(index, { progress: progress.value }),
        );
        job.current = active;
        const output = await active.promise;
        update(index, {
          status: output.blob.size < file.size ? "done" : "kept",
          blob: output.blob,
        });
      } catch (failure) {
        if (failure instanceof Error && failure.message === "cancelled") break;
        const message =
          failure instanceof Error && failure.message.startsWith("password")
            ? t.batchPassword
            : failure instanceof Error && failure.message === "target"
              ? t.targetInvalid
              : errorMessage(t, failure);
        update(index, { status: "error", message });
      }
    }
    job.current = undefined;
    setRunning(false);
  }
  function cancel() {
    stopped.current = true;
    job.current?.cancel();
    setItems((current) =>
      current.map((item) =>
        item.status === "working" ? { ...item, status: "queued" } : item,
      ),
    );
  }
  const finished = items.filter((item) => item.status === "done");
  const before = finished.reduce((sum, item) => sum + item.file.size, 0);
  const after = finished.reduce((sum, item) => sum + (item.blob?.size ?? 0), 0);
  const complete = !running && items.every((item) => item.status !== "queued");
  useEffect(() => onComplete(complete), [complete, onComplete]);
  // The archive references the result Blobs, so building it copies nothing;
  // a real link (not a scripted click) keeps Safari's download working.
  useEffect(() => {
    if (!complete || !finished.length) return;
    let active = true;
    const names = uniqueNames(
      finished.map((item) => safeEntryName(outputName(item.file.name))),
    );
    zipBlobs(finished.map((item, i) => ({ name: names[i], blob: item.blob! }))).then(
      (archive) => active && setZip(archive),
    );
    return () => {
      active = false;
    };
    // finished is derived from items, which only change while running.
  }, [complete]);
  const largest = Math.max(...files.map((file) => file.size));
  return (
    <div className="batch">
      <p className="batch-count">{fill(t.batchCount, { count: files.length })}</p>
      <ul className="batch-list">
        {items.map((item, index) => (
          <li key={index} className={`batch-${item.status}`}>
            <FileText size={18} aria-hidden="true" />
            <div className="file-details">
              <strong>{item.file.name}</strong>
              <small>
                {formatSize(item.file.size, locale)}
                {item.status === "done" && item.blob &&
                  ` → ${formatSize(item.blob.size, locale)} (−${savings(item.file.size, item.blob.size)}%)`}
                {item.status === "kept" && ` · ${t.batchKept}`}
                {item.status === "error" && ` · ${item.message}`}
              </small>
              {item.status === "working" && (
                <span className="sr-only" role="status">
                  {t.compressing}
                </span>
              )}
              {item.status === "working" && (
                <span className="progress small" aria-hidden="true">
                  <span style={{ width: `${Math.floor((item.progress ?? 0) * 100)}%` }} />
                </span>
              )}
            </div>
            {item.status === "done" && <Check size={18} className="ok" aria-label={t.complete} />}
            {item.status === "error" && <X size={18} className="bad" aria-hidden="true" />}
          </li>
        ))}
      </ul>
      {!running && !complete && (
        <>
          <CompressionPlan
            t={t}
            locale={locale}
            size={largest}
            summary={{ pages: 1, hasImages: true, tagged: false }}
            value={plan}
            onChange={setPlan}
          />
          <button type="button" className="primary" onClick={start}>
            {fill(t.batchStart, { count: files.length })}
          </button>
        </>
      )}
      {running && (
        <button type="button" className="secondary" onClick={cancel}>
          {t.cancel}
        </button>
      )}
      {complete && (
        <div className="result">
          <Outcome
            tone={finished.length ? "success" : "neutral"}
            title={
              finished.length
                ? fill(t.batchDoneTitle, { done: finished.length, count: files.length })
                : t.noReduction
            }
            detail={
              finished.length
                ? fill(t.batchSaved, {
                    before: formatSize(before, locale),
                    after: formatSize(after, locale),
                    percent: `${savings(before, after)}%`,
                  })
                : undefined
            }
          />
          {finished.length > 0 && (
            <>
              {zipUrl ? (
                <a className="primary" href={zipUrl} download="pdf-kha-do-compressed.zip">
                  <Archive size={18} aria-hidden="true" />
                  {t.downloadAll}
                </a>
              ) : (
                <button type="button" className="primary" disabled>
                  {t.preparingZip}
                </button>
              )}
              <div className="batch-links">
                {finished.map((item) => (
                  <BatchLink key={item.file.name + item.file.lastModified} item={item} />
                ))}
              </div>
            </>
          )}
          <button type="button" className="link-button" onClick={onReset}>
            <RotateCcw size={15} aria-hidden="true" />
            {t.another}
          </button>
        </div>
      )}
    </div>
  );
}
function BatchLink({ item }: { item: Item }) {
  const url = useObjectUrl(item.blob);
  return url ? (
    <a href={url} download={outputName(item.file.name)}>
      {outputName(item.file.name)}
    </a>
  ) : null;
}
