import React, { useEffect, useState, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Globe,
  ShieldCheck,
  Sun,
  Moon,
  Monitor,
  Heart,
  Github,
} from "lucide-react";
import { initialLocale, locales, names, type Locale } from "./i18n/config";
import { messages, type Messages } from "./i18n";
import en from "./i18n/en";
import { metadata } from "./i18n/metadata";
import { tools } from "./app/tools";
import { config } from "./app/config";
import { SIZE_PAGES, sizeFromPath, sizeFromSlug, sizePath } from "./app/sizes";
import { fill } from "./i18n/fill";
import "./styles/main.css";
const CompressTool = React.lazy(tools[0].load);
// The engines this site is built on, linked inside the translated sentence.
function Credits({ text }: { text: string }) {
  const links: Record<string, [string, string]> = {
    gs: ["Ghostscript", "https://www.ghostscript.com/"],
    pdfjs: ["pdf.js", "https://mozilla.github.io/pdf.js/"],
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
// Keeps /privacy/ or a size page when the locale changes.
const suffix = location.pathname.endsWith("/privacy/")
  ? "privacy/"
  : preset
    ? sizePath(preset.slug)
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
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("theme") || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    let active = true;
    messages(locale)
      .catch(() => en)
      .then((m) => {
        if (!active) return;
        setT(m);
        const [title, description] = preset
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
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  function selectLocale(l: Locale) {
    try { localStorage.setItem("locale", l); } catch { /* Storage is optional. */ }
    setLocale(l);
  }
  function selectTheme(v: string) {
    try { localStorage.setItem("theme", v); } catch { /* Storage is optional. */ }
    setTheme(v);
  }
  const privacyPage = location.pathname.endsWith("/privacy/");
  return (
    <>
      <header className="site-header">
        <a className="brand" href={`/${locale}/`}>
          <img className="brand-logo light-only" src="/icons/icon.svg" alt="" />
          <img className="brand-logo dark-only" src="/icons/icon-dark.svg" alt="" />
          pdf.kha.do
        </a>
        <nav aria-label={t.tools}>
          <a href={privacyPage ? `/${locale}/#tool` : "#tool"}>{t.tools}</a>
          <a href={privacyPage ? `/${locale}/#about` : "#about"}>{t.about}</a>
          {config.githubUrl && (
            <a href={config.githubUrl} target="_blank" rel="noreferrer">
              {t.github}
              <ArrowUpRight size={13} />
            </a>
          )}
        </nav>
        <div className="header-actions">
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
            aria-label={
              theme === "system"
                ? t.systemTheme
                : theme === "dark"
                  ? t.darkTheme
                  : t.lightTheme
            }
            title={
              theme === "system"
                ? t.systemTheme
                : theme === "dark"
                  ? t.darkTheme
                  : t.lightTheme
            }
            onClick={() =>
              selectTheme(
                theme === "system"
                  ? "light"
                  : theme === "light"
                    ? "dark"
                    : "system",
              )
            }
          >
            {theme === "system" ? (
              <Monitor size={17} />
            ) : theme === "light" ? (
              <Sun size={17} />
            ) : (
              <Moon size={17} />
            )}
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
            <h1>{preset ? fill(t.sizeHero, { size: preset.label }) : t.hero}</h1>
            <p>{preset ? fill(t.sizeIntro, { size: preset.label }) : t.sub}</p>
            <p className="support">{t.support}</p>
          </div>
          <div id="tool">
            <Suspense fallback={<div className="tool-card">{t.loading}</div>}>
              <CompressTool t={t} locale={locale} preset={preset} />
            </Suspense>
          </div>
          <div className="content" id="about">
            <div className="info-card how">
              <span>01</span>
              <h2>{t.how}</h2>
              <p>{t.howText}</p>
            </div>
            <div className="info-card why">
              <span>02</span>
              <h2>{t.why}</h2>
              <p>{t.whyText}</p>
            </div>
          </div>
          <section className="faq">
            <h2>{t.faq}</h2>
            {(
              [
                [t.q1, t.a1],
                [t.q2, t.a2],
                [t.q3, t.a3],
                [t.q4, t.a4],
                [t.q5, t.a5],
                [t.q6, t.a6],
              ] as const
            ).map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </section>
          <section className="privacy-section" id="privacy">
            <h2>{t.privacyTitle}</h2>
            <p className="philosophy">{t.philosophy}</p>
            <p>{t.siteLoads}</p>
            <p>{t.privacyBody}</p>
            <Credits text={t.credits} />
            <p>{t.limitations}</p>
          </section>
          {/* Plain links for the size pages: useful to crawlers, quiet for people. */}
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
        </main>
      )}
      <footer>
        <span className="copyright">© {new Date().getFullYear()} Kha Do</span>
        <span className="hosted">
          Hosted on GitHub Pages with
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
messages(firstLocale)
  .catch(() => en)
  .then((firstMessages) =>
    createRoot(document.getElementById("root")!).render(
      <App firstLocale={firstLocale} firstMessages={firstMessages} />,
    ),
  );
if ("serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(() => {}),
  );
