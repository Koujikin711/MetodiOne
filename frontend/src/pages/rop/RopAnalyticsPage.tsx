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

function initial(name: string) {
  return (name.trim()[0] || "·").toUpperCase();
}

function replyTone(minutes: number | null | undefined) {
  if (minutes == null || Number.isNaN(Number(minutes))) return "mid";
  if (minutes <= 120) return "up";
  if (minutes <= 24 * 60) return "mid";
  return "down";
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
  const replyTimes = (data?.managers_sla ?? [])
    .map((row) => row.avg_first_response_minutes)
    .filter((value): value is number => value != null && value > 0);
  const slowestReply = replyTimes.length ? Math.max(...replyTimes) : 0;

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
          <section className="rop-analytics-col" aria-label="Первый ответ">
            <article className="rop-analytics-hero">
              <span>Первый ответ</span>
              <strong>{formatMinutes(data?.avg_first_response_minutes)}</strong>
              <em>среднее по отделу</em>
            </article>
            <div className="rop-report__people">
              {(data?.managers_sla ?? []).map((manager) => {
                const tone = replyTone(manager.avg_first_response_minutes);
                const minutes = manager.avg_first_response_minutes;
                const bar =
                  minutes != null && minutes > 0 && slowestReply > 0
                    ? Math.max(8, Math.min(100, (minutes / slowestReply) * 100))
                    : 8;
                return (
                  <article key={manager.user_id} className="rop-report-person">
                    <div className="rop-report-person__head">
                      <span className="rop-report-person__who">
                        <span className={`rop-report-person__mark rop-report__conv--${tone}`}>
                          {initial(manager.full_name)}
                        </span>
                        <span>
                          <strong>{manager.full_name}</strong>
                          <em>{manager.leads_count.toLocaleString("ru-RU")} лид.</em>
                        </span>
                      </span>
                      <span className={`rop-report-person__pct rop-report__conv--${tone}`}>
                        {formatMinutes(minutes)}
                      </span>
                    </div>
                    <div className="rop-report-person__bar" aria-hidden>
                      <i className={`rop-report__conv--${tone}`} style={{ width: `${bar}%` }} />
                    </div>
                  </article>
                );
              })}
              {!data?.managers_sla?.length && <p className="rop-report__empty">Нет ответов за период</p>}
            </div>
          </section>

          <section className="rop-analytics-col" aria-label="Выручка">
            <article className="rop-analytics-hero">
              <span>Выручка</span>
              <strong>{money(data?.revenue_total ?? 0)}</strong>
              <em>всего за период</em>
            </article>
            <div className="rop-report__people">
              {groups.map((group) => {
                const open = openId === group.id;
                return (
                  <article key={group.id} className="rop-report-person">
                    <button
                      type="button"
                      className="print-keep rop-report-person__head"
                      onClick={() => setOpenId(open ? null : group.id)}
                      aria-expanded={open}
                    >
                      <span className="rop-report-person__who">
                        <span className="rop-report-person__mark rop-report__conv--mid">
                          {initial(group.name)}
                        </span>
                        <span>
                          <strong>{group.name}</strong>
                          <em>{Math.round(group.share)}% выручки</em>
                        </span>
                      </span>
                      <span className="rop-report-person__pct">{money(group.total)}</span>
                    </button>
                    <div className="rop-report-person__bar" aria-hidden>
                      <i className="rop-report__conv--mid" style={{ width: `${Math.max(group.share, 4)}%` }} />
                    </div>
                    <div className={open ? "rop-report-person__services" : "mo-print-detail rop-report-person__services"}>
                      <table>
                        <thead>
                          <tr>
                            <th>Услуга</th>
                            <th>Сумма</th>
                            <th>Доля</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.services
                            .slice()
                            .sort((a, b) => Number(b.amount) - Number(a.amount))
                            .map((service) => {
                              const share = group.total > 0 ? (Number(service.amount) / group.total) * 100 : 0;
                              return (
                                <tr key={service.service_name}>
                                  <td>{service.service_name}</td>
                                  <td>{money(service.amount)}</td>
                                  <td>{share.toFixed(0)}%</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </article>
                );
              })}
              {!groups.length && <p className="rop-report__empty">Нет оплат за период</p>}
            </div>
          </section>
        </div>
      )}
      <PrintSign />
    </div>
  );
}
