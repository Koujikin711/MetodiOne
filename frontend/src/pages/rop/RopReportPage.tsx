import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import { DateField } from "@/components/DateField";
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

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function money(v: number | string | undefined) {
  return Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

function num(v: number | string | undefined) {
  return Number(v || 0);
}

export function RopReportPage() {
  const { pipelineId } = useRopContext();
  const [from, setFrom] = useState(monthStartYmd);
  const [to, setTo] = useState(todayYmd);
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
  const conv = soldTotal > 0 ? (fullTotal / soldTotal) * 100 : 0;

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

      <div className="rounded-xl border border-[var(--mo-border)] p-4">
        <h3 className="font-medium">Выручка отдела продаж</h3>
        <p className="mt-2 text-sm mo-muted">
          KPI «Факт» — это число визитов, оплаченных на 100%. Здесь суммы: продали (цена услуги)
          и полностью оплатили. Конверсия = полностью оплачено / продано.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span>
            Продали <strong className="tabular-nums">{money(soldTotal)}</strong>
          </span>
          <span>
            Оплатили <strong className="tabular-nums">{money(paidTotal)}</strong>
          </span>
          <span>
            Полностью <strong className="tabular-nums">{money(fullTotal)}</strong>
          </span>
          <span>
            Конверсия <strong className="tabular-nums">{conv.toFixed(1)}%</strong>
          </span>
        </div>
        {query.isLoading ? (
          <p className="mt-3 text-sm mo-muted">Загрузка…</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {groups.map((g) => {
              const open = openId === g.id;
              const gConv = g.sold > 0 ? (g.fullPaid / g.sold) * 100 : 0;
              return (
                <div key={g.id} className="rounded-lg border border-[var(--mo-border)]">
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1 px-3 py-2 text-left text-sm sm:flex-row sm:items-center sm:justify-between"
                    onClick={() => setOpenId(open ? null : g.id)}
                  >
                    <span className="font-medium">{g.name}</span>
                    <span className="tabular-nums mo-muted">
                      продали {money(g.sold)} · полностью {money(g.fullPaid)} · {gConv.toFixed(1)}%
                      {g.soldCount > 0 ? ` · визиты ${g.fullCount}/${g.soldCount}` : ""}
                    </span>
                  </button>
                  {open && (
                    <table className="w-full border-t border-[var(--mo-border)] text-sm">
                      <thead className="text-xs mo-muted">
                        <tr>
                          <th className="px-3 py-1 text-left">Услуга</th>
                          <th className="px-3 py-1 text-right">Продали</th>
                          <th className="px-3 py-1 text-right">Оплатили</th>
                          <th className="px-3 py-1 text-right">Полностью</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.services
                          .slice()
                          .sort((a, b) => num(b.sold_amount ?? b.amount) - num(a.sold_amount ?? a.amount))
                          .map((s) => (
                            <tr key={s.service_name} className="border-t border-[var(--mo-border)]">
                              <td className="px-3 py-1">{s.service_name}</td>
                              <td className="px-3 py-1 text-right tabular-nums">
                                {money(s.sold_amount ?? s.amount)}
                              </td>
                              <td className="px-3 py-1 text-right tabular-nums">
                                {money(s.paid_amount ?? s.amount)}
                              </td>
                              <td className="px-3 py-1 text-right tabular-nums">
                                {money(s.full_paid_amount)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
            {!groups.length && <p className="text-sm mo-muted">Нет продаж за период</p>}
          </div>
        )}
      </div>
    </div>
  );
}
