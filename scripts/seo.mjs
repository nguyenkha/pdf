import { metadata } from "../src/i18n/metadata.ts";
import { SIZE_PAGES } from "../src/app/sizes.ts";
import { faqFor } from "../src/app/faq.ts";

// Mirrors the built tools in src/app/tools.ts (that file imports React
// components); the locale home page redirects to compress. MORE_PLANNED mirrors its
// unnamed "more tools coming" placeholder.
const TOOLS = [
  { id: "compress", slug: "compress", nameKey: "compress" },
  { id: "merge", slug: "merge", nameKey: "toolMerge" },
  { id: "markdown", slug: "markdown", nameKey: "toolMarkdown" },
  { id: "organize", slug: "organize", nameKey: "toolOrganize" },
];
// Mirrors the tools' landing pages: own texts and FAQ, the tool's app.
const LANDINGS = [
  { id: "rotate-pdf", slug: "rotate-pdf", nameKey: "toolRotate", tool: "organize" },
  { id: "delete-pdf-pages", slug: "delete-pdf-pages", nameKey: "toolDeletePages", tool: "organize" },
];
const MORE_PLANNED = true;
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
  "ko",
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
  ko: "ko_KR",
  de: "de_DE",
  vi: "vi_VN",
};
const fill = (message, values) =>
  message.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
const sizeLabel = (slug) => slug.replace(/(\d+)(kb|mb)/, (_, n, u) => `${n} ${u.toUpperCase()}`);
const sizePath = (slug) => `compress-pdf-to-${slug}/`;
// Every page family: home, one page per size limit, privacy. Alternates
// list the same family in each locale.
// A tool beyond compress needs <id>Title, <id>Description, <id>Hero and
// <id>Intro strings (prefix = its nameKey); the build fails without them.
// Compress keeps the original home-page content and strings.
const COMPRESS = "compress/";
const toolPages = [...TOOLS.filter((tool) => tool.nameKey !== "compress"), ...LANDINGS];
// The tool behind a page: itself, or the tool a landing page opens.
const appOf = (page) => (page?.tool ? TOOLS.find((tool) => tool.id === page.tool) : page);
const families = [
  COMPRESS,
  ...SIZE_PAGES.map(sizePath),
  ...toolPages.map((tool) => `${tool.slug}/`),
  "privacy/",
];
function writePage(locale, suffix, html) {
  const dir = path.join("dist", locale, suffix);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
}
// Each tool has its own share image; compress keeps the original address.
const ogImage = (locale, tool) =>
  `https://pdf.kha.do/og/${tool ? `${tool.id}-` : ""}${locale}.png`;
function socialTags(locale, t, title, description, url, tool, alt) {
  const image = ogImage(locale, tool);
  return [
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
    ["property", "og:image:alt", alt],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
    ["name", "twitter:image", image],
  ]
    .map(([kind, key, value]) => `<meta ${kind}="${key}" content="${escape(value)}">`)
    .join("");
}
// Matches ToolSwitcher: the tool in use, the others behind "+".
const switcher = (t, locale, tool = TOOLS[0]) => {
  const href = (item) => `/${locale}/${item.slug ? item.slug + "/" : ""}`;
  const others = TOOLS.filter((item) => item.id !== tool.id);
  return !others.length && !MORE_PLANNED
    ? ""
    : `<nav class="tool-switcher"><a href="${href(tool)}" aria-current="page">${escape(t[tool.nameKey])}</a><details class="tool-more"><summary aria-label="${escape(t.tools)}" title="${escape(t.tools)}">+</summary><ul>${others
        .map((item) => `<li><a href="${href(item)}">${escape(t[item.nameKey])}</a></li>`)
        .join("")}${MORE_PLANNED ? `<li class="soon">${escape(t.coming)}</li>` : ""}</ul></details></nav>`;
};
// Same boxes as the app's first render, so swapping in the app moves nothing.
const header = '<header class="site-header"></header>';
const credits = (t) =>
  `<p class="credits">${escape(t.credits)
    .replace("{gs}", '<a href="https://www.ghostscript.com/">Ghostscript</a>')
    .replace("{pdfjs}", '<a href="https://mozilla.github.io/pdf.js/">pdf.js</a>')
    .replace("{pdflib}", '<a href="https://pdf-lib.js.org/">pdf-lib</a>')}</p>`;
