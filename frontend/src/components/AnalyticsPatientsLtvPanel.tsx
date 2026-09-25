import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";

type JourneyReport = {
  course_15_started: number;
  course_15_completed: number;
  course_15_buyers?: number;
  master_class: number;
  master_class_recorded?: number;
  master_class_not_recorded?: number;
  branch_main_course: number;
  branch_protocols: number;
  funnel?: Record<string, number>;
  conversions?: Record<string, number>;
  first_product?: Record<string, number>;
  main_course_origin?: Record<string, number>;
  protocol_origin?: Record<string, number>;
};

type CohortReport = {
  patients: number;
  avg_paid_ltv: string | number;
  avg_sales_value: string | number;
  repeat_purchase_rate: string | number;
  purchases_per_patient: string | number;
  avg_lifetime_days: string | number;
  ltv_windows: Record<string, string | number>;
  journey: JourneyReport;
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

const FUNNEL_LABELS: Record<string, string> = {
  mk_main: "МК зафиксирован → Main",
  mk_protocol: "МК зафиксирован → Protocol",
  mk_both: "МК зафиксирован → Main+Protocol",
  mk_none: "МК зафиксирован → без следующей покупки",
  no_mk_main: "МК не зафиксирован → Main",
  no_mk_protocol: "МК не зафиксирован → Protocol",
  no_mk_both: "МК не зафиксирован → Main+Protocol",
  no_mk_none: "МК не зафиксирован → без следующей покупки",
};

const CONV_LABELS: Record<string, string> = {
  course15_to_main: "Course15 → Main",
  course15_to_protocol: "Course15 → Protocol",
  course15_to_masterclass: "Course15 → МК (recorded)",
  masterclass_to_main: "МК → Main",
  masterclass_to_protocol: "МК → Protocol",
  course15_to_main_without_mk: "Course15 → Main без МК",
  course15_to_protocol_without_mk: "Course15 → Protocol без МК",
};

const ORIGIN_LABELS: Record<string, string> = {
  as_first_product: "как first product",
  after_course15_with_mk: "после Course15 + МК",
  after_course15_mk_not_recorded: "после Course15, МК не зафиксирован",
  without_course15: "без Course15",
  other_previous_path: "другой previous path",
};

const FIRST_PRODUCT_LABELS: Record<string, string> = {
  course_15: "Course15",
  main_course: "Main Course",
  protocol: "Protocol",
  other_service: "Другая услуга",
  visit: "Визит",
  desk: "Desk",
  extra: "Extra",
};

function StatGrid({
  entries,
  labels,
}: {
  entries: Record<string, number> | undefined;
  labels: Record<string, string>;
}) {
  const rows = Object.entries(entries ?? {}).filter(([, v]) => Number(v) > 0);
  if (rows.length === 0) {
    return <p className="text-xs mo-muted">Нет данных в когорте</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 border-b border-[var(--mo-border)]/40 py-1">
          <span className="mo-muted">{labels[k] ?? k}</span>
          <strong className="tabular-nums">{v}</strong>
        </div>
      ))}
    </div>
  );
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
  const j = data?.journey;

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
          Период = когорта по дате первой покупки. LTV по реальным Purchase Events. Course15 / МК —
          program context, не gate.
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
            <h3 className="mb-1 text-sm font-semibold">First Product</h3>
            <p className="mb-2 text-xs mo-muted">По реальной первой valid purchase, без навязанной воронки.</p>
            <StatGrid entries={j?.first_product} labels={FIRST_PRODUCT_LABELS} />
          </div>

          <div className="mo-section p-4">
            <h3 className="mb-1 text-sm font-semibold">Course15 Program Journey</h3>
            <p className="mb-2 text-xs mo-muted">
              Аналитика вариантов. МК — event; «не зафиксирован» ≠ доказанное отсутствие визита.
              Покупка Main/Protocol без МК остаётся в LTV.
            </p>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm">
              <div>
                Course15 buyers: <strong>{j?.course_15_buyers ?? j?.course_15_started ?? 0}</strong>
              </div>
              <div>
                Completed: <strong>{j?.course_15_completed ?? 0}</strong>
              </div>
              <div>
                МК зафиксирован: <strong>{j?.master_class_recorded ?? j?.master_class ?? 0}</strong>
              </div>
              <div>
                МК не зафиксирован: <strong>{j?.master_class_not_recorded ?? 0}</strong>
              </div>
            </div>
            <StatGrid entries={j?.funnel} labels={FUNNEL_LABELS} />
          </div>

          <div className="mo-section p-4">
            <h3 className="mb-1 text-sm font-semibold">Conversions</h3>
            <p className="mb-2 text-xs mo-muted">Метрики путей, не правила допуска к покупке.</p>
            <StatGrid entries={j?.conversions} labels={CONV_LABELS} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="mo-section p-4">
              <h3 className="mb-1 text-sm font-semibold">Main Course — origin</h3>
              <StatGrid entries={j?.main_course_origin} labels={ORIGIN_LABELS} />
            </div>
            <div className="mo-section p-4">
              <h3 className="mb-1 text-sm font-semibold">Protocol — origin</h3>
              <StatGrid entries={j?.protocol_origin} labels={ORIGIN_LABELS} />
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
