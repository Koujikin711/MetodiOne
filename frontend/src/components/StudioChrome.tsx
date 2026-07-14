import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import type { LandingCopy, LandingLang } from "@/i18n/landing";

export type StudioNavItem = {
  href: string;
  label: string;
};

type Props = {
  lang: LandingLang;
  setLang: (lang: LandingLang) => void;
  t: LandingCopy;
  active?: "home" | "demos" | "investors" | "industry" | "showcase";
  links?: StudioNavItem[];
};

function StudioNavLink({
  href,
  label,
  className,
  onNavigate,
}: {
  href: string;
  label: string;
  className?: string;
  onNavigate?: () => void;
}) {
  if (href.startsWith("#")) {
    return (
      <a href={href} className={className} onClick={onNavigate}>
        {label}
      </a>
    );
  }
  return (
    <Link to={href} className={className} onClick={onNavigate}>
      {label}
    </Link>
  );
}

export function StudioChrome({ lang, setLang, t, active = "home", links }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  const items: StudioNavItem[] =
    links ??
    ([
      { href: "/#cases", label: t.navCases },
      { href: "/demos", label: t.navDemos },
      { href: "/investors", label: t.navInvestors },
      { href: "/#offer", label: t.navOffer },
      { href: "/#contact", label: t.navContact },
    ] satisfies StudioNavItem[]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const close = () => setMenuOpen(false);

  return (
    <header className={`studio-header${menuOpen ? " is-menu-open" : ""}`}>
      <div className="studio-header-inner">
        <Link to="/" className="studio-brand" onClick={close}>
          <span className="studio-brand-mark">M</span>
          <span className="studio-brand-text">
            {t.brand}
            <em>{t.brandSub}</em>
          </span>
        </Link>

        <nav className="studio-nav" aria-label="Primary">
          {items.map((item) => (
            <StudioNavLink
              key={item.href + item.label}
              href={item.href}
              label={item.label}
              className={
                (active === "demos" && item.href === "/demos") ||
                (active === "investors" && item.href === "/investors")
                  ? "is-active"
                  : undefined
              }
            />
          ))}
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
          <Link to="/demos" className="studio-btn studio-btn-ghost studio-btn-header-cta">
            {t.ctaDemos}
          </Link>
          <button
            type="button"
            className="studio-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="studio-mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      <div
        id="studio-mobile-nav"
        className={`studio-mobile-drawer${menuOpen ? " is-open" : ""}`}
        hidden={!menuOpen}
      >
        <nav className="studio-mobile-nav" aria-label="Mobile">
          {items.map((item) => (
            <StudioNavLink key={`m-${item.href}-${item.label}`} href={item.href} label={item.label} onNavigate={close} />
          ))}
          <Link to="/demos" className="studio-btn studio-btn-primary studio-btn-block" onClick={close}>
            {t.ctaDemos}
          </Link>
          <Link to="/investors" className="studio-btn studio-btn-secondary studio-btn-block" onClick={close}>
            {t.ctaInvestors}
          </Link>
        </nav>
      </div>
      {menuOpen ? <button type="button" className="studio-mobile-scrim" aria-label="Close menu" onClick={close} /> : null}
    </header>
  );
}
