import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileDropZone } from "../../components/FileDropZone";
import { useObjectUrl } from "../../hooks/useObjectUrl";
import { validateFile, formatSize } from "../../lib/pdf";
import vi from "../../i18n/vi";
import "../../styles/main.css";
import "./local.css";

function App() {
  const [file, setFile] = useState<File>();
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ page: number; total: number }>();
  const [emptyPages, setEmptyPages] = useState(0);
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
    setDownloadBlob(undefined);
    setError("");
    setProgress(undefined);
    setEmptyPages(0);
    if (files.length !== 1 || validateFile(files[0])) {
      setFile(undefined);
      setError("Chọn một file PDF hợp lệ.");
      return;
    }
    setFile(files[0]);
  }
  function start() {
    if (!file || busy) return;
    stop();
    setError("");
    setBusy(true);
    setProgress(undefined);
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
        stop();
        setBusy(false);
        if (data.type === "error") {
          setError(
            data.code === "no-text"
              ? "Không tìm thấy lớp chữ trong PDF. File scan cần OCR; bản thử nghiệm này chưa hỗ trợ OCR."
              : data.code === "password"
                ? "Bản thử nghiệm chưa hỗ trợ PDF có mật khẩu. Hãy dùng bản PDF đã mở khóa."
                : "Không đọc được PDF này. File có thể bị lỗi hoặc dùng tính năng chưa hỗ trợ.",
          );
          return;
        }
        setMarkdown(data.markdown);
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
      job.postMessage({ file });
    } catch {
      stop();
      setBusy(false);
      setError("Trình duyệt chưa hỗ trợ xử lý PDF bằng worker.");
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
            Bản tối giản: chia theo trang, giữ các dòng chữ. Chưa có OCR, nhận
            diện bảng, hình ảnh hay tiêu đề; thứ tự đọc có thể sai với tài liệu
            nhiều cột.
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
          {error && <p role="alert">{error}</p>}
          {!busy && file && !markdown && (
            <button className="primary" onClick={start}>
              Chuyển sang Markdown
            </button>
          )}
          {busy && (
            <div role="status">
              <p>
                {progress
                  ? `Đang đọc trang ${progress.page}/${progress.total}…`
                  : "Đang mở PDF…"}
              </p>
              <button
                className="secondary"
                onClick={() => {
                  stop();
                  setBusy(false);
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
              <a
                className="primary"
                href={url}
                download={file?.name.replace(/\.pdf$/i, "") + ".md"}
              >
                Tải Markdown
              </a>
              <label htmlFor="md-output">Nội dung Markdown</label>
              <textarea
                id="md-output"
                value={markdown}
                readOnly
                spellCheck={false}
              />
            </div>
          )}
        </section>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
