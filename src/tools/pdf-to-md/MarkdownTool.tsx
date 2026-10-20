import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Columns2, Copy, RotateCcw, Table } from "lucide-react";
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
import { useObjectUrl } from "../../hooks/useObjectUrl";
import { unlockFile } from "../compress/run";
import { MarkdownPreview } from "./MarkdownPreview";
import { PreviewLabelsContext, type PreviewLabels } from "./labels";
import { defaultOptions, type ConversionOptions } from "./markdown";
import type { ConvertedTable } from "./tables";
import "./tool.css";
// The PDF parser for page comparison loads only when someone opens it.
const PdfPagePreview = lazy(() => import("./PdfPagePreview"));

type Result = {
  markdown: string;
  pageMarkdowns: string[];
  emptyPages: number;
  removedLines: number;
  headings: number;
  tables: ConvertedTable[];
  columnPages: number;
  linkCount: number;
  noteCount: number;
  listCount: number;
};
const TIMEOUT = 120_000;
const OPTION_KEYS = [
  ["detectHeadings", "optHeadings"],
  ["detectTables", "optTables"],
  ["preserveLinks", "optLinks"],
  ["preserveLists", "optLists"],
  ["preserveFootnotes", "optFootnotes"],
  ["removeMargins", "optMargins"],
  ["restoreColumns", "optColumns"],
  ["joinPages", "optJoinPages"],
  ["keepLineBreaks", "optKeepLineBreaks"],
] as const;
const markdownName = (file: File) => file.name.replace(/\.pdf$/i, "") + ".md";
/** One PDF's text layer to Markdown, converted as soon as a file is chosen. */
export default function MarkdownTool({ t, locale }: ToolProps) {
  const [file, setFile] = useState<File>();
  const [options, setOptions] = useState<ConversionOptions>(defaultOptions);
  const [result, setResult] = useState<Result>();
  const [progress, setProgress] = useState<{ page: number; total: number }>();
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string>();
  const worker = useRef<Worker | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Words written into the Markdown follow the interface language.
  const labels = useMemo(
    () => ({
      page: t.mdPage,
      noText: t.mdNoTextPage,
      marginsOnly: t.mdMarginsOnly,
      column: t.mdColumn,
    }),
    [t],
  );
  const stop = () => {
    worker.current?.terminate();
    worker.current = undefined;
    clearTimeout(timer.current);
  };
  useEffect(() => () => stop(), []);
  function fail(message: string) {
    stop();
    setBusy(false);
    setUpdating(false);
    setResult(undefined);
    setError(message);
  }
  function convert(source: File, chosen: ConversionOptions) {
    stop();
    setError("");
    setBusy(true);
    setProgress(undefined);
    const job = new Worker(new URL("./extract.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = job;
    timer.current = setTimeout(() => fail(t.mdTimeout), TIMEOUT);
    job.onmessage = ({ data }) => {
      if (worker.current !== job) return;
      if (data.type === "progress") return setProgress(data);
      // pdf.js can announce its in-worker fallback; ignore anything else.
      if (data.type !== "error" && data.type !== "result") return;
      clearTimeout(timer.current);
      setBusy(false);
      setUpdating(false);
      if (data.type === "result") {
        setResult(data);
        return;
      }
      stop();
      if (data.code === "password") {
        setLocked(true);
        return;
      }
      setError(
        data.code === "no-text"
          ? t.mdNoText
          : data.code === "memory"
            ? t.memory
            : t.mdFailed,
      );
    };
    job.onerror = () => fail(t.failed);
    job.postMessage({ type: "extract", file: source, options: { ...chosen, labels } });
  }
  function select(files: File[]) {
    stop();
    setResult(undefined);
    setError("");
    setLocked(false);
    setUnlockError(undefined);
    if (files.length !== 1) return setError(t.oneFile);
    if (validateFile(files[0])) return setError(t.invalid);
    setFile(files[0]);
    convert(files[0], options);
  }
  // Option changes re-format the text the worker already holds.
  function update(next: ConversionOptions) {
    setOptions(next);
    if (!file || !result) return;
    if (!worker.current) return convert(file, next);
    setBusy(true);
    setUpdating(true);
    timer.current = setTimeout(() => fail(t.mdTimeout), TIMEOUT);
    worker.current.postMessage({ type: "format", options: { ...next, labels } });
  }
  // Same check and rewrite as the compress tool's password step.
  async function unlock(password: string) {
    if (!file) return;
    setUnlocking(true);
    setUnlockError(undefined);
    try {
      const blob = await unlockFile(file, password).promise;
      const unlocked = new File([blob], file.name, { type: "application/pdf" });
      setLocked(false);
      setFile(unlocked);
      convert(unlocked, options);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "";
      setUnlockError(message === "password-incorrect" ? t.passwordWrong : t.failed);
    } finally {
      setUnlocking(false);
    }
  }
  function reset() {
    stop();
    setFile(undefined);
    setResult(undefined);
    setError("");
    setLocked(false);
    setBusy(false);
  }
  const step = result ? 3 : file ? 2 : 1;
  const previewLabels: PreviewLabels = {
    preview: t.mdPreview,
    table: t.mdTable,
    footnote: t.mdFootnote,
    pdfFailed: t.mdPdfFailed,
    pdfOpening: t.mdPdfOpening,
    pdfRendering: t.mdPdfRendering,
    pdfPage: t.mdPdfPage,
  };
  return (
    <section className="tool-card" aria-label={t.toolMarkdown}>
      <Steps t={t} current={step} labels={[t.stepFile, t.stepConvert, t.stepDownload]} />
      {file ? (
        <FileInformation file={file} locale={locale} t={t} busy={busy} onRemove={reset} onSelect={select} />
      ) : (
        <FileDropZone t={t} onSelect={select} hint={t.mdHint} />
      )}
      {locked && file && (
        <PasswordPrompt t={t} busy={unlocking} error={unlockError} onSubmit={unlock} />
      )}
      {busy && !result && (
        <div className="processing">
          <div className="progress-head">
            <strong>{t.mdConverting}</strong>
            {progress && (
              <span aria-hidden="true">
                {Math.floor((progress.page / progress.total) * 100)}%
              </span>
            )}
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-label={t.mdConverting}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress ? Math.floor((progress.page / progress.total) * 100) : 0}
          >
            <span style={{ width: `${progress ? (progress.page / progress.total) * 100 : 3}%` }} />
          </div>
          {progress && (
            <p className="progress-detail" role="status">
              {fill(t.pageOf, { page: progress.page, pages: progress.total })}
            </p>
          )}
          <button type="button" className="secondary" onClick={reset}>
            {t.cancel}
          </button>
        </div>
      )}
      {result && file && (
        <PreviewLabelsContext.Provider value={previewLabels}>
          <MarkdownResult
            t={t}
            locale={locale}
            file={file}
            result={result}
            options={options}
            updating={updating}
            onOptions={update}
            onReset={reset}
          />
        </PreviewLabelsContext.Provider>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function MarkdownResult({
  t,
  locale,
  file,
  result,
  options,
  updating,
  onOptions,
  onReset,
}: {
  t: Messages;
  locale: string;
  file: File;
  result: Result;
  options: ConversionOptions;
  updating: boolean;
  onOptions: (next: ConversionOptions) => void;
  onReset: () => void;
}) {
  const [view, setView] = useState<"preview" | "source">("preview");
  const [comparing, setComparing] = useState(false);
  const [page, setPage] = useState(1);
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const source = useRef<HTMLTextAreaElement>(null);
  const blob = useMemo(
    () => new Blob([result.markdown], { type: "text/markdown;charset=utf-8" }),
    [result.markdown],
  );
  useEffect(() => setCopy("idle"), [result.markdown]);
  useEffect(() => {
    if (copy === "failed") {
      source.current?.focus();
      source.current?.select();
    }
  }, [copy, view]);
  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(result.markdown);
      setCopy("done");
    } catch {
      setView("source");
      setCopy("failed");
    }
  }
  const pages = result.pageMarkdowns.length;
  const stats = [
    [t.mdStatHeadings, result.headings],
    [t.mdStatTables, result.tables.length],
    [t.mdStatLinks, result.linkCount],
    [t.mdStatLists, result.listCount],
    [t.mdStatNotes, result.noteCount],
  ]
    .filter(([, count]) => Number(count) > 0)
    .map(([label, count]) => fill(String(label), { count }));
  const notes = [
    result.emptyPages > 0 && fill(t.mdEmptyPages, { count: result.emptyPages }),
    result.removedLines > 0 && fill(t.mdRemovedLines, { count: result.removedLines }),
    options.restoreColumns && result.columnPages > 0 && fill(t.mdColumnPages, { count: result.columnPages }),
  ].filter(Boolean);
  return (
    <div className="result md-result" aria-live="polite">
      <Outcome
        title={fill(t.mdDoneTitle, { pages })}
        detail={`${formatSize(blob.size, locale)}${stats.length ? ` · ${stats.join(" · ")}` : ""}`}
      />
      {notes.map((note) => (
        <p className="result-note" key={String(note)}>
          {note}
        </p>
      ))}
      <ResultActions t={t} blob={blob} name={markdownName(file)} download={t.downloadMarkdown} preview={false}>
        <button type="button" className="secondary" onClick={copyMarkdown}>
          <Copy size={18} aria-hidden="true" />
          {t.copyMarkdown}
        </button>
        <button
          type="button"
          className="secondary"
          aria-expanded={comparing}
          onClick={() => setComparing(!comparing)}
        >
          <Columns2 size={18} aria-hidden="true" />
          {t.compareWithPdf}
        </button>
      </ResultActions>
      {copy !== "idle" && (
        <p className="result-note" role="status">
          {copy === "done" ? t.mdCopied : t.mdCopyFailed}
        </p>
      )}
      {result.tables.length > 0 && (
        <div className="md-tables">
          <strong>
            <Table size={15} aria-hidden="true" />
            {t.mdTablesTitle}
          </strong>
          <div>
            {result.tables.map((table, index) => (
              <CsvLink key={index} t={t} table={table} index={index + 1} base={file.name} />
            ))}
          </div>
          {result.tables.some((table) => table.merged) && <small>{t.mdMergedNote}</small>}
        </div>
      )}
      <div className="md-toolbar">
        <div className="chips" role="group" aria-label={`${t.preview} / ${t.viewSource}`}>
          <button type="button" aria-pressed={view === "preview"} onClick={() => setView("preview")}>
            {t.preview}
          </button>
          <button type="button" aria-pressed={view === "source"} onClick={() => setView("source")}>
            {t.viewSource}
          </button>
        </div>
        {comparing && (
          <div className="compare-bar">
            <button
              type="button"
              className="icon-button"
              aria-label={t.previousPage}
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>{fill(t.pageOf, { page, pages })}</span>
            <button
              type="button"
              className="icon-button"
              aria-label={t.nextPage}
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
        {updating && (
          <span className="hint" role="status">
            {t.mdUpdating}
          </span>
        )}
      </div>
      <div className={comparing ? "md-comparison" : ""}>
        {comparing && (
          <Suspense fallback={<p className="hint">{t.loading}</p>}>
            <PdfPagePreview file={file} page={page} />
          </Suspense>
        )}
        {view === "preview" ? (
          <MarkdownPreview markdown={comparing ? result.pageMarkdowns[page - 1] : result.markdown} />
        ) : (
          <textarea
            ref={source}
            className="md-source"
            aria-label={t.mdSource}
            value={comparing ? result.pageMarkdowns[page - 1] : result.markdown}
            readOnly
            spellCheck={false}
          />
        )}
      </div>
      <details className="advanced md-options">
        <summary>{t.mdOptions}</summary>
        <div className="md-option-grid">
          {OPTION_KEYS.map(([key, label]) => (
            <label className="check" key={key}>
              <input
                type="checkbox"
                checked={options[key]}
                disabled={updating}
                onChange={(event) => onOptions({ ...options, [key]: event.target.checked })}
              />
              {t[label]}
            </label>
          ))}
        </div>
        <small className="hint">{t.mdOptionsNote}</small>
      </details>
      <button type="button" className="link-button" onClick={onReset}>
        <RotateCcw size={15} aria-hidden="true" />
        {t.mdAnother}
      </button>
    </div>
  );
}
function CsvLink({
  t,
  table,
  index,
  base,
}: {
  t: Messages;
  table: ConvertedTable;
  index: number;
  base: string;
}) {
  const blob = useMemo(() => new Blob([table.csv], { type: "text/csv;charset=utf-8" }), [table.csv]);
  const url = useObjectUrl(blob);
  return url ? (
    <a className="chip-button" href={url} download={`${base.replace(/\.pdf$/i, "")}-table-${index}.csv`}>
      {fill(t.mdTableCsv, { index, page: table.page })}
    </a>
  ) : null;
}
