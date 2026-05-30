import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import type { HorecaFinanceSummaryRead } from "@/lib/types";

const moneyFmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
function fm(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? moneyFmt.format(n) : v;
}

export function HorecaFinancePage() {
  const q = useQuery({
    queryKey: ["horeca-finance-page"],
    queryFn: () => apiFetch<HorecaFinanceSummaryRead>("/api/horeca/finance/summary?days=30"),
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / Финансы</p>
        <h1 className="lux-heading-page">Финансы ресторана</h1>
        <p className="text-sm lux-caption">Специализированные метрики: COGS, food cost, валовая прибыль, маржинальность.</p>
      </header>
      <div className="flex gap-2 text-xs mo-muted">
        <Link to="/horeca/analytics" className="rounded-lg border border-[var(--mo-border-strong)]/50 px-3 py-1.5 hover:bg-[var(--mo-accent-soft)]">
          К аналитике
        </Link>
        <Link to="/horeca" className="rounded-lg border border-[var(--mo-border-strong)]/50 px-3 py-1.5 hover:bg-[var(--mo-accent-soft)]">
          В центр HoReCa
        </Link>
      </div>
      {q.isLoading ? <p className="text-sm lux-caption">Загрузка финансов…</p> : null}
      {q.isError ? <p className="text-sm text-[#6b1d2f]">{(q.error as Error).message}</p> : null}
      {q.data ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-[var(--mo-border)] bg-white p-3">
              <p className="text-xs mo-muted">Выручка</p>
              <p className="mt-1 lux-heading-page text-2xl">{fm(q.data.revenue)}</p>
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] bg-white p-3">
              <p className="text-xs mo-muted">COGS</p>
              <p className="mt-1 lux-heading-page text-2xl">{fm(q.data.cogs)}</p>
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] bg-white p-3">
              <p className="text-xs mo-muted">Валовая прибыль</p>
              <p className="mt-1 lux-heading-page text-2xl">{fm(q.data.gross_profit)}</p>
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] bg-white p-3">
              <p className="text-xs mo-muted">Food cost</p>
              <p className="mt-1 lux-heading-page text-2xl">{q.data.food_cost_pct}%</p>
            </div>
          </section>
          <section className="overflow-x-auto rounded-2xl border border-[var(--mo-border)] bg-white p-4">
            <table className="w-full min-w-[760px] text-left text-sm text-[var(--mo-text)]">
              <thead className="lux-caption">
                <tr>
                  <th className="py-2 pr-3">Позиция</th>
                  <th className="py-2 pr-3">ABC</th>
                  <th className="py-2 pr-3">Кол-во</th>
                  <th className="py-2 pr-3">Выручка</th>
                  <th className="py-2 pr-3">COGS</th>
                  <th className="py-2 pr-3">Валовая прибыль</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((r) => (
                  <tr key={r.menu_item_name} className="border-t border-[var(--mo-border)]">
                    <td className="py-2 pr-3">{r.menu_item_name}</td>
                    <td className="py-2 pr-3">{r.abc_class}</td>
                    <td className="py-2 pr-3">{r.qty}</td>
                    <td className="py-2 pr-3">{fm(r.revenue)}</td>
                    <td className="py-2 pr-3">{fm(r.cogs)}</td>
                    <td className="py-2 pr-3">{fm(r.gross_profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </div>
  );
}

