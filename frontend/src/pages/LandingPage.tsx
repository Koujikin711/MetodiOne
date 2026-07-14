import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import { STUDIO_PRODUCTS } from "@/content/products";
import {
  detectLandingLang,
  LANDING_LANG_KEY,
  landingCopy,
  statusLabel,
  type LandingLang,
} from "@/i18n/landing";

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
  const featured = STUDIO_PRODUCTS.slice(0, 6);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(LANDING_LANG_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const res = await apiFetch<{ ok?: boolean; message?: string }>("/api/system/demo-request", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          company: form.company,
          email: form.email,
          phone: form.phone,
          comment: form.comment,
          source: "studio-landing",
          lang,
        }),
      });
      toast.success(res.message || (lang === "ru" ? "Заявка отправлена" : "Request sent"));
      setContactOpen(false);
      setForm({ name: "", company: "", email: "", phone: "", comment: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="studio-root">
      <div className="studio-atmosphere" aria-hidden />
      <div className="studio-grid" aria-hidden />

      <header className="studio-header">
        <div className="studio-header-inner">
          <a href="#top" className="studio-brand">
            <span className="studio-brand-mark">M</span>
            <span className="studio-brand-text">
              {t.brand}
              <em>{t.brandSub}</em>
            </span>
          </a>
          <nav className="studio-nav">
            <a href="#work">{t.navWork}</a>
            <a href="#products">{t.navProducts}</a>
            <a href="#demos">{t.navDemos}</a>
            <a href="#contact">{t.navContact}</a>
          </nav>
          <div className="studio-header-actions">
            <div className="studio-lang" role="group" aria-label="Language">
              <button
                type="button"
                className={lang === "ru" ? "active" : ""}
                onClick={() => setLang("ru")}
              >
                RU
              </button>
              <button
                type="button"
                className={lang === "en" ? "active" : ""}
                onClick={() => setLang("en")}
              >
                EN
              </button>
            </div>
            <Link to="/demos" className="studio-btn studio-btn-ghost">
              {t.ctaDemos}
            </Link>
          </div>
        </div>
      </header>

      <main id="top">
        <section className={`studio-hero ${revealed ? "is-in" : ""}`}>
          <div className="studio-hero-copy">
            <p className="studio-kicker">{t.brand} {t.brandSub}</p>
            <h1 className="studio-hero-title">{t.heroHeadline}</h1>
            <p className="studio-hero-lead">{t.heroLead}</p>
            <div className="studio-hero-cta">
              <Link to="/demos" className="studio-btn studio-btn-primary">
                {t.ctaDemos}
              </Link>
              <button type="button" className="studio-btn studio-btn-secondary" onClick={() => setContactOpen(true)}>
                {t.ctaContact}
              </button>
            </div>
          </div>
          <div className="studio-hero-visual" aria-hidden>
            <div className="studio-hero-plane">
              <div className="studio-hero-orbit" />
              <div className="studio-hero-panel">
                <span>FuelOps</span>
                <span>MessageHub</span>
                <span>ScaleGate</span>
                <span>CraftLine</span>
                <span>MetodiOne CRM</span>
              </div>
            </div>
          </div>
        </section>

        <section id="work" className="studio-section">
          <div className="studio-section-head">
            <h2>{t.whatTitle}</h2>
            <p>{t.whatLead}</p>
          </div>
          <div className="studio-split-list">
            {t.whatItems.map((item) => (
              <article key={item.t} className="studio-split-item">
                <h3>{item.t}</h3>
                <p>{item.d}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="products" className="studio-section">
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
            {featured.map((p, i) => (
              <article
                key={p.id}
                className="studio-product"
                style={{ animationDelay: `${120 + i * 70}ms` }}
              >
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
                {p.demoUrl && p.status !== "private" ? (
                  <a
                    href={p.demoUrl}
                    target={p.demoUrl.startsWith("http") ? "_blank" : undefined}
                    rel={p.demoUrl.startsWith("http") ? "noreferrer" : undefined}
                    className="studio-btn studio-btn-primary studio-btn-block"
                  >
                    {t.openDemo}
                  </a>
                ) : (
                  <button type="button" className="studio-btn studio-btn-secondary studio-btn-block" onClick={() => setContactOpen(true)}>
                    {t.requestPrivate}
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>

        <section id="demos" className="studio-section studio-section-band">
          <div className="studio-band">
            <div>
              <h2>{t.demosTitle}</h2>
              <p>{t.demosLead}</p>
              <p className="studio-disclaimer">{t.demoDisclaimer}</p>
            </div>
            <Link to="/demos" className="studio-btn studio-btn-primary">
              {t.demosHubCta}
            </Link>
          </div>
        </section>

        <section className="studio-section">
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

        <section id="contact" className="studio-section studio-section-end">
          <div className="studio-finale">
            <h2>{t.contactTitle}</h2>
            <p>{t.contactLead}</p>
            <div className="studio-hero-cta">
              <button type="button" className="studio-btn studio-btn-primary" onClick={() => setContactOpen(true)}>
                {t.ctaContact}
              </button>
              <Link to="/login" className="studio-btn studio-btn-secondary">
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
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
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
