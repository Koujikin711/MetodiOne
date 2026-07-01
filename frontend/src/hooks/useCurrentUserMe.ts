import { useQuery } from "@tanstack/react-query";

import { apiFetch, getStoredToken } from "@/lib/api";
import type { UserMe } from "@/lib/types";

export function useCurrentUserMe() {
  const token = getStoredToken();
  return useQuery({
    queryKey: ["auth-me"],
    queryFn: () => apiFetch<UserMe>("/api/auth/me"),
    enabled: !!token,
    staleTime: 60_000,
  });
}
