import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";

type CohortReport = {
  patients: number;
  avg_paid_ltv: string | number;
  avg_sales_value: string | number;
  repeat_purchase_rate: string | number;
  purchases_per_patient: string | number;
  avg_lifetime_days: string | number;
  ltv_windows: Record<string, string | number>;
  journey: {
    course_15_started: number;
    course_15_completed: number;
    master_class: number;
    branch_main_course: number;
    branch_protocols: number;
  };
  patients_rows: {
    lead_id: number;
    patient_name?: string | null;
    patient_phone?: string | null;
    paid_ltv: string | number;
    sales_value: string | number;
    purchase_count: number;
    outstanding: string | number;
    lifetime_days: number | null;
  }[];
};

function money(v: string | number | undefined): string {
  return formatMoney(Number(v ?? 0), { digits: 0 });
}

function pct(v: string | number | undefined): string {
  return `${(Number(v ?? 0) * 100).toFixed(1)}%`;
}

function defaultMonthRange(): { from: string; to: string } {
  const n = new Date();
  const y = n.getFullYear();
  const m = n.getMonth();
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const last = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

export function AnalyticsPatientsLtvPanel() {
  const qc = useQueryClient();
  const initial = useMemo(() => defaultMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);

  const syncMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/analytics/ltv/sync", { method: "POST" }),
    onSuccess: () => {
      toast.success("Ledger синхронизирован");
      void qc.invalidateQueries({ queryKey: ["analytics-ltv-cohort"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("date_from", dateFrom);
    p.set("date_to", dateTo);
    return p.toString();
  }, [dateFrom, dateTo]);

  const cohortQuery = useQuery({
    queryKey: ["analytics-ltv-cohort", qs],
    queryFn: () => apiFetch<CohortReport>(`/api/analytics/ltv/cohort?${qs}`),
    enabled: Boolean(dateFrom && dateTo),
  });

  const data = cohortQuery.data;

  return (
    <div className="space-y-4">
      <div className="mo-section flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm mo-muted">
          Cohort с (first purchase)
          <input
            type="date"
            className="mo-input mt-1"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="text-sm mo-muted">
          по
          <input
            type="date"
            className="mo-input mt-1"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn-secondary px-3 py-2 text-sm"
          disabled={syncMutation.isPending}
          onClick={() => syncMutation.mutate()}
        >
          Sync ledger
        </button>
        <p className="pb-2 text-xs mo-muted max-w-md">
          Период = когорта по дате первой покупки. Не путать с выручкой месяца. Формулы только на
          backend.
        </p>
      </div>

      {cohortQuery.isLoading ? <p className="lux-caption px-1">Загрузка LTV…</p> : null}
      {cohortQuery.isError ? (
        <p className="text-sm text-red-400">{(cohortQuery.error as Error).message}</p>
      ) : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Пациентов", String(data.patients)],
              ["Avg Paid LTV", money(data.avg_paid_ltv)],
              ["Avg Sales Value", money(data.avg_sales_value)],
              ["Repeat %", pct(data.repeat_purchase_rate)],
              ["Purchases / patient", Number(data.purchases_per_patient).toFixed(2)],
              ["Avg lifetime (дн.)", Number(data.avg_lifetime_days).toFixed(0)],
            ].map(([label, value]) => (
              <div key={label} className="mo-section p-3">
                <div className="text-[11px] mo-muted">{label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </div>

          <div className="mo-section p-4">
            <h3 className="mb-2 text-sm font-semibold">LTV windows (avg paid)</h3>
            <div className="flex flex-wrap gap-3 text-sm">
              {Object.entries(data.ltv_windows ?? {}).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-[var(--mo-border)] px-3 py-2">
                  <span className="mo-muted uppercase">{k}</span>
                  <div className="font-semibold tabular-nums">{money(v)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mo-section p-4">
            <h3 className="mb-2 text-sm font-semibold">Journey (когорта)</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-sm">
              <div>Курс 15 старт: <strong>{data.journey.course_15_started}</strong></div>
              <div>Курс 15 завершён: <strong>{data.journey.course_15_completed}</strong></div>
              <div>Мастер-класс: <strong>{data.journey.master_class}</strong></div>
              <div>Ветка Main: <strong>{data.journey.branch_main_course}</strong></div>
              <div>Ветка Protocols: <strong>{data.journey.branch_protocols}</strong></div>
            </div>
          </div>

          <div className="mo-section overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[var(--mo-border)] text-left text-xs mo-muted">
                  <th className="px-3 py-2">Пациент</th>
                  <th className="px-3 py-2 text-right">Paid LTV</th>
                  <th className="px-3 py-2 text-right">Sales Value</th>
                  <th className="px-3 py-2 text-right">Purchases</th>
                  <th className="px-3 py-2 text-right">Долг</th>
                  <th className="px-3 py-2 text-right">Lifetime</th>
                </tr>
              </thead>
              <tbody>
                {(data.patients_rows ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center mo-muted">
                      Нет пациентов с первой покупкой в когорте. Нажмите Sync ledger.
                    </td>
                  </tr>
                ) : (
                  data.patients_rows.map((r) => (
                    <tr key={r.lead_id} className="border-b border-[var(--mo-border)]/60">
                      <td className="px-3 py-2">
                        <Link
                          to={`/leads/${r.lead_id}`}
                          className="font-medium text-[var(--mo-accent-hover)] hover:underline"
                        >
                          {r.patient_name || `#${r.lead_id}`}
                        </Link>
                        <div className="text-[11px] mo-muted">{r.patient_phone || ""}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.paid_ltv)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.sales_value)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.purchase_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.outstanding)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.lifetime_days ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
