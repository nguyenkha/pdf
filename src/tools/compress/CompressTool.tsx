import { useRef, useState, useEffect } from "react";
import { ShieldCheck, Signature } from "lucide-react";
import type { Messages } from "../../i18n";
import type { Locale } from "../../i18n/config";
import { validateFile, LARGE_FILE_BYTES } from "../../lib/pdf";
import { planOptions, suggestedLimit } from "../../lib/plan";
import { estimateFile, probeFile, runCompression, type JobProgress } from "./run";
import { removeSignatures } from "../merge/run";
import type { CompressOptions } from "../../engines/ghostscript";
import type { PdfSummary } from "../../engines/validate";
import { ENGINE_BASE } from "../../engines/core";
import { FileDropZone } from "../../components/FileDropZone";
import { FileInformation } from "../../components/FileInformation";
import { PasswordPrompt } from "../../components/PasswordPrompt";
import {
  CompressionPlan,
  type PlanChoice,
} from "../../components/CompressionPlan";
import { ProcessingStatus } from "../../components/ProcessingStatus";
import {
  ResultDownload,
  type CompressionResult,
} from "../../components/ResultDownload";
import { Steps } from "../../components/Steps";
import { errorMessage } from "./errors";
import { BatchTool } from "./BatchTool";
import type { SizePreset } from "../../app/sizes";

