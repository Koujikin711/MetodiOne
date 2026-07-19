import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiFetch, setActiveCompanyId, setStoredToken } from "@/lib/api";
import { trackStudioEvent } from "@/lib/studioAnalytics";

type TokenResp = { access_token: string; must_change_password?: boolean };

/** One-click CRM sandbox entry from the studio hub. */
export function DemoEnterPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        trackStudioEvent("crm_demo_enter");
        const res = await apiFetch<TokenResp>("/api/auth/demo-login", { method: "POST", body: "{}" });
        if (cancelled) return;
        setStoredToken(res.access_token);
        setActiveCompanyId(null);
        navigate("/app", { replace: true });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="studio-root" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "1.5rem" }}>
        <div className="studio-feature" style={{ maxWidth: 420 }}>
          <h1 style={{ marginTop: 0 }}>Sandbox</h1>
          <p className="studio-muted">{error}</p>
          <Link to="/demos" className="studio-btn studio-btn-primary">
            Demo hub
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-root" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "1.5rem" }}>
      <div className="studio-feature" style={{ maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ marginTop: 0 }}>MetodiOne CRM</h1>
        <p className="studio-muted">Открываем демо…</p>
      </div>
    </div>
  );
}
