export const locales = [
  "en",
  "zh-CN",
  "es",
  "ar",
  "fr",
  "pt",
  "ru",
  "hi",
  "ja",
  "ko",
  "de",
  "vi",
] as const;
export type Locale = (typeof locales)[number];
export const names = [
  "English",
  "简体中文",
  "Español",
  "العربية",
  "Français",
  "Português",
  "Русский",
  "हिन्दी",
  "日本語",
  "한국어",
  "Deutsch",
  "Tiếng Việt",
];
export function resolveLocale(value: string): Locale {
  const match =
    locales.find((l) => l.toLowerCase() === value.toLowerCase()) ??
    locales.find(
      (l) => l.split("-")[0] === value.split("-")[0].toLowerCase(),
    );
  return match ?? "en";
}
export function initialLocale(): Locale {
  const route = location.pathname.split("/")[1];
  if (locales.includes(route as Locale)) return route as Locale;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("locale");
  } catch {
    /* Storage may be disabled. */
  }
  if (saved) return resolveLocale(saved);
  const preferred = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  return resolveLocale(
    preferred.find((value) => resolveLocale(value) !== "en" || /^en\b/i.test(value)) ??
      "en",
  );
}
