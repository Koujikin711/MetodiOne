import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { apiFetch, getActiveCompanyId, getStoredToken } from "@/lib/api";
import { decodeImpersonatorFromToken, decodeRoleFromToken } from "@/lib/auth";
import { isOnboardingDone } from "@/lib/onboarding";
import type { BillingStatusRead } from "@/lib/types";

function trialDaysLeft(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const end = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function AppBanners() {
  const location = useLocation();
  const [demo, setDemo] = useState(false);
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const companyId = getActiveCompanyId();
  const impersonatorId = decodeImpersonatorFromToken(token);
  const showOnboardingBanner = role === "owner" && !isOnboardingDone() && !location.pathname.startsWith("/crm");
  const canBillingBanner = false;

  const billingQ = useQuery({
    queryKey: ["billing-status", companyId],
    queryFn: () => apiFetch<BillingStatusRead>("/api/billing/status"),
    enabled: canBillingBanner,
    staleTime: 30_000,
  });

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

  const b = billingQ.data;
  const daysLeft = b ? trialDaysLeft(b.trial_ends_at) : null;
  const showBillingUrgent =
    b &&
    (b.billing_status === "demo_expired" ||
      b.billing_status === "payment_pending" ||
      (b.billing_status === "demo_trial" && daysLeft != null && daysLeft <= 3));

  if (!demo && !showOnboardingBanner && impersonatorId == null && !showBillingUrgent) {
    return null;
  }

  return (
    <div className="mb-4 space-y-2 print:hidden">
      {impersonatorId != null ? (
        <div className="mo-section border-[#D4AF37]/40 bg-[#FAF5EB] px-4 py-2 text-center text-xs text-[#2C2520]">
          Режим поддержки: вы вошли от имени владельца компании. Сессия помечена супер-владельцем (ID{" "}
          {impersonatorId}). Не вносите необоснованные изменения.
        </div>
      ) : null}
      {demo ? (
        <div className="mo-section border-[#2A6F85]/25 bg-[#F0F6F8] px-4 py-2 text-center text-xs text-[#2C2520]">
          Режим демо: данные могут быть примерными. Добавьте{" "}
          <code className="rounded border border-[#DCD1B4] bg-white px-1 text-[#A38A53]">?demo=1</code> к URL.
        </div>
      ) : null}
      {b?.billing_status === "demo_trial" && daysLeft != null && daysLeft <= 3 ? (
        <div className="executive-banner flex flex-wrap items-center justify-center gap-3 text-xs">
          <span>
            Демо заканчивается: осталось <strong>{daysLeft}</strong>{" "}
            {daysLeft === 1 ? "день" : daysLeft < 5 ? "дня" : "дней"}. Подключите тариф.
          </span>
          <Link
            to="/billing"
            className="rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 font-semibold hover:bg-white/18"
          >
            Оплата и тариф
          </Link>
        </div>
      ) : null}
      {b?.billing_status === "demo_expired" ? (
        <div className="mo-section flex flex-wrap items-center justify-center gap-3 border-[#6B1D2F]/30 bg-[#FDF5F5] px-4 py-3 text-xs text-[#2C2520]">
          <span>Срок демо истёк. Выберите тариф — после оплаты администратор платформы включит доступ.</span>
          <Link to="/billing" className="crm-pill-btn">
            Выбрать тариф
          </Link>
        </div>
      ) : null}
      {b?.billing_status === "payment_pending" ? (
        <div className="executive-banner text-xs">
          Ожидается подтверждение оплаты
          {b.pending_tariff_plan_name ? (
            <>
              {" "}
              по тарифу «{b.pending_tariff_plan_name}».
            </>
          ) : (
            "."
          )}{" "}
          <Link to="/billing" className="ml-1 font-semibold underline underline-offset-2">
            Оплата и тариф
          </Link>
        </div>
      ) : null}
      {showOnboardingBanner ? (
        <div className="executive-banner flex flex-wrap items-center justify-center gap-3 text-xs">
          <span>Первый день в CRM: пройдите короткий мастер настройки.</span>
          <Link
            to="/onboarding"
            className="rounded-lg border border-white/25 bg-white/10 px-3 py-1 font-semibold hover:bg-white/18"
          >
            Открыть мастер
          </Link>
        </div>
      ) : null}
    </div>
  );
}
