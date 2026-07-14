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

export function LandingPage() {
  const [lang, setLang] = useState<LandingLang>(() => detectLandingLang());
  const [contactOpen, setContactOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    comment: "",
  });

  const t = useMemo(() => landingCopy(lang), [lang]);

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
          { href: "#audience", label: t.navAudience },
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
              <Link to="/investors" className="studio-btn studio-btn-ghost" onClick={() => trackStudioEvent("cta_investors", { from: "hero" })}>
                {t.ctaInvestors}
              </Link>
            </div>
          </div>
          <div className="studio-hero-visual" aria-hidden>
            <div className="studio-hero-plane">
              <div className="studio-hero-orbit" />
              <div className="studio-hero-mosaic">
                <div className="studio-mosaic-col">
                  <span className="studio-mosaic-wide">MetodiOne CRM</span>
                  <span>FuelOps</span>
                  <span>StaffDesk</span>
                </div>
                <div className="studio-mosaic-col studio-mosaic-col-tall">
                  <span>MessageHub</span>
                  <span className="studio-mosaic-accent">ScaleGate</span>
                  <span>CraftLine</span>
                  <span>PartStock</span>
                </div>
                <div className="studio-mosaic-col">
                  <span>BakeFlow</span>
                  <span>TradeDesk</span>
                  <span className="studio-mosaic-wide">Atelier Retail</span>
                </div>
              </div>
            </div>
          </div>
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

        <section id="custom" className="studio-section studio-section-panel" data-reveal>
          <div className="studio-section-head">
            <h2>{t.customTitle}</h2>
            <p>{t.customLead}</p>
          </div>
          <div className="studio-feature-stack">
            {t.customItems.map((item) => (
              <article key={item.t} className="studio-feature">
                <h3>{item.t}</h3>
                <p>{item.d}</p>
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
            {STUDIO_CASES.map((c) => (
              <article key={c.id} className="studio-case">
                <p className="studio-case-industry">{c.industry[lang]}</p>
                <div className="studio-case-grid">
                  <div>
                    <h3>{t.caseProblem}</h3>
                    <p>{c.problem[lang]}</p>
                  </div>
                  <div>
                    <h3>{t.caseDid}</h3>
                    <p>{c.did[lang]}</p>
                  </div>
                  <div>
                    <h3>{t.caseResult}</h3>
                    <p>{c.result[lang]}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="work" className="studio-section" data-reveal>
          <div className="studio-section-head">
            <h2>{t.whatTitle}</h2>
            <p>{t.whatLead}</p>
          </div>
          <div className="studio-split-list studio-split-list-4">
            {t.whatItems.map((item) => (
              <article key={item.t} className="studio-split-item">
                <h3>{item.t}</h3>
                <p>{item.d}</p>
              </article>
            ))}
          </div>
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
                    {p.status === "showcase" ? t.openShowcase : t.openDemo}
                  </a>
                ) : (
                  <button type="button" className="studio-btn studio-btn-secondary studio-btn-block" onClick={() => openContact(`product-${p.id}`)}>
                    {t.requestPrivate}
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="studio-section" data-reveal>
          <div className="studio-section-head">
            <h2>{t.industriesTitle}</h2>
          </div>
          <div className="studio-industry-links">
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

        <section id="demos" className="studio-section studio-section-band" data-reveal>
          <div className="studio-band">
            <div>
              <h2>{t.demosTitle}</h2>
              <p>{t.demosLead}</p>
              <p className="studio-disclaimer">{t.demoDisclaimer}</p>
            </div>
            <Link to="/demos" className="studio-btn studio-btn-primary" onClick={() => trackStudioEvent("cta_demos", { from: "band" })}>
              {t.demosHubCta}
            </Link>
          </div>
        </section>

        <section id="offer" className="studio-section studio-section-panel" data-reveal>
          <div className="studio-section-head">
            <h2>{t.offerTitle}</h2>
            <p>{t.offerLead}</p>
          </div>
          <div className="studio-feature-stack">
            {t.offerItems.map((item) => (
              <article key={item.t} className="studio-feature">
                <h3>{item.t}</h3>
                <p>{item.d}</p>
              </article>
            ))}
          </div>
          <div className="studio-hero-cta studio-offer-cta-wrap" style={{ marginTop: "1.75rem" }}>
            <button type="button" className="studio-btn studio-btn-primary" onClick={() => openContact("offer")}>
              {t.offerCta}
            </button>
          </div>
        </section>

        <section id="engage" className="studio-section" data-reveal>
          <div className="studio-section-head">
            <h2>{t.experienceTitle}</h2>
          </div>
          <ol className="studio-steps">
            {t.experienceItems.map((item, idx) => (
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

        <section className="studio-section studio-section-panel" data-reveal>
          <div className="studio-section-head">
            <h2>{t.investTitle}</h2>
            <p>{t.investLead}</p>
          </div>
          <div className="studio-feature-stack">
            {t.investItems.map((item) => (
              <article key={item.t} className="studio-feature">
                <h3>{item.t}</h3>
                <p>{item.d}</p>
              </article>
            ))}
          </div>
          <div className="studio-hero-cta" style={{ marginTop: "1.5rem", padding: "0 1.35rem" }}>
            <Link to="/investors" className="studio-btn studio-btn-primary">
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
