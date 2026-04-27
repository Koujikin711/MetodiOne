import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { apiFetch, getActiveCompanyId, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type { TariffAccessRead } from "@/lib/types";

/**
 * Доступ к пунктам меню по тарифу: скрываем иконки функций, которых нет в плане.
 * super_owner и отсутствие контекста компании — не фильтруем.
 */
export function useTariffNavAccess() {
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const companyId = getActiveCompanyId();

  const q = useQuery({
    queryKey: ["tariff-access", companyId],
    queryFn: () => apiFetch<TariffAccessRead>("/api/system/tariff-access"),
    enabled: companyId != null && role !== "super_owner",
    staleTime: 60_000,
  });

  const enabledSet = useMemo(() => new Set(q.data?.enabled_features ?? []), [q.data?.enabled_features]);
  const restaurantMode = enabledSet.has("horeca");

  const showNavForFeature = useCallback(
    (featureKey: string | null) => {
      if (role === "super_owner") return true;
      if (featureKey == null) return true;
      if (companyId == null) return true;
      if (q.isLoading || !q.data) return true;
      return enabledSet.has(featureKey);
    },
    [role, companyId, q.isLoading, q.data, enabledSet],
  );

  return { showNavForFeature, restaurantMode, tariffAccess: q.data, isLoading: q.isLoading };
}
