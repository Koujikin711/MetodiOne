import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { StudioChrome } from "@/components/StudioChrome";
import { STUDIO_PRODUCTS } from "@/content/products";
import {
  detectLandingLang,
  LANDING_LANG_KEY,
  landingCopy,
  type LandingLang,
} from "@/i18n/landing";
import { trackStudioEvent } from "@/lib/studioAnalytics";

export function InvestorsPage() {
  const [lang, setLang] = useState<LandingLang>(() => detectLandingLang());
  const t = useMemo(() => landingCopy(lang), [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${t.investorsTitle} | MetodiOne Studio`;
    try {
      localStorage.setItem(LANDING_LANG_KEY, lang);
    } catch {
      /* ignore */
    }
    trackStudioEvent("investors_view", { lang });
  }, [lang, t.investorsTitle]);

  return (
    <div className={`studio-root studio-lang-${lang}`}>
      <div className="studio-atmosphere" aria-hidden />
      <div className="studio-grid" aria-hidden />
      <div className="studio-sheen" aria-hidden />

      <StudioChrome lang={lang} setLang={setLang} t={t} active="investors" />

      <main className="studio-demos-main studio-investors">
        <div className="studio-section-head studio-section-head-row">
          <div>
            <h1 className="studio-demos-title">{t.investorsTitle}</h1>
            <p>{t.investorsLead}</p>
          </div>
          <button type="button" className="studio-btn studio-btn-secondary studio-print-btn" onClick={() => window.print()}>
            {t.printPdf}
          </button>
        </div>

        <section className="studio-section-block" data-reveal>
          <h2>{t.investorsWhatTitle}</h2>
          <p className="studio-prose">{t.investorsWhat}</p>
        </section>

        <section className="studio-section-block">
          <h2>{t.investorsLineTitle}</h2>
          <ul className="studio-investor-line">
            {STUDIO_PRODUCTS.map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong>
                <span>{p.tagline[lang]}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="studio-section-block">
          <h2>{t.investorsModelTitle}</h2>
          <div className="studio-feature-stack">
            {t.investorsModelItems.map((item) => (
              <article key={item.t} className="studio-feature">
                <h3>{item.t}</h3>
                <p>{item.d}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="studio-section-block">
          <h2>{t.investorsRoadTitle}</h2>
          <ol className="studio-steps">
            {t.investorsRoadItems.map((item, idx) => (
              <li key={item.t}>
                <span className="studio-step-n">{String(idx + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{item.t}</h3>
                  <p>{item.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="studio-hero-cta" style={{ marginTop: "2rem" }}>
          <Link
            to="/demos"
            className="studio-btn studio-btn-primary"
            onClick={() => trackStudioEvent("investors_cta_demos")}
          >
            {t.ctaDemos}
          </Link>
          <Link to="/#contact" className="studio-btn studio-btn-secondary">
            {t.ctaContact}
          </Link>
          <Link to="/" className="studio-btn studio-btn-ghost">
            {t.backStudio}
          </Link>
        </div>
      </main>
    </div>
  );
}
