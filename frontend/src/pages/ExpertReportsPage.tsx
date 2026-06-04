import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { ExpertReportsResponse } from "@/lib/types";

export function ExpertReportsPage() {
  const [period, setPeriod] = useState<"day" | "week" | "custom">("day");
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
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--mo-text)]">Отчёты</h1>
        <p className="text-sm lux-caption">
          Воронка(и), где вы назначены экспертом. Данные по лидам и онлайн‑записи за период.
        </p>
      </header>

      <section className="mo-section p-4">
        <div className="grid gap-3 md:grid-cols-[200px_170px_170px_1fr]">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as "day" | "week" | "custom")}
            className="mo-input"
          >
            <option value="day">За сегодня</option>
            <option value="week">За неделю</option>
            <option value="custom">За период</option>
          </select>
          <input
            type="date"
            disabled={period !== "custom"}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mo-input disabled:opacity-50"
          />
          <input
            type="date"
            disabled={period !== "custom"}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mo-input disabled:opacity-50"
          />
        </div>
      </section>

      {query.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
      {query.isError && <p className="text-sm text-red-300">{(query.error as Error).message}</p>}

      {(query.data?.items ?? []).map((p) => (
        <section
          key={p.pipeline_id}
          className="mo-section p-5 shadow-inner"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="lux-subheading">{p.pipeline_name}</h2>
            <div className="flex flex-wrap gap-3 text-sm mo-muted">
              <span>
                <span className="mo-muted">Записано:</span> {p.patients_booked}
              </span>
              <span>
                <span className="mo-muted">Пришло:</span> {p.patients_arrived}
              </span>
              <span>
                <span className="mo-muted">Первое обращение:</span> {p.first_visit_patients ?? 0}
              </span>
              <span>
                <span className="mo-muted">Повторное:</span> {p.repeat_patients ?? 0}
              </span>
              <span>
                <span className="mo-muted">Сеансы (сумма):</span> {p.sessions_total ?? 0}
              </span>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-left text-sm text-[var(--mo-text)]">
              <thead>
                <tr className="border-b border-[var(--mo-border)] lux-caption">
                  <th className="py-2 pr-4">Эксперт</th>
                  <th className="py-2 pr-4">Записано</th>
                  <th className="py-2 pr-4">Пришло</th>
                  <th className="py-2 pr-4">Первое обращение</th>
                  <th className="py-2 pr-4">Повторное</th>
                  <th className="py-2 pr-4">Сеансы</th>
                </tr>
              </thead>
              <tbody>
                {(p.experts ?? []).map((x) => (
                  <tr key={x.specialist_id} className="border-b border-[var(--mo-border)]">
                    <td className="py-2 pr-4">
                      {x.specialist_name}
                      {x.specialization ? (
                        <span className="block text-xs mo-muted">{x.specialization}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{x.patients_booked}</td>
                    <td className="py-2 pr-4 tabular-nums">{x.patients_arrived}</td>
                    <td className="py-2 pr-4 tabular-nums font-medium text-emerald-800">
                      {x.first_visit_patients ?? 0}
                    </td>
                    <td className="py-2 pr-4 tabular-nums font-medium text-indigo-800">
                      {x.repeat_patients ?? 0}
                    </td>
                    <td className="py-2 pr-4 tabular-nums font-semibold">{x.sessions_total ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!query.isLoading && (p.experts ?? []).length === 0 && (
              <p className="py-5 text-center text-sm mo-muted">Нет записей за период</p>
            )}
          </div>
        </section>
      ))}

      {!query.isLoading && (query.data?.items ?? []).length === 0 && (
        <p className="text-sm mo-muted">
          У вас нет назначенной воронки эксперта. Владелец должен привязать вас к воронке в настройках.
        </p>
      )}
    </div>
  );
}