for (const locale of locales) {
  const t = (await import(`../src/i18n/${locale}.ts`)).default;
  const sizeLinks = `<nav class="sizes"><span>${escape(t.sizesTitle)}:</span>${SIZE_PAGES.map((slug) => `<a href="/${locale}/${sizePath(slug)}" title="${escape(fill(t.sizeLink, { size: sizeLabel(slug) }))}">${sizeLabel(slug)}</a>`).join("")}</nav>`;
  for (const suffix of families.slice(0, -1)) {
    const tool = toolPages.find((entry) => `${entry.slug}/` === suffix);
    const faq = faqFor(tool ? tool.id : "compress");
    const text = (key) => {
      if (!t[key]) throw new Error(`seo: missing string ${key} for ${locale}`);
      return t[key];
    };
    const slug = !tool && suffix !== COMPRESS && suffix.slice("compress-pdf-to-".length, -1);
    const size = slug && sizeLabel(slug);
    const [title, description] = tool
      ? [text(`${tool.nameKey}Title`), text(`${tool.nameKey}Description`)]
      : size
        ? [fill(t.sizePageTitle, { size }), fill(t.sizePageDescription, { size })]
        : metadata[locale];
    const h1 = tool ? text(`${tool.nameKey}Hero`) : size ? fill(t.sizeHero, { size }) : t.hero;
    const intro = tool ? text(`${tool.nameKey}Intro`) : size ? fill(t.sizeIntro, { size }) : t.sub;
    const url = `https://pdf.kha.do/${locale}/${suffix}`;
    const structured = [
      {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: title,
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires a modern browser with WebAssembly",
        isAccessibleForFree: true,
        inLanguage: locale,
        url,
        description,
        image: ogImage(locale, appOf(tool)),
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map(([q, a]) => ({
          "@type": "Question",
          name: text(q),
          acceptedAnswer: { "@type": "Answer", text: text(a) },
        })),
      },
    ];
    const content = `${header}<main><div class="hero"><div class="eyebrow">${escape(t.privacy)}</div><h1>${escape(h1)}</h1><p>${escape(intro)}</p></div><div id="tool">${switcher(t, locale, appOf(tool))}<section class="tool-card placeholder" aria-label="${escape(tool ? t[appOf(tool).nameKey] : t.compress)}"></section></div><section class="content"><h2>${escape(t.how)}</h2><p>${escape(tool ? text(`${tool.nameKey}HowText`) : t.howText)}</p><h2>${escape(t.why)}</h2><p>${escape(t.whyText)}</p></section><section class="faq"><h2>${escape(t.faq)}</h2>${faq.map(([q, a]) => `<h3>${escape(text(q))}</h3><p>${escape(text(a))}</p>`).join("")}</section><section class="privacy-section"><h2>${escape(t.privacyTitle)}</h2><p class="philosophy">${escape(t.philosophy)}</p><p>${escape(t.privacyBody)}</p><a class="more-link" href="/${locale}/privacy/">${escape(t.privacyMore)} →</a></section>${tool ? "" : sizeLinks}</main>`;
    const html = base(
      locale,
      title,
      description,
      url,
      alternates(suffix) +
        socialTags(locale, t, title, description, url, appOf(tool), h1) +
        `<script type="application/ld+json">${JSON.stringify(structured)}</script>`,
    ).replace('<div id="root"></div>', `<div id="root">${content}</div>`);
    writePage(locale, suffix, html);
  }
  const privacyUrl = `https://pdf.kha.do/${locale}/privacy/`;
  const privacyContent = `${header}<main class="privacy-page"><a href="/${locale}/compress/">pdf.kha.do</a><h1>${escape(t.privacyTitle)}</h1><p class="philosophy">${escape(t.philosophy)}</p><p>${escape(t.siteLoads)}</p><p>${escape(t.privacyBody)}</p>${credits(t)}<p>${escape(t.limitations)}</p><h2>${escape(t.how)}</h2><p>${escape(t.howText)}</p><p>${escape(t.support)}</p></main>`;
  const privacyHtml = base(
    locale,
    `${t.privacyTitle} | pdf.kha.do`,
    t.siteLoads,
    privacyUrl,
    alternates("privacy/"),
  )
    .replace('<div id="root"></div>', `<div id="root">${privacyContent}</div>`);
  writePage(locale, "privacy/", privacyHtml);
  // The locale home forwards to compress. Static hosting has no 301, so a
  // zero-second refresh plus canonical, which search engines treat as a
  // permanent redirect (no noindex: it would contradict the canonical);
  // redirect.js does it sooner and keeps ?shared=1.
  writePage(
    locale,
    "",
    `<!doctype html><html lang="${locale}"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=/${locale}/${COMPRESS}"><link rel="canonical" href="https://pdf.kha.do/${locale}/${COMPRESS}"><title>${escape(metadata[locale][0])}</title><script src="/redirect.js"></script></head><body><a href="/${locale}/${COMPRESS}">${escape(t.compress)}</a></body></html>`,
  );
}
fs.writeFileSync(
  "dist/index.html",
  '<!doctype html><html><head><meta charset="UTF-8"><meta name="robots" content="noindex"><script src="/redirect.js"></script><noscript><meta http-equiv="refresh" content="0;url=/en/compress/"></noscript></head><body><a href="/en/compress/">English</a></body></html>',
);
fs.copyFileSync("LICENSE", "dist/LICENSE");
const lastmod = new Date().toISOString().slice(0, 10);
fs.writeFileSync(
  "dist/sitemap.xml",
  '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' +
    families
      .flatMap((suffix) =>
        locales.map(
          (locale) =>
            `<url><loc>https://pdf.kha.do/${locale}/${suffix}</loc><lastmod>${lastmod}</lastmod>` +
            locales
              .map(
                (other) =>
                  `<xhtml:link rel="alternate" hreflang="${other}" href="https://pdf.kha.do/${other}/${suffix}"/>`,
              )
              .join("") +
            `<xhtml:link rel="alternate" hreflang="x-default" href="https://pdf.kha.do/en/${suffix}"/></url>`,
        ),
      )
      .join("") +
    "</urlset>",
);
