/** Heartbeat «я онлайн» для менеджеров / РОП / админов. */

import { useEffect } from "react";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";

const HEARTBEAT_ROLES = new Set([
  "manager",
  "admin",
  "rop",
  "owner",
  "administrator",
]);

const INTERVAL_MS = 30_000;

export function usePresenceHeartbeat() {
  useEffect(() => {
    const role = decodeRoleFromToken(getStoredToken());
    if (!role || !HEARTBEAT_ROLES.has(role)) return;

    let cancelled = false;

    async function beat() {
      if (cancelled || document.visibilityState === "hidden") return;
      try {
        await apiFetch("/api/rop/presence/heartbeat", { method: "POST", body: "{}" });
      } catch {
        /* ignore */
      }
    }

    void beat();
    const id = window.setInterval(() => void beat(), INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
}
