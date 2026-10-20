import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Columns2, Copy, FileDown, RotateCcw, Table } from "lucide-react";
import type { ToolProps } from "../../app/tools";
import type { Locale } from "../../i18n/config";
import type { Messages } from "../../i18n";
import { fill } from "../../i18n/fill";
import { validateFile } from "../../lib/pdf";
import { safeEntryName, zipBlobs } from "../../lib/zip";
import { FileDropZone } from "../../components/FileDropZone";
import { FileInformation } from "../../components/FileInformation";
import { Steps } from "../../components/Steps";
import { Outcome } from "../../components/Outcome";
import { ResultActions } from "../../components/ResultActions";
import { PasswordPrompt } from "../../components/PasswordPrompt";
import { useObjectUrl } from "../../hooks/useObjectUrl";
import { unlockFile } from "../compress/run";
import { MarkdownPreview } from "./MarkdownPreview";
import { ImageUrlsContext, PreviewLabelsContext, type PreviewLabels } from "./labels";
import { defaultOptions, type ConversionOptions } from "./markdown";
import type { ConvertedTable } from "./tables";
import { OcrPrompt } from "./OcrPrompt";
import type { OcrProgress } from "./ocr";
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
  images: { path: string; blob: Blob }[];
  /** Pages still without text, by index; OCR can read them. */
  textless: number[];
  /** Pages whose text came from OCR. */
  recognized: number;
};
// The OCR module and its engine load only when someone asks for OCR.
const loadOcr = () => import("./ocr");
const TIMEOUT = 120_000;
const OPTION_KEYS = [
  ["detectHeadings", "optHeadings"],
  ["detectTables", "optTables"],
  ["preserveLinks", "optLinks"],
  ["preserveLists", "optLists"],
  ["preserveFootnotes", "optFootnotes"],
  ["preserveImages", "optImages"],
  ["removeMargins", "optMargins"],
  ["restoreColumns", "optColumns"],
  ["joinPages", "optJoinPages"],
  ["keepLineBreaks", "optKeepLineBreaks"],
] as const;
const baseName = (file: File) => safeEntryName(file.name.replace(/\.pdf$/i, "")) || "document";
/** Words a reader would count: Markdown syntax, comments and image links left out. */
function countWords(markdown: string, locale: string) {
  const text = markdown
    .replace(/<!--[\s\S]*?-->|!\[[^\]]*\]\([^)]*\)|<[^>]+>|\]\(<[^>]*>\)/g, " ")
    .replace(/[#*_`|\\[\]>-]/g, " ");
  if (typeof Intl.Segmenter !== "function") return text.split(/\s+/).filter(Boolean).length;
  let count = 0;
  for (const segment of new Intl.Segmenter(locale, { granularity: "word" }).segment(text))
    if (segment.isWordLike) count++;
  return count;
}
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
  // A PDF with no text at all: the worker keeps it and offers OCR instead of failing.
  const [scan, setScan] = useState(0);
  const [ocrLanguage, setOcrLanguage] = useState<Locale>(locale);
  const [ocr, setOcr] = useState<OcrProgress>();
  const [ocrError, setOcrError] = useState("");
  const ocrAbort = useRef<AbortController | undefined>(undefined);
  const worker = useRef<Worker | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Words written into the Markdown follow the interface language.
  const labels = useMemo(
    () => ({
      page: t.mdPage,
      noText: t.mdNoTextPage,
      marginsOnly: t.mdMarginsOnly,
      column: t.mdColumn,
      image: t.mdImage,
    }),
    [t],
  );
  const stop = () => {
    ocrAbort.current?.abort();
    ocrAbort.current = undefined;
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
      setOcr(undefined);
      if (data.type === "result") {
        setScan(0);
        setResult(data);
        return;
      }
      if (data.code === "no-text") {
        setScan(data.pages);
        return;
      }
      stop();
      if (data.code === "password") {
        setLocked(true);
        return;
      }
      setError(data.code === "memory" ? t.memory : t.mdFailed);
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
    setScan(0);
    setOcrError("");
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
  // Pages are drawn and read here, then handed to the worker as text parts.
  async function recognize(indexes: number[]) {
    if (!file || !worker.current) return;
    const controller = new AbortController();
    ocrAbort.current = controller;
    setOcrError("");
    setOcr({ stage: "loading" });
    try {
      const { recognizePages } = await loadOcr();
      const pages = await recognizePages(file, indexes, ocrLanguage, setOcr, controller.signal);
      if (controller.signal.aborted || !worker.current) return;
      setUpdating(Boolean(result));
      timer.current = setTimeout(() => fail(t.mdTimeout), TIMEOUT);
      worker.current.postMessage({ type: "ocr", pages, options: { ...options, labels } });
    } catch {
      if (controller.signal.aborted) return;
      setOcr(undefined);
      setOcrError(t.ocrFailed);
    }
  }
  function cancelOcr() {
    ocrAbort.current?.abort();
    ocrAbort.current = undefined;
    setOcr(undefined);
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
    setScan(0);
    setOcr(undefined);
    setOcrError("");
  }
  const step = result ? 3 : file ? 2 : 1;
  // The same place shows the offer, then OCR progress, then any OCR error.
  function ocrPanel(title: string, indexes: number[]) {
    if (ocr)
      return (
        <Progress
          t={t}
          title={t.ocrRunning}
          done={ocr.stage === "page" ? ocr.done : undefined}
          total={ocr.stage === "page" ? ocr.total : undefined}
          detail={
            ocr.stage === "loading"
              ? t.ocrLoading
              : fill(t.pageOf, { page: ocr.page, pages: ocr.total })
          }
          onCancel={cancelOcr}
        />
      );
    return (
      <>
        <OcrPrompt
          t={t}
          locale={locale}
          title={title}
          language={ocrLanguage}
          onLanguage={setOcrLanguage}
          onStart={() =>
            void recognize(indexes.length ? indexes : Array.from({ length: scan }, (_, i) => i))
          }
        />
        {ocrError && (
          <p className="error" role="alert">
            {ocrError}
          </p>
        )}
      </>
    );
  }
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
      {busy && !result && !ocr && (
        <Progress
          t={t}
          title={t.mdConverting}
          done={progress?.page}
          total={progress?.total}
          detail={progress && fill(t.pageOf, { page: progress.page, pages: progress.total })}
          onCancel={reset}
        />
      )}
      {scan > 0 && file && !result && ocrPanel(t.ocrTitle, [])}
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
            ocr={
              result.textless.length > 0 &&
              ocrPanel(fill(t.ocrPagesTitle, { count: result.textless.length }), result.textless)
            }
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
  ocr,
}: {
  t: Messages;
  locale: string;
  file: File;
  result: Result;
  options: ConversionOptions;
  updating: boolean;
  onOptions: (next: ConversionOptions) => void;
  onReset: () => void;
  /** The OCR offer for pages without text, shown with the result's notes. */
  ocr?: ReactNode;
}) {
  const [view, setView] = useState<"preview" | "source">("preview");
  const [comparing, setComparing] = useState(false);
  const [page, setPage] = useState(1);
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const [zip, setZip] = useState<Blob>();
  const source = useRef<HTMLTextAreaElement>(null);
  const base = baseName(file);
  const markdown = useMemo(
    () => new Blob([result.markdown], { type: "text/markdown;charset=utf-8" }),
    [result.markdown],
  );
  // Images and tables travel with the Markdown in one archive.
  const bundled = result.images.length > 0 || result.tables.length > 0;
  useEffect(() => {
    setZip(undefined);
    if (!bundled) return;
    let current = true;
    void zipBlobs(
      [
        { name: `${base}.md`, blob: markdown },
        ...result.images.map(({ path, blob }) => ({ name: path, blob })),
        ...result.tables.map((table, index) => ({
          name: `${base}-table-${index + 1}.csv`,
          blob: new Blob([table.csv], { type: "text/csv;charset=utf-8" }),
        })),
      ],
      { folders: true },
    ).then((blob) => current && setZip(blob));
    return () => {
      current = false;
    };
  }, [bundled, base, markdown, result.images, result.tables]);
  const imageUrls = useMemo(
    () => new Map(result.images.map(({ path, blob }) => [path, URL.createObjectURL(blob)])),
    [result.images],
  );
  useEffect(() => () => imageUrls.forEach((url) => URL.revokeObjectURL(url)), [imageUrls]);
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
  const number = new Intl.NumberFormat(locale);
  const stats = [
    [t.mdStatHeadings, result.headings],
    [t.mdStatTables, result.tables.length],
    [t.mdStatImages, result.images.length],
    [t.mdStatLinks, result.linkCount],
    [t.mdStatLists, result.listCount],
    [t.mdStatNotes, result.noteCount],
  ]
    .filter(([, count]) => Number(count) > 0)
    .map(([label, count]) => fill(String(label), { count: number.format(Number(count)) }));
  const notes = [
    result.recognized > 0 && fill(t.ocrDoneNote, { count: result.recognized }),
    // While OCR is still on offer, the offer itself names these pages.
    !result.textless.length && result.emptyPages > 0 && fill(t.mdEmptyPages, { count: result.emptyPages }),
    result.removedLines > 0 && fill(t.mdRemovedLines, { count: result.removedLines }),
    options.restoreColumns && result.columnPages > 0 && fill(t.mdColumnPages, { count: result.columnPages }),
  ].filter(Boolean);
  const changed = OPTION_KEYS.filter(([key]) => options[key] !== defaultOptions[key]).length;
  // With images the archive is the complete result; the .md alone would miss them.
  const withImages = result.images.length > 0;
  const primary = withImages ? zip : markdown;
  const shown = comparing ? result.pageMarkdowns[page - 1] : result.markdown;
  return (
    <div className="result md-result" aria-live="polite">
      <Outcome
        title={fill(t.mdDoneTitle, { pages })}
        detail={[fill(t.mdWords, { count: number.format(countWords(result.markdown, locale)) }), ...stats].join(" · ")}
      />
      {primary && (
        <ResultActions
          t={t}
          blob={primary}
          name={withImages ? `${base}.zip` : `${base}.md`}
          download={withImages ? t.downloadZip : t.downloadMarkdown}
          preview={false}
        >
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
      )}
      {copy !== "idle" && (
        <p className="result-note" role="status">
          {copy === "done" ? t.mdCopied : t.mdCopyFailed}
        </p>
      )}
      {/* The other format is a quiet link here, not one more button row. */}
      {bundled && (
        <p className="result-note">
          {t.mdZipNote}{" "}
          {withImages ? (
            <DownloadLink blob={markdown} name={`${base}.md`} label={t.downloadMdOnly} />
          ) : (
            zip && <DownloadLink blob={zip} name={`${base}.zip`} label={t.downloadZip} />
          )}
        </p>
      )}
      {notes.map((note) => (
        <p className="result-note" key={String(note)}>
          {note}
        </p>
      ))}
      {ocr}
      {result.tables.length > 0 && (
        <div className="md-tables">
          <strong>
            <Table size={15} aria-hidden="true" />
            {t.mdTablesTitle}
          </strong>
          <div>
            {result.tables.map((table, index) => (
              <CsvLink key={index} t={t} table={table} index={index + 1} base={base} />
            ))}
          </div>
          {result.tables.some((table) => table.merged) && <small>{t.mdMergedNote}</small>}
        </div>
      )}
      <details className="advanced md-options">
        <summary>
          {t.mdOptions}
          {changed > 0 && <span className="md-changed">{fill(t.mdOptionsChanged, { count: changed })}</span>}
        </summary>
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
        <div className="md-options-foot">
          <small className="hint">{t.mdOptionsNote}</small>
          {changed > 0 && (
            <button
              type="button"
              className="link-button"
              disabled={updating}
              onClick={() => onOptions({ ...defaultOptions })}
            >
              {t.mdOptionsReset}
            </button>
          )}
        </div>
      </details>
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
          <ImageUrlsContext.Provider value={imageUrls}>
            <MarkdownPreview markdown={shown} />
          </ImageUrlsContext.Provider>
        ) : (
          <textarea
            ref={source}
            className="md-source"
            aria-label={t.mdSource}
            value={shown}
            readOnly
            spellCheck={false}
          />
        )}
      </div>
      <button type="button" className="link-button" onClick={onReset}>
        <RotateCcw size={15} aria-hidden="true" />
        {t.mdAnother}
      </button>
    </div>
  );
}
function DownloadLink({ blob, name, label }: { blob: Blob; name: string; label: string }) {
  const url = useObjectUrl(blob);
  return url ? (
    <a className="note-link" href={url} download={name}>
      <FileDown size={13} aria-hidden="true" />
      {label}
    </a>
  ) : null;
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
    <a className="chip-button" href={url} download={`${base}-table-${index}.csv`}>
      {fill(t.mdTableCsv, { index, page: table.page })}
    </a>
  ) : null;
}
function Progress({
  t,
  title,
  done,
  total,
  detail,
  onCancel,
}: {
  t: Messages;
  title: string;
  done?: number;
  total?: number;
  detail?: string;
  onCancel: () => void;
}) {
  const percent = done !== undefined && total ? Math.min(100, (done / total) * 100) : undefined;
  return (
    <div className="processing">
      <div className="progress-head">
        <strong>{title}</strong>
        {percent !== undefined && <span aria-hidden="true">{Math.floor(percent)}%</span>}
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(percent ?? 0)}
      >
        <span style={{ width: `${percent ?? 3}%` }} />
      </div>
      {detail && (
        <p className="progress-detail" role="status">
          {detail}
        </p>
      )}
      <button type="button" className="secondary" onClick={onCancel}>
        {t.cancel}
      </button>
    </div>
  );
}