type Props = {
  t: Messages;
  locale: Locale;
  preset?: SizePreset;
  /** Opened from the share target with files waiting in the cache. */
  shared?: boolean;
};
// Asks the service worker for files handed over by the share target; it
// holds them in memory and forgets them once given.
async function takeSharedFiles(): Promise<File[]> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller ?? registration.active;
    if (!worker) return [];
    const channel = new MessageChannel();
    const reply = new Promise<File[]>((resolve) => {
      channel.port1.onmessage = (event) => resolve(event.data ?? []);
      setTimeout(() => resolve([]), 5000);
    });
    worker.postMessage({ type: "take-shared" }, [channel.port2]);
    return await reply;
  } catch {
    return [];
  }
}
const RUNNING = "compress-running";
const MAX_BATCH = 20;
function mark(running: boolean) {
  try {
    if (running) sessionStorage.setItem(RUNNING, "1");
    else sessionStorage.removeItem(RUNNING);
  } catch {
    /* Storage may be disabled. */
  }
}
// Warm the HTTP and service worker cache while the user picks a level.
let engineWarmed = false;
function warmEngine() {
  const connection = (navigator as { connection?: { saveData?: boolean } })
    .connection;
  if (engineWarmed || connection?.saveData) return;
  engineWarmed = true;
  fetch(`${ENGINE_BASE}core.wasm`).catch(() => (engineWarmed = false));
}
export default function CompressTool({ t, locale, preset, shared }: Props) {
  const [file, setFile] = useState<File>();
  const [batch, setBatch] = useState<File[]>();
  const [batchDone, setBatchDone] = useState(false);
  const [summary, setSummary] = useState<PdfSummary>();
  const [password, setPassword] = useState<string>();
  const [locked, setLocked] = useState(false);
  // Digitally signed: compressing breaks the signatures, so ask first.
  const [signed, setSigned] = useState(false);
  const [unsigning, setUnsigning] = useState(false);
  const [unsigned, setUnsigned] = useState(false);
  const [checking, setChecking] = useState(false);
  // A size landing page starts on that limit; otherwise the recommendation.
  const [plan, setPlan] = useState<PlanChoice>({
    goal: preset ? "limit" : "recommended",
    imageQuality: "auto",
    gray: false,
    custom: preset?.value ?? "",
    unit: preset?.unit ?? "MB",
  });
  const [progress, setProgress] = useState<JobProgress>();
  const [error, setError] = useState("");
  const [result, setResult] = useState<CompressionResult>();
  const [busy, setBusy] = useState(false);
  const job = useRef<{ cancel: () => void } | undefined>(undefined);
  // Files handed over by the installed app's share target (see sw.js).
  useEffect(() => {
    if (!shared) return;
    takeSharedFiles().then((files) => files.length && select(files));
    // A one-time hand-over on mount.
  }, [shared]);
  // Phones kill and reload a tab that runs out of memory mid-job. A marker
  // that survives the reload lets us explain it instead of starting blank.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(RUNNING)) {
        sessionStorage.removeItem(RUNNING);
        setError(t.crashed);
      }
    } catch {
      /* Storage may be disabled. */
    }
  }, [t.crashed]);
  const card = useRef<HTMLElement>(null);
  const [estimate, setEstimate] = useState<{ size?: number; loading: boolean }>();
  const sampleJob = useRef<{ cancel: () => void } | undefined>(undefined);
  // On phones the next action can sit below the fold after a step changes.
  useEffect(() => {
    const element = card.current;
    if (!element || (!summary && !result)) return;
    const { bottom } = element.getBoundingClientRect();
    if (bottom > innerHeight)
      element.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [summary, result]);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      job.current?.cancel();
    },
    [],
  );
  function stop() {
    generation.current++;
    job.current?.cancel();
    job.current = undefined;
  }
  function reset() {
    stop();
    setBatch(undefined);
    setFile(undefined);
    setSummary(undefined);
    setPassword(undefined);
    setLocked(false);
    setSigned(false);
    setUnsigned(false);
    setChecking(false);
    setResult(undefined);
    setError("");
    setBusy(false);
  }
  // Flattens the signatures into the page (what readers see stays), then
  // checks the copy like any other file.
  async function unsign() {
    if (!file) return;
    setUnsigning(true);
    try {
      const blob = await removeSignatures(file).promise;
      const copy = new File([blob], file.name, { type: "application/pdf" });
      setSigned(false);
      setUnsigned(true);
      setFile(copy);
      await probe(copy, password);
    } catch (failure) {
      setSigned(false);
      setError(errorMessage(t, failure));
    } finally {
      setUnsigning(false);
    }
  }
  async function probe(next: File, secret?: string) {
    const id = ++generation.current;
    setChecking(true);
    setError("");
    try {
      const head = new Uint8Array(await next.slice(0, 1024).arrayBuffer());
      if (id !== generation.current) return;
      if (String.fromCharCode(...head.slice(0, 5)) !== "%PDF-")
        throw new Error("corrupt");
      const active = probeFile(next, secret);
      job.current = active;
      const found = await active.promise;
      if (id !== generation.current) return;
      setSummary(found);
      setPassword(secret);
      setLocked(false);
      setPlan((current) => ({
        ...current,
        limit: suggestedLimit(next.size, found.pages),
      }));
      warmEngine();
    } catch (failure) {
      if (id !== generation.current) return;
      const message = failure instanceof Error ? failure.message : "";
      if (message === "cancelled") return;
      if (message.startsWith("password")) {
        setLocked(true);
        if (message === "password-incorrect") setError(t.passwordWrong);
      } else if (message === "signed") setSigned(true);
      else setError(errorMessage(t, failure));
    } finally {
      if (id === generation.current) {
        setChecking(false);
        job.current = undefined;
      }
    }
  }
  function select(files: File[]) {
    if (!files.length) return;
    reset();
    if (files.length > MAX_BATCH) {
      setError(t.tooMany);
      return;
    }
    if (files.length > 1) {
      const pdfs = files.filter((candidate) => !validateFile(candidate));
      if (pdfs.length < files.length) setError(t.invalid);
      if (pdfs.length > 1) setBatch(pdfs);
      else if (pdfs.length === 1) select(pdfs);
      return;
    }
    if (validateFile(files[0])) {
      setError(t.invalid);
      return;
    }
    setFile(files[0]);
    probe(files[0]);
  }
  function options(): CompressOptions | undefined {
    if (!file || !summary) return;
    return planOptions(plan, file.size, summary, password);
  }
  // A quick sample run gives an expected size for the chosen level.
  const estimateKey = file && summary && !busy && !result && plan.goal !== "limit" && summary.hasImages
    ? `${file.name}|${file.size}|${file.lastModified}|${summary.pages}|${plan.goal}|${plan.imageQuality}|${plan.gray}`
    : "";
  useEffect(() => {
    setEstimate(undefined);
    if (!estimateKey || !file || !summary) return;
    const chosen = options();
    if (!chosen) return;
    let active = true;
    let sample: ReturnType<typeof estimateFile> | undefined;
    const timer = setTimeout(() => {
      setEstimate({ loading: true });
      sample = estimateFile(file, chosen, summary.pages);
      sampleJob.current = sample;
      sample.promise
        .then((size) => active && setEstimate({ size, loading: false }))
        .catch(() => active && setEstimate(undefined));
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
      sample?.cancel();
    };
    // options() reads plan, file and summary, all covered by the key.
  }, [estimateKey]);
  async function start() {
    if (!file || busy) return;
    const chosen = options();
    if (!chosen) {
      setError(t.targetInvalid);
      return;
    }
    // Stop the size estimate first: its engine runs would otherwise overlap
    // the real job and add to the peak memory on phones.
    sampleJob.current?.cancel();
    sampleJob.current = undefined;
    const id = ++generation.current;
    setError("");
    setBusy(true);
    setProgress({ stage: "reading", value: 0 });
    mark(true);
    try {
      const active = runCompression(file, chosen, (next) => {
        if (id === generation.current) setProgress(next);
      });
      job.current = active;
      const output = await active.promise;
      if (id !== generation.current) return;
      setResult({
        blob: output.blob,
        achieved: output.achieved,
        target: chosen.target,
        lossy: output.lossy,
        unlocked: Boolean(password),
        unsigned,
      });
    } catch (failure) {
      if (id !== generation.current) return;
      if (!(failure instanceof Error && failure.message === "cancelled"))
        setError(errorMessage(t, failure));
    } finally {
      mark(false);
      if (id === generation.current) {
        setBusy(false);
        job.current = undefined;
      }
    }
  }
  function cancel() {
    stop();
    setBusy(false);
  }
  const step = batch ? (batchDone ? 3 : 2) : result ? 3 : file && (summary || locked || signed) ? 2 : 1;
  return (
    <section className="tool-card" aria-label={t.compress} ref={card}>
      <Steps t={t} current={step} />
      {batch ? (
        <BatchTool
          t={t}
          locale={locale}
          files={batch}
          onReset={reset}
          onComplete={setBatchDone}
        />
      ) : file ? (
        <FileInformation
          file={file}
          locale={locale}
          t={t}
          pages={summary?.pages}
          busy={busy}
          onRemove={reset}
          onSelect={select}
        />
      ) : (
        <FileDropZone t={t} onSelect={select} />
      )}
      {file && file.size > LARGE_FILE_BYTES && !result && (
        <p className="warning">{t.large}</p>
      )}
      {checking && !locked && (
        <p className="checking" role="status">
          <span className="spinner small" aria-hidden="true" />
          {t.checking}
        </p>
      )}
      {file && signed && (
        <div className="password signed">
          <p>
            <Signature size={16} aria-hidden="true" />
            {t.signedPrompt}
          </p>
          <button type="button" className="primary" disabled={unsigning} onClick={unsign}>
            {t.signedContinue}
          </button>
          <small>{t.signedHint}</small>
        </div>
      )}
      {file && locked && (
        <PasswordPrompt
          t={t}
          busy={checking}
          onSubmit={(secret) => probe(file, secret)}
          error={error || undefined}
        />
      )}
      {file && summary && !result && !busy && (
        <>
          <CompressionPlan
            t={t}
            locale={locale}
            size={file.size}
            summary={summary}
            value={plan}
            onChange={setPlan}
            estimate={estimate}
          />
          <button type="button" className="primary" onClick={start}>
            {t.compress}
          </button>
        </>
      )}
      {busy && progress && (
        <ProcessingStatus
          t={t}
          locale={locale}
          progress={progress}
          onCancel={cancel}
        />
      )}
      {result && file && (
        <ResultDownload
          file={file}
          result={result}
          t={t}
          locale={locale}
          pages={summary?.pages ?? 1}
          password={password}
          onReset={reset}
        />
      )}
      {error && !locked && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!file && !batch && (
        <div className="reassurance">
          <ShieldCheck size={16} aria-hidden="true" />
          {t.privacy}
        </div>
      )}
    </section>
  );
}
