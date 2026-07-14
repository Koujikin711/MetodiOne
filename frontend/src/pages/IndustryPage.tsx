import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { StudioChrome } from "@/components/StudioChrome";
import { getIndustry } from "@/content/industries";
import { STUDIO_PRODUCTS } from "@/content/products";
import {
  detectLandingLang,
  LANDING_LANG_KEY,
  landingCopy,
  statusLabel,
  type LandingLang,
} from "@/i18n/landing";
import { trackStudioEvent } from "@/lib/studioAnalytics";

export function IndustryPage() {
  const { slug = "" } = useParams();
  const industry = getIndustry(slug);
  const [lang, setLang] = useState<LandingLang>(() => detectLandingLang());
  const t = useMemo(() => landingCopy(lang), [lang]);

  useEffect(() => {
    if (!industry) return;
    document.documentElement.lang = lang;
    document.title = industry.seoTitle[lang];
    try {
      localStorage.setItem(LANDING_LANG_KEY, lang);
    } catch {
      /* ignore */
    }
    trackStudioEvent("industry_view", { slug, lang });
  }, [industry, lang, slug]);

  if (!industry) return <Navigate to="/" replace />;

  const products = STUDIO_PRODUCTS.filter((p) => industry.productIds.includes(p.id));

  return (
    <div className={`studio-root studio-lang-${lang}`}>
      <div className="studio-atmosphere" aria-hidden />
      <div className="studio-grid" aria-hidden />
      <StudioChrome lang={lang} setLang={setLang} t={t} active="industry" />

      <main className="studio-demos-main">
        <div className="studio-section-head">
          <p className="studio-brand-hero">
            {t.brand}
            <span>{t.industriesTitle}</span>
          </p>
          <h1 className="studio-demos-title">{industry.title[lang]}</h1>
          <p>{industry.lead[lang]}</p>
        </div>

        <ul className="studio-bullet-list">
          {industry.bullets.map((b) => (
            <li key={b.en}>{b[lang]}</li>
          ))}
        </ul>

        <div className="studio-demo-grid" style={{ marginTop: "2rem" }}>
          {products.map((p) => (
            <article key={p.id} className="studio-demo-card">
              <div className="studio-product-top">
                <h2>{p.name}</h2>
                <span className={`studio-pill studio-pill-${p.status}`}>{statusLabel(lang, p.status)}</span>
              </div>
              <p className="studio-product-tag">{p.tagline[lang]}</p>
              <p className="studio-product-blurb">{p.blurb[lang]}</p>
              {p.demoUrl ? (
                <a
                  href={p.demoUrl}
                  className="studio-btn studio-btn-primary studio-btn-block"
                  target={p.demoUrl.startsWith("http") ? "_blank" : undefined}
                  rel={p.demoUrl.startsWith("http") ? "noreferrer" : undefined}
                  onClick={() => trackStudioEvent("product_click", { id: p.id, from: "industry", slug })}
                >
                  {p.status === "showcase" ? t.openShowcase : t.openDemo}
                </a>
              ) : null}
            </article>
          ))}
        </div>

        <div className="studio-hero-cta" style={{ marginTop: "2rem" }}>
          <Link to="/demos" className="studio-btn studio-btn-primary">
            {t.demosHubCta}
          </Link>
          <Link to="/investors" className="studio-btn studio-btn-secondary">
            {t.ctaInvestors}
          </Link>
        </div>
      </main>
    </div>
  );
}
