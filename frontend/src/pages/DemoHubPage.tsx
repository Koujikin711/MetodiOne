import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";

import { StudioChrome } from "@/components/StudioChrome";
import { STUDIO_PRODUCTS, type StudioProduct } from "@/content/products";
import {
  detectLandingLang,
  LANDING_LANG_KEY,
  landingCopy,
  statusLabel,
  type LandingLang,
} from "@/i18n/landing";
import { trackStudioEvent } from "@/lib/studioAnalytics";
import { useStudioReveal } from "@/lib/useStudioReveal";

function actionLabel(lang: LandingLang, p: StudioProduct, t: ReturnType<typeof landingCopy>) {
  if (p.status === "showcase") return t.openShowcase;
  if (p.instantDemo) return t.openDemoInstant;
  if (p.demoUrl) return t.openDemo;
  return t.requestPrivate;
}

/** Live sandboxes and enter bridges open in a new tab; in-app showcases stay same-tab. */
function opensInNewTab(demoUrl: string, status: StudioProduct["status"]) {
  if (status === "showcase") return false;
  return demoUrl.startsWith("http") || demoUrl.startsWith("/enter/") || demoUrl === "/demo";
}

function DemoRow({
  p,
  lang,
  t,
  featured,
  index,
  onCopy,
}: {
  p: StudioProduct;
  lang: LandingLang;
  t: ReturnType<typeof landingCopy>;
  featured?: boolean;
  index: number;
  onCopy: (user: string, password: string, productId: string) => void;
}) {
  const canOpen = Boolean(p.demoUrl && (p.status === "live" || p.status === "starting" || p.status === "showcase"));
  const showBlurb = Boolean(featured || p.status === "showcase");
  const detail = showBlurb ? p.blurb[lang] : p.tagline[lang];

  return (
    <article
      className={`studio-demo-row studio-demo-row-${p.status}${featured ? " is-featured" : ""}`}
      style={{ "--reveal-i": index } as CSSProperties}
    >
      <div className="studio-demo-row-main">
        <div className="studio-demo-row-head">
          <h2>{p.name}</h2>
          <span className={`studio-pill studio-pill-${p.status}`}>{statusLabel(lang, p.status)}</span>
        </div>
        {featured ? (
          <>
            <p className="studio-demo-row-tag">{p.tagline[lang]}</p>
            <p className="studio-demo-row-blurb">{p.blurb[lang]}</p>
          </>
        ) : (
          <p className="studio-demo-row-tag">{detail}</p>
        )}
        {!p.instantDemo && p.demoLogin ? (
          <div className="studio-creds studio-creds-inline">
            <code>
              {p.demoLogin.user} / {p.demoLogin.password}
            </code>
            <button
              type="button"
              className="studio-btn studio-btn-ghost"
              onClick={() => onCopy(p.demoLogin!.user, p.demoLogin!.password, p.id)}
            >
              {t.copyLogin}
            </button>
            {p.demoLogin.note ? <small>{p.demoLogin.note[lang]}</small> : null}
          </div>
        ) : null}
      </div>
      <div className="studio-demo-row-action">
        {canOpen ? (
          <a
            href={p.demoUrl}
            className={`studio-btn ${featured ? "studio-btn-primary" : "studio-btn-secondary"}`}
            target={opensInNewTab(p.demoUrl!, p.status) ? "_blank" : undefined}
            rel={opensInNewTab(p.demoUrl!, p.status) ? "noopener noreferrer" : undefined}
            onClick={() => trackStudioEvent("demo_open", { id: p.id, status: p.status })}
          >
            {actionLabel(lang, p, t)}
          </a>
        ) : (
          <span className="studio-muted">{t.noPublicDemo}</span>
        )}
      </div>
    </article>
  );
}

