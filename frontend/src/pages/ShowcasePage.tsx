import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { StudioChrome } from "@/components/StudioChrome";
import { STUDIO_PRODUCTS } from "@/content/products";
import { getShowcase } from "@/content/showcases";
import {
  detectLandingLang,
  LANDING_LANG_KEY,
  landingCopy,
  type LandingLang,
} from "@/i18n/landing";
import { trackStudioEvent } from "@/lib/studioAnalytics";

export function ShowcasePage() {
  const { id = "" } = useParams();
  const showcase = getShowcase(id);
  const [lang, setLang] = useState<LandingLang>(() => detectLandingLang());
  const t = useMemo(() => landingCopy(lang), [lang]);
  const product = STUDIO_PRODUCTS.find((p) => p.id === showcase?.productId);

  useEffect(() => {
    if (!showcase) return;
    document.documentElement.lang = lang;
    document.title = `${showcase.title[lang]} | MetodiOne Studio`;
    try {
      localStorage.setItem(LANDING_LANG_KEY, lang);
    } catch {
      /* ignore */
    }
    trackStudioEvent("showcase_view", { id, lang });
  }, [showcase, lang, id]);

  if (!showcase || !product) return <Navigate to="/demos" replace />;

  return (
    <div className={`studio-root studio-lang-${lang}`}>
      <div className="studio-atmosphere" aria-hidden />
      <div className="studio-grid" aria-hidden />
      <StudioChrome lang={lang} setLang={setLang} t={t} active="showcase" />

      <main className="studio-demos-main">
        <div className="studio-section-head">
          <p className="studio-brand-hero">
            {product.name}
            <span>{t.statusShowcase}</span>
          </p>
          <h1 className="studio-demos-title">{showcase.title[lang]}</h1>
          <p>{showcase.lead[lang]}</p>
        </div>

        <section className="studio-section-block">
          <h2>{t.showcaseModules}</h2>
          <ul className="studio-bullet-list">
            {showcase.modules.map((m) => (
              <li key={m.en}>{m[lang]}</li>
            ))}
          </ul>
        </section>

        <section className="studio-section-block">
          <h2>{t.showcaseAudience}</h2>
          <p className="studio-prose">{showcase.audience[lang]}</p>
        </section>

        <div className="studio-hero-cta">
          <Link
            to="/#contact"
            className="studio-btn studio-btn-primary"
            onClick={() => trackStudioEvent("showcase_request", { id })}
          >
            {t.showcaseRequest}
          </Link>
          <Link to="/demos" className="studio-btn studio-btn-secondary">
            {t.demosHubCta}
          </Link>
        </div>
      </main>
    </div>
  );
}
