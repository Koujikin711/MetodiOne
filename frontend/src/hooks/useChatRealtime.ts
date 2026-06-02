import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { getStoredToken } from "@/lib/api";

/** WebSocket: сигнал обновить чаты (меньше polling). */
export function useChatRealtime(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const token = getStoredToken();
    if (!token) return;

    let ws: WebSocket | null = null;
    let pingTimer: ReturnType<typeof window.setInterval> | undefined;

    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: ["chat-threads"] });
      void qc.invalidateQueries({ queryKey: ["chat-thread-bucket-counts"] });
      void qc.invalidateQueries({ queryKey: ["desk-awaiting-threads"] });
      void qc.invalidateQueries({ queryKey: ["team-threads"] });
      void qc.invalidateQueries({ queryKey: ["team-messages"] });
    };

    try {
      const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
      const wsBase = apiBase
        ? apiBase.replace(/^http/i, (m) => (m.toLowerCase() === "https" ? "wss" : "ws"))
        : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
      ws = new WebSocket(`${wsBase}/api/chat/ws?token=${encodeURIComponent(token)}`);
      ws.onmessage = () => invalidate();
      ws.onopen = () => {
        pingTimer = window.setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send("ping");
        }, 25000);
      };
    } catch {
      return undefined;
    }

    return () => {
      if (pingTimer) window.clearInterval(pingTimer);
      ws?.close();
    };
  }, [enabled, qc]);
}
