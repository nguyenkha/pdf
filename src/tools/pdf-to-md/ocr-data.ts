import type { Locale } from "../../i18n/config";
// Kept apart from ocr.ts so the offer can show sizes without loading OCR.
/** Tesseract language for each interface language, and its data size in bytes. */
export const OCR_LANGUAGES: Record<Locale, { code: string; bytes: number }> = {
  en: { code: "eng", bytes: 2_950_000 },
  "zh-CN": { code: "chi_sim", bytes: 1_720_000 },
  es: { code: "spa", bytes: 2_100_000 },
  ar: { code: "ara", bytes: 1_660_000 },
  fr: { code: "fra", bytes: 710_000 },
  pt: { code: "por", bytes: 1_390_000 },
  ru: { code: "rus", bytes: 2_680_000 },
  hi: { code: "hin", bytes: 1_390_000 },
  ja: { code: "jpn", bytes: 2_030_000 },
  ko: { code: "kor", bytes: 1_570_000 },
  de: { code: "deu", bytes: 1_330_000 },
  vi: { code: "vie", bytes: 1_420_000 },
};
/** The recognizer itself, downloaded once per browser like the language data. */
export const OCR_ENGINE_BYTES = 3_900_000;
/** The chosen language plus English, which most documents mix in. */
export const ocrLanguages = (locale: Locale) =>
  locale === "en" ? ["eng"] : [OCR_LANGUAGES[locale].code, "eng"];
/** First-time download for a language choice: engine plus language data. */
export const ocrDownloadBytes = (locale: Locale) =>
  OCR_ENGINE_BYTES +
  ocrLanguages(locale).reduce(
    (sum, code) => sum + Object.values(OCR_LANGUAGES).find((language) => language.code === code)!.bytes,
    0,
  );
