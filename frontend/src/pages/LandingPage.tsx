import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";

import { StudioChrome } from "@/components/StudioChrome";
import { apiFetch } from "@/lib/api";
import { STUDIO_CASES } from "@/content/cases";
import { INDUSTRY_PAGES } from "@/content/industries";
import { STUDIO_PRODUCTS } from "@/content/products";
import {
  detectLandingLang,
  LANDING_LANG_KEY,
  landingCopy,
  statusLabel,
  type LandingLang,
} from "@/i18n/landing";
import { trackStudioEvent } from "@/lib/studioAnalytics";

const FEATURED_CASE_IDS = ["fuel-wholesale", "weighbridge-whatsapp", "crm-service", "hr-department"] as const;

export function LandingPage() {
  const [lang, setLang] = useState<LandingLang>(() => detectLandingLang());
  const [contactOpen, setContactOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [casesExpanded, setCasesExpanded] = useState(false);
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    comment: "",
  });

  const t = useMemo(() => landingCopy(lang), [lang]);

  const featuredCases = useMemo(
    () => FEATURED_CASE_IDS.map((id) => STUDIO_CASES.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c)),
    [],
  );
  const remainingCases = useMemo(
    () => STUDIO_CASES.filter((c) => !(FEATURED_CASE_IDS as readonly string[]).includes(c.id)),
    [],
  );
  const visibleCases = casesExpanded ? [...featuredCases, ...remainingCases] : featuredCases;
  const hiddenCount = remainingCases.length;

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = "MetodiOne Studio — custom operational software";
    try {
      localStorage.setItem(LANDING_LANG_KEY, lang);
    } catch {
      /* ignore */
    }
    trackStudioEvent("landing_view", { lang });
  }, [lang]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!nodes.length || typeof IntersectionObserver === "undefined") {
      nodes.forEach((n) => n.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [lang]);

  const openContact = (source: string) => {
    trackStudioEvent("contact_open", { source, lang });
    setContactOpen(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const message = [form.company && `Company: ${form.company}`, form.comment].filter(Boolean).join("\n\n");
      const res = await apiFetch<{ ok?: boolean; message?: string }>("/api/system/demo-request", {
        method: "POST",
        body: JSON.stringify({
          full_name: form.name,
          company: form.company,
          email: form.email,
          phone: form.phone,
          message,
        }),
      });
      trackStudioEvent("contact_submit", { lang, ok: true });
      toast.success(res.message || (lang === "ru" ? "Заявка отправлена" : "Request sent"));
      setContactOpen(false);
      setForm({ name: "", company: "", email: "", phone: "", comment: "" });
    } catch (err) {
      trackStudioEvent("contact_submit", { lang, ok: false });
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`studio-root studio-lang-${lang}`} key={lang}>
      <div className="studio-atmosphere" aria-hidden />
      <div className="studio-grid" aria-hidden />
      <div className="studio-sheen" aria-hidden />

      <StudioChrome
        lang={lang}
        setLang={setLang}
        t={t}
        active="home"
        links={[
          { href: "#cases", label: t.navCases },
          { href: "#products", label: t.navProducts },
          { href: "#offer", label: t.navOffer },
          { href: "/demos", label: t.navDemos },
          { href: "/investors", label: t.navInvestors },
          { href: "#contact", label: t.navContact },
        ]}
      />

      <main id="top">
        <section className={`studio-hero ${revealed ? "is-in" : ""}`}>
          <div className="studio-hero-bleed" aria-hidden>
            <div className="studio-hero-orbit" />
            <p className="studio-hero-roster">
              <span>ScaleGate</span>
              <span>FuelOps</span>
              <span>StaffDesk</span>
              <span>MessageHub</span>
            </p>
          </div>
          <div className="studio-hero-copy">
            <p className="studio-brand-hero">
              {t.brand}
              <span>{t.brandSub}</span>
            </p>
            <h1 className="studio-hero-title">{t.heroHeadline}</h1>
            <p className="studio-hero-lead">{t.heroLead}</p>
            <div className="studio-hero-cta">
              <Link
                to="/demos"
                className="studio-btn studio-btn-primary"
                onClick={() => trackStudioEvent("cta_demos", { from: "hero" })}
              >
                {t.ctaDemos}
              </Link>
              <button type="button" className="studio-btn studio-btn-secondary" onClick={() => openContact("hero")}>
                {t.ctaContact}
              </button>
            </div>
            <Link
              to="/investors"
              className="studio-hero-sublink"
              onClick={() => trackStudioEvent("cta_investors", { from: "hero" })}
            >
              {t.ctaInvestors} →
            </Link>
          </div>
        </section>

        <section className="studio-offer-strip" aria-label={t.offerStripTitle} data-reveal>
          <div className="studio-offer-strip-main">
            <p className="studio-offer-strip-label">{t.offerStripTitle}</p>
            <ol className="studio-offer-strip-steps">
              {t.offerItems.map((item, i) => (
                <li key={item.t}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <strong>{item.t}</strong>
                </li>
              ))}
            </ol>
            <a href="#offer" className="studio-link studio-offer-strip-link">
              {t.navOffer} →
            </a>
          </div>
          <p className="studio-offer-strip-proof">
            <span className="studio-live-dot" aria-hidden />
            <span>
              {t.heroProofLive}: {t.heroProofLine}. {t.heroProofCaption}
            </span>
          </p>
        </section>

        <section id="audience" className="studio-section" data-reveal>
          <div className="studio-section-head">
            <h2>{t.audienceTitle}</h2>
            <p>{t.audienceLead}</p>
          </div>
          <div className="studio-editorial-list">
            {t.audienceItems.map((item, i) => (
              <article key={item.t} className="studio-editorial-row">
                <span className="studio-editorial-index">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{item.t}</h3>
                  <p>{item.d}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="cases" className="studio-section" data-reveal>
          <div className="studio-section-head">
            <h2>{t.casesTitle}</h2>
            <p>{t.casesLead}</p>
          </div>
          <div className="studio-cases">
            {visibleCases.map((c) => (
              <article key={c.id} className="studio-case">
                <header className="studio-case-head">
                  <p className="studio-case-industry">{c.industry[lang]}</p>
                  <h3 className="studio-case-title">{c.title[lang]}</h3>
                  <p className="studio-case-context">{c.context[lang]}</p>
                </header>
                <div className="studio-case-grid">
                  <div>
                    <h4>{t.caseProblem}</h4>
                    <p>{c.problem[lang]}</p>
                  </div>
                  <div>
                    <h4>{t.caseDid}</h4>
                    <p>{c.did[lang]}</p>
                  </div>
                  <div>
                    <h4>{t.caseResult}</h4>
                    <p>{c.result[lang]}</p>
                  </div>
                </div>
                <ul className="studio-case-metrics" aria-label={t.caseImpact}>
                  {c.metrics.map((m) => (
                    <li key={`${c.id}-${m.value}-${m.label.en}`}>
                      <strong>{m.value}</strong>
                      <span>{m.label[lang]}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          {hiddenCount > 0 && (
            <div className="studio-cases-toggle-wrap">
              <button
                type="button"
                className="studio-btn studio-btn-secondary studio-cases-toggle"
                aria-expanded={casesExpanded}
                onClick={() => {
                  const next = !casesExpanded;
                  setCasesExpanded(next);
                  trackStudioEvent("cases_toggle", { expanded: next, lang });
                  if (!next) {
                    document.getElementById("cases")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
              >
                {casesExpanded ? t.casesShowLess : `${t.casesShowMore} · ${hiddenCount} ${t.casesMoreHint}`}
              </button>
            </div>
          )}
        </section>

        <section id="products" className="studio-section" data-reveal>
          <div className="studio-section-head studio-section-head-row">
            <div>
              <h2>{t.productsTitle}</h2>
              <p>{t.productsLead}</p>
            </div>
            <Link to="/demos" className="studio-link">
              {t.viewAllDemos} →
            </Link>
          </div>
          <div className="studio-product-rail">
            {STUDIO_PRODUCTS.map((p, i) => (
              <article key={p.id} className="studio-product" style={{ animationDelay: `${80 + i * 45}ms` }}>
                <div className="studio-product-top">
                  <h3>{p.name}</h3>
                  <span className={`studio-pill studio-pill-${p.status}`}>{statusLabel(lang, p.status)}</span>
                </div>
                <p className="studio-product-tag">{p.tagline[lang]}</p>
                <p className="studio-product-blurb">{p.blurb[lang]}</p>
                <div className="studio-tags">
                  {p.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                {p.demoUrl ? (
                  <a
                    href={p.demoUrl}
                    target={p.demoUrl.startsWith("http") ? "_blank" : undefined}
                    rel={p.demoUrl.startsWith("http") ? "noreferrer" : undefined}
                    className="studio-btn studio-btn-primary studio-btn-block"
                    onClick={() => trackStudioEvent("product_click", { id: p.id, from: "landing" })}
                  >
                    {p.status === "showcase"
                      ? t.openShowcase
                      : p.instantDemo
                        ? t.openDemoInstant
                        : t.openDemo}
                  </a>
                ) : (
                  <button type="button" className="studio-btn studio-btn-secondary studio-btn-block" onClick={() => openContact(`product-${p.id}`)}>
                    {t.requestPrivate}
                  </button>
                )}
              </article>
            ))}
          </div>
          <div className="studio-industry-rail" aria-label={t.industriesTitle}>
            {INDUSTRY_PAGES.map((ind) => (
              <Link
                key={ind.slug}
                to={`/solutions/${ind.slug}`}
                className="studio-industry-link"
                onClick={() => trackStudioEvent("industry_click", { slug: ind.slug })}
              >
                {ind.title[lang]}
              </Link>
            ))}
          </div>
        </section>

        <section id="offer" className="studio-section studio-section-panel" data-reveal>
          <div className="studio-section-head">
            <h2>{t.offerTitle}</h2>
            <p>{t.offerLead}</p>
          </div>
          <ol className="studio-steps studio-steps-panel">
            {t.offerItems.map((item, idx) => (
              <li key={item.t}>
                <span className="studio-step-n">{String(idx + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{item.t}</h3>
                  <p>{item.d}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="studio-hero-cta studio-offer-cta-wrap">
            <button type="button" className="studio-btn studio-btn-primary" onClick={() => openContact("offer")}>
              {t.offerCta}
            </button>
          </div>
        </section>

        <section className="studio-section studio-invest-teaser" data-reveal>
          <div className="studio-invest-teaser-inner">
            <div>
              <h2>{t.investTitle}</h2>
              <p>{t.investLead}</p>
            </div>
            <Link to="/investors" className="studio-btn studio-btn-secondary">
              {t.ctaInvestors}
            </Link>
          </div>
        </section>

        <section id="contact" className="studio-section studio-section-end" data-reveal>
          <div className="studio-finale">
            <h2>{t.contactTitle}</h2>
            <p>{t.contactLead}</p>
            <div className="studio-hero-cta">
              <button type="button" className="studio-btn studio-btn-primary" onClick={() => openContact("finale")}>
                {t.ctaOffer}
              </button>
              <Link to="/demos" className="studio-btn studio-btn-secondary">
                {t.ctaDemos}
              </Link>
              <Link to="/login" className="studio-btn studio-btn-ghost">
                {t.ctaLogin}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="studio-footer">
        <div className="studio-footer-inner">
          <strong>
            {t.brand} {t.brandSub}
          </strong>
          <p>{t.footerNote}</p>
          <p className="studio-footer-links">
            <Link to="/investors">{t.navInvestors}</Link>
            <Link to="/demos">{t.navDemos}</Link>
            <Link to="/solutions/fuel-erp">{INDUSTRY_PAGES[0].title[lang]}</Link>
          </p>
        </div>
      </footer>

      {contactOpen && (
        <div className="studio-modal-backdrop" onClick={() => setContactOpen(false)}>
          <div className="studio-modal" onClick={(e) => e.stopPropagation()}>
            <div className="studio-modal-head">
              <h2>{t.ctaContact}</h2>
              <button type="button" onClick={() => setContactOpen(false)}>
                {t.contactClose}
              </button>
            </div>
            <form onSubmit={onSubmit} className="studio-form">
              <label>
                {t.contactName}
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                {t.contactCompany}
                <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </label>
              <label>
                {t.contactEmail}
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <label>
                {t.contactPhone}
                <input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
              <label>
                {t.contactMessage}
                <textarea
                  rows={4}
                  required
                  value={form.comment}
                  onChange={(e) => setForm({ ...form, comment: e.target.value })}
                />
              </label>
              <button type="submit" className="studio-btn studio-btn-primary studio-btn-block" disabled={sending}>
                {sending ? t.contactSending : t.contactSend}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