export function DemoHubPage() {
  const [lang, setLang] = useState<LandingLang>(() => detectLandingLang());
  const t = useMemo(() => landingCopy(lang), [lang]);

  const live = useMemo(
    () => STUDIO_PRODUCTS.filter((p) => p.status === "live" || p.status === "starting"),
    [],
  );
  const featuredLive = live.slice(0, 3);
  const moreLive = live.slice(3);
  const showcases = useMemo(() => STUDIO_PRODUCTS.filter((p) => p.status === "showcase"), []);
  const other = useMemo(
    () => STUDIO_PRODUCTS.filter((p) => p.status !== "live" && p.status !== "starting" && p.status !== "showcase"),
    [],
  );

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${t.demosPageTitle} | MetodiOne Studio`;
    try {
      localStorage.setItem(LANDING_LANG_KEY, lang);
    } catch {
      /* ignore */
    }
    trackStudioEvent("demos_view", { lang });
  }, [lang, t.demosPageTitle]);

  useStudioReveal([lang]);

  const copyCreds = async (user: string, password: string, productId: string) => {
    try {
      await navigator.clipboard.writeText(`${user} / ${password}`);
      trackStudioEvent("demo_copy_login", { productId });
      toast.success(t.copied);
    } catch {
      toast.error(lang === "ru" ? "Буфер обмена недоступен" : "Clipboard unavailable");
    }
  };

  return (
    <div className={`studio-root studio-demos-page studio-lang-${lang}`}>
      <div className="studio-atmosphere" aria-hidden />
      <div className="studio-grid" aria-hidden />
      <div className="studio-sheen" aria-hidden />

      <StudioChrome lang={lang} setLang={setLang} t={t} active="demos" />

      <main className="studio-demos-main">
        <header className="studio-demos-hero" data-reveal>
          {t.demosVersionLabel ? <p className="studio-demos-kicker">{t.demosVersionLabel}</p> : null}
          <h1 className="studio-demos-title">{t.demosPageTitle}</h1>
          <p className="studio-demos-lead">{t.demosPageLead}</p>
          <p className="studio-demos-note studio-demos-warn" role="note">
            <span aria-hidden="true">!</span>
            {t.demoDisclaimer}
          </p>
        </header>

        <section className="studio-demo-section studio-demo-section-live" aria-labelledby="demos-live">
          <div className="studio-demo-section-head" data-reveal>
            <h2 id="demos-live">{t.demosLiveTitle}</h2>
            <p>{t.demosLiveLead}</p>
          </div>
          <div className="studio-demo-list studio-demo-list-featured" data-reveal>
            {featuredLive.map((p, i) => (
              <DemoRow key={p.id} p={p} lang={lang} t={t} featured index={i} onCopy={copyCreds} />
            ))}
          </div>
          {moreLive.length > 0 ? (
            <div className="studio-demo-list studio-demo-list-compact" data-reveal>
              <p className="studio-demo-more-label">{t.demosMoreLive}</p>
              {moreLive.map((p, i) => (
                <DemoRow key={p.id} p={p} lang={lang} t={t} index={i} onCopy={copyCreds} />
              ))}
            </div>
          ) : null}
        </section>

        {showcases.length > 0 ? (
          <section className="studio-demo-section studio-demo-section-soft" aria-labelledby="demos-showcase">
            <div className="studio-demo-section-head" data-reveal>
              <h2 id="demos-showcase">{t.demosShowcaseTitle}</h2>
              <p>{t.demosShowcaseLead}</p>
            </div>
            <div className="studio-demo-list studio-demo-list-compact" data-reveal>
              {showcases.map((p, i) => (
                <DemoRow key={p.id} p={p} lang={lang} t={t} index={i} onCopy={copyCreds} />
              ))}
            </div>
          </section>
        ) : null}

        {other.length > 0 ? (
          <section className="studio-demo-section studio-demo-section-soft" aria-labelledby="demos-other">
            <div className="studio-demo-section-head" data-reveal>
              <h2 id="demos-other">{t.demosOtherTitle}</h2>
            </div>
            <div className="studio-demo-list studio-demo-list-compact" data-reveal>
              {other.map((p, i) => (
                <DemoRow key={p.id} p={p} lang={lang} t={t} index={i} onCopy={copyCreds} />
              ))}
            </div>
          </section>
        ) : null}

        <footer className="studio-demos-footer" data-reveal>
          <Link to="/" className="studio-link">
            {t.backStudio}
          </Link>
          <Link to="/investors" className="studio-link">
            {t.navInvestors}
          </Link>
        </footer>
      </main>
    </div>
  );
}
