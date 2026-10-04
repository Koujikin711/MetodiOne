import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { DateField } from "@/components/DateField";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";

type CohortReport = {
  patients: number;
  avg_paid_ltv: string | number;
  repeat_purchase_rate: string | number;
  ltv_windows: Record<string, string | number>;
};

function money(v: string | number | undefined): string {
  return formatMoney(Number(v ?? 0), { digits: 0 });
}

function pct(v: string | number | undefined): string {
  return `${(Number(v ?? 0) * 100).toFixed(1)}%`;
}

function defaultMonthRange(): { from: string; to: string } {
  const n = new Date();
  const prev = new Date(n.getFullYear(), n.getMonth() - 1, 1);
  const y = prev.getFullYear();
  const m = prev.getMonth();
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const last = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

const LTV_WINDOW_STORY: { key: string; title: string; hint: string }[] = [
  { key: "d30", title: "30 дней", hint: "Касса с первого дня по конец месяца" },
  { key: "d90", title: "90 дней", hint: "Всё, что оплатили за три месяца" },
  { key: "d365", title: "365 дней", hint: "Всё, что оплатили за год" },
];

export function AnalyticsPatientsLtvPanel() {
  const qc = useQueryClient();
  const initial = useMemo(() => defaultMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);

  const syncMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/analytics/ltv/sync", { method: "POST" }),
    onSuccess: () => {
      toast.success("Данные обновлены");
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
      <div className="ltv-toolbar mo-section">
        <div>
          <h2 className="text-base font-semibold">LTV пациентов</h2>
          <p className="mt-1 max-w-xl text-sm mo-muted">
            Новые пациенты выбранного месяца: сколько их, сколько они уже заплатили и кто вернулся
            ещё раз. По умолчанию — прошлый полный месяц.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm mo-muted">
            С
            <DateField className="mt-1" value={dateFrom} onChange={setDateFrom} aria-label="Период с" />
          </label>
          <label className="text-sm mo-muted">
            по
            <DateField className="mt-1" value={dateTo} onChange={setDateTo} aria-label="Период по" />
          </label>
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-sm"
            disabled={syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
          >
            {syncMutation.isPending ? "Обновляем…" : "Обновить данные"}
          </button>
        </div>
      </div>

      {cohortQuery.isLoading ? <p className="lux-caption px-1">Загрузка LTV…</p> : null}
      {cohortQuery.isError ? (
        <p className="text-sm text-red-400">{(cohortQuery.error as Error).message}</p>
      ) : null}

      {data ? (
        <>
          <div className="ltv-kpis">
            {[
              ["Пациентов", String(data.patients), "Первая покупка в этом месяце"],
              ["Уже оплатили", money(data.avg_paid_ltv), "Касса на пациента, без долга"],
              ["Вернулись", pct(data.repeat_purchase_rate), "Купили ещё хотя бы раз"],
            ].map(([label, value, hint]) => (
              <div key={label} className="ltv-kpi">
                <div className="ltv-kpi__label">{label}</div>
                <div className="ltv-kpi__value">{value}</div>
                <div className="ltv-kpi__hint">{hint}</div>
              </div>
            ))}
          </div>

          <div className="mo-section p-4">
            <h3 className="mb-1 text-base font-semibold">Как копится касса</h3>
            <p className="mb-3 max-w-2xl text-sm mo-muted">
              Средняя оплата на пациента с первого дня. 90 дней включают 30, год включает всё
              предыдущее. Это не отдельный месяц, а накопленная касса.
            </p>
            <div className="ltv-windows">
              {LTV_WINDOW_STORY.map((w) => {
                const value = Number(data.ltv_windows?.[w.key] ?? 0);
                const cap = Math.max(
                  ...LTV_WINDOW_STORY.map((item) => Number(data.ltv_windows?.[item.key] ?? 0)),
                  1,
                );
                const width = Math.max(6, Math.round((value / cap) * 100));
                return (
                  <div key={w.key} className="ltv-window">
                    <div className="ltv-window__title">{w.title}</div>
                    <div className="ltv-window__value">{money(value)}</div>
                    <div className="ltv-window__bar" aria-hidden>
                      <span style={{ width: `${width}%` }} />
                    </div>
                    <div className="ltv-window__hint">{w.hint}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
