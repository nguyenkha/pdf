import { ScanText } from "lucide-react";
import type { Messages } from "../../i18n";
import { locales, names, type Locale } from "../../i18n/config";
import { fill } from "../../i18n/fill";
import { formatSize } from "../../lib/pdf";
import { ocrDownloadBytes } from "./ocr-data";
/**
 * One choice and one button, shaped like the password prompt: what was
 * found, what OCR does and costs, then start. The language follows the page;
 * English is always read too, since most documents mix some in.
 */
export function OcrPrompt({
  t,
  locale,
  title,
  language,
  onLanguage,
  onStart,
}: {
  t: Messages;
  locale: string;
  title: string;
  language: Locale;
  onLanguage: (language: Locale) => void;
  onStart: () => void;
}) {
  const size = formatSize(ocrDownloadBytes(language), locale);
  return (
    <div className="password ocr">
      <p>
        <ScanText size={16} aria-hidden="true" />
        {title}
      </p>
      <div className="password-row">
        <select
          aria-label={t.ocrLanguage}
          title={t.ocrLanguage}
          value={language}
          onChange={(event) => onLanguage(event.target.value as Locale)}
        >
          {locales.map((code, index) => (
            <option key={code} value={code}>
              {names[index]}
            </option>
          ))}
        </select>
        <button type="button" className="primary" onClick={onStart}>
          {t.ocrStart}
        </button>
      </div>
      <small>{fill(t.ocrBody, { size })}</small>
    </div>
  );
}
