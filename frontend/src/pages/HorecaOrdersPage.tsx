import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeHorecaRoleFromToken, decodeRoleFromToken } from "@/lib/auth";
import { HORECA_STAGE_META, type HorecaOrderStage } from "@/lib/horecaOrderFlow";
import type { HorecaOrderBoardItem } from "@/lib/types";

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function HorecaOrdersPage() {
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const horecaRole = decodeHorecaRoleFromToken(token);
  const ordersQuery = useQuery({
    queryKey: ["horeca-orders-board"],
    queryFn: () => apiFetch<HorecaOrderBoardItem[]>("/api/horeca/orders/board?days=2"),
    refetchInterval: 10_000,
  });

  const grouped: Record<HorecaOrderStage, HorecaOrderBoardItem[]> = { new: [], in_work: [], ready: [], closed: [] };
  for (const item of ordersQuery.data ?? []) {
    const stage = (item.stage as HorecaOrderStage) || "closed";
    if (stage in grouped) grouped[stage].push(item);
  }

  const visibleStages: HorecaOrderStage[] =
    horecaRole === "cook" || role === "expert"
      ? ["in_work", "ready"]
      : horecaRole === "waiter" || role === "manager"
        ? ["new", "in_work"]
        : ["new", "in_work", "ready", "closed"];

  const roleLabel =
    horecaRole === "cook" || role === "expert"
      ? "Режим кухни"
      : horecaRole === "waiter" || role === "manager"
        ? "Режим официанта"
        : horecaRole === "hall_admin" || role === "admin"
          ? "Режим администратора зала"
          : "Режим владельца";

  return (
    <div className="mx-auto max-w-[1300px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / Заказы</p>
        <h1 className="lux-heading-page">Заказы и стадии смены</h1>
        <p className="text-sm lux-caption">
          Отдельный контур HoReCa: без CRM-канбана, только операционные заказы по смене.
        </p>
        <p className="text-xs mo-muted">{roleLabel}</p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs mo-muted">
        <Link to="/horeca/tables" className="rounded-lg border border-[var(--mo-border-strong)]/50 px-3 py-1.5 hover:bg-[var(--mo-accent-soft)]">
          К столикам
        </Link>
        <Link to="/horeca" className="rounded-lg border border-[var(--mo-border-strong)]/50 px-3 py-1.5 hover:bg-[var(--mo-accent-soft)]">
          В центр HoReCa
        </Link>
      </div>

      {ordersQuery.isLoading ? <p className="text-sm lux-caption">Загрузка заказов…</p> : null}
      {ordersQuery.isError ? <p className="text-sm text-[#6b1d2f]">{(ordersQuery.error as Error).message}</p> : null}

      <section className="grid gap-3 lg:grid-cols-4">
        {visibleStages.map((k) => (
          <div key={k} className="rounded-2xl border border-[var(--mo-border)] bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="lux-subheading text-sm">{HORECA_STAGE_META[k].title}</h2>
              <span className="rounded-full bg-[var(--mo-accent-soft)] px-2 py-0.5 text-xs mo-muted">{grouped[k].length}</span>
            </div>
            <p className="mb-3 text-xs mo-muted">{HORECA_STAGE_META[k].hint}</p>
            <div className="space-y-2">
              {grouped[k].map((o) => (
                <div key={o.id} className="rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-[var(--mo-text)]">{(o.item_name || "").trim() || "Заказ"}</span>
                    <span className="text-xs lux-caption">{shortTime(o.start_at)}</span>
                  </div>
                  <div className="mt-1 text-xs lux-caption">
                    {(o.guest_name || "").trim() || "Гость"} · {(o.table_name || "").trim() || "Стол"}
                  </div>
                </div>
              ))}
              {grouped[k].length === 0 ? <p className="text-xs mo-muted">Нет заказов</p> : null}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

