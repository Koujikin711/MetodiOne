import { useEffect, useMemo, useState } from "react";

import { mergeShellSidebarOrder, type ShellSidebarNavItem } from "@/lib/shellSidebarNavItems";

const STORAGE_PREFIX = "metodi-shell-nav-order";

function storageKey(scope: string) {
  return `${STORAGE_PREFIX}:${scope}`;
}

function readOrder(scope: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

function writeOrder(scope: string, ids: string[]) {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function useShellSidebarOrder(scope: string, items: ShellSidebarNavItem[]) {
  const defaultIds = useMemo(() => items.map((item) => item.id), [items]);
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const [order, setOrder] = useState<string[]>(() => mergeShellSidebarOrder(defaultIds, readOrder(scope)));

  useEffect(() => {
    setOrder(mergeShellSidebarOrder(defaultIds, readOrder(scope)));
  }, [scope, defaultIds.join("|")]);

  useEffect(() => {
    writeOrder(scope, order);
  }, [scope, order]);

  const orderedItems = useMemo(
    () => order.map((id) => itemsById.get(id)).filter((item): item is ShellSidebarNavItem => item != null),
    [order, itemsById],
  );

  function reorder(activeId: string, overId: string | null) {
    if (!overId || activeId === overId) return;
    setOrder((prev) => {
      const from = prev.indexOf(activeId);
      const to = prev.indexOf(overId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, activeId);
      return next;
    });
  }

  return { orderedItems, order, reorder };
}
