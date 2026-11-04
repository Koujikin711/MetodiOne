import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { RopPageIntro } from "@/components/RopPageIntro";
import { apiFetch } from "@/lib/api";
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
  const { pipelineId, from, to } = useRopContext();
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
    const totalAll = Number(query.data?.revenue_total || 0);
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
    return [...map.values()]
      .sort((a, b) => b.total - a.total)
      .map((g) => ({
        ...g,
        share: totalAll > 0 ? (g.total / totalAll) * 100 : 0,
      }));
  }, [query.data]);

  if (pipelineId == null) return <p className="text-sm mo-muted">Выберите воронку</p>;

  const data = query.data;

  return (
    <div className="mo-print-doc rop-dense flex flex-col gap-3">
      <PrintMasthead title="Аналитика отдела продаж" meta={printPeriod(from, to)} />
      <RopPageIntro
        title="Аналитика"
        hint="Первый ответ и выручка по менеджерам за период в шапке."
      />

      {query.isLoading ? (
        <p className="text-sm mo-muted">Загрузка…</p>
      ) : (
        <div className="rop-analytics-grid">
          <section className="rop-panel">
            <div className="rop-panel__head">
              <h3 className="rop-panel__title">Первый ответ</h3>
              <strong className="rop-panel__hero tabular-nums">
                {formatMinutes(data?.avg_first_response_minutes)}
              </strong>
            </div>
            <table className="rop-dense-table">
              <thead>
                <tr>
                  <th>Менеджер</th>
                  <th className="text-right">Лиды</th>
                  <th className="text-right">Ответ</th>
                </tr>
              </thead>
              <tbody>
                {(data?.managers_sla ?? []).map((m) => (
                  <tr key={m.user_id}>
                    <td>{m.full_name}</td>
                    <td className="text-right tabular-nums">{m.leads_count}</td>
                    <td className="text-right tabular-nums">
                      {formatMinutes(m.avg_first_response_minutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rop-panel">
            <div className="rop-panel__head">
              <h3 className="rop-panel__title">Выручка</h3>
              <span className="rop-panel__meta">всего {money(data?.revenue_total ?? 0)}</span>
            </div>
            <div className="rop-rev-list">
              {groups.map((g) => {
                const open = openId === g.id;
                return (
                  <div key={g.id} className="rop-rev-row">
                    <button
                      type="button"
                      className="rop-rev-row__btn print-keep"
                      onClick={() => setOpenId(open ? null : g.id)}
                    >
                      <span className="rop-rev-row__name">{g.name}</span>
                      <span className="rop-rev-row__amt tabular-nums">{money(g.total)}</span>
                      <span className="rop-rev-row__bar" aria-hidden>
                        <i style={{ width: `${Math.max(g.share, 3)}%` }} />
                      </span>
                    </button>
                    <div
                      className={[
                        "rop-rev-row__detail",
                        open ? "is-open" : "mo-print-detail",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {g.services
                        .slice()
                        .sort((a, b) => Number(b.amount) - Number(a.amount))
                        .map((s) => {
                          const share = g.total > 0 ? (Number(s.amount) / g.total) * 100 : 0;
                          return (
                            <div key={s.service_name} className="rop-rev-svc">
                              <span>{s.service_name}</span>
                              <span className="tabular-nums">
                                {money(s.amount)} · {share.toFixed(0)}%
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                );
              })}
              {!groups.length && <p className="text-sm mo-muted">Нет оплат за период</p>}
            </div>
          </section>
        </div>
      )}
      <PrintSign />
    </div>
  );
}
