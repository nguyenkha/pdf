// Renders the 1200x630 share images in public/og/, one per tool and locale:
// og/<locale>.png for compress (its address is already cached by social
// sites) and og/<tool>-<locale>.png for the others. Run after changing a
// hero: node scripts/make-og.mjs (needs Playwright's Chromium locally).
import fs from "node:fs";
import { chromium } from "@playwright/test";

const locales = ["en", "zh-CN", "es", "ar", "fr", "pt", "ru", "hi", "ja", "ko", "de", "vi"];
const icon = fs.readFileSync("public/icons/icon.svg", "utf8");
const escape = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
fs.mkdirSync("public/og", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const tools = [
  { file: "", hero: "hero", name: "compress" },
  { file: "merge-", hero: "toolMergeHero", name: "toolMerge" },
  { file: "markdown-", hero: "toolMarkdownHero", name: "toolMarkdown" },
  { file: "organize-", hero: "toolOrganizeHero", name: "toolOrganize" },
];
for (const locale of locales) for (const tool of tools) {
  const t = (await import(`../src/i18n/${locale}.ts`)).default;
  await page.setContent(`<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><style>
    body{margin:0;width:1200px;height:630px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI","Noto Sans","Hiragino Sans","PingFang SC",sans-serif;background:radial-gradient(circle at 1130px 640px,#ffead8 0 300px,transparent 301px),#fcfaf7;color:#14201a;display:flex;flex-direction:column;justify-content:space-between;padding:72px 80px;box-sizing:border-box;position:relative;overflow:hidden}
    .brand{display:flex;align-items:center;gap:20px;font-size:34px;font-weight:760;letter-spacing:-.03em;position:relative}
    .brand svg{width:72px;height:72px}
    h1{font-size:${["ja", "ko", "zh-CN", "hi"].includes(locale) ? 66 : 74}px;line-height:1.08;letter-spacing:-.045em;margin:0;max-width:940px;position:relative}
    .chips{display:flex;gap:14px;flex-wrap:wrap;position:relative}
    .chips span{background:#fff;border:2px solid #efd8c8;color:#a33c15;border-radius:100px;padding:12px 24px;font-size:26px;font-weight:650}
  </style><body>
    <div class="brand">${icon}pdf.kha.do</div>
    <h1>${escape(t[tool.hero])}</h1>
    <div class="chips"><span>${escape(t[tool.name])}</span><span>${escape(t.privacy)}</span></div>
  </body></html>`);
  await page.screenshot({ path: `public/og/${tool.file}${locale}.png` });
}
await browser.close();
