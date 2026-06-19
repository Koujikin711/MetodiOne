import { useEffect, useState } from "react";

const STORAGE_KEY = "metodi-shell-sidebar-expanded";

export function useShellSidebarExpanded() {
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "0") return false;
      if (raw === "1") return true;
    } catch {
      /* ignore */
    }
    return true;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, expanded ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [expanded]);

  return { expanded, setExpanded, toggle: () => setExpanded((v) => !v) };
}
