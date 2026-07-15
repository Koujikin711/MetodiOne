import { useEffect, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import type { LandingCopy, LandingLang } from "@/i18n/landing";
import { scrollToStudioId, studioHashId } from "@/lib/studioScroll";

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

function pathOf(href: string): string {
  if (href.startsWith("#")) return "";
  try {
    return new URL(href, "https://metodione.local").pathname;
  } catch {
    return href.split("?")[0]?.split("#")[0] ?? href;
  }
}

function hashOf(href: string): string {
  if (href.startsWith("#")) return href;
  try {
    return new URL(href, "https://metodione.local").hash;
  } catch {
    const i = href.indexOf("#");
    return i >= 0 ? href.slice(i) : "";
  }
}

function isExactSameRoute(href: string, currentPath: string): boolean {
  if (href.startsWith("#")) return false;
  try {
    const u = new URL(href, "https://metodione.local");
    return u.pathname === currentPath && !u.hash && !u.search;
  } catch {
    return href === currentPath;
  }
}

function StudioNavLink({
  href,
  label,
  className,
  onNavigate,
  currentPath,
}: {
  href: string;
  label: string;
  className?: string;
  onNavigate?: () => void;
  currentPath: string;
}) {
  const navigate = useNavigate();
  const hash = hashOf(href);
  const targetPath = href.startsWith("#") ? currentPath : pathOf(href) || "/";

  if (isExactSameRoute(href, currentPath)) {
    return (
      <span className={className} aria-current="page">
        {label}
      </span>
    );
  }

  const go = (e: MouseEvent) => {
    onNavigate?.();
    const id = studioHashId(hash);
    if (!id) return;

    // Same-page hash: scroll with header offset (native jump lands under sticky bar).
    if (targetPath === currentPath) {
      e.preventDefault();
      scrollToStudioId(id);
      if (window.location.hash !== `#${id}`) {
        window.history.replaceState(null, "", `#${id}`);
      }
      return;
    }

    // Cross-page hash (e.g. /demos → /#contact): navigate then landing scrolls.
    e.preventDefault();
    navigate({ pathname: targetPath || "/", hash: `#${id}` });
  };

  if (hash) {
    return (
      <a href={href.startsWith("#") ? href : `${targetPath}${hash}`} className={className} onClick={go}>
        {label}
      </a>
    );
  }

  return (
    <Link to={href} className={className} onClick={() => onNavigate?.()}>
      {label}
    </Link>
  );
}

export function StudioChrome({ lang, setLang, t, active = "home", links }: Props) {
  const { pathname } = useLocation();
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
  const onDemos = active === "demos" || pathname === "/demos";
  const headerCta = onDemos
    ? { to: "/#contact", label: t.ctaContact }
    : { to: "/demos", label: t.ctaDemos };

  return (
    <header className={`studio-header${menuOpen ? " is-menu-open" : ""}`}>
      <div className="studio-header-inner">
        {pathname === "/" ? (
          <a
            href="#top"
            className="studio-brand"
            onClick={(e) => {
              e.preventDefault();
              close();
              window.scrollTo({ top: 0, behavior: "smooth" });
              if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
            }}
          >
            <span className="studio-brand-mark">M</span>
            <span className="studio-brand-text">
              {t.brand}
              <em>{t.brandSub}</em>
            </span>
          </a>
        ) : (
          <Link to="/" className="studio-brand" onClick={close}>
            <span className="studio-brand-mark">M</span>
            <span className="studio-brand-text">
              {t.brand}
              <em>{t.brandSub}</em>
            </span>
          </Link>
        )}

        <nav className="studio-nav" aria-label="Primary">
          {items.map((item) => (
            <StudioNavLink
              key={item.href + item.label}
              href={item.href}
              label={item.label}
              currentPath={pathname}
              className={
                (active === "demos" && pathOf(item.href) === "/demos") ||
                (active === "investors" && pathOf(item.href) === "/investors")
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
          <StudioNavLink
            href={headerCta.to}
            label={headerCta.label}
            currentPath={pathname}
            className="studio-btn studio-btn-ghost studio-btn-header-cta"
          />
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
            <StudioNavLink
              key={`m-${item.href}-${item.label}`}
              href={item.href}
              label={item.label}
              currentPath={pathname}
              onNavigate={close}
              className={
                (active === "demos" && pathOf(item.href) === "/demos") ||
                (active === "investors" && pathOf(item.href) === "/investors")
                  ? "is-active"
                  : undefined
              }
            />
          ))}
          <StudioNavLink
            href={headerCta.to}
            label={headerCta.label}
            currentPath={pathname}
            onNavigate={close}
            className="studio-btn studio-btn-primary studio-btn-block"
          />
          <Link to="/investors" className="studio-btn studio-btn-secondary studio-btn-block" onClick={close}>
            {t.ctaInvestors}
          </Link>
        </nav>
      </div>
      {menuOpen ? <button type="button" className="studio-mobile-scrim" aria-label="Close menu" onClick={close} /> : null}
    </header>
  );
}
