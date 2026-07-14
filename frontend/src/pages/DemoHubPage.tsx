import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";

import { StudioChrome } from "@/components/StudioChrome";
import { STUDIO_PRODUCTS } from "@/content/products";
import {
  detectLandingLang,
  LANDING_LANG_KEY,
  landingCopy,
  statusLabel,
  type LandingLang,
} from "@/i18n/landing";
import { trackStudioEvent } from "@/lib/studioAnalytics";

export function DemoHubPage() {
  const [lang, setLang] = useState<LandingLang>(() => detectLandingLang());
  const t = useMemo(() => landingCopy(lang), [lang]);

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
    <div className="studio-root studio-demos-page">
      <div className="studio-atmosphere" aria-hidden />
      <div className="studio-grid" aria-hidden />
      <div className="studio-sheen" aria-hidden />

      <StudioChrome lang={lang} setLang={setLang} t={t} active="demos" />

      <main className="studio-demos-main">
        <div className="studio-section-head">
          <h1 className="studio-demos-title">{t.demosPageTitle}</h1>
          <p>{t.demosPageLead}</p>
          <p className="studio-disclaimer">{t.demoDisclaimer}</p>
        </div>

        <div className="studio-demo-grid">
          {STUDIO_PRODUCTS.map((p) => (
            <article key={p.id} className="studio-demo-card">
              <div className="studio-product-top">
                <h2>{p.name}</h2>
                <span className={`studio-pill studio-pill-${p.status}`}>{statusLabel(lang, p.status)}</span>
              </div>
              <p className="studio-product-tag">{p.tagline[lang]}</p>
              <p className="studio-product-blurb">{p.blurb[lang]}</p>
              <div className="studio-tags">
                {p.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>

              {p.demoLogin && (
                <div className="studio-creds">
                  <code>
                    {p.demoLogin.user} / {p.demoLogin.password}
                  </code>
                  <button
                    type="button"
                    className="studio-btn studio-btn-ghost"
                    onClick={() => copyCreds(p.demoLogin!.user, p.demoLogin!.password, p.id)}
                  >
                    {t.copyLogin}
                  </button>
                  {p.demoLogin.note && <small>{p.demoLogin.note[lang]}</small>}
                </div>
              )}

              {p.demoUrl && (p.status === "live" || p.status === "starting" || p.status === "showcase") ? (
                <a
                  href={p.demoUrl}
                  className="studio-btn studio-btn-primary studio-btn-block"
                  target={p.demoUrl.startsWith("http") ? "_blank" : undefined}
                  rel={p.demoUrl.startsWith("http") ? "noreferrer" : undefined}
                  onClick={() => trackStudioEvent("demo_open", { id: p.id, status: p.status })}
                >
                  {p.status === "showcase" ? t.openShowcase : t.openDemo}
                </a>
              ) : (
                <p className="studio-muted">{t.noPublicDemo}</p>
              )}
            </article>
          ))}
        </div>

        <p style={{ marginTop: "2rem" }}>
          <Link to="/investors" className="studio-link">
            {t.ctaInvestors} →
          </Link>
        </p>
      </main>
    </div>
  );
}
