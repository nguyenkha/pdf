import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, RotateCw, Trash2, Undo2 } from "lucide-react";
import type { ToolProps } from "../../app/tools";
import type { Messages } from "../../i18n";
import { fill } from "../../i18n/fill";
import { formatSize, validateFile } from "../../lib/pdf";
import { FileDropZone } from "../../components/FileDropZone";
import { FileInformation } from "../../components/FileInformation";
import { Steps } from "../../components/Steps";
import { Outcome } from "../../components/Outcome";
import { ResultActions } from "../../components/ResultActions";
import { PasswordPrompt } from "../../components/PasswordPrompt";
import { takeSharedFiles } from "../../lib/handOver";
import { NextSteps } from "../../components/NextSteps";
import { unlockFile } from "../compress/run";
import { organizeFile, readPages } from "./run";
import "./organize.css";

/** One card in the grid: a source page, its extra turn, and whether it stays. */
type Card = { page: number; rotate: number; deleted: boolean };
// Previews past this many pages would cost phones memory for little use.
const PREVIEWS = 300;
// pdf-lib copies the whole document in memory; past this a desktop app fits better.
const MAX_PAGES = 2000;
const organizedName = (file: File) => file.name.replace(/\.pdf$/i, "") + "-organized.pdf";
const fresh = (count: number): Card[] =>
  Array.from({ length: count }, (_, page) => ({ page, rotate: 0, deleted: false }));
