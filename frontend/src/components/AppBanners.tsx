import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { isOnboardingDone } from "@/lib/onboarding";

export function AppBanners() {
  const location = useLocation();
  const [demo, setDemo] = useState(false);
  const role = decodeRoleFromToken(getStoredToken());
  const showOnboardingBanner = role === "owner" && !isOnboardingDone();

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get("demo") === "1") {
      try {
        sessionStorage.setItem("crm_demo_mode", "1");
      } catch {
        /* ignore */
      }
    }
    try {
      setDemo(sessionStorage.getItem("crm_demo_mode") === "1");
    } catch {
      setDemo(false);
    }
  }, [location.search]);

  if (!demo && !showOnboardingBanner) return null;

  return (
    <div className="mb-4 space-y-2 print:hidden">
      {demo ? (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-4 py-2 text-center text-xs text-cyan-100">
          Режим демо: данные могут быть примерными. Добавьте{" "}
          <code className="rounded bg-black/30 px-1">?demo=1</code> к URL чтобы включить баннер на других страницах.
        </div>
      ) : null}
      {showOnboardingBanner ? (
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-violet-500/30 bg-violet-950/25 px-4 py-2 text-xs text-violet-100">
          <span>Первый день в CRM: пройдите короткий мастер настройки.</span>
          <Link
            to="/onboarding"
            className="rounded-lg bg-white/10 px-3 py-1 font-medium text-white hover:bg-white/15"
          >
            Открыть мастер
          </Link>
        </div>
      ) : null}
    </div>
  );
}
