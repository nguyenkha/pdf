import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  FileArchive,
  FileText,
  GripVertical,
  Lock,
  RotateCcw,
  X,
} from "lucide-react";
import type { ToolProps } from "../../app/tools";
import type { Messages } from "../../i18n";
import { fill } from "../../i18n/fill";
import { formatSize, validateFile } from "../../lib/pdf";
import { FileDropZone } from "../../components/FileDropZone";
import { Steps } from "../../components/Steps";
import { ResultActions } from "../../components/ResultActions";
import { Outcome } from "../../components/Outcome";
import { mergeFiles, summarizeFile, type FileSummary } from "./run";
import { unlockFile } from "../compress/run";
import { PasswordPrompt } from "../../components/PasswordPrompt";
import { canHandOver, handOver } from "../../lib/handOver";

type Item = {
  id: number;
  file: File;
  summary?: FileSummary;
  thumbnail?: string;
  failed?: boolean;
  /** Unlocked here with its password; the merged copy has none. */
  unlocked?: boolean;
  unlocking?: boolean;
  unlockError?: string;
};
const MAX_FILES = 50;
// Above this the merged copy and its sources may not fit a phone's memory.
const LARGE_TOTAL = 150 * 1024 * 1024;
let nextId = 0;
const mergedName = (first: File) => first.name.replace(/\.pdf$/i, "") + "-merged.pdf";
/** Several PDFs into one, in an order the user arranges. */
export default function MergeTool({ t, locale }: ToolProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number>();
  const [result, setResult] = useState<{ blob: Blob; pages: number; signed: number[] }>();
  const [dragging, setDragging] = useState<number>();
  const [descending, setDescending] = useState(false);
  const job = useRef<{ cancel: () => void } | undefined>(undefined);
  const summaries = useRef(new Map<number, { cancel: () => void }>());
  // Thumbnails are object URLs; release them with their row or the tool.
  const live = useRef(items);
  live.current = items;
  useEffect(
    () => () => {
      job.current?.cancel();
      summaries.current.forEach((run) => run.cancel());
      live.current.forEach((item) => item.thumbnail && URL.revokeObjectURL(item.thumbnail));
    },
    [],
  );
  // One preview at a time keeps memory flat however many files are added.
  useEffect(() => {
    if (summaries.current.size) return;
    const next = items.find((item) => !item.summary && !item.failed);
    if (!next) return;
    const run = summarizeFile(next.file);
    summaries.current.set(next.id, run);
    run.promise
      .then((summary) =>
        setItems((current) =>
          current.map((item) =>
            item.id === next.id
              ? {
                  ...item,
                  summary,
                  thumbnail: summary.thumbnail && URL.createObjectURL(summary.thumbnail),
                }
              : item,
          ),
        ),
      )
      .catch(() =>
        setItems((current) =>
          current.map((item) => (item.id === next.id ? { ...item, failed: true } : item)),
        ),
      )
      .finally(() => summaries.current.delete(next.id));
  }, [items]);
  function add(files: File[]) {
    setError("");
    setResult(undefined);
    const pdfs = files.filter((file) => !validateFile(file));
    if (pdfs.length < files.length) setError(t.invalid);
    const room = MAX_FILES - live.current.length;
    if (pdfs.length > room) setError(fill(t.mergeTooMany, { count: MAX_FILES }));
    const added = pdfs.slice(0, room).map((file) => ({ id: nextId++, file }));
    setItems((current) => [...current, ...added]);
  }
  function remove(id: number) {
    summaries.current.get(id)?.cancel();
    summaries.current.delete(id);
    setItems((current) => {
      const gone = current.find((item) => item.id === id);
      if (gone?.thumbnail) URL.revokeObjectURL(gone.thumbnail);
      return current.filter((item) => item.id !== id);
    });
  }
  // Same check and rewrite as the compress tool's password step.
  async function unlock(id: number, password: string) {
    const target = live.current.find((item) => item.id === id);
    if (!target) return;
    const patch = (change: Partial<Item>) =>
      setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
    patch({ unlocking: true, unlockError: undefined });
    try {
      const blob = await unlockFile(target.file, password).promise;
      if (target.thumbnail) URL.revokeObjectURL(target.thumbnail);
      // A fresh summary (preview, page count) runs for the unlocked copy.
      patch({
        file: new File([blob], target.file.name, { type: "application/pdf" }),
        summary: undefined,
        thumbnail: undefined,
        unlocked: true,
        unlocking: false,
      });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "";
      patch({
        unlocking: false,
        unlockError: message === "password-incorrect" ? t.passwordWrong : t.mergeFailed,
      });
    }
  }
  function move(from: number, to: number) {
    setItems((current) => {
      if (to < 0 || to >= current.length || from === to) return current;
      const next = [...current];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  }
  function sortByName() {
    // Natural order, so scan2 comes before scan10.
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    const direction = descending ? -1 : 1;
    setItems((current) =>
      [...current].sort((a, b) => direction * collator.compare(a.file.name, b.file.name)),
    );
    setDescending(!descending);
  }
  function reset() {
    job.current?.cancel();
    summaries.current.forEach((run) => run.cancel());
    summaries.current.clear();
    items.forEach((item) => item.thumbnail && URL.revokeObjectURL(item.thumbnail));
    setItems([]);
    setResult(undefined);
    setProgress(undefined);
    setError("");
  }
  async function merge() {
    setError("");
    setProgress(0);
    try {
      const active = mergeFiles(
        items.map((item) => item.file),
        setProgress,
      );
      job.current = active;
      setResult(await active.promise);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "";
      if (message === "cancelled") return;
      const [kind, index] = message.split(":");
      const name = items[Number(index)]?.file.name ?? "";
      setError(
        kind === "password"
          ? fill(t.mergeLockedError, { name })
          : kind === "corrupt"
            ? fill(t.mergeCorrupt, { name })
            : t.mergeFailed,
      );
    } finally {
      job.current = undefined;
      setProgress(undefined);
    }
  }
  const locked = items.some((item) => item.summary?.locked);
  const pages = items.reduce((sum, item) => sum + (item.summary?.pages ?? 0), 0);
  const total = items.reduce((sum, item) => sum + item.file.size, 0);
  const busy = progress !== undefined;
  const step = result ? 3 : items.length ? 2 : 1;
  return (
    <section className="tool-card" aria-label={t.toolMerge}>
      <Steps t={t} current={step} labels={[t.stepFile, t.stepOrder, t.stepDownload]} />
      {result ? (
        <MergeResult
          t={t}
          locale={locale}
          blob={result.blob}
          name={mergedName(items[0].file)}
          count={items.length}
          pages={result.pages}
          unlocked={items.some((item) => item.unlocked)}
          signed={result.signed.map((index) => items[index]?.file.name).filter(Boolean)}
          onReset={reset}
        />
      ) : !items.length ? (
        <FileDropZone t={t} onSelect={add} title={t.mergeDrop} hint={t.mergeHint} />
      ) : (
        <div
          className="merge"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) event.preventDefault();
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.files.length) return;
            event.preventDefault();
            add(Array.from(event.dataTransfer.files));
          }}
        >
          <div className="merge-toolbar">
            <span>{fill(t.mergeCount, { count: items.length, pages })}</span>
            <button type="button" className="chip-button" onClick={sortByName} disabled={busy || items.length < 2}>
              <ArrowDownAZ size={15} aria-hidden="true" />
              {t.sortByName}
            </button>
          </div>
          <ol className="merge-list" aria-label={t.stepOrder}>
            {items.map((item, index) => (
              <li
                key={item.id}
                className={dragging === index ? "dragging" : ""}
                draggable={!busy}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/x-merge-row", String(index));
                  setDragging(index);
                }}
                onDragOver={(event) => {
                  if (dragging === undefined) return;
                  event.preventDefault();
                  if (dragging !== index) {
                    move(dragging, index);
                    setDragging(index);
                  }
                }}
                onDragEnd={() => setDragging(undefined)}
              >
                <GripVertical size={16} className="grip" aria-hidden="true" />
                <span className="order" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="thumb" aria-hidden="true">
                  {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <FileText size={20} />}
                </span>
                <span className="file-details">
                  <strong>{item.file.name}</strong>
                  <small className={item.summary?.locked || item.failed ? "bad" : ""}>
                    {item.summary?.locked ? (
                      <>
                        <Lock size={12} aria-hidden="true" /> {t.mergeLocked}
                      </>
                    ) : item.failed ? (
                      t.corrupt
                    ) : (
                      <>
                        <span>{formatSize(item.file.size, locale)}</span>
                        {item.summary && (
                          <span>{fill(t.pagesCount, { pages: item.summary.pages })}</span>
                        )}
                      </>
                    )}
                  </small>
                </span>
                <span className="row-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={fill(t.moveUp, { name: item.file.name })}
                    disabled={busy || index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={fill(t.moveDown, { name: item.file.name })}
                    disabled={busy || index === items.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={fill(t.removeNamed, { name: item.file.name })}
                    disabled={busy}
                    onClick={() => remove(item.id)}
                  >
                    <X size={16} />
                  </button>
                </span>
                {item.summary?.locked && (
                  <div className="row-unlock">
                    <PasswordPrompt
                      t={t}
                      busy={Boolean(item.unlocking)}
                      label={fill(t.mergeUnlockLabel, { name: item.file.name })}
                      error={item.unlockError}
                      autoFocus={false}
                      onSubmit={(password) => unlock(item.id, password)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
          {!busy && <FileDropZone t={t} onSelect={add} title={t.mergeAddMore} compact />}
          {total > LARGE_TOTAL && <p className="warning">{t.large}</p>}
          {busy ? (
            <div className="processing">
              <div className="progress-head">
                <strong>{t.merging}</strong>
                <span aria-hidden="true">{Math.floor((progress ?? 0) * 100)}%</span>
              </div>
              <div
                className="progress"
                role="progressbar"
                aria-label={t.merging}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.floor((progress ?? 0) * 100)}
              >
                <span style={{ width: `${Math.floor((progress ?? 0) * 100)}%` }} />
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="primary"
                disabled={items.length < 2 || locked}
                onClick={merge}
              >
                {items.length < 2 ? t.mergeNeedTwo : fill(t.mergeStart, { count: items.length })}
              </button>
              <p className="hint merge-note">{t.mergeNote}</p>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function MergeResult({
  t,
  locale,
  blob,
  name,
  count,
  pages,
  unlocked,
  signed,
  onReset,
}: {
  t: Messages;
  locale: string;
  blob: Blob;
  name: string;
  count: number;
  pages: number;
  unlocked: boolean;
  /** Sources whose digital signatures were flattened into the pages. */
  signed: string[];
  onReset: () => void;
}) {
  const [handing, setHanding] = useState(false);
  return (
    <div className="result" aria-live="polite">
      <Outcome
        title={fill(t.mergeDoneTitle, { count })}
        detail={fill(t.mergeDoneDetail, { pages, size: formatSize(blob.size, locale) })}
      />
      <ResultActions t={t} blob={blob} name={name}>
        {canHandOver() && (
          <button
            type="button"
            className="secondary"
            disabled={handing}
            onClick={async () => {
              setHanding(true);
              const file = new File([blob], name, { type: "application/pdf" });
              if (!(await handOver([file], `/${locale}/compress/`))) setHanding(false);
            }}
          >
            <FileArchive size={18} aria-hidden="true" />
            {t.compressThis}
          </button>
        )}
      </ResultActions>
      {unlocked && <p className="result-note">{t.mergeUnlockedNote}</p>}
      {signed.length > 0 && (
        <p className="result-note">{fill(t.mergeSignedNote, { names: signed.join(", ") })}</p>
      )}
      <button type="button" className="link-button" onClick={onReset}>
        <RotateCcw size={15} aria-hidden="true" />
        {t.mergeAnother}
      </button>
    </div>
  );
}