/** One PDF's pages, reordered, turned or removed, then saved as a new PDF. */
export default function OrganizeTool({ t, locale, shared }: ToolProps) {
  const [file, setFile] = useState<File>();
  const [count, setCount] = useState<number>();
  const [cards, setCards] = useState<Card[]>([]);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string>();
  const [unlocked, setUnlocked] = useState(false);
  // Opened without a password but encrypted to restrict printing or copying.
  const [restricted, setRestricted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; pages: number; signed: boolean }>();
  const [dragging, setDragging] = useState<number>();
  const reading = useRef<{ cancel: () => void } | undefined>(undefined);
  const job = useRef<{ cancel: () => void } | undefined>(undefined);
  // Previews are object URLs; release them with the file or the tool.
  const urls = useRef<string[]>([]);
  urls.current = thumbnails;
  // Previews still arriving from an older read are dropped, not kept.
  const generation = useRef(0);
  const release = () => {
    generation.current++;
    urls.current.forEach((url) => url && URL.revokeObjectURL(url));
    setThumbnails([]);
  };
  // A file handed over from another tool's result (see handOver).
  useEffect(() => {
    if (!shared) return;
    takeSharedFiles().then((files) => files.length && select(files.slice(0, 1)));
    // A one-time hand-over on mount.
  }, [shared]);
  useEffect(
    () => () => {
      generation.current++;
      reading.current?.cancel();
      job.current?.cancel();
      urls.current.forEach((url) => url && URL.revokeObjectURL(url));
    },
    [],
  );
  function read(source: File) {
    reading.current?.cancel();
    release();
    setCount(undefined);
    setCards([]);
    setLocked(false);
    setError("");
    const id = generation.current;
    const run = readPages(
      source,
      PREVIEWS,
      (pages) => {
        if (id !== generation.current) return;
        if (pages > MAX_PAGES) {
          run.cancel();
          setError(fill(t.organizeTooMany, { count: MAX_PAGES }));
          return;
        }
        setCount(pages);
        setCards(fresh(pages));
      },
      (index, thumbnail) => {
        // Made outside the state update, so a reset that empties the list
        // cannot drop one unrevoked; the replaced one is revoked here.
        const url = URL.createObjectURL(thumbnail);
        if (id !== generation.current) return URL.revokeObjectURL(url);
        setThumbnails((current) => {
          const next = [...current];
          if (next[index]) URL.revokeObjectURL(next[index]);
          next[index] = url;
          return next;
        });
      },
    );
    reading.current = run;
    run.promise
      .catch((failure) => {
        if (id !== generation.current) return;
        const message = failure instanceof Error ? failure.message : "";
        if (message.startsWith("password")) setLocked(true);
        else setError(t.corrupt);
      })
      .finally(() => {
        if (reading.current === run) reading.current = undefined;
      });
  }
  function select(files: File[]) {
    reset();
    if (files.length !== 1) return setError(t.oneFile);
    if (validateFile(files[0])) return setError(t.invalid);
    setFile(files[0]);
    read(files[0]);
  }
  // Same check and rewrite as the compress tool's password step.
  async function unlock(password: string) {
    if (!file) return;
    const id = generation.current;
    setUnlocking(true);
    setUnlockError(undefined);
    try {
      const active = unlockFile(file, password);
      job.current = active;
      const blob = await active.promise;
      if (id !== generation.current) return;
      const copy = new File([blob], file.name, { type: "application/pdf" });
      job.current = undefined;
      setUnlocking(false);
      setUnlocked(true);
      setFile(copy);
      read(copy);
    } catch (failure) {
      if (id !== generation.current) return;
      const message = failure instanceof Error ? failure.message : "";
      setUnlockError(message === "password-incorrect" ? t.passwordWrong : t.failed);
    } finally {
      if (id === generation.current) {
        job.current = undefined;
        setUnlocking(false);
      }
    }
  }
  function reset() {
    reading.current?.cancel();
    job.current?.cancel();
    release();
    setFile(undefined);
    setCount(undefined);
    setCards([]);
    setLocked(false);
    setUnlocked(false);
    setUnlocking(false);
    setRestricted(false);
    setUnlockError(undefined);
    setBusy(false);
    setResult(undefined);
    setError("");
  }
  const change = (index: number, patch: Partial<Card>) =>
    setCards((current) => current.map((card, at) => (at === index ? { ...card, ...patch } : card)));
  function move(from: number, to: number) {
    setCards((current) => {
      if (to < 0 || to >= current.length || from === to) return current;
      const next = [...current];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  }
  async function save() {
    if (!file) return;
    const id = generation.current;
    setError("");
    setBusy(true);
    const plan = cards.filter((card) => !card.deleted).map(({ page, rotate }) => ({ page, rotate }));
    const run = async (source: File) => {
      if (id !== generation.current) throw new Error("cancelled");
      const active = organizeFile(source, plan);
      job.current = active;
      return active.promise;
    };
    try {
      const result = await run(file).catch(async (failure) => {
          // Encrypted only to restrict printing or copying: it opens without a
          // password, so rewrite it without encryption (as compressing does).
          if (!(failure instanceof Error) || failure.message !== "password") throw failure;
          if (id !== generation.current) throw new Error("cancelled");
          setRestricted(true);
          const active = unlockFile(file, "");
          job.current = active;
          return run(new File([await active.promise], file.name, { type: "application/pdf" }));
        });
      if (id === generation.current) setResult(result);
    } catch (failure) {
      if (id !== generation.current) return;
      const message = failure instanceof Error ? failure.message : "";
      if (message !== "cancelled")
        setError(message === "unsupported" ? t.organizeUnsupported : message === "memory" ? t.memory : t.organizeFailed);
    } finally {
      if (id === generation.current) {
        job.current = undefined;
        setBusy(false);
      }
    }
  }
  const kept = cards.filter((card) => !card.deleted).length;
  const changed = cards.some((card, at) => card.page !== at || card.rotate % 360 || card.deleted);
  const step = result ? 3 : file && (count !== undefined || locked) ? 2 : 1;
  return (
    <section className="tool-card" aria-label={t.toolOrganize}>
      <Steps t={t} current={step} labels={[t.stepFile, t.stepOrder, t.stepDownload]} />
      {file ? (
        <FileInformation
          file={file}
          locale={locale}
          t={t}
          pages={count}
          busy={busy}
          onRemove={reset}
          onSelect={select}
        />
      ) : (
        <FileDropZone t={t} onSelect={select} hint={t.organizeHint} />
      )}
      {file && locked && (
        <PasswordPrompt t={t} busy={unlocking} error={unlockError} onSubmit={unlock} />
      )}
      {file && !locked && count === undefined && !error && (
        <p className="checking" role="status">
          <span className="spinner small" aria-hidden="true" />
          {t.organizeLoading}
        </p>
      )}
      {result && file ? (
        <OrganizeResult
          t={t}
          locale={locale}
          blob={result.blob}
          name={organizedName(file)}
          pages={result.pages}
          unlocked={unlocked}
          restricted={restricted}
          signed={result.signed}
          onReset={reset}
        />
      ) : (
        count !== undefined && (
          <div className="organize">
            <div className="merge-toolbar">
              <span>{fill(t.organizeCount, { kept, count })}</span>
              <span className="organize-tools">
                <button
                  type="button"
                  className="chip-button"
                  disabled={busy}
                  onClick={() => setCards((current) => current.map((card) => ({ ...card, rotate: card.rotate + 90 })))}
                >
                  <RotateCw size={15} aria-hidden="true" />
                  {t.rotateAll}
                </button>
                <button
                  type="button"
                  className="chip-button"
                  disabled={busy || !changed}
                  onClick={() => setCards(fresh(count))}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  {t.resetPages}
                </button>
              </span>
            </div>
            {count > PREVIEWS && <p className="hint">{fill(t.organizeManyPages, { count: PREVIEWS })}</p>}
            <ol className="page-grid" aria-label={t.stepOrder}>
              {cards.map((card, index) => {
                const number = card.page + 1;
                return (
                  <li
                    key={card.page}
                    className={`${card.deleted ? "deleted" : ""}${dragging === index ? " dragging" : ""}`}
                    draggable={!busy}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/x-page", String(index));
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
                    <span className="page-thumb" aria-hidden="true">
                      {thumbnails[card.page] ? (
                        <img
                          src={thumbnails[card.page]}
                          alt=""
                          style={{ transform: `rotate(${card.rotate % 360}deg)` }}
                        />
                      ) : (
                        <span className="page-placeholder">{number}</span>
                      )}
                      {card.deleted && <span className="page-badge">{t.deletedBadge}</span>}
                    </span>
                    <span className="page-number">{fill(t.pageLabel, { page: number })}</span>
                    <span className="page-actions">
                      <button
                        type="button"
                        className="icon-button flip"
                        aria-label={fill(t.movePageBack, { page: number })}
                        disabled={busy || index === 0}
                        onClick={() => move(index, index - 1)}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={fill(t.rotatePage, { page: number })}
                        disabled={busy || card.deleted}
                        onClick={() => change(index, { rotate: card.rotate + 90 })}
                      >
                        <RotateCw size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={fill(card.deleted ? t.restorePage : t.deletePage, { page: number })}
                        aria-pressed={card.deleted}
                        disabled={busy}
                        onClick={() => change(index, { deleted: !card.deleted })}
                      >
                        {card.deleted ? <Undo2 size={16} /> : <Trash2 size={16} />}
                      </button>
                      <button
                        type="button"
                        className="icon-button flip"
                        aria-label={fill(t.movePageForward, { page: number })}
                        disabled={busy || index === cards.length - 1}
                        onClick={() => move(index, index + 1)}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
            {busy ? (
              <div className="processing">
                <div className="progress-head">
                  <strong>{t.organizing}</strong>
                </div>
                <div className="progress indeterminate" role="progressbar" aria-label={t.organizing}>
                  <span />
                </div>
              </div>
            ) : (
              <div className="organize-save">
                <button type="button" className="primary" disabled={!kept} onClick={save}>
                  {t.organizeSave}
                </button>
                <p className="hint merge-note">{kept ? t.organizeNote : t.organizeAllDeleted}</p>
              </div>
            )}
          </div>
        )
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function OrganizeResult({
  t,
  locale,
  blob,
  name,
  pages,
  unlocked,
  restricted,
  signed,
  onReset,
}: {
  t: Messages;
  locale: string;
  blob: Blob;
  name: string;
  pages: number;
  unlocked: boolean;
  restricted: boolean;
  signed: boolean;
  onReset: () => void;
}) {
  return (
    <div className="result" aria-live="polite">
      <Outcome
        title={t.organizeDoneTitle}
        detail={fill(t.mergeDoneDetail, { pages, size: formatSize(blob.size, locale) })}
      />
      <ResultActions t={t} blob={blob} name={name} />
      {unlocked && <p className="result-note">{t.organizeUnlockedNote}</p>}
      {restricted && !unlocked && <p className="result-note">{t.restrictionsNote}</p>}
      {signed && <p className="result-note">{t.organizeSignedNote}</p>}
      <NextSteps
        t={t}
        locale={locale}
        file={new File([blob], name, { type: "application/pdf" })}
        steps={[{ tool: "compress", label: t.compressThis }]}
      />
      <button type="button" className="link-button" onClick={onReset}>
        <RotateCcw size={15} aria-hidden="true" />
        {t.organizeAnother}
      </button>
    </div>
  );
}
