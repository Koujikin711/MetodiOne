import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { apiFetch, getActiveCompanyId, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { pathToTariffFeature } from "@/lib/tariffRoutes";
import type { TariffAccessRead } from "@/lib/types";

export function TariffFeatureOutletGate() {
  const { pathname } = useLocation();
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const companyId = getActiveCompanyId();
  const feature = useMemo(() => pathToTariffFeature(pathname), [pathname]);

  const skip =
    role === "super_owner" ||
    feature == null ||
    companyId == null ||
    pathname.startsWith("/companies") ||
    pathname.startsWith("/tariff-plans") ||
    pathname === "/force-password";

  const q = useQuery({
    queryKey: ["tariff-access", companyId],
    queryFn: () => apiFetch<TariffAccessRead>("/api/system/tariff-access"),
    enabled: !skip,
    staleTime: 60_000,
  });

  if (skip) return <Outlet />;

  if (q.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">Проверка тарифа…</div>
    );
  }

  if (q.isError || !q.data) {
    return <Outlet />;
  }

  const enabled = new Set(q.data.enabled_features);
  if (enabled.has(feature)) return <Outlet />;

  const label = q.data.feature_labels[feature] ?? feature;
  const upgrade = (q.data.upgrade_hints[feature] ?? []).filter(Boolean);
  const currentPlan = q.data.plan_name;

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center justify-center rounded-2xl border border-amber-500/35 bg-amber-950/25 px-6 py-12 text-center">
      <p className="text-lg font-semibold text-amber-50">Нет доступа по тарифу</p>
      <p className="mt-3 text-sm text-amber-100/90">
        Раздел «{label}» не входит в ваш текущий тариф
        {currentPlan ? (
          <>
            {" "}
            (<span className="font-medium text-white">{currentPlan}</span>)
          </>
        ) : null}
        .
      </p>
      {upgrade.length > 0 ? (
        <p className="mt-4 text-sm text-slate-200">
          Для доступа приобретите тариф: <span className="font-semibold text-white">{upgrade.join(", ")}</span>.
        </p>
      ) : (
        <p className="mt-4 text-sm text-slate-300">
          Для доступа приобретите тариф, в который входит эта функция, или обратитесь к администратору платформы.
        </p>
      )}
    </div>
  );
}
