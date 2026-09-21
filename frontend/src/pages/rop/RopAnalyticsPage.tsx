import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch } from "@/lib/api";
import { DateField } from "@/components/DateField";
import { useRopContext } from "@/pages/rop/RopLayout";

type Analytics = {
  avg_first_response_minutes: number | null;
  managers_sla: {
    user_id: number;
    full_name: string;
    avg_first_response_minutes: number | null;
    leads_count: number;
  }[];
  revenue_shares: {
    manager_id: number;
    manager_name: string;
    service_name: string;
    amount: number | string;
    percent_of_total: number;
  }[];
  revenue_total: number | string;
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function money(v: number | string) {
  return Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

export function RopAnalyticsPage() {
  const { pipelineId } = useRopContext();
  const [from, setFrom] = useState(monthStartYmd);
  const [to, setTo] = useState(todayYmd);

  const query = useQuery({
    queryKey: ["rop-analytics", pipelineId, from, to],
    enabled: pipelineId != null,
    queryFn: () =>
      apiFetch<Analytics>(
        `/api/rop/analytics?pipeline_id=${pipelineId}&from=${from}&to=${to}`,
      ),
  });

  if (pipelineId == null) return <p className="text-sm mo-muted">Выберите воронку</p>;

  const data = query.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <label className="text-sm mo-muted">
          С
          <DateField value={from} onChange={setFrom} className="mo-input mt-1" />
        </label>
        <label className="text-sm mo-muted">
          По
          <DateField value={to} onChange={setTo} className="mo-input mt-1" />
        </label>
      </div>

      {query.isLoading ? (
        <p className="text-sm mo-muted">Загрузка…</p>
      ) : (
        <>
          <div className="rounded-xl border border-[var(--mo-border)] p-4">
            <h3 className="font-medium">Среднее время ответа</h3>
            <p className="mt-1 text-2xl tabular-nums">
              {data?.avg_first_response_minutes != null
                ? `${data.avg_first_response_minutes} мин`
                : "—"}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs mo-muted">
                  <tr>
                    <th className="py-1 text-left">Менеджер</th>
                    <th className="py-1 text-right">Лиды</th>
                    <th className="py-1 text-right">Ответ, мин</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.managers_sla ?? []).map((m) => (
                    <tr key={m.user_id} className="border-t border-[var(--mo-border)]">
                      <td className="py-1">{m.full_name}</td>
                      <td className="py-1 text-right tabular-nums">{m.leads_count}</td>
                      <td className="py-1 text-right tabular-nums">
                        {m.avg_first_response_minutes ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--mo-border)] p-4">
            <h3 className="font-medium">Доля выручки по услугам</h3>
            <p className="mt-1 text-sm mo-muted">Итого: {money(data?.revenue_total ?? 0)}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-xs mo-muted">
                  <tr>
                    <th className="py-1 text-left">Менеджер</th>
                    <th className="py-1 text-left">Услуга</th>
                    <th className="py-1 text-right">Сумма</th>
                    <th className="py-1 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.revenue_shares ?? []).map((r, i) => (
                    <tr key={`${r.manager_id}-${r.service_name}-${i}`} className="border-t border-[var(--mo-border)]">
                      <td className="py-1">{r.manager_name}</td>
                      <td className="py-1">{r.service_name}</td>
                      <td className="py-1 text-right tabular-nums">{money(r.amount)}</td>
                      <td className="py-1 text-right tabular-nums">{r.percent_of_total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
