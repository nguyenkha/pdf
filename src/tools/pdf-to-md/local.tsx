import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileDropZone } from "../../components/FileDropZone";
import { useObjectUrl } from "../../hooks/useObjectUrl";
import { validateFile, formatSize } from "../../lib/pdf";
import vi from "../../i18n/vi";
import { MarkdownPreview } from "./MarkdownPreview";
import type { ConvertedTable } from "./tables";
import { defaultOptions, type ConversionOptions } from "./markdown";
const PdfPagePreview = lazy(() => import("./PdfPagePreview"));
import "../../styles/main.css";
import "./local.css";

function CsvDownload({table,index}:{table:ConvertedTable;index:number}) {
  const blob = useMemo(()=>new Blob([table.csv],{type:"text/csv;charset=utf-8"}),[table.csv]);
  const url = useObjectUrl(blob);
  return <a className="secondary" href={url} download={`table-page-${table.page}-${index}.csv`}>CSV · Bảng {index} · Trang {table.page}</a>;
}

function App() {
  const [file, setFile] = useState<File>();
  const [markdown, setMarkdown] = useState("");
  const [view, setView] = useState<"preview" | "source">("preview");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ page: number; total: number }>();
  const [emptyPages, setEmptyPages] = useState(0);
  const [options, setOptions] = useState<ConversionOptions>(defaultOptions);
  const [pageMarkdowns, setPageMarkdowns] = useState<string[]>([]);
  const [removedLines, setRemovedLines] = useState(0);
  const [headings, setHeadings] = useState(0);
  const [tables, setTables] = useState<ConvertedTable[]>([]);
  const [compare, setCompare] = useState(false);
  const [page, setPage] = useState(1);
  const [formatting, setFormatting] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "failed">(
    "idle",
  );
  const source = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (copyStatus === "failed") {
      source.current?.focus();
      source.current?.select();
    }
  }, [copyStatus, view]);
  const worker = useRef<Worker | undefined>(undefined);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [downloadBlob, setDownloadBlob] = useState<Blob>();
  const url = useObjectUrl(downloadBlob);
  const stop = () => {
    worker.current?.terminate();
    worker.current = undefined;
    clearTimeout(timeout.current);
  };
  useEffect(() => () => stop(), []);
  function select(files: File[]) {
    stop();
    setBusy(false);
    setMarkdown("");
    setView("preview");
    setDownloadBlob(undefined);
    setError("");
    setProgress(undefined);
    setEmptyPages(0);
    setPageMarkdowns([]);
    setRemovedLines(0);
    setHeadings(0); setTables([]);
    setCompare(false);
    setPage(1);
    setCopyStatus("idle");
    setFormatting(false);
    if (files.length !== 1 || validateFile(files[0])) {
      setFile(undefined);
      setError("Chọn một file PDF hợp lệ.");
      return;
    }
    setFile(files[0]);
  }
  function start(chosen: ConversionOptions = options) {
    if (!file || busy) return;
    stop();
    setError("");
    setBusy(true);
    setProgress(undefined);
    setFormatting(false);
    try {
      const job = new Worker(new URL("./extract.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = job;
      timeout.current = setTimeout(() => {
        stop();
        setBusy(false);
        setError(
          "File mất quá lâu để đọc. Thử file nhỏ hơn hoặc chuyển ít trang hơn.",
        );
      }, 120000);
      job.onmessage = ({ data }) => {
        if (worker.current !== job) return;
        if (data.type === "progress") {
          setProgress(data);
          return;
        }
        // PDF.js can emit a parser handshake while its module initializes.
        if (data.type !== "error" && data.type !== "result") return;
        clearTimeout(timeout.current);
        setBusy(false);
        setFormatting(false);
        if (data.type === "error") {
          stop();
          setMarkdown("");
          setDownloadBlob(undefined);
          setPageMarkdowns([]);
          setError(
            data.code === "no-text"
              ? "Không tìm thấy lớp chữ trong PDF. File scan cần OCR; bản thử nghiệm này chưa hỗ trợ OCR."
              : data.code === "password"
                ? "Bản thử nghiệm chưa hỗ trợ PDF có mật khẩu. Hãy dùng bản PDF đã mở khóa."
                : data.code === "memory"
                  ? "Trình duyệt không đủ bộ nhớ. Hãy thử ít trang hơn hoặc dùng máy tính."
                  : "Không đọc được PDF này. File có thể bị lỗi hoặc dùng tính năng chưa hỗ trợ.",
          );
          return;
        }
        setMarkdown(data.markdown);
        setPageMarkdowns(data.pageMarkdowns);
        setRemovedLines(data.removedLines);
        setHeadings(data.headings); setTables(data.tables);
        setCopyStatus("idle");
        setEmptyPages(data.emptyPages);
        setDownloadBlob(
          new Blob([data.markdown], { type: "text/markdown;charset=utf-8" }),
        );
      };
      job.onerror = () => {
        if (worker.current !== job) return;
        stop();
        setBusy(false);
        setError("Không khởi động được trình đọc PDF. Thử tải lại trang.");
      };
      job.postMessage({ type: "extract", file, options: chosen });
    } catch {
      stop();
      setBusy(false);
      setError("Trình duyệt chưa hỗ trợ xử lý PDF bằng worker.");
    }
  }
  function updateOptions(next: ConversionOptions) {
    setOptions(next);
    setError("");
    if (!markdown) return;
    if (!worker.current) {
      start(next);
      return;
    }
    setBusy(true);
    setFormatting(true);
    setCopyStatus("idle");
    timeout.current = setTimeout(() => {
      stop();
      setBusy(false);
      setMarkdown("");
      setDownloadBlob(undefined);
      setError("Không cập nhật được Markdown. Hãy chuyển lại PDF.");
    }, 120000);
    worker.current.postMessage({ type: "format", options: next });
  }
  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyStatus("done");
    } catch {
      setView("source");
      setCopyStatus("failed");
    }
  }
  return (
    <>
      <header>
        <a className="brand" href="/">
          pdf.kha.do
        </a>
        <span>Thử nghiệm local · PDF → Markdown</span>
      </header>
      <main className="md-experiment">
        <div className="hero">
          <div className="eyebrow">
            File được xử lý ngay trong trình duyệt, không gửi lên server.
          </div>
          <h1>PDF → Markdown</h1>
          <p>Lấy lớp chữ có sẵn trong PDF và xuất thành file .md.</p>
        </div>
        <section className="tool-card" aria-label="Chuyển PDF sang Markdown">
          <p className="hint">
            Trích chữ, ghép đoạn và nhận diện tiêu đề theo cỡ chữ. Chưa có OCR,
            ô gộp hay hình ảnh; thứ tự đọc có thể sai với tài liệu nhiều cột. Các
            quy tắc định dạng là ước lượng, hãy đối chiếu với PDF gốc.
          </p>
          <FileDropZone
            t={{
              ...vi,
              hint: "Chọn một PDF có lớp chữ. File không được tải lên.",
            }}
            onSelect={select}
          />
          {file && (
            <p>
              <strong>{file.name}</strong> · {formatSize(file.size, "vi")}
            </p>
          )}
          {file && (
            <fieldset className="md-options" disabled={busy}>
              <legend>Tùy chọn văn bản</legend>
              <label>
                <input
                  type="checkbox"
                  checked={options.keepLineBreaks}
                  onChange={(event) =>
                    updateOptions({
                      ...options,
                      keepLineBreaks: event.target.checked,
                    })
                  }
                />
                Giữ xuống dòng gốc
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.detectHeadings}
                  onChange={(event) =>
                    updateOptions({
                      ...options,
                      detectHeadings: event.target.checked,
                    })
                  }
                />
                Nhận diện tiêu đề
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.removeMargins}
                  onChange={(event) =>
                    updateOptions({
                      ...options,
                      removeMargins: event.target.checked,
                    })
                  }
                />
                Bỏ header/footer lặp
              </label>
              <label><input type="checkbox" checked={options.detectTables} onChange={event=>updateOptions({...options,detectTables:event.target.checked})} />Nhận diện bảng đơn giản</label>
              <small>
                Bảng cần hàng/cột thẳng, không ô gộp. Bảng 2 cột cần dữ liệu số để giảm nhầm với bố cục nhiều cột. Dòng đầu dạng chữ được dùng làm tiêu đề; hãy kiểm tra lại.
                Chỉ bỏ dòng nhỏ lặp ở mép ít nhất 3 trang. Bạn có thể tắt từng
                tùy chọn và xem kết quả cập nhật.
              </small>
            </fieldset>
          )}
          {error && <p role="alert">{error}</p>}
          {!busy && file && !markdown && (
            <button className="primary" onClick={() => start()}>
              Chuyển sang Markdown
            </button>
          )}
          {busy && (
            <div role="status">
              <p>
                {formatting
                  ? "Đang cập nhật Markdown…"
                  : progress
                    ? `Đang đọc trang ${progress.page}/${progress.total}…`
                    : "Đang mở PDF…"}
              </p>
              <button
                className="secondary"
                onClick={() => {
                  stop();
                  setBusy(false);
                  setFormatting(false);
                  setMarkdown("");
                  setDownloadBlob(undefined);
                  setPageMarkdowns([]);
                }}
              >
                Hủy
              </button>
            </div>
          )}
          {markdown && (
            <div className="md-result">
              <p role="status">
                Đã trích xuất chữ.
                {emptyPages > 0
                  ? ` Có ${emptyPages} trang không có lớp chữ, được đánh dấu trong kết quả.`
                  : ""}
              </p>
              <p className="hint">
                {headings} tiêu đề và {tables.length} bảng được nhận diện.{" "}
                {removedLines > 0
                  ? `Đã bỏ ${removedLines} dòng header/footer lặp; tắt tùy chọn nếu muốn giữ lại.`
                  : "Không bỏ dòng header/footer nào."}
              </p>
              {tables.length>0 && <div className="md-csv-links" aria-label="Tải bảng CSV">{tables.map((table,i)=><CsvDownload key={i} table={table} index={i+1} />)}</div>}
              <div className="md-actions">
                <a
                  className="primary"
                  href={url}
                  download={file?.name.replace(/\.pdf$/i, "") + ".md"}
                >
                  Tải Markdown
                </a>
                <button
                  type="button"
                  className="secondary"
                  onClick={copyMarkdown}
                >
                  Copy Markdown
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-pressed={compare}
                  onClick={() => setCompare(!compare)}
                >
                  So sánh với PDF
                </button>
              </div>
              {copyStatus !== "idle" && (
                <p role="status">
                  {copyStatus === "done"
                    ? "Đã copy Markdown."
                    : "Trình duyệt không cho phép copy. Nội dung đã được chọn; nhấn Ctrl+C hoặc Command+C để sao chép."}
                </p>
              )}
              {compare && (
                <div
                  className="md-page-controls"
                  aria-label="Chọn trang so sánh"
                >
                  <button
                    type="button"
                    className="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Trang trước
                  </button>
                  <span>
                    Trang {page}/{pageMarkdowns.length}
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    disabled={page >= pageMarkdowns.length}
                    onClick={() => setPage(page + 1)}
                  >
                    Trang sau
                  </button>
                </div>
              )}
              <div className="md-views" aria-label="Chế độ xem">
                <button
                  type="button"
                  className="secondary"
                  aria-pressed={view === "preview"}
                  onClick={() => setView("preview")}
                >
                  Xem trước
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-pressed={view === "source"}
                  onClick={() => setView("source")}
                >
                  Markdown
                </button>
              </div>
              <div className={compare ? "md-comparison" : ""}>
                {compare && file && (
                  <section aria-label="PDF gốc">
                    <h2 className="md-pane-title">PDF gốc · Trang {page}</h2>
                    <Suspense fallback={<p>Đang mở PDF…</p>}>
                      <PdfPagePreview file={file} page={page} />
                    </Suspense>
                  </section>
                )}
                <section aria-label="Kết quả Markdown">
                  {view === "preview" ? (
                    <MarkdownPreview
                      markdown={compare ? pageMarkdowns[page - 1] : markdown}
                    />
                  ) : (
                    <>
                      <label htmlFor="md-output">Nội dung Markdown</label>
                      <textarea
                        ref={source}
                        id="md-output"
                        value={markdown}
                        readOnly
                        spellCheck={false}
                      />
                    </>
                  )}
                </section>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
