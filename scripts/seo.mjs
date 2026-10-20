import { metadata } from "../src/i18n/metadata.ts";
import fs from "node:fs";
import path from "node:path";

const locales = [
  "en",
  "zh-CN",
  "es",
  "ar",
  "fr",
  "pt",
  "ru",
  "hi",
  "ja",
  "de",
  "vi",
];

const template = fs.readFileSync("dist/index.html", "utf8");
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const alternates = (suffix) =>
  locales
    .map(
      (locale) =>
        `<link rel="alternate" hreflang="${locale}" href="https://pdf.kha.do/${locale}/${suffix}">`,
    )
    .join("") +
  `<link rel="alternate" hreflang="x-default" href="https://pdf.kha.do/en/${suffix}">`;
// Fail the build instead of silently shipping pages without SEO tags.
function replaceOnce(html, pattern, value) {
  if (!pattern.test(html)) throw new Error(`seo: ${pattern} not found`);
  return html.replace(pattern, value);
}
function base(locale, title, description, url, extra = "") {
  let html = replaceOnce(
    template,
    /<html lang="en">/,
    `<html lang="${locale}"${locale === "ar" ? ' dir="rtl"' : ""}>`,
  );
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`);
  return replaceOnce(
    html,
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escape(description)}"><link rel="canonical" href="${url}">${extra}`,
  );
}
// Open Graph wants language_TERRITORY; Facebook lists ar_AR for Arabic.
const ogLocales = {
  en: "en_US",
  "zh-CN": "zh_CN",
  es: "es_ES",
  ar: "ar_AR",
  fr: "fr_FR",
  pt: "pt_BR",
  ru: "ru_RU",
  hi: "hi_IN",
  ja: "ja_JP",
  de: "de_DE",
  vi: "vi_VN",
};
for (const locale of locales) {
  const t = (await import(`../src/i18n/${locale}.ts`)).default;
  const [title, description] = metadata[locale];
  const url = `https://pdf.kha.do/${locale}/`;
  const structured = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: title,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    url,
    description,
    image: `https://pdf.kha.do/og/${locale}.png`,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const image = `https://pdf.kha.do/og/${locale}.png`;
  const social = [
    ["property", "og:type", "website"],
    ["property", "og:site_name", "pdf.kha.do"],
    ["property", "og:locale", ogLocales[locale]],
    ...locales
      .filter((other) => other !== locale)
      .map((other) => ["property", "og:locale:alternate", ogLocales[other]]),
    ["property", "og:title", title],
    ["property", "og:description", description],
    ["property", "og:url", url],
    ["property", "og:image", image],
    ["property", "og:image:type", "image/png"],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:alt", t.hero],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
    ["name", "twitter:image", image],
  ]
    .map(([kind, key, value]) => `<meta ${kind}="${key}" content="${escape(value)}">`)
    .join("") + `<script type="application/ld+json">${JSON.stringify(structured)}</script>`;
  const content = `<main><div class="hero"><h1>${escape(t.hero)}</h1><p>${escape(t.sub)}</p><p>${escape(t.support)}</p></div><section class="content"><h2>${escape(t.how)}</h2><p>${escape(t.howText)}</p><h2>${escape(t.why)}</h2><p>${escape(t.whyText)}</p></section><section class="faq"><h2>${escape(t.faq)}</h2>${[1, 2, 3, 4].map((i) => `<h3>${escape(t["q" + i])}</h3><p>${escape(t["a" + i])}</p>`).join("")}</section><section class="privacy-section"><h2>${escape(t.privacyTitle)}</h2><p>${escape(t.siteLoads)}</p><p>${escape(t.privacyBody)}</p></section></main>`;
  const html = base(
    locale,
    title,
    description,
    url,
    alternates("") + social,
  ).replace('<div id="root"></div>', `<div id="root">${content}</div>`);
  const dir = path.join("dist", locale);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  const privacyUrl = `${url}privacy/`;
  const privacyContent = `<main class="privacy-page"><a href="/${locale}/">pdf.kha.do</a><h1>${escape(t.privacyTitle)}</h1><p class="philosophy">${escape(t.philosophy)}</p><p>${escape(t.siteLoads)}</p><p>${escape(t.privacyBody)}</p><p>${escape(t.limitations)}</p><h2>${escape(t.how)}</h2><p>${escape(t.howText)}</p><p>${escape(t.support)}</p></main>`;
  const privacyHtml = base(
    locale,
    `${t.privacyTitle} | pdf.kha.do`,
    t.siteLoads,
    privacyUrl,
    alternates("privacy/"),
  )
    .replace(/<script type="module"[^>]*><\/script>/, "")
    .replace('<div id="root"></div>', `<div id="root">${privacyContent}</div>`);
  const privacyDir = path.join(dir, "privacy");
  fs.mkdirSync(privacyDir, { recursive: true });
  fs.writeFileSync(path.join(privacyDir, "index.html"), privacyHtml);
}
fs.writeFileSync(
  "dist/index.html",
  '<!doctype html><html><head><meta charset="UTF-8"><meta name="robots" content="noindex"><script src="/redirect.js"></script><noscript><meta http-equiv="refresh" content="0;url=/en/"></noscript></head><body><a href="/en/">English</a></body></html>',
);
fs.copyFileSync("LICENSE", "dist/LICENSE");
fs.writeFileSync(
  "dist/sitemap.xml",
  '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    locales
      .flatMap((locale) => [
        `<url><loc>https://pdf.kha.do/${locale}/</loc></url>`,
        `<url><loc>https://pdf.kha.do/${locale}/privacy/</loc></url>`,
      ])
      .join("") +
    "</urlset>",
);
