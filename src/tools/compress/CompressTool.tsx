import { useRef, useState, useEffect } from "react";
import { FileText, ShieldCheck, ChevronDown } from "lucide-react";
import type { Messages } from "../../i18n";
import type { Locale } from "../../i18n/config";
import { targetBytes, validateFile, LARGE_FILE_BYTES } from "../../lib/pdf";
import { runCompression } from "./run";
import type { Preference, ImageQuality } from "../../engines/ghostscript";
import { FileDropZone } from "../../components/FileDropZone";
import { FileInformation } from "../../components/FileInformation";
import {
  ProcessingStatus,
  type Stage,
} from "../../components/ProcessingStatus";
import {
  ResultDownload,
  type CompressionResult,
} from "../../components/ResultDownload";

type Props = { t: Messages; locale: Locale };
export default function CompressTool({ t, locale }: Props) {
  const [file, setFile] = useState<File>();
  const [preference, setPreference] = useState<Preference>("quality");
  const [imageQuality, setImageQuality] = useState<ImageQuality>("auto");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState<"KB" | "MB">("MB");
  const [stage, setStage] = useState<Stage>("reading");
  const [error, setError] = useState("");
  const [result, setResult] = useState<CompressionResult>();
  const [busy, setBusy] = useState(false);
  const job = useRef<{ cancel: () => void } | undefined>(undefined);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      job.current?.cancel();
    },
    [],
  );
  function reset() {
    generation.current++;
    job.current?.cancel();
    job.current = undefined;
    setFile(undefined);
    setResult(undefined);
    setError("");
    setBusy(false);
  }
  function select(files: File[]) {
    if (!files.length) return;
    reset();
    if (files.length !== 1) {
      setError(t.oneFile);
      return;
    }
    const issue = validateFile(files[0]);
    if (issue) {
      setError(t.invalid);
      return;
    }
    setFile(files[0]);
  }
  async function start() {
    if (!file || busy) return;
    const targetSize = targetBytes(target, unit);
    if (target.trim() && !targetSize) {
      setError(t.targetInvalid);
      return;
    }
    const id = ++generation.current;
    setError("");
    setBusy(true);
    setStage("reading");
    try {
      const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
      if (id !== generation.current) return;
      if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-")
        throw new Error("corrupt");
      const active = runCompression(
        file,
        { preference, imageQuality, target: targetSize },
        (next) => {
          if (id === generation.current) setStage(next as Stage);
        },
      );
      job.current = active;
      const output = await active.promise;
      if (id !== generation.current) return;
      setResult({
        blob: output.blob,
        achieved: output.achieved,
        target: targetSize,
        lossy: output.lossy,
      });
    } catch (failure) {
      if (id !== generation.current) return;
      const message =
        failure instanceof Error ? failure.message.toLowerCase() : "";
      if (message !== "cancelled")
        setError(
          message.includes("password")
            ? t.password
            : ["unsupported", "preservation"].includes(message)
              ? t.unsupported
              : message === "corrupt" || message.includes("invalid pdf")
                ? t.corrupt
                : /memory|allocation/.test(message)
                  ? t.memory
                  : t.failed,
        );
    } finally {
      if (id === generation.current) {
        setBusy(false);
        job.current = undefined;
      }
    }
  }
  function cancel() {
    generation.current++;
    job.current?.cancel();
    job.current = undefined;
    setBusy(false);
  }
  return (
    <section className="tool-card" aria-label={t.compress}>
      <div className="tool-title">
        <span className="tool-icon">
          <FileText size={21} aria-hidden="true" />
        </span>
        <div>
          <h2>{t.compress}</h2>
          <p>{t.tagline}</p>
        </div>
      </div>
      {file ? (
        <FileInformation
          file={file}
          locale={locale}
          t={t}
          busy={busy}
          onRemove={reset}
          onSelect={select}
        />
      ) : (
        <FileDropZone t={t} onSelect={select} />
      )}
      {file && file.size > LARGE_FILE_BYTES && (
        <p className="warning">{t.large}</p>
      )}
      <div className="reassurance">
        <ShieldCheck size={16} aria-hidden="true" />
        {t.privacy}
      </div>
      {file && !result && !busy && (
        <>
          <details>
            <summary>
              {t.options}
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="options">
              <label>
                {t.preference}
                <select
                  value={preference}
                  onChange={(event) =>
                    setPreference(event.target.value as Preference)
                  }
                >
                  <option value="quality">{t.quality}</option>
                  <option value="balanced">{t.balanced}</option>
                  <option value="smallest">{t.smallest}</option>
                </select>
              </label>
              <label>
                {t.image}
                <select
                  value={imageQuality}
                  onChange={(event) =>
                    setImageQuality(event.target.value as ImageQuality)
                  }
                >
                  <option value="auto">{t.auto}</option>
                  <option value="high">{t.high}</option>
                  <option value="medium">{t.medium}</option>
                  <option value="low">{t.low}</option>
                </select>
              </label>
              <label>
                {t.target}
                <div className="target-row">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder={t.off}
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                  />
                  <select
                    value={unit}
                    onChange={(event) =>
                      setUnit(event.target.value as "KB" | "MB")
                    }
                    aria-label={t.target}
                  >
                    <option>MB</option>
                    <option>KB</option>
                  </select>
                </div>
              </label>
            </div>
          </details>
          <button type="button" className="primary" onClick={start}>
            {t.compress}
          </button>
        </>
      )}
      {busy && <ProcessingStatus t={t} stage={stage} onCancel={cancel} />}
      {result && file && (
        <ResultDownload
          file={file}
          result={result}
          t={t}
          locale={locale}
          onReset={reset}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
