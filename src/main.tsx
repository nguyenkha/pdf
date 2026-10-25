import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import {
  Globe,
  ShieldCheck,
  Sun,
  Moon,
  Heart,
  Github,
} from "lucide-react";
import { initialLocale, locales, names, type Locale } from "./i18n/config";
import { messages, type Messages } from "./i18n";
import en from "./i18n/en";
import { metadata } from "./i18n/metadata";
// Loaded eagerly (~9 KB gzip): a lazy fallback swapped for the full card
// shifted the page below it (Lighthouse CLS 0.22).
import CompressTool from "./tools/compress/CompressTool";
import { pageFromPath, relatedPages, toolFromPath, type ToolProps } from "./app/tools";
import { faqFor } from "./app/faq";
import { ToolSwitcher } from "./components/ToolSwitcher";
import { ToolsMenu } from "./components/ToolsMenu";
import { config } from "./app/config";
import { SIZE_PAGES, sizeFromPath, sizeFromSlug, sizePath } from "./app/sizes";
import { fill } from "./i18n/fill";
import "./styles/main.css";
/** Whether a media query matches, kept current as the system changes. */
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
// The engines this site is built on, linked inside the translated sentence.
function Credits({ text }: { text: string }) {
  const links: Record<string, [string, string]> = {
    gs: ["Ghostscript", "https://www.ghostscript.com/"],
    pdfjs: ["pdf.js", "https://mozilla.github.io/pdf.js/"],
    pdflib: ["pdf-lib", "https://pdf-lib.js.org/"],
  };
  return (
    <p className="credits">
      {text.split(/(\{\w+\})/).map((part, index) => {
        const link = links[part.slice(1, -1)];
        return link ? (
          <a key={index} href={link[1]} target="_blank" rel="noreferrer">
            {link[0]}
          </a>
        ) : (
          part
        );
      })}
    </p>
  );
}
const preset = sizeFromPath(location.pathname);
const activeTool = toolFromPath(location.pathname);
// A landing page ("rotate PDF") has its own texts but runs its tool.
const activePage = pageFromPath(location.pathname);
const home = activeTool.id === "compress";
// Tool pages beyond compress read <nameKey>Title, Description, Hero, Intro
// and HowText (the same strings scripts/seo.mjs prerenders).
const toolText = (m: Messages, part: "Title" | "Description" | "Hero" | "Intro" | "HowText") =>
  m[`${activePage.nameKey}${part}` as keyof Messages];
// Compress is the home tool and renders eagerly; others load on their page,
// alongside the messages, so the first render already has them: a lazy
// component that suspends is held back by React's ~300 ms fallback throttle.
// If the chunk fails here, the lazy component retries it when rendered.
let ToolComponent: ComponentType<ToolProps> = CompressTool;
const toolReady =
  activeTool.id === "compress"
    ? Promise.resolve()
    : activeTool.load!().then(
        (module) => {
          ToolComponent = module.default;
        },
        () => {
          ToolComponent = lazy(activeTool.load!);
        },
      );
// Read before the URL is normalised below; the tool loads lazily.
const shared = new URLSearchParams(location.search).has("shared");
// Keeps /privacy/ or a size page when the locale changes.
const suffix = location.pathname.endsWith("/privacy/")
  ? "privacy/"
  : preset
    ? sizePath(preset.slug)
    : activePage.slug
      ? `${activePage.slug}/`
      : "";
