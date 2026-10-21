import { useEffect, useRef, useState } from "react";
import { ArrowDownAZ, ChevronLeft, ChevronRight, ImageOff, RotateCcw, RotateCw, X } from "lucide-react";
import type { ToolProps } from "../../app/tools";
import type { Messages } from "../../i18n";
import { fill } from "../../i18n/fill";
import { formatSize } from "../../lib/pdf";
import type { PageSize } from "../../engines/images";
import { FileDropZone } from "../../components/FileDropZone";
import { Steps } from "../../components/Steps";
import { Outcome } from "../../components/Outcome";
import { ResultActions } from "../../components/ResultActions";
import { NextSteps } from "../../components/NextSteps";
import { takeSharedFiles } from "../../lib/handOver";
import { defaultPageSize, imagePreview, imagesToPdf, isImage } from "./run";
import "../organize/organize.css";
import "../pdf-to-images/images.css";

type Item = {
  id: number;
  file: File;
  rotate: number;
  preview?: string;
  /** This browser cannot read the image (HEIC outside Safari, damaged files). */
  unreadable?: boolean;
};
const MAX_IMAGES = 100;
// Above this the images and the PDF may not fit a phone's memory together.
const LARGE_TOTAL = 150 * 1024 * 1024;
// Plain image/*: iPhones then hand over HEIC photos as JPG, which every browser reads.
const ACCEPT = "image/*";
const SIZES: PageSize[] = ["a4", "letter", "fit"];
let nextId = 0;
const pdfName = (first: File) => first.name.replace(/\.[^.]+$/, "") + ".pdf";
/** Photos and scans into one PDF, a page per image, in the order arranged. */
export default function ImagesToPdfTool({ t, locale, shared }: ToolProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [size, setSize] = useState<PageSize>(defaultPageSize);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number>();
  const [result, setResult] = useState<{ blob: Blob; pages: number }>();
  const [dragging, setDragging] = useState<number>();
  const [descending, setDescending] = useState(false);
  const job = useRef<{ cancel: () => void } | undefined>(undefined);
  const previewing = useRef<number | undefined>(undefined);
  const live = useRef(items);
  live.current = items;
  useEffect(() => {
    if (!shared) return;
    takeSharedFiles().then((files) => files.length && add(files));
    // A one-time hand-over on mount.
  }, [shared]);
  useEffect(
    () => () => {
      job.current?.cancel();
      live.current.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    },
    [],
  );
  // One preview at a time keeps memory flat: each decodes a full photo.
  useEffect(() => {
    if (previewing.current !== undefined) return;
    const next = items.find((item) => !item.preview && !item.unreadable);
    if (!next) return;
    previewing.current = next.id;
    imagePreview(next.file)
      .then(
        (blob) => {
          const url = URL.createObjectURL(blob);
          setItems((current) => {
            if (!current.some((item) => item.id === next.id)) {
              URL.revokeObjectURL(url);
              return current;
            }
            return current.map((item) => (item.id === next.id ? { ...item, preview: url } : item));
          });
        },
        () =>
          setItems((current) =>
            current.map((item) => (item.id === next.id ? { ...item, unreadable: true } : item)),
          ),
      )
      .finally(() => {
        previewing.current = undefined;
        // Wake the effect for the next image.
        setItems((current) => [...current]);
      });
  }, [items]);
  function add(files: File[]) {
    setError("");
    setResult(undefined);
    const images = files.filter(isImage);
    if (images.length < files.length) setError(t.imagesInvalid);
    const room = MAX_IMAGES - live.current.length;
    if (images.length > room) setError(fill(t.imagesTooMany, { count: MAX_IMAGES }));
    const added = images.slice(0, room).map((file) => ({ id: nextId++, file, rotate: 0 }));
    setItems((current) => [...current, ...added]);
  }
  function remove(id: number) {
    setItems((current) => {
      const gone = current.find((item) => item.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return current.filter((item) => item.id !== id);
    });
  }
  function move(from: number, to: number) {
    setItems((current) => {
      if (to < 0 || to >= current.length || from === to) return current;
      const next = [...current];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  }
  const turn = (id: number) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, rotate: item.rotate + 90 } : item)));
  function sortByName() {
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    const direction = descending ? -1 : 1;
    setItems((current) => [...current].sort((a, b) => direction * collator.compare(a.file.name, b.file.name)));
    setDescending(!descending);
  }
  function reset() {
    job.current?.cancel();
    items.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    setItems([]);
    setResult(undefined);
    setProgress(undefined);
    setError("");
  }
  async function create() {
    setError("");
    setProgress(0);
    const usable = items.filter((item) => !item.unreadable);
    try {
      const active = imagesToPdf(
        usable.map(({ file, rotate }) => ({ file, rotate })),
        size,
        setProgress,
      );
      job.current = active;
      setResult(await active.promise);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "";
      if (message === "cancelled") return;
      const [kind, index] = message.split(":");
      const name = usable[Number(index)]?.file.name ?? "";
      setError(
        kind === "unsupported" || kind === "image"
          ? fill(t.imageUnreadable, { name })
          : message === "memory"
            ? t.memory
            : t.imagesPdfFailed,
      );
    } finally {
      job.current = undefined;
      setProgress(undefined);
    }
  }
  const usable = items.filter((item) => !item.unreadable).length;
  const total = items.reduce((sum, item) => sum + item.file.size, 0);
  const busy = progress !== undefined;
  const step = result ? 3 : items.length ? 2 : 1;
  const sizeLabel = (value: PageSize) =>
    value === "a4" ? "A4" : value === "letter" ? t.pageLetter : t.pageFit;
  return (
    <section className="tool-card" aria-label={t.toolFromImages}>
      <Steps t={t} current={step} labels={[t.stepImages, t.stepOrder, t.stepDownload]} />
      {result ? (
        <ImagesPdfResult
          t={t}
          locale={locale}
          blob={result.blob}
          name={pdfName(items[0].file)}
          pages={result.pages}
          onReset={reset}
        />
      ) : !items.length ? (
        <FileDropZone t={t} onSelect={add} title={t.imagesDrop} hint={t.imagesHint} accept={ACCEPT} />
      ) : (
        <div
          className="organize from-images"
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
            <span>{fill(t.imagesCount, { count: items.length })}</span>
            <span className="organize-tools">
              <button type="button" className="chip-button" onClick={sortByName} disabled={busy || items.length < 2}>
                <ArrowDownAZ size={15} aria-hidden="true" />
                {t.sortByName}
              </button>
            </span>
          </div>
          <ol className="page-grid" aria-label={t.stepOrder}>
            {items.map((item, index) => (
              <li
                key={item.id}
                className={`${item.unreadable ? "deleted" : ""}${dragging === index ? " dragging" : ""}`}
                draggable={!busy}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/x-image", String(index));
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
                  {item.preview ? (
                    <img src={item.preview} alt="" style={{ transform: `rotate(${item.rotate % 360}deg)` }} />
                  ) : item.unreadable ? (
                    <span className="page-placeholder">
                      <ImageOff size={20} />
                    </span>
                  ) : (
                    <span className="page-placeholder">{index + 1}</span>
                  )}
                  {item.unreadable && <span className="page-badge">{t.imageNotSupported}</span>}
                </span>
                <span className="page-number image-name" title={item.file.name}>
                  {item.file.name}
                </span>
                <span className="page-actions">
                  <button
                    type="button"
                    className="icon-button flip"
                    aria-label={fill(t.moveImageBack, { name: item.file.name })}
                    disabled={busy || index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={fill(t.rotateImage, { name: item.file.name })}
                    disabled={busy || item.unreadable}
                    onClick={() => turn(item.id)}
                  >
                    <RotateCw size={16} />
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
                  <button
                    type="button"
                    className="icon-button flip"
                    aria-label={fill(t.moveImageForward, { name: item.file.name })}
                    disabled={busy || index === items.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
          {!busy && <FileDropZone t={t} onSelect={add} title={t.imagesAddMore} compact accept={ACCEPT} />}
          {items.some((item) => item.unreadable) && <p className="warning">{t.imagesSkipped}</p>}
          {total > LARGE_TOTAL && <p className="warning">{t.imagesLarge}</p>}
          <div className="image-options">
            <div className="chips" role="group" aria-label={t.pageSize}>
              <span className="option-label" aria-hidden="true">{t.pageSize}</span>
              {SIZES.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={size === value}
                  disabled={busy}
                  onClick={() => setSize(value)}
                >
                  {sizeLabel(value)}
                </button>
              ))}
            </div>
          </div>
          {busy ? (
            <div className="processing">
              <div className="progress-head">
                <strong>{t.imagesCreating}</strong>
                <span aria-hidden="true">{Math.floor((progress ?? 0) * 100)}%</span>
              </div>
              <div
                className="progress"
                role="progressbar"
                aria-label={t.imagesCreating}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.floor((progress ?? 0) * 100)}
              >
                <span style={{ width: `${Math.floor((progress ?? 0) * 100)}%` }} />
              </div>
            </div>
          ) : (
            <div className="organize-save">
              <button type="button" className="primary" disabled={!usable} onClick={create}>
                {usable === 1 ? t.imagesCreateOne : fill(t.imagesCreate, { count: usable })}
              </button>
            </div>
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
function ImagesPdfResult({
  t,
  locale,
  blob,
  name,
  pages,
  onReset,
}: {
  t: Messages;
  locale: string;
  blob: Blob;
  name: string;
  pages: number;
  onReset: () => void;
}) {
  return (
    <div className="result" aria-live="polite">
      <Outcome
        title={t.imagesPdfDone}
        detail={fill(t.mergeDoneDetail, { pages, size: formatSize(blob.size, locale) })}
      />
      <ResultActions t={t} blob={blob} name={name} />
      <NextSteps
        t={t}
        locale={locale}
        file={new File([blob], name, { type: "application/pdf" })}
        steps={[
          { tool: "compress", label: t.compressThis },
          { tool: "merge", label: t.mergeWithOthers },
        ]}
      />
      <button type="button" className="link-button" onClick={onReset}>
        <RotateCcw size={15} aria-hidden="true" />
        {t.imagesPdfAnother}
      </button>
    </div>
  );
}
