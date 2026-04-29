import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { HorecaStockBalance, HorecaStockMovement } from "@/lib/types";

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

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / Склад и списания</p>
        <h1 className="text-3xl font-semibold text-white">Склад и списания</h1>
      </header>

      {(balances.isLoading || movements.isLoading) && <p className="text-sm text-slate-400">Загрузка склада…</p>}
      {balances.isError ? <p className="text-sm text-rose-300">{(balances.error as Error).message}</p> : null}
      {movements.isError ? <p className="text-sm text-rose-300">{(movements.error as Error).message}</p> : null}

      <section className="overflow-x-auto rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
        <h2 className="mb-2 text-base font-semibold text-white">Остатки</h2>
        <table className="w-full min-w-[740px] text-left text-sm text-slate-200">
          <thead className="text-slate-400">
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
              <tr key={r.product_id} className="border-t border-slate-800">
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

      <section className="overflow-x-auto rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
        <h2 className="mb-2 text-base font-semibold text-white">Движения</h2>
        <table className="w-full min-w-[840px] text-left text-sm text-slate-200">
          <thead className="text-slate-400">
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
              <tr key={m.id} className="border-t border-slate-800">
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