function App({
  firstLocale,
  firstMessages,
}: {
  firstLocale: Locale;
  firstMessages: Messages;
}) {
  const [locale, setLocale] = useState<Locale>(firstLocale);
  const [t, setT] = useState<Messages>(firstMessages);
  // Two themes. Until the person picks one, the page follows the system
  // (no data-theme, so CSS keeps tracking it) and nothing is stored.
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  const [chosen, setChosen] = useState<"light" | "dark" | undefined>(() => {
    try {
      const stored = localStorage.getItem("theme");
      return stored === "light" || stored === "dark" ? stored : undefined;
    } catch {
      return undefined;
    }
  });
  const theme = chosen ?? (dark ? "dark" : "light");
  useEffect(() => {
    if (chosen) document.documentElement.dataset.theme = chosen;
    else delete document.documentElement.dataset.theme;
  }, [chosen]);
  useEffect(() => {
    let active = true;
    messages(locale)
      .catch(() => en)
      .then((m) => {
        if (!active) return;
        setT(m);
        const [title, description] = !home
          ? [toolText(m, "Title"), toolText(m, "Description")]
          : preset
            ? [
                fill(m.sizePageTitle, { size: preset.label }),
                fill(m.sizePageDescription, { size: preset.label }),
              ]
            : metadata[locale];
        const url = `${config.domain}/${locale}/${suffix}`;
        document.title = title;
        const set = (selector: string, attribute: string, value: string) =>
          document.querySelector(selector)?.setAttribute(attribute, value);
        set('meta[name="description"]', "content", description);
        set('link[rel="canonical"]', "href", url);
        set('meta[property="og:title"]', "content", title);
        set('meta[property="og:description"]', "content", description);
        set('meta[property="og:url"]', "content", url);
      });
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    history.replaceState(null, "", `/${locale}/${suffix}`);
    return () => {
      active = false;
    };
  }, [locale]);
  function selectLocale(l: Locale) {
    try { localStorage.setItem("locale", l); } catch { /* Storage is optional. */ }
    setLocale(l);
  }
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", next); } catch { /* Storage is optional. */ }
    setChosen(next);
  }
  const privacyPage = location.pathname.endsWith("/privacy/");
  return (
    <>
      <header className="site-header">
        <a className="brand" href={`/${locale}/compress/`}>
          <img className="brand-logo light-only" src="/icons/icon.svg" alt="" />
          <img className="brand-logo dark-only" src="/icons/icon-dark.svg" alt="" />
          PDF Tools
        </a>
        <div className="header-actions">
          {/* Tool pages have the switcher; a second menu there would repeat it. */}
          {privacyPage && <ToolsMenu t={t} locale={locale} />}
          <label className="language">
            <Globe size={16} />
            <select
              aria-label={t.language}
              value={locale}
              onChange={(e) => selectLocale(e.target.value as Locale)}
            >
              {locales.map((l, i) => (
                <option key={l} value={l}>
                  {names[i]}
                </option>
              ))}
            </select>
          </label>
          <button
            className="theme-toggle"
            aria-label={t.darkTheme}
            aria-pressed={theme === "dark"}
            title={theme === "dark" ? t.darkTheme : t.lightTheme}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </header>
      {privacyPage ? (
        <main className="privacy-page">
          <h1>{t.privacyTitle}</h1>
          <p className="philosophy">{t.philosophy}</p>
          <p>{t.siteLoads}</p>
          <p>{t.privacyBody}</p>
          <Credits text={t.credits} />
          <p>{t.limitations}</p>
          <p>{t.shareLimit}</p>
          <h2>{t.how}</h2>
          <p>{t.howText}</p>
          <p>{t.support}</p>
        </main>
      ) : (
        <main>
          <div className="hero">
            <div className="eyebrow">
              <ShieldCheck size={15} />
              {t.privacy}
            </div>
            <h1>
              {!home ? toolText(t, "Hero") : preset ? fill(t.sizeHero, { size: preset.label }) : t.hero}
            </h1>
            <p>
              {!home ? toolText(t, "Intro") : preset ? fill(t.sizeIntro, { size: preset.label }) : t.sub}
            </p>
          </div>
          <div id="tool">
            <ToolSwitcher t={t} locale={locale} active={activeTool} />
            <Suspense fallback={<section className="tool-card placeholder" />}>
              <ToolComponent
                t={t}
                locale={locale}
                preset={preset}
                shared={shared}
                page={activePage === activeTool ? undefined : activePage.id}
              />
            </Suspense>
          </div>
          <div className="content" id="about">
            <div className="info-card how">
              <h2>{t.how}</h2>
              <p>{home ? t.howText : toolText(t, "HowText")}</p>
            </div>
            <div className="info-card why">
              <h2>{t.why}</h2>
              <p>{t.whyText}</p>
            </div>
          </div>
          {/* This tool's questions, then the ones every tool shares. */}
          <section className="faq">
            <h2>{t.faq}</h2>
            {faqFor(activePage.id).map(([question, answer]) => (
              <details key={question}>
                <summary>{t[question as keyof Messages]}</summary>
                <p>{t[answer as keyof Messages]}</p>
              </details>
            ))}
          </section>
          {/* The short version on every tool page; details on /privacy/. */}
          <section className="privacy-section" id="privacy">
            <h2>{t.privacyTitle}</h2>
            <p className="philosophy">{t.philosophy}</p>
            <p>{t.privacyBody}</p>
            <a className="more-link" href={`/${locale}/privacy/`}>
              {t.privacyMore} →
            </a>
          </section>
          {/* The same tool under other names ("PNG to PDF"), and its reverse. */}
          {!home && relatedPages(activeTool).length > 0 && (
            <nav className="sizes related" aria-label={t.relatedPages}>
              <span>{t.relatedPages}:</span>
              {relatedPages(activeTool).map((page) => (
                <a
                  key={page.slug}
                  href={`/${locale}/${page.slug}/`}
                  aria-current={page.slug === activePage.slug ? "page" : undefined}
                >
                  {t[`${page.nameKey}Short` as keyof Messages]}
                </a>
              ))}
            </nav>
          )}
          {/* Plain links for the size pages: useful to crawlers, quiet for people. */}
          {home && (
        <nav className="sizes" aria-label={t.sizesTitle}>
            <span>{t.sizesTitle}:</span>
            {SIZE_PAGES.map((slug) => {
              const size = sizeFromSlug(slug)!;
              return (
                <a
                  key={slug}
                  href={`/${locale}/${sizePath(slug)}`}
                  title={fill(t.sizeLink, { size: size.label })}
                  aria-current={preset?.slug === slug ? "page" : undefined}
                >
                  {size.label}
                </a>
              );
            })}
          </nav>
        )}
        </main>
      )}
      <footer>
        <span className="copyright">© {new Date().getFullYear()} Kha Do</span>
        <span className="hosted">
          Hosted on Cloudflare with
          <Heart size={12} fill="currentColor" aria-label="love" />
        </span>
        <nav aria-label={t.about}>
          <a href={`/${locale}/privacy/`}>{t.privacyTitle}</a>
          <a href="/LICENSE">{t.license}</a>
          <a href={`mailto:${config.contact}`} title={config.contact}>
            {t.contact}
          </a>
          {config.githubUrl && (
            <a href={config.githubUrl} aria-label={t.open} title={t.open}>
              <Github size={16} aria-hidden="true" />
            </a>
          )}
        </nav>
      </footer>
    </>
  );
}
const firstLocale = initialLocale();
// The locale home forwards to compress (the static page does too, without
// keeping the query); never render the app there.
const atHome = /^\/[^/]+\/$/.test(location.pathname);
if (atHome) location.replace(`/${firstLocale}/compress/${location.search}${location.hash}`);
if (!atHome)
  Promise.all([messages(firstLocale).catch(() => en), toolReady])
  .then(([firstMessages]) =>
    createRoot(document.getElementById("root")!).render(
      <App firstLocale={firstLocale} firstMessages={firstMessages} />,
    ),
  );
if ("serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(() => {}),
  );
