import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { MonthYearPicker } from "@/components/MonthYearPicker";
import { PageHeader } from "@/components/ui/PageHeader";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import type { SalesKpiCompanyReport, SalesKpiPipelineMeta } from "@/lib/types";

function defaultYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Финансы для бухгалтера — отчёт компании (KPI company-report). */
export function AccountantCompanyFinance() {
  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  const [pipelineId, setPipelineId] = useState<number | null>(null);

  const pipelinesQuery = useQuery({
    queryKey: ["sales-kpi-pipelines"],
    queryFn: () => apiFetch<SalesKpiPipelineMeta[]>("/api/sales-kpi/pipelines"),
  });

  useEffect(() => {
    const list = pipelinesQuery.data ?? [];
    if (!list.length) return;
    if (pipelineId == null || !list.some((x) => x.id === pipelineId)) {
      setPipelineId(list[0].id);
    }
  }, [pipelinesQuery.data, pipelineId]);

  const qs = useMemo(() => {
    if (!pipelineId) return "";
    const p = new URLSearchParams();
    p.set("pipeline_id", String(pipelineId));
    p.set("year_month", yearMonth);
    return p.toString();
  }, [pipelineId, yearMonth]);

  const companyQuery = useQuery({
    queryKey: ["sales-kpi-company-report", qs],
    queryFn: () =>
      apiFetch<SalesKpiCompanyReport>(`/api/sales-kpi/company-report?${qs}`, {
        timeoutMs: 60_000,
      }),
    enabled: Boolean(qs),
  });

  const data = companyQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Финансы"
        description="Выручка клиники = оплаты по визитам за месяц. Курсы KPI в сумму не плюсуются (иначе двойной счёт). Расходы — отдельно."
        actions={
          <Link to="/expenses" className="mo-btn-primary rounded-xl px-3 py-2 text-sm">
            Расходы
          </Link>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm mo-muted">
          Воронка
          <select
            className="mo-input mt-1 block min-w-[12rem]"
            value={pipelineId ?? ""}
            onChange={(e) => setPipelineId(Number(e.target.value) || null)}
          >
            {(pipelinesQuery.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <MonthYearPicker value={yearMonth} onChange={setYearMonth} />
      </div>

      {companyQuery.isLoading ? <p className="text-sm mo-muted">Загрузка…</p> : null}
      {companyQuery.isError ? (
        <p className="text-sm text-red-400">{(companyQuery.error as Error).message}</p>
      ) : null}

      {data ? (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-[var(--mo-border)] p-4">
              <div className="text-xs mo-muted">Выручка (визиты)</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {formatMoney(data.revenue_total, { digits: 0 })}
              </div>
              {Number(data.revenue_manual) > 0 ? (
                <div className="mt-1 text-[11px] mo-muted">
                  курсы KPI {formatMoney(data.revenue_manual, { digits: 0 })} (не в сумме)
                </div>
              ) : null}
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] p-4">
              <div className="text-xs mo-muted">Дебиторка (запись)</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {formatMoney(data.debtor_booking, { digits: 0 })}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] p-4">
              <div className="text-xs mo-muted">Дебиторка (курсы)</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {formatMoney(data.debtor_manual, { digits: 0 })}
              </div>
            </div>
          </div>

          <section className="overflow-hidden rounded-2xl border border-[var(--mo-border)]">
            <div className="border-b border-[var(--mo-border)] px-4 py-3 text-sm font-semibold">
              По услугам
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--mo-surface)]/70 text-xs mo-muted">
                  <tr>
                    <th className="px-3 py-2">Услуга</th>
                    <th className="px-3 py-2">Оплачено</th>
                    <th className="px-3 py-2">Долг</th>
                    <th className="px-3 py-2">Визиты</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.service_stats ?? []).map((row) => (
                    <tr key={`${row.direction_id ?? row.direction_name}`} className="border-t border-[var(--mo-border)]/60">
                      <td className="px-3 py-2">{row.direction_name}</td>
                      <td className="px-3 py-2 tabular-nums">{formatMoney(row.revenue_paid, { digits: 0 })}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatMoney(row.debtor_amount, { digits: 0 })}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{row.appointments_total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
