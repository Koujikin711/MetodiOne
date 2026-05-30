import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { HorecaStockAlert, HorecaStockBalance, HorecaStockMovement, HorecaStockReportRead } from "@/lib/types";

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export function HorecaStockPage() {
  const balances = useQuery({
    queryKey: ["horeca-stock-balances"],
    queryFn: () => apiFetch<HorecaStockBalance[]>("/api/horeca/stock/balances"),
    refetchInterval: 30_000,
  });
  const movements = useQuery({
    queryKey: ["horeca-stock-movements"],
    queryFn: () => apiFetch<HorecaStockMovement[]>("/api/horeca/stock/movements?limit=80"),
    refetchInterval: 20_000,
  });
  const alerts = useQuery({
    queryKey: ["horeca-stock-alerts"],
    queryFn: () => apiFetch<HorecaStockAlert[]>("/api/horeca/stock/alerts"),
    refetchInterval: 20_000,
  });
  const report = useQuery({
    queryKey: ["horeca-stock-report"],
    queryFn: () => apiFetch<HorecaStockReportRead>("/api/horeca/stock/report?days=14"),
    refetchInterval: 60_000,
  });

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / Склад и списания</p>
        <h1 className="lux-heading-page">Склад и списания</h1>
      </header>

      {(balances.isLoading || movements.isLoading) && <p className="text-sm lux-caption">Загрузка склада…</p>}
      {balances.isError ? <p className="text-sm text-[#6b1d2f]">{(balances.error as Error).message}</p> : null}
      {movements.isError ? <p className="text-sm text-[#6b1d2f]">{(movements.error as Error).message}</p> : null}
      {alerts.isError ? <p className="text-sm text-[#6b1d2f]">{(alerts.error as Error).message}</p> : null}

      <section className="grid gap-3 lg:grid-cols-2">
        <article className="rounded-2xl border border-amber-500/35 bg-amber-950/20 p-4">
          <h2 className="mb-2 lux-subheading">Алерты кухни: заканчиваются продукты</h2>
          <div className="space-y-2">
            {(alerts.data ?? []).slice(0, 8).map((a) => (
              <div key={a.product_id} className="flex items-center justify-between rounded-lg border border-[var(--mo-border)] px-3 py-2 text-sm">
                <span>{a.product_name}</span>
                <span className="text-amber-200">{a.quantity}</span>
              </div>
            ))}
            {!alerts.isLoading && (alerts.data?.length ?? 0) === 0 ? <p className="text-sm lux-caption">Критических остатков нет.</p> : null}
          </div>
        </article>
        <article className="rounded-2xl mo-section p-4">
          <h2 className="mb-2 lux-subheading">Авто-отчет списаний (14 дней)</h2>
          <p className="text-sm mo-muted">Итого списано по себестоимости: <span className="font-semibold text-[var(--mo-text)]">{report.data?.total_issue_value ?? "0"}</span></p>
          <div className="mt-2 space-y-1 text-sm lux-caption">
            {(report.data?.lines ?? []).slice(0, 5).map((line) => (
              <p key={line.product_id}>{line.product_name}: {line.issue_qty} / {line.issue_value}</p>
            ))}
          </div>
        </article>
      </section>

      <section className="overflow-x-auto rounded-2xl mo-section p-4">
        <h2 className="mb-2 lux-subheading">Остатки</h2>
        <table className="w-full min-w-[740px] text-left text-sm text-[var(--mo-text)]">
          <thead className="lux-caption">
            <tr>
              <th className="py-2 pr-3">Продукт</th>
              <th className="py-2 pr-3">Остаток</th>
              <th className="py-2 pr-3">Себестоимость</th>
              <th className="py-2 pr-3">Стоимость</th>
              <th className="py-2 pr-3">Риск</th>
            </tr>
          </thead>
          <tbody>
            {(balances.data ?? []).map((r) => (
              <tr key={r.product_id} className="border-t border-[var(--mo-border)]">
                <td className="py-2 pr-3">{r.product_name}</td>
                <td className="py-2 pr-3">{r.quantity}</td>
                <td className="py-2 pr-3">{r.avg_unit_cost}</td>
                <td className="py-2 pr-3">{r.stock_value}</td>
                <td className="py-2 pr-3">{r.risk}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="overflow-x-auto rounded-2xl mo-section p-4">
        <h2 className="mb-2 lux-subheading">Движения</h2>
        <table className="w-full min-w-[840px] text-left text-sm text-[var(--mo-text)]">
          <thead className="lux-caption">
            <tr>
              <th className="py-2 pr-3">Время</th>
              <th className="py-2 pr-3">Тип</th>
              <th className="py-2 pr-3">Продукт</th>
              <th className="py-2 pr-3">Кол-во</th>
              <th className="py-2 pr-3">Комментарий</th>
            </tr>
          </thead>
          <tbody>
            {(movements.data ?? []).map((m) => (
              <tr key={m.id} className="border-t border-[var(--mo-border)]">
                <td className="py-2 pr-3">{fmt(m.created_at)}</td>
                <td className="py-2 pr-3">{m.movement_type}</td>
                <td className="py-2 pr-3">{m.product_name}</td>
                <td className="py-2 pr-3">{m.qty_delta}</td>
                <td className="py-2 pr-3">{m.memo || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
