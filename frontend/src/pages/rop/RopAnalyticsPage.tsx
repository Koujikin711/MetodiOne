import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import { DateField } from "@/components/DateField";
import { PrintMasthead, PrintSign, printPeriod } from "@/components/PrintMasthead";
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

function formatMinutes(v: number | null | undefined) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const total = Math.max(0, Math.round(Number(v)));
  if (total < 60) return `${total} мин`;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return mins ? `${hours} ч ${mins} мин` : `${hours} ч`;
}

export function RopAnalyticsPage() {
  const { pipelineId } = useRopContext();
  const [from, setFrom] = useState(monthStartYmd);
  const [to, setTo] = useState(todayYmd);
  const [openId, setOpenId] = useState<number | null>(null);

  const query = useQuery({
    queryKey: ["rop-analytics", pipelineId, from, to],
    enabled: pipelineId != null,
    queryFn: () =>
      apiFetch<Analytics>(
        `/api/rop/analytics?pipeline_id=${pipelineId}&from=${from}&to=${to}`,
      ),
  });

  const groups = useMemo(() => {
    const map = new Map<
      number,
      { id: number; name: string; total: number; services: Analytics["revenue_shares"] }
    >();
    for (const row of query.data?.revenue_shares ?? []) {
      const cur = map.get(row.manager_id) ?? {
        id: row.manager_id,
        name: row.manager_name,
        total: 0,
        services: [],
      };
      cur.total += Number(row.amount || 0);
      cur.services.push(row);
      map.set(row.manager_id, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [query.data]);

  if (pipelineId == null) return <p className="text-sm mo-muted">Выберите воронку</p>;

  const data = query.data;

  return (
    <div className="mo-print-doc flex flex-col gap-4">
      <PrintMasthead title="Аналитика отдела продаж" meta={printPeriod(from, to)} />
      <div className="print-screen-only flex flex-wrap items-end gap-3">
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
              {formatMinutes(data?.avg_first_response_minutes)}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm md:w-auto md:min-w-[24rem]">
                <thead className="text-xs mo-muted">
                  <tr>
                    <th className="py-1 pr-8 text-left font-normal">Менеджер</th>
                    <th className="w-20 py-1 text-right font-normal">Лиды</th>
                    <th className="w-28 py-1 pl-4 text-right font-normal">Ответ</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.managers_sla ?? []).map((m) => (
                    <tr key={m.user_id} className="border-t border-[var(--mo-border)]">
                      <td className="py-1">{m.full_name}</td>
                      <td className="py-1 text-right tabular-nums">{m.leads_count}</td>
                      <td className="py-1 text-right tabular-nums">
                        {formatMinutes(m.avg_first_response_minutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--mo-border)] p-4">
            <h3 className="font-medium">Кто сколько принёс</h3>
            <p className="mt-1 text-sm mo-muted">Итого оплат: {money(data?.revenue_total ?? 0)}</p>
            <div className="mt-3 flex flex-col gap-2">
              {groups.map((g) => {
                const open = openId === g.id;
                return (
                  <div key={g.id} className="rounded-lg border border-[var(--mo-border)]">
                    <button
                      type="button"
                      className="print-keep flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm"
                      onClick={() => setOpenId(open ? null : g.id)}
                    >
                      <span className="font-medium">{g.name}</span>
                      <span className="tabular-nums">{money(g.total)}</span>
                    </button>
                    <div className={["flex flex-col gap-2 border-t border-[var(--mo-border)] px-3 py-3", open ? "" : "mo-print-detail"].filter(Boolean).join(" ")}>
                        {g.services
                          .slice()
                          .sort((a, b) => Number(b.amount) - Number(a.amount))
                          .map((s) => {
                            const share = g.total > 0 ? (Number(s.amount) / g.total) * 100 : 0;
                            return (
                              <div key={s.service_name}>
                                <div className="mb-1 flex justify-between text-xs">
                                  <span>{s.service_name}</span>
                                  <span className="tabular-nums">
                                    {money(s.amount)} · {share.toFixed(1)}%
                                  </span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-[var(--mo-surface)]">
                                  <div
                                    className="h-full rounded-full bg-[var(--mo-accent)]"
                                    style={{ width: `${Math.max(share, 2)}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                    </div>
                  </div>
                );
              })}
              {!groups.length && <p className="text-sm mo-muted">Нет оплат за период</p>}
            </div>
          </div>
        </>
      )}
      <PrintSign />
    </div>
  );
}
