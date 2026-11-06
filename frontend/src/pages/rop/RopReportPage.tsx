import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { RopPageIntro } from "@/components/RopPageIntro";
import { apiFetch } from "@/lib/api";
import { PrintMasthead, PrintSign, printPeriod } from "@/components/PrintMasthead";
import { useRopContext } from "@/pages/rop/RopLayout";

type ReportRow = {
  manager_id: number;
  manager_name: string;
  service_name: string;
  amount: number | string;
  sold_amount?: number | string;
  paid_amount?: number | string;
  full_paid_amount?: number | string;
  sold_count?: number;
  full_paid_count?: number;
};

type Report = {
  rows: ReportRow[];
  total: number | string;
  sold_total?: number | string;
  full_paid_total?: number | string;
};

function money(v: number | string | undefined) {
  return Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

function num(v: number | string | undefined) {
  return Number(v || 0);
}

function pct(part: number, whole: number) {
  if (whole <= 0) return 0;
  return (part / whole) * 100;
}

function pctText(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function tone(value: number) {
  if (value >= 95) return "up";
  if (value >= 80) return "mid";
  return "down";
}

export function RopReportPage() {
  const { pipelineId, from, to } = useRopContext();
  const [openId, setOpenId] = useState<number | null>(null);

  const query = useQuery({
    queryKey: ["rop-report", pipelineId, from, to],
    enabled: pipelineId != null,
    queryFn: () =>
      apiFetch<Report>(
        `/api/rop/report?pipeline_id=${pipelineId}&from=${from}&to=${to}`,
      ),
  });

  const groups = useMemo(() => {
    const map = new Map<
      number,
      {
        id: number;
        name: string;
        sold: number;
        paid: number;
        fullPaid: number;
        soldCount: number;
        fullCount: number;
        services: ReportRow[];
      }
    >();
    for (const row of query.data?.rows ?? []) {
      const cur = map.get(row.manager_id) ?? {
        id: row.manager_id,
        name: row.manager_name,
        sold: 0,
        paid: 0,
        fullPaid: 0,
        soldCount: 0,
        fullCount: 0,
        services: [],
      };
      cur.sold += num(row.sold_amount ?? row.amount);
      cur.paid += num(row.paid_amount ?? row.amount);
      cur.fullPaid += num(row.full_paid_amount);
      cur.soldCount += row.sold_count ?? 0;
      cur.fullCount += row.full_paid_count ?? 0;
      cur.services.push(row);
      map.set(row.manager_id, cur);
    }
    return [...map.values()].sort((a, b) => b.sold - a.sold);
  }, [query.data]);

  if (pipelineId == null) return <p className="text-sm mo-muted">Выберите воронку</p>;

  const soldTotal = num(query.data?.sold_total);
  const paidTotal = num(query.data?.total);
  const fullTotal = num(query.data?.full_paid_total);
  const conv = pct(fullTotal, soldTotal);

  return (
    <div className="mo-print-doc rop-dense flex flex-col gap-3">
      <PrintMasthead title="Отчёт отдела продаж" meta={printPeriod(from, to)} />
      <RopPageIntro title="Отчёт" hint="Сколько продали и сколько из этого закрыли полностью." />

      <section className="rop-report" aria-label="Выручка отдела">
        <div className="rop-report__totals">
          <article>
            <span>Продали</span>
            <strong>{money(soldTotal)}</strong>
          </article>
          <article>
            <span>Оплатили</span>
            <strong>{money(paidTotal)}</strong>
          </article>
          <article>
            <span>Полностью</span>
            <strong>{money(fullTotal)}</strong>
          </article>
          <article className={`rop-report__conv rop-report__conv--${tone(conv)}`}>
            <span>Закрыто</span>
            <strong>{pctText(conv)}</strong>
          </article>
        </div>

        {query.isLoading ? (
          <p className="rop-report__empty">Загрузка…</p>
        ) : (
          <div className="rop-report__people">
            {groups.map((g) => {
              const open = openId === g.id;
              const gConv = pct(g.fullPaid, g.sold);
              const bar = Math.max(0, Math.min(100, gConv));
              return (
                <article key={g.id} className="rop-report-person">
                  <button
                    type="button"
                    className="print-keep rop-report-person__head"
                    onClick={() => setOpenId(open ? null : g.id)}
                    aria-expanded={open}
                  >
                    <span className="rop-report-person__who">
                      <span className={`rop-report-person__mark rop-report__conv--${tone(gConv)}`}>
                        {(g.name.trim()[0] || "·").toUpperCase()}
                      </span>
                      <span>
                        <strong>{g.name}</strong>
                        <em>
                          {g.soldCount > 0
                            ? `${g.fullCount} из ${g.soldCount} визитов`
                            : "без визитов"}
                        </em>
                      </span>
                    </span>
                    <span className={`rop-report-person__pct rop-report__conv--${tone(gConv)}`}>
                      {pctText(gConv)}
                    </span>
                  </button>
                  <div className="rop-report-person__bar" aria-hidden>
                    <i className={`rop-report__conv--${tone(gConv)}`} style={{ width: `${bar}%` }} />
                  </div>
                  <div className="rop-report-person__nums">
                    <div>
                      <span>Продали</span>
                      <strong>{money(g.sold)}</strong>
                    </div>
                    <div>
                      <span>Оплатили</span>
                      <strong>{money(g.paid)}</strong>
                    </div>
                    <div>
                      <span>Полностью</span>
                      <strong>{money(g.fullPaid)}</strong>
                    </div>
                  </div>
                  <div className={open ? "rop-report-person__services" : "mo-print-detail rop-report-person__services"}>
                    <table>
                      <thead>
                        <tr>
                          <th>Услуга</th>
                          <th>Продали</th>
                          <th>Оплатили</th>
                          <th>Полностью</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.services
                          .slice()
                          .sort((a, b) => num(b.sold_amount ?? b.amount) - num(a.sold_amount ?? a.amount))
                          .map((s) => (
                            <tr key={s.service_name}>
                              <td>{s.service_name}</td>
                              <td>{money(s.sold_amount ?? s.amount)}</td>
                              <td>{money(s.paid_amount ?? s.amount)}</td>
                              <td>{money(s.full_paid_amount)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              );
            })}
            {!groups.length && <p className="rop-report__empty">Нет продаж за период</p>}
          </div>
        )}
      </section>
      <PrintSign />
    </div>
  );
}
