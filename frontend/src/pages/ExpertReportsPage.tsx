import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { ExpertReportsResponse } from "@/lib/types";

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

export function ExpertReportsPage() {
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

  const query = useQuery({
    queryKey: ["reports-expert", qs],
    queryFn: () => apiFetch<ExpertReportsResponse>(`/api/reports/expert?${qs}`),
  });

  return (
    <div className="relative mx-auto max-w-6xl space-y-6 pb-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Отчёты</h1>
        <p className="text-sm text-slate-400">
          Воронка(и), где вы назначены экспертом. Данные по лидам и онлайн‑записи за период.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4">
        <div className="grid gap-3 md:grid-cols-[200px_170px_170px_1fr]">
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
        </div>
      </section>

      {query.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
      {query.isError && <p className="text-sm text-red-300">{(query.error as Error).message}</p>}

      {(query.data?.items ?? []).map((p) => (
        <section
          key={p.pipeline_id}
          className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 shadow-inner"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">{p.pipeline_name}</h2>
            <div className="flex flex-wrap gap-3 text-sm text-slate-300">
              <span>
                <span className="text-slate-500">Лидов пришло:</span> {p.leads_created}
              </span>
              <span>
                <span className="text-slate-500">Открыто менеджерами:</span> {p.leads_opened_by_managers}
              </span>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm text-slate-200">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="py-2 pr-4">Эксперт</th>
                  <th className="py-2 pr-4">Продаж (завершённых записей)</th>
                  <th className="py-2 pr-4">Пациентов пришло</th>
                  <th className="py-2 pr-4">Оплачено</th>
                </tr>
              </thead>
              <tbody>
                {(p.sales_by_expert ?? []).map((x) => (
                  <tr key={x.specialist_id} className="border-b border-slate-800/80">
                    <td className="py-2 pr-4">
                      {x.specialist_name}
                      {x.specialization ? (
                        <span className="block text-xs text-slate-500">{x.specialization}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">{x.appointments_completed}</td>
                    <td className="py-2 pr-4">{x.patients_count}</td>
                    <td className="py-2 pr-4">{moneyFmt.format(Number(x.paid_amount_sum || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!query.isLoading && (p.sales_by_expert ?? []).length === 0 && (
              <p className="py-5 text-center text-sm text-slate-500">Нет завершённых записей за период</p>
            )}
          </div>
        </section>
      ))}

      {!query.isLoading && (query.data?.items ?? []).length === 0 && (
        <p className="text-sm text-slate-500">
          У вас нет назначенной воронки эксперта. Владелец должен привязать вас к воронке в настройках.
        </p>
      )}
    </div>
  );
}

