import { useContext, useEffect, useRef, useState } from "react";
import { fillLabel, PreviewLabelsContext } from "./labels";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
type Doc = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
export default function PdfPagePreview({
  file,
  page,
}: {
  file: File;
  page: number;
}) {
  const labels = useContext(PreviewLabelsContext);
  const [doc, setDoc] = useState<Doc>();
  const [error, setError] = useState(false);
  const [renderedPage, setRenderedPage] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof pdfjs.getDocument> | undefined;
    setDoc(undefined);
    setError(false);
    file
      .arrayBuffer()
      .then((data) => {
        if (cancelled) return;
        task = pdfjs.getDocument({
          data: new Uint8Array(data),
          isEvalSupported: false,
          verbosity: 0,
          useSystemFonts: false,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        });
        return task.promise.then((document) => {
          if (!cancelled) setDoc(document);
        });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      void task?.destroy().catch(() => {});
    };
  }, [file]);
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let render:
      | ReturnType<Awaited<ReturnType<Doc["getPage"]>>["render"]>
      | undefined;
    doc
      .getPage(page)
      .then(async (view) => {
        if (cancelled || !canvas.current || !box.current) return;
        const base = view.getViewport({ scale: 1 });
        const width = Math.min(
          box.current.clientWidth * Math.min(devicePixelRatio, 1.5),
          1200,
        );
        const scale = Math.min(
          width / base.width,
          Math.sqrt(4_000_000 / (base.width * base.height)),
          8192 / base.width,
          8192 / base.height,
        );
        const viewport = view.getViewport({ scale });
        const node = canvas.current;
        node.width = Math.ceil(viewport.width);
        node.height = Math.ceil(viewport.height);
        const context = node.getContext("2d");
        if (!context) throw new Error("canvas");
        render = view.render({
          canvasContext: context,
          viewport,
          background: "white",
        });
        try {
          await render.promise;
          if (!cancelled) setRenderedPage(page);
        } finally {
          view.cleanup();
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [doc, page]);
  return (
    <div className="md-pdf-page" ref={box}>
      {error ? (
        <p role="status">
          {labels.pdfFailed}
        </p>
      ) : (
        <>
          {!doc && <p role="status">{labels.pdfOpening}</p>}
          {doc && renderedPage !== page && (
            <p role="status">{labels.pdfRendering}</p>
          )}
          <canvas
            ref={canvas}
            hidden={renderedPage !== page}
            aria-label={fillLabel(labels.pdfPage, { page })}
          />
        </>
      )}
    </div>
  );
}
