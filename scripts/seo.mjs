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
function base(locale, title, description, url, extra = "") {
  return template
    .replace(
      '<html lang="en">',
      `<html lang="${locale}"${locale === "ar" ? ' dir="rtl"' : ""}>`,
    )
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*">/,
      `<meta name="description" content="${escape(description)}"><link rel="canonical" href="${url}">${extra}`,
    );
}
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
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const social = `<meta property="og:type" content="website"><meta property="og:site_name" content="pdf.kha.do"><meta property="og:locale" content="${locale}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="https://pdf.kha.do/icons/icon.svg"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><script type="application/ld+json">${JSON.stringify(structured)}</script>`;
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
