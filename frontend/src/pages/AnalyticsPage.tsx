import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { DetailedAnalyticsRead, FullAnalyticsRead } from "@/lib/types";

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const esc = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
  const csv = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AnalyticsPage() {
  const [mode, setMode] = useState<"full" | "detailed">("full");
  const [period, setPeriod] = useState<"day" | "month" | "custom">("day");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("period", period);
    if (period === "custom") {
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
    }
    return p.toString();
  }, [period, dateFrom, dateTo]);

  const fullQuery = useQuery({
    queryKey: ["analytics-full", qs],
    queryFn: () => apiFetch<FullAnalyticsRead>(`/api/analytics/full?${qs}`),
  });

  const detailedQuery = useQuery({
    queryKey: ["analytics-detailed", qs],
    queryFn: () => apiFetch<DetailedAnalyticsRead>(`/api/analytics/detailed?${qs}`),
  });

  return (
    <div className="relative mx-auto max-w-6xl space-y-6 pb-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Аналитика</h1>
        <p className="text-sm text-slate-400">
          Полная — по воронкам. Детальная — по менеджерам. Доступно только владельцу компании.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4">
        <div className="grid gap-3 md:grid-cols-[170px_170px_1fr_1fr_auto]">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "full" | "detailed")}
            className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
          >
            <option value="full">Полная</option>
            <option value="detailed">Детальная</option>
          </select>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as "day" | "month" | "custom")}
            className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
          >
            <option value="day">За день</option>
            <option value="month">За месяц</option>
            <option value="custom">За период</option>
          </select>
          <input
            type="date"
            disabled={period !== "custom"}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white disabled:opacity-50"
          />
          <input
            type="date"
            disabled={period !== "custom"}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => {
              if (mode === "full" && fullQuery.data) {
                downloadCsv(
                  "analytics_full.csv",
                  ["Воронка", "Лидов", "Обработано менеджером", "Получено", "Дебиторка"],
                  fullQuery.data.by_pipeline.map((r) => [
                    r.pipeline_name,
                    r.leads_count,
                    r.processed_by_manager_count,
                    Number(r.received_amount),
                    Number(r.debt_amount),
                  ]),
                );
              }
              if (mode === "detailed" && detailedQuery.data) {
                downloadCsv(
                  "analytics_detailed.csv",
                  ["Менеджер", "Лидов", "Продано", "Не оплачено"],
                  detailedQuery.data.by_manager.map((r) => [
                    r.manager_name,
                    r.leads_count,
                    Number(r.sold_amount),
                    Number(r.unpaid_amount),
                  ]),
                );
              }
            }}
            className="rounded-xl border border-slate-600/50 bg-slate-900/60 px-4 py-2 text-sm text-white hover:bg-slate-800"
          >
            Экспорт CSV
          </button>
        </div>
      </section>

      {mode === "full" && (
        <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4">
          {fullQuery.isError && <p className="text-sm text-red-300">{(fullQuery.error as Error).message}</p>}
          {fullQuery.isLoading && <p className="text-sm text-slate-400">Загрузка...</p>}
          {fullQuery.data && (
            <>
              <div className="mb-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-900/40 p-3 text-sm text-slate-200">
                  Лиды: <b>{fullQuery.data.total_leads}</b>
                </div>
                <div className="rounded-xl bg-slate-900/40 p-3 text-sm text-slate-200">
                  Получено: <b>{moneyFmt.format(Number(fullQuery.data.total_received_amount))}</b>
                </div>
                <div className="rounded-xl bg-slate-900/40 p-3 text-sm text-slate-200">
                  Дебиторка: <b>{moneyFmt.format(Number(fullQuery.data.total_debt_amount))}</b>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm text-slate-200">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="py-2 pr-4">Воронка</th>
                      <th className="py-2 pr-4">Лидов</th>
                      <th className="py-2 pr-4">Обработано менеджером</th>
                      <th className="py-2 pr-4">Получено</th>
                      <th className="py-2 pr-4">Дебиторка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullQuery.data.by_pipeline.map((r) => (
                      <tr key={`${r.pipeline_id ?? "none"}-${r.pipeline_name}`} className="border-t border-slate-800">
                        <td className="py-2 pr-4">{r.pipeline_name}</td>
                        <td className="py-2 pr-4">{r.leads_count}</td>
                        <td className="py-2 pr-4">{r.processed_by_manager_count}</td>
                        <td className="py-2 pr-4">{moneyFmt.format(Number(r.received_amount))}</td>
                        <td className="py-2 pr-4">{moneyFmt.format(Number(r.debt_amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {mode === "detailed" && (
        <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4">
          {detailedQuery.isError && <p className="text-sm text-red-300">{(detailedQuery.error as Error).message}</p>}
          {detailedQuery.isLoading && <p className="text-sm text-slate-400">Загрузка...</p>}
          {detailedQuery.data && (
            <>
              <div className="mb-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-900/40 p-3 text-sm text-slate-200">
                  Лиды: <b>{detailedQuery.data.total_leads}</b>
                </div>
                <div className="rounded-xl bg-slate-900/40 p-3 text-sm text-slate-200">
                  Продано: <b>{moneyFmt.format(Number(detailedQuery.data.total_sold_amount))}</b>
                </div>
                <div className="rounded-xl bg-slate-900/40 p-3 text-sm text-slate-200">
                  Не оплачено: <b>{moneyFmt.format(Number(detailedQuery.data.total_unpaid_amount))}</b>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm text-slate-200">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="py-2 pr-4">Менеджер</th>
                      <th className="py-2 pr-4">Лидов</th>
                      <th className="py-2 pr-4">Продано</th>
                      <th className="py-2 pr-4">Не оплачено</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailedQuery.data.by_manager.map((r) => (
                      <tr key={`${r.manager_id ?? "none"}-${r.manager_name}`} className="border-t border-slate-800">
                        <td className="py-2 pr-4">{r.manager_name}</td>
                        <td className="py-2 pr-4">{r.leads_count}</td>
                        <td className="py-2 pr-4">{moneyFmt.format(Number(r.sold_amount))}</td>
                        <td className="py-2 pr-4">{moneyFmt.format(Number(r.unpaid_amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
