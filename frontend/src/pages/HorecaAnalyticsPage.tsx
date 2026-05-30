import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import type { HorecaOrderBoardItem, HorecaOverviewRead, HorecaTableStatus } from "@/lib/types";

export function HorecaAnalyticsPage() {
  const overview = useQuery({
    queryKey: ["horeca-overview-analytics"],
    queryFn: () => apiFetch<HorecaOverviewRead>("/api/horeca/overview"),
    refetchInterval: 30_000,
  });
  const tables = useQuery({
    queryKey: ["horeca-tables-analytics"],
    queryFn: () => apiFetch<HorecaTableStatus[]>("/api/horeca/tables/status"),
    refetchInterval: 10_000,
  });
  const orders = useQuery({
    queryKey: ["horeca-orders-analytics"],
    queryFn: () => apiFetch<HorecaOrderBoardItem[]>("/api/horeca/orders/board?days=1"),
    refetchInterval: 10_000,
  });

  const busyTables = (tables.data ?? []).filter((t) => t.is_busy).length;
  const totalTables = tables.data?.length ?? 0;
  const tableLoadPct = totalTables > 0 ? Math.round((busyTables / totalTables) * 100) : 0;
  const inWorkCount = (orders.data ?? []).filter((o) => o.stage === "in_work").length;
  const readyCount = (orders.data ?? []).filter((o) => o.stage === "ready").length;

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / Аналитика</p>
        <h1 className="lux-heading-page">Операционная аналитика ресторана</h1>
        <p className="text-sm lux-caption">Загрузка зала, динамика заказов по стадиям, ABC-позиции и риск склада.</p>
      </header>
      <div className="flex gap-2 text-xs mo-muted">
        <Link to="/horeca/finance" className="rounded-lg border border-[var(--mo-border-strong)]/50 px-3 py-1.5 hover:bg-[var(--mo-accent-soft)]">
          К финансам
        </Link>
        <Link to="/horeca" className="rounded-lg border border-[var(--mo-border-strong)]/50 px-3 py-1.5 hover:bg-[var(--mo-accent-soft)]">
          В центр HoReCa
        </Link>
      </div>
      {overview.isLoading || tables.isLoading || orders.isLoading ? <p className="text-sm lux-caption">Загрузка аналитики…</p> : null}
      {overview.isError ? <p className="text-sm text-[#6b1d2f]">{(overview.error as Error).message}</p> : null}
      {tables.isError ? <p className="text-sm text-[#6b1d2f]">{(tables.error as Error).message}</p> : null}
      {orders.isError ? <p className="text-sm text-[#6b1d2f]">{(orders.error as Error).message}</p> : null}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[var(--mo-border)] bg-white p-3">
          <p className="text-xs mo-muted">Загрузка столов</p>
          <p className="mt-1 lux-heading-page text-2xl">{tableLoadPct}%</p>
        </div>
        <div className="rounded-2xl border border-[var(--mo-border)] bg-white p-3">
          <p className="text-xs mo-muted">Заказы в работе</p>
          <p className="mt-1 lux-heading-page text-2xl">{inWorkCount}</p>
        </div>
        <div className="rounded-2xl border border-[var(--mo-border)] bg-white p-3">
          <p className="text-xs mo-muted">Готово к выдаче</p>
          <p className="mt-1 lux-heading-page text-2xl">{readyCount}</p>
        </div>
        <div className="rounded-2xl border border-[var(--mo-border)] bg-white p-3">
          <p className="text-xs mo-muted">Риск по складу</p>
          <p className="mt-1 lux-heading-page text-2xl">{overview.data?.shift.low_stock_items ?? 0}</p>
        </div>
      </section>
    </div>
  );
}

