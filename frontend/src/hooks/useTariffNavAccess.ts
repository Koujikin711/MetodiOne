import { useCallback } from "react";

/**
 * Тарифные ограничения навигации отключены — все разделы видны в рамках роли.
 */
export function useTariffNavAccess() {
  const showNavForFeature = useCallback((_featureKey: string | null) => true, []);

  return { showNavForFeature, tariffAccess: undefined, isLoading: false };
}
