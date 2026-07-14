import { Link } from "react-router-dom";

import type { LandingCopy, LandingLang } from "@/i18n/landing";

type Props = {
  lang: LandingLang;
  setLang: (lang: LandingLang) => void;
  t: LandingCopy;
  active?: "home" | "demos" | "investors" | "industry" | "showcase";
};

export function StudioChrome({ lang, setLang, t, active = "home" }: Props) {
  return (
    <header className="studio-header">
      <div className="studio-header-inner">
        <Link to="/" className="studio-brand">
          <span className="studio-brand-mark">M</span>
          <span className="studio-brand-text">
            {t.brand}
            <em>{t.brandSub}</em>
          </span>
        </Link>
        <nav className="studio-nav">
          <Link to="/#cases" className={active === "home" ? "is-active" : undefined}>
            {t.navCases}
          </Link>
          <Link to="/demos" className={active === "demos" ? "is-active" : undefined}>
            {t.navDemos}
          </Link>
          <Link to="/investors" className={active === "investors" ? "is-active" : undefined}>
            {t.navInvestors}
          </Link>
          <Link to="/#offer">{t.navOffer}</Link>
          <Link to="/#contact">{t.navContact}</Link>
        </nav>
        <div className="studio-header-actions">
          <div className="studio-lang" role="group" aria-label="Language">
            <button type="button" className={lang === "ru" ? "active" : ""} onClick={() => setLang("ru")}>
              RU
            </button>
            <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>
              EN
            </button>
          </div>
          <Link to="/demos" className="studio-btn studio-btn-ghost">
            {t.ctaDemos}
          </Link>
        </div>
      </div>
    </header>
  );
}
