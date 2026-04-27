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
  const showOnboardingBanner = role === "owner" && !isOnboardingDone();
  const canBillingBanner = (role === "owner" || role === "admin") && companyId != null && role !== "super_owner";

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

  if (
    !demo &&
    !showOnboardingBanner &&
    impersonatorId == null &&
    !showBillingUrgent
  ) {
    return null;
  }

  return (
    <div className="mb-4 space-y-2 print:hidden">
      {impersonatorId != null ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/35 px-4 py-2 text-center text-xs text-amber-50">
          Режим поддержки: вы вошли от имени владельца компании. Сессия помечена супер-владельцем (ID{" "}
          {impersonatorId}). Не вносите необоснованные изменения.
        </div>
      ) : null}
      {demo ? (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-4 py-2 text-center text-xs text-cyan-100">
          Режим демо: данные могут быть примерными. Добавьте{" "}
          <code className="rounded bg-black/30 px-1">?demo=1</code> к URL чтобы включить баннер на других страницах.
        </div>
      ) : null}
      {b?.billing_status === "demo_trial" && daysLeft != null && daysLeft <= 3 ? (
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-amber-500/35 bg-amber-950/30 px-4 py-3 text-xs text-amber-50">
          <span>
            Демо заканчивается: осталось <strong className="text-white">{daysLeft}</strong>{" "}
            {daysLeft === 1 ? "день" : daysLeft < 5 ? "дня" : "дней"}. Подключите тариф, чтобы не потерять доступ.
          </span>
          <Link
            to="/billing"
            className="rounded-lg bg-white/10 px-3 py-1.5 font-medium text-white hover:bg-white/15"
          >
            Оплата и тариф
          </Link>
        </div>
      ) : null}
      {b?.billing_status === "demo_expired" ? (
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-rose-500/40 bg-rose-950/35 px-4 py-3 text-xs text-rose-50">
          <span>Срок демо истёк. Выберите тариф — после оплаты администратор платформы включит доступ.</span>
          <Link
            to="/billing"
            className="rounded-lg bg-white/15 px-3 py-1.5 font-semibold text-white hover:bg-white/20"
          >
            Выбрать тариф
          </Link>
        </div>
      ) : null}
      {b?.billing_status === "payment_pending" ? (
        <div className="rounded-xl border border-violet-500/40 bg-violet-950/35 px-4 py-3 text-center text-xs text-violet-100">
          Ожидается подтверждение оплаты
          {b.pending_tariff_plan_name ? (
            <>
              {" "}
              по тарифу «<span className="font-semibold text-white">{b.pending_tariff_plan_name}</span>».
            </>
          ) : (
            "."
          )}{" "}
          CRM откроется после проверки администратором. Подробности — в разделе{" "}
          <Link to="/billing" className="font-medium text-white underline-offset-2 hover:underline">
            Оплата и тариф
          </Link>
          .
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
