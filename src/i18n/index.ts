import en from "./en";
import type { Locale } from "./config";
export type Messages = typeof en;
const loaders: Record<Locale, () => Promise<{ default: Messages }>> = {
  en: () => Promise.resolve({ default: en }),
  "zh-CN": () => import("./zh-CN"),
  es: () => import("./es"),
  ar: () => import("./ar"),
  fr: () => import("./fr"),
  pt: () => import("./pt"),
  ru: () => import("./ru"),
  hi: () => import("./hi"),
  ja: () => import("./ja"),
  de: () => import("./de"),
  vi: () => import("./vi"),
};
export async function messages(locale: Locale) {
  return (await loaders[locale]()).default;
}
