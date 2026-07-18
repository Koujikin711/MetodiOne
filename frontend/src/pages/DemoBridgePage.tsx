import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { STUDIO_PRODUCTS } from "@/content/products";
import { detectLandingLang, landingCopy } from "@/i18n/landing";
import { trackStudioEvent } from "@/lib/studioAnalytics";

/**
 * Same-origin hop before opening an external sandbox.
 * Fixes hash-route demos (Nizom/PartStock) that some browsers mishandle
 * when opened directly via target=_blank from the marketing site.
 */
const BRIDGE_TARGETS: Record<string, string> = {
  partstock: "https://nizom-koujikin.amvera.io/#/demo",
  tradedesk: "https://akmal-koujikin.amvera.io/demo",
};

export function DemoBridgePage() {
  const { productId = "" } = useParams();
  const lang = detectLandingLang();
  const t = useMemo(() => landingCopy(lang), [lang]);
  const product = STUDIO_PRODUCTS.find((p) => p.id === productId);
  const target = BRIDGE_TARGETS[productId] ?? product?.demoUrl;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setError(lang === "ru" ? "Демо для этого продукта не найдено." : "No demo target for this product.");
      return;
    }
    trackStudioEvent("demo_bridge", { id: productId });
    const timer = window.setTimeout(() => {
      // Prefer a new tab so the Studio hub stays open (matches other live sandboxes).
      const popup = window.open(target, "_blank", "noopener,noreferrer");
      if (popup) {
        window.location.replace("/demos");
        return;
      }
      window.location.replace(target);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [target, productId, lang]);

  if (error) {
    return (
      <div className="studio-root" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "1.5rem" }}>
        <div className="studio-feature" style={{ maxWidth: 420 }}>
          <h1 style={{ marginTop: 0 }}>Sandbox</h1>
          <p className="studio-muted">{error}</p>
          <Link to="/demos" className="studio-btn studio-btn-primary">
            {t.navDemos}
          </Link>
        </div>
      </div>
    );
  }

  const name = product?.name ?? "Studio";
  return (
    <div className="studio-root" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "1.5rem" }}>
      <div className="studio-feature" style={{ maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ marginTop: 0 }}>{name}</h1>
        <p className="studio-muted">
          {lang === "ru" ? "Входим в sandbox без пароля…" : "Opening the passwordless sandbox…"}
        </p>
      </div>
    </div>
  );
}
