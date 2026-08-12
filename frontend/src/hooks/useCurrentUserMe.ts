import { useQuery } from "@tanstack/react-query";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeUserIdFromToken } from "@/lib/auth";
import type { UserMe } from "@/lib/types";

export function useCurrentUserMe() {
  const token = getStoredToken();
  const userId = decodeUserIdFromToken(token);
  return useQuery({
    // userId in key: иначе после смены аккаунта (клиника ↔ продажи) 60с живёт чужой /me
    queryKey: ["auth-me", userId ?? "anon"],
    queryFn: () => apiFetch<UserMe>("/api/auth/me"),
    enabled: !!token,
    staleTime: 60_000,
  });
}
