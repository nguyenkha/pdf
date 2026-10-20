import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import type { Messages } from "../i18n";
import { fill } from "../i18n/fill";
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Doc = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
const ZOOM = 2.5;
function open(blob: Blob, password?: string) {
  return blob.arrayBuffer().then(
    (data) =>
      pdfjs.getDocument({
        data: new Uint8Array(data),
        password,
        isEvalSupported: false,
        verbosity: 0,
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
      }).promise,
  );
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
    let loaded: Doc[] = [];
    Promise.all([open(original, password), open(result)])
      .then((pair) => {
        loaded = pair;
        setDocs(pair as [Doc, Doc]);
      })
      .catch(() => setFailed(true));
    return () => loaded.forEach((doc) => doc.destroy());
  }, [original, result, password]);
  useEffect(() => {
    if (!docs) return;
    const tasks: { cancel: () => void }[] = [];
    docs.forEach(async (doc, index) => {
      const canvas = canvases[index].current;
      const box = boxes[index].current;
      if (!canvas || !box) return;
      const view = await doc.getPage(page);
      const base = view.getViewport({ scale: 1 });
      const width = box.clientWidth * (zoom ? ZOOM : 1);
      const scale = (width * devicePixelRatio) / base.width;
      const viewport = view.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${width}px`;
      const task = view.render({
        canvasContext: canvas.getContext("2d")!,
        viewport,
        background: "white",
      });
      tasks.push(task);
      await task.promise.catch(() => {});
      view.cleanup();
    });
    return () => tasks.forEach((task) => task.cancel());
    // The canvas and box refs are stable.
  }, [docs, page, zoom]);
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
              <canvas ref={canvases[index]} />
            </div>
          </figure>
        ))}
      </div>
      {!docs && <p className="hint">{t.loading}</p>}
    </div>
  );
}
