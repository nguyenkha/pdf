import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, RotateCcw } from "lucide-react";
import type { ToolProps } from "../../app/tools";
import type { Messages } from "../../i18n";
import { fill } from "../../i18n/fill";
import { formatSize, validateFile } from "../../lib/pdf";
import { zipBlobs } from "../../lib/zip";
import { FileDropZone } from "../../components/FileDropZone";
import { FileInformation } from "../../components/FileInformation";
import { Steps } from "../../components/Steps";
import { Outcome } from "../../components/Outcome";
import { ResultActions } from "../../components/ResultActions";
import { PasswordPrompt } from "../../components/PasswordPrompt";
import { takeSharedFiles } from "../../lib/handOver";
import { OtherToolOffer } from "../../components/OtherToolOffer";
import { isImage } from "../images-to-pdf/run";
import { unlockFile } from "../compress/run";
import { readPages } from "../organize/run";
import { imageName, renderImages, type ImageFormat } from "./run";
import "../organize/organize.css";
import "./images.css";

// Same preview budget as Organize: past it pages show their number only.
const PREVIEWS = 300;
const MAX_PAGES = 2000;
// Standard suits screens and messages; high suits printing and small text.
const RESOLUTIONS = { standard: 150, high: 300 } as const;
type Resolution = keyof typeof RESOLUTIONS;
type Image = { page: number; name: string; blob: Blob; url: string };
/** Pages of one PDF as JPG or PNG images, drawn on this device. */
export default function PdfToImagesTool({ t, locale, shared, page }: ToolProps) {
  const [file, setFile] = useState<File>();
  const [count, setCount] = useState<number>();
  const [selected, setSelected] = useState<boolean[]>([]);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [format, setFormat] = useState<ImageFormat>(page === "pdf-to-png" ? "png" : "jpg");
  const [resolution, setResolution] = useState<Resolution>("standard");
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string>();
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ images: Image[]; zip?: Blob }>();
  const reading = useRef<{ cancel: () => void } | undefined>(undefined);
  const job = useRef<{ cancel: () => void } | undefined>(undefined);
  // Previews and result images are object URLs; release them with the file or the tool.
  const urls = useRef<string[]>([]);
  urls.current = thumbnails;
  const images = useRef<Image[]>([]);
  images.current = result?.images ?? [];
  const generation = useRef(0);
  // Images chosen here: offered to Image to PDF instead.
  const [offer, setOffer] = useState<File[]>();
  const convertButton = useRef<HTMLButtonElement>(null);
  const selectButton = useRef<HTMLButtonElement>(null);
  // After unlocking, keyboard focus moves to the pages once they are read.
  const focusPages = useRef(false);
  const releaseImages = () => images.current.forEach((image) => URL.revokeObjectURL(image.url));
  const release = () => {
    generation.current++;
    urls.current.forEach((url) => url && URL.revokeObjectURL(url));
    setThumbnails([]);
  };
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
      releaseImages();
    },
    [],
  );
  function read(source: File) {
    reading.current?.cancel();
    release();
    setCount(undefined);
    setSelected([]);
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
        setSelected(Array(pages).fill(true));
        if (focusPages.current) {
          focusPages.current = false;
          requestAnimationFrame(() => selectButton.current?.focus());
        }
      },
      (index, thumbnail) => {
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
    if (files.length && files.every(isImage)) return setOffer(files);
    if (files.length !== 1) return setError(t.oneFile);
    if (validateFile(files[0])) return setError(t.invalid);
    setFile(files[0]);
    read(files[0]);
  }
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
      setFile(copy);
      focusPages.current = true;
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
    releaseImages();
    setFile(undefined);
    setCount(undefined);
    setSelected([]);
    setLocked(false);
    setUnlocking(false);
    setUnlockError(undefined);
    setProgress(undefined);
    setResult(undefined);
    setError("");
    setOffer(undefined);
  }
  function back() {
    releaseImages();
    setResult(undefined);
    requestAnimationFrame(() => convertButton.current?.focus());
  }
  async function convert() {
    if (!file || !count) return;
    const id = generation.current;
    const pages = selected.flatMap((on, index) => (on ? [index + 1] : []));
    setError("");
    setProgress({ done: 0, total: pages.length });
    try {
      const active = renderImages(file, pages, RESOLUTIONS[resolution], format, (done) =>
        setProgress({ done, total: pages.length }),
      );
      job.current = active;
      const rendered = await active.promise;
      if (id !== generation.current) return;
      const made = rendered.map(({ page, blob }) => ({
        page,
        name: imageName(file.name, page, count, format),
        blob,
        url: URL.createObjectURL(blob),
      }));
      // Store-only: JPG and PNG are compressed already.
      const zip = made.length > 1 ? await zipBlobs(made) : undefined;
      if (id !== generation.current) return made.forEach((image) => URL.revokeObjectURL(image.url));
      setResult({ images: made, zip });
    } catch (failure) {
      if (id !== generation.current) return;
      const message = failure instanceof Error ? failure.message : "";
      if (message !== "cancelled") setError(message === "memory" ? t.memory : t.imagesFailed);
    } finally {
      if (id === generation.current) {
        job.current = undefined;
        setProgress(undefined);
      }
    }
  }
  function cancel() {
    job.current?.cancel();
    job.current = undefined;
    setProgress(undefined);
  }
  const chosen = selected.filter(Boolean).length;
  const busy = progress !== undefined;
  const step = result ? 3 : file && (count !== undefined || locked) ? 2 : 1;
  const label = format.toUpperCase();
  return (
    <section className="tool-card" aria-label={t.toolToImages}>
      <Steps t={t} current={step} labels={[t.stepFile, t.stepPages, t.stepDownload]} />
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
        <ImagesResult
          t={t}
          locale={locale}
          images={result.images}
          thumbnails={thumbnails}
          zip={result.zip}
          zipName={file.name.replace(/\.pdf$/i, "") + `-${format}.zip`}
          format={label}
          onBack={back}
          onReset={reset}
        />
      ) : (
        count !== undefined && (
          <div className="organize to-images">
            <div className="merge-toolbar">
              <span>{fill(t.imagesSelected, { count: chosen, pages: count })}</span>
              <span className="organize-tools">
                <button
                  ref={selectButton}
                  type="button"
                  className="chip-button"
                  disabled={busy}
                  onClick={() => setSelected(Array(count).fill(chosen < count))}
                >
                  {chosen < count ? t.selectAll : t.selectNone}
                </button>
              </span>
            </div>
            <div className="image-options">
              <div className="chips" role="group" aria-label={t.imageFormat}>
                <span className="option-label" aria-hidden="true">{t.imageFormat}</span>
                {(["jpg", "png"] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={format === value}
                    disabled={busy}
                    onClick={() => setFormat(value)}
                  >
                    {value.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="chips" role="group" aria-label={t.imageResolution}>
                <span className="option-label" aria-hidden="true">{t.imageResolution}</span>
                {(Object.keys(RESOLUTIONS) as Resolution[]).map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={resolution === value}
                    disabled={busy}
                    onClick={() => setResolution(value)}
                  >
                    {fill(value === "standard" ? t.resolutionStandard : t.resolutionHigh, {
                      dpi: RESOLUTIONS[value],
                    })}
                  </button>
                ))}
              </div>
              <p className="hint">{format === "jpg" ? t.jpgHint : t.pngHint}</p>
            </div>
            {count > PREVIEWS && <p className="hint">{fill(t.imagesManyPages, { count: PREVIEWS })}</p>}
            <ol className="page-grid pick-grid" aria-label={t.stepPages}>
              {selected.map((on, index) => (
                <li key={index} className={on ? "" : "deleted"}>
                  <button
                    type="button"
                    className="pick"
                    aria-pressed={on}
                    aria-label={fill(t.pageLabel, { page: index + 1 })}
                    disabled={busy}
                    onClick={() =>
                      setSelected((current) => current.map((value, at) => (at === index ? !value : value)))
                    }
                  >
                    <span className="page-thumb" aria-hidden="true">
                      {thumbnails[index] ? (
                        <img src={thumbnails[index]} alt="" />
                      ) : (
                        <span className="page-placeholder">{index + 1}</span>
                      )}
                      <span className="pick-mark">{on && <Check size={14} strokeWidth={3} />}</span>
                    </span>
                    <span className="page-number" aria-hidden="true">
                      {fill(t.pageLabel, { page: index + 1 })}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {busy ? (
              <div className="processing">
                <div className="progress-head">
                  <strong>{t.imagesConverting}</strong>
                  <span>{fill(t.pageOf, { page: progress.done, pages: progress.total })}</span>
                </div>
                <div
                  className="progress"
                  role="progressbar"
                  aria-label={t.imagesConverting}
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.done}
                >
                  <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
                <button type="button" className="link-button" onClick={cancel}>
                  {t.cancel}
                </button>
              </div>
            ) : (
              <div className="organize-save">
                <button ref={convertButton} type="button" className="primary" disabled={!chosen} onClick={convert}>
                  {chosen === 1
                    ? fill(t.imagesStartOne, { format: label })
                    : fill(t.imagesStart, { count: chosen, format: label })}
                </button>
                {!chosen && <p className="hint merge-note">{t.imagesNone}</p>}
              </div>
            )}
          </div>
        )
      )}
      {offer && (
        <OtherToolOffer t={t} locale={locale} files={offer} tool="images-to-pdf" text={t.offerImagesToPdf} />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function ImagesResult({
  t,
  locale,
  images,
  thumbnails,
  zip,
  zipName,
  format,
  onBack,
  onReset,
}: {
  t: Messages;
  locale: string;
  images: Image[];
  /** The page previews: full-size images would cost phones memory here. */
  thumbnails: string[];
  zip?: Blob;
  zipName: string;
  format: string;
  onBack: () => void;
  onReset: () => void;
}) {
  const total = images.reduce((sum, image) => sum + image.blob.size, 0);
  // Phones save shared images straight to the photo library.
  const files = useMemo(
    () => images.map((image) => new File([image.blob], image.name, { type: image.blob.type })),
    [images],
  );
  const single = images.length === 1 ? images[0] : undefined;
  return (
    <div className="result" aria-live="polite">
      <Outcome
        title={
          single
            ? fill(t.imagesDoneOne, { format })
            : fill(t.imagesDoneTitle, { count: images.length, format })
        }
        detail={formatSize(total, locale)}
      />
      <ResultActions
        t={t}
        blob={zip ?? images[0].blob}
        name={zip ? zipName : images[0].name}
        download={zip ? t.downloadZip : fill(t.downloadImage, { format })}
        preview={!zip}
        shareFiles={files}
      />
      {!single && (
        <ol className="image-results" aria-label={t.imagesEach}>
          {images.map((image) => (
            <li key={image.page}>
              <a
                href={image.url}
                download={image.name}
                title={image.name}
                aria-label={fill(t.imageLinkLabel, { format, page: image.page })}
              >
                {thumbnails[image.page - 1] ? (
                  <img src={thumbnails[image.page - 1]} alt="" />
                ) : (
                  <span className="page-placeholder">{image.page}</span>
                )}
                <span>
                  <Download size={12} aria-hidden="true" />
                  {fill(t.pageLabel, { page: image.page })}
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
      <p className="next-steps">
        <button type="button" onClick={onBack}>
          {t.imagesChangePages}
        </button>
      </p>
      <button type="button" className="link-button" onClick={onReset}>
        <RotateCcw size={15} aria-hidden="true" />
        {t.imagesAnother}
      </button>
    </div>
  );
}
