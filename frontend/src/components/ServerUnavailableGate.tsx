import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import {
  ServerUnavailableState,
  isServerUnavailableError,
} from "@/components/ServerUnavailableState";

/**
 * Если любой активный запрос упал с 502/503/504 — показываем робота поверх контента,
 * а не красную строку.
 */
export function ServerUnavailableGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [down, setDown] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  useEffect(() => {
    const scan = () => {
      const queries = queryClient.getQueryCache().getAll();
      for (const q of queries) {
        if (q.state.status !== "error" || q.getObserversCount() === 0) continue;
        if (!isServerUnavailableError(q.state.error)) continue;
        const msg = q.state.error instanceof Error ? q.state.error.message : String(q.state.error);
        setDown(true);
        setMessage(msg);
        return;
      }
      setDown(false);
      setMessage(undefined);
    };
    scan();
    return queryClient.getQueryCache().subscribe(() => scan());
  }, [queryClient, location.pathname]);

  if (!down) return <>{children}</>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ServerUnavailableState
        message={message}
        onRetry={() => {
          void queryClient.invalidateQueries();
          void queryClient.refetchQueries({ type: "active" });
        }}
      />
    </div>
  );
}
