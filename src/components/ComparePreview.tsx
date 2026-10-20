import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import type { Messages } from "../i18n";
import { fill } from "../i18n/fill";
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Doc = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
type Task = ReturnType<typeof pdfjs.getDocument>;
const ZOOM = 2.5;
// Canvas ceilings: Safari kills tabs that hold large canvases, so cap the
// pixel ratio and the pixels per canvas instead of matching the screen.
const MAX_RATIO = 2;
const MAX_PIXELS = 6_000_000;
// pdf.js asks for byte ranges as it needs them, so a large original is never
// read into memory whole just to show one page.
class BlobRange extends pdfjs.PDFDataRangeTransport {
  constructor(private blob: Blob) {
    super(blob.size, new Uint8Array(0));
  }
  requestDataRange(begin: number, end: number) {
    this.blob
      .slice(begin, end)
      .arrayBuffer()
      .then((chunk) => this.onDataRange(begin, new Uint8Array(chunk)));
  }
}
function open(blob: Blob, worker: pdfjs.PDFWorker, password?: string): Task {
  return pdfjs.getDocument({
    range: new BlobRange(blob),
    worker,
    disableAutoFetch: true,
    disableStream: true,
    password,
    isEvalSupported: false,
    verbosity: 0,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  });
}
/** Side-by-side render of one page of the original and the compressed copy. */
export default function ComparePreview({
  t,
  original,
  result,
  pages,
  password,
}: {
  t: Messages;
  original: Blob;
  result: Blob;
  pages: number;
  password?: string;
}) {
  const [docs, setDocs] = useState<[Doc, Doc]>();
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(false);
  const canvases = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)];
  const boxes = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  useEffect(() => {
    // Destroying the loading tasks (not only loaded documents) also stops
    // pdf.js workers when the preview closes before loading finished.
    // One pdf.js worker for both documents, owned here so closing the view
    // terminates it at once instead of waiting for a busy worker to reply.
    const worker = new pdfjs.PDFWorker();
    const tasks = [open(original, worker, password), open(result, worker)];
    let active = true;
    Promise.all(tasks.map((task) => task.promise))
      .then((pair) => active && setDocs(pair as [Doc, Doc]))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      setDocs(undefined);
      tasks.forEach((task) => task.destroy());
      worker.destroy();
    };
  }, [original, result, password]);
  useEffect(() => {
    if (!docs) return;
    let render: { cancel: () => void } | undefined;
    let active = true;
    (async () => {
      // One pane after the other keeps a single decoded page in memory.
      for (const [index, doc] of docs.entries()) {
        const canvas = canvases[index].current;
        const box = boxes[index].current;
        if (!active || !canvas || !box) return;
        const view = await doc.getPage(page);
        const base = view.getViewport({ scale: 1 });
        const width = box.clientWidth * (zoom ? ZOOM : 1);
        let scale = (width * Math.min(devicePixelRatio, MAX_RATIO)) / base.width;
        const pixels = base.width * base.height * scale * scale;
        if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);
        const viewport = view.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${width}px`;
        const task = view.render({
          canvasContext: canvas.getContext("2d")!,
          viewport,
          background: "white",
        });
        render = task;
        await task.promise.catch(() => {});
        view.cleanup();
      }
    })();
    return () => {
      active = false;
      render?.cancel();
    };
    // The canvas and box refs are stable.
  }, [docs, page, zoom]);
  // Release canvas memory when the preview closes.
  useEffect(
    () => () =>
      canvases.forEach((ref) => {
        if (ref.current) ref.current.width = ref.current.height = 0;
      }),
    [],
  );
  // Scroll both panes together while zoomed in.
  function sync(from: number) {
    const source = boxes[from].current;
    const target = boxes[1 - from].current;
    if (source && target) {
      target.scrollTop = source.scrollTop;
      target.scrollLeft = source.scrollLeft;
    }
  }
  if (failed) return <p className="hint">{t.failed}</p>;
  return (
    <div className="compare">
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
        <button
          type="button"
          className="icon-button"
          aria-label={zoom ? t.zoomOut : t.zoomIn}
          aria-pressed={zoom}
          onClick={() => setZoom(!zoom)}
        >
          {zoom ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
        </button>
      </div>
      <div className="compare-panes">
        {[t.original, t.result].map((label, index) => (
          <figure key={label}>
            <figcaption>{label}</figcaption>
            <div
              className={`compare-box${zoom ? " zoomed" : ""}`}
              ref={boxes[index]}
              onScroll={() => sync(index)}
            >
              <canvas
                ref={canvases[index]}
                role="img"
                aria-label={`${label}, ${fill(t.pageOf, { page, pages })}`}
              />
            </div>
          </figure>
        ))}
      </div>
      {!docs && <p className="hint">{t.loading}</p>}
    </div>
  );
}
