import { useEffect, useMemo, useState } from "react";
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

function actionLabel(lang: LandingLang, p: StudioProduct, t: ReturnType<typeof landingCopy>) {
  if (p.status === "showcase") return t.openShowcase;
  if (p.instantDemo) return t.openDemoInstant;
  if (p.demoUrl) return t.openDemo;
  return t.requestPrivate;
}

function DemoRow({
  p,
  lang,
  t,
  onCopy,
}: {
  p: StudioProduct;
  lang: LandingLang;
  t: ReturnType<typeof landingCopy>;
  onCopy: (user: string, password: string, productId: string) => void;
}) {
  const canOpen = Boolean(p.demoUrl && (p.status === "live" || p.status === "starting" || p.status === "showcase"));

  return (
    <article className={`studio-demo-row studio-demo-row-${p.status}`}>
      <div className="studio-demo-row-main">
        <div className="studio-demo-row-head">
          <h2>{p.name}</h2>
          <span className={`studio-pill studio-pill-${p.status}`}>{statusLabel(lang, p.status)}</span>
        </div>
        <p className="studio-demo-row-tag">{p.tagline[lang]}</p>
        <p className="studio-demo-row-blurb">{p.blurb[lang]}</p>
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
            className="studio-btn studio-btn-primary"
            target={p.demoUrl!.startsWith("http") ? "_blank" : undefined}
            rel={p.demoUrl!.startsWith("http") ? "noreferrer" : undefined}
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

  const copyCreds = async (user: string, password: string, productId: string) => {
    try {
      await navigator.clipboard.writeText(`${user} / ${password}`);
      trackStudioEvent("demo_copy_login", { productId });
      toast.success(t.copied);
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  return (
    <div className={`studio-root studio-demos-page studio-lang-${lang}`}>
      <div className="studio-atmosphere" aria-hidden />
      <div className="studio-grid" aria-hidden />
      <div className="studio-sheen" aria-hidden />

      <StudioChrome lang={lang} setLang={setLang} t={t} active="demos" />

      <main className="studio-demos-main">
        <header className="studio-demos-hero">
          <p className="studio-demos-kicker">{t.brand}</p>
          <h1 className="studio-demos-title">{t.demosPageTitle}</h1>
          <p className="studio-demos-lead">{t.demosPageLead}</p>
          <p className="studio-demos-note">{t.demoDisclaimer}</p>
        </header>

        <section className="studio-demo-section" aria-labelledby="demos-live">
          <div className="studio-demo-section-head">
            <h2 id="demos-live">{t.demosLiveTitle}</h2>
            <p>{t.demosLiveLead}</p>
          </div>
          <div className="studio-demo-list">
            {live.map((p) => (
              <DemoRow key={p.id} p={p} lang={lang} t={t} onCopy={copyCreds} />
            ))}
          </div>
        </section>

        {showcases.length > 0 ? (
          <section className="studio-demo-section" aria-labelledby="demos-showcase">
            <div className="studio-demo-section-head">
              <h2 id="demos-showcase">{t.demosShowcaseTitle}</h2>
              <p>{t.demosShowcaseLead}</p>
            </div>
            <div className="studio-demo-list">
              {showcases.map((p) => (
                <DemoRow key={p.id} p={p} lang={lang} t={t} onCopy={copyCreds} />
              ))}
            </div>
          </section>
        ) : null}

        {other.length > 0 ? (
          <section className="studio-demo-section" aria-labelledby="demos-other">
            <div className="studio-demo-section-head">
              <h2 id="demos-other">{t.demosOtherTitle}</h2>
            </div>
            <div className="studio-demo-list">
              {other.map((p) => (
                <DemoRow key={p.id} p={p} lang={lang} t={t} onCopy={copyCreds} />
              ))}
            </div>
          </section>
        ) : null}

        <footer className="studio-demos-footer">
          <Link to="/investors" className="studio-link">
            {t.ctaInvestors} →
          </Link>
          <Link to="/#contact" className="studio-link">
            {t.ctaContact} →
          </Link>
        </footer>
      </main>
    </div>
  );
}
