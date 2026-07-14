import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";

import { STUDIO_PRODUCTS } from "@/content/products";
import {
  detectLandingLang,
  LANDING_LANG_KEY,
  landingCopy,
  statusLabel,
  type LandingLang,
} from "@/i18n/landing";

export function DemoHubPage() {
  const [lang, setLang] = useState<LandingLang>(() => detectLandingLang());
  const t = useMemo(() => landingCopy(lang), [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(LANDING_LANG_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const copyCreds = async (user: string, password: string) => {
    try {
      await navigator.clipboard.writeText(`${user} / ${password}`);
      toast.success(t.copied);
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  return (
    <div className="studio-root studio-demos-page">
      <div className="studio-atmosphere" aria-hidden />
      <div className="studio-grid" aria-hidden />

      <header className="studio-header">
        <div className="studio-header-inner">
          <Link to="/" className="studio-brand">
            <span className="studio-brand-mark">M</span>
            <span className="studio-brand-text">
              {t.brand}
              <em>{t.brandSub}</em>
            </span>
          </Link>
          <div className="studio-header-actions">
            <div className="studio-lang" role="group" aria-label="Language">
              <button type="button" className={lang === "ru" ? "active" : ""} onClick={() => setLang("ru")}>
                RU
              </button>
              <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>
                EN
              </button>
            </div>
            <Link to="/" className="studio-btn studio-btn-ghost">
              {t.backHome}
            </Link>
          </div>
        </div>
      </header>

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
                    onClick={() => copyCreds(p.demoLogin!.user, p.demoLogin!.password)}
                  >
                    {t.copyLogin}
                  </button>
                  {p.demoLogin.note && <small>{p.demoLogin.note[lang]}</small>}
                </div>
              )}

              {p.demoUrl && (p.status === "live" || p.status === "starting") ? (
                <a
                  href={p.demoUrl}
                  className="studio-btn studio-btn-primary studio-btn-block"
                  target={p.demoUrl.startsWith("http") ? "_blank" : undefined}
                  rel={p.demoUrl.startsWith("http") ? "noreferrer" : undefined}
                >
                  {t.openDemo}
                </a>
              ) : (
                <p className="studio-muted">{t.noPublicDemo}</p>
              )}
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
