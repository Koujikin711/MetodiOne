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
  coverage?: {
    purchases_linked: number;
    purchases_unresolved: number;
    coverage_pct: string | number | null;
    note?: string;
  };
  unresolved_rows?: {
    purchase_id: number;
    source_type: string;
    source_id: number;
    product_kind: string;
    product_name: string;
    service_amount: string | number;
    paid_amount: string | number;
    status: string;
    purchased_at?: string | null;
    client_name?: string | null;
    client_phone?: string | null;
  }[];
  product_transitions?: {
    from_product: string;
    to_product: string;
    transition_count: number;
    patients: number;
    share_of_from: number | null;
    from_out_count: number;
    avg_interval_days: number | null;
    median_interval_days: number | null;
  }[];
  patients_rows: {
    lead_id: number;
    patient_name?: string | null;
    patient_phone?: string | null;
    paid_ltv: string | number;
    sales_value: string | number;
    purchase_count: number;
    outstanding: string | number;
    operational_debt?: string | number;
    refunds_total?: string | number;
    lifetime_days: number | null;
    first_purchase_at?: string | null;
    last_purchase_at?: string | null;
    first_purchase_product_key?: string | null;
    first_purchase_product_name?: string | null;
    last_purchase_product_key?: string | null;
    last_purchase_product_name?: string | null;
  }[];
};

type PatientLtvDetail = {
  lead_id: number;
  purchase_count: number;
  paid_ltv: string | number;
  sales_value: string | number;
  outstanding: string | number;
  operational_debt?: string | number;
  refunds_total: string | number;
  lifetime_days: number | null;
  first_purchase_at?: string | null;
  last_purchase_at?: string | null;
  purchases: {
    id: number;
    product_kind: string;
    product_name: string;
    service_amount: string | number;
    paid_amount: string | number;
    status: string;
    purchased_at?: string | null;
  }[];
  money_events: {
    id: number;
    purchase_id: number;
    amount: string | number;
    is_refund: boolean;
    signed_amount: string | number;
    event_type: string;
    paid_at?: string | null;
    source_type: string;
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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Display labels; canonical keys in API stay English. */
const PRODUCT_KIND_LABELS: Record<string, string> = {
  course_15: "Курс 15",
  main_course: "Основной курс",
  protocol: "Протокол",
  other_service: "Другая услуга",
  visit: "Визит",
  desk: "Desk",
  extra: "Доп. услуга",
};

function productLabel(keyOrName: string | null | undefined, name?: string | null): string {
  const n = (name || "").trim();
  if (n) return n;
  const k = (keyOrName || "").trim();
  if (!k) return "—";
  return PRODUCT_KIND_LABELS[k] ?? k;
}

const FUNNEL_LABELS: Record<string, string> = {
  mk_main: "МК зафиксирован → Основной курс",
  mk_protocol: "МК зафиксирован → Протокол",
  mk_both: "МК зафиксирован → Основной курс + Протокол",
  mk_none: "МК зафиксирован → без следующей покупки",
  no_mk_main: "МК не зафиксирован → Основной курс",
  no_mk_protocol: "МК не зафиксирован → Протокол",
  no_mk_both: "МК не зафиксирован → Основной курс + Протокол",
  no_mk_none: "МК не зафиксирован → без следующей покупки",
};

const CONV_LABELS: Record<string, string> = {
  course15_to_main: "Курс 15 → Основной курс",
  course15_to_protocol: "Курс 15 → Протокол",
  course15_to_masterclass: "Курс 15 → МК (зафиксирован)",
  masterclass_to_main: "МК → Основной курс",
  masterclass_to_protocol: "МК → Протокол",
  course15_to_main_without_mk: "Курс 15 → Основной курс без МК",
  course15_to_protocol_without_mk: "Курс 15 → Протокол без МК",
};

const ORIGIN_LABELS: Record<string, string> = {
  as_first_product: "как первая покупка",
  after_course15_with_mk: "после Курса 15 + МК",
  after_course15_mk_not_recorded: "после Курса 15, МК не зафиксирован",
  without_course15: "без Курса 15",
  other_previous_path: "другой предыдущий путь",
};

const FIRST_PRODUCT_LABELS: Record<string, string> = {
  course_15: "Курс 15",
  main_course: "Основной курс",
  protocol: "Протокол",
  other_service: "Другая услуга",
  visit: "Визит",
  desk: "Desk",
  extra: "Доп. услуга",
};

const LTV_WINDOW_LABELS: Record<string, string> = {
  d0: "D0",
  d30: "D30",
  d90: "D90",
  d180: "D180",
  d365: "D365",
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
          <span className="mo-muted">{labels[k] ?? productLabel(k)}</span>
          <strong className="tabular-nums">{v}</strong>
        </div>
      ))}
    </div>
  );
}

function PatientLtvDrawer({
  leadId,
  patientName,
  onClose,
}: {
  leadId: number;
  patientName: string;
  onClose: () => void;
}) {
  const detailQuery = useQuery({
    queryKey: ["analytics-ltv-patient", leadId],
    queryFn: () => apiFetch<PatientLtvDetail>(`/api/analytics/ltv/patient/${leadId}`),
  });
  const d = detailQuery.data;

  const purchasesSorted = useMemo(() => {
    const list = [...(d?.purchases ?? [])];
    list.sort((a, b) => {
      const ta = a.purchased_at ? new Date(a.purchased_at).getTime() : 0;
      const tb = b.purchased_at ? new Date(b.purchased_at).getTime() : 0;
      return ta - tb;
    });
    return list.filter((p) => (p.status || "") !== "cancelled");
  }, [d?.purchases]);

  const eventsByPurchase = useMemo(() => {
    const map = new Map<number, PatientLtvDetail["money_events"]>();
    for (const ev of d?.money_events ?? []) {
      const pid = Number(ev.purchase_id);
      const arr = map.get(pid) ?? [];
      arr.push(ev);
      map.set(pid, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const ta = a.paid_at ? new Date(a.paid_at).getTime() : 0;
        const tb = b.paid_at ? new Date(b.paid_at).getTime() : 0;
        return ta - tb;
      });
    }
    return map;
  }, [d?.money_events]);

  return (
    <div
      className="fixed inset-0 z-[400] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`LTV пациента ${patientName}`}
      onClick={onClose}
    >
      <div
        className="mo-modal-panel flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-[var(--mo-border)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--mo-border)] px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-[var(--mo-text)]">{patientName}</h3>
            <p className="text-xs mo-muted">Patient LTV · Lead #{leadId}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/leads/${leadId}`}
              className="text-xs text-[var(--mo-accent-hover)] hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Открыть в CRM
            </Link>
            <button type="button" className="mo-modal-close" onClick={onClose} aria-label="Закрыть">
              ×
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {detailQuery.isLoading ? <p className="lux-caption py-6">Загрузка…</p> : null}
          {detailQuery.isError ? (
            <p className="text-sm text-red-400">{(detailQuery.error as Error).message}</p>
          ) : null}
          {d ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  ["Paid LTV", money(d.paid_ltv)],
                  ["Sales Value", money(d.sales_value)],
                  ["Refunds", money(d.refunds_total)],
                  ["Остаток", money(d.outstanding)],
                  ["Дебиторка", money(d.operational_debt ?? 0)],
                  ["Покупок", String(d.purchase_count)],
                  ["Lifetime", d.lifetime_days != null ? `${d.lifetime_days} дн.` : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-[var(--mo-border)]/60 px-3 py-2">
                    <div className="text-[11px] mo-muted">{label}</div>
                    <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
                  </div>
                ))}
              </div>

              <h4 className="mb-2 mt-4 text-sm font-semibold">Хронология покупок</h4>
              <p className="mb-3 text-[11px] mo-muted">
                Purchase Events. Платежи и возвраты — внутри покупки, не отдельные покупки.
              </p>
              {purchasesSorted.length === 0 ? (
                <p className="text-xs mo-muted">Нет покупок</p>
              ) : (
                <ul className="space-y-3">
                  {purchasesSorted.map((p) => {
                    const events = eventsByPurchase.get(Number(p.id)) ?? [];
                    return (
                      <li
                        key={p.id}
                        className="rounded-lg border border-[var(--mo-border)]/70 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div>
                            <span className="text-xs mo-muted">{formatDate(p.purchased_at)}</span>
                            <div className="font-medium">
                              {productLabel(p.product_kind, p.product_name)}
                              {(p.status || "") === "returned" ? (
                                <span className="ml-2 text-[11px] mo-muted">(возврат)</span>
                              ) : null}
                            </div>
                          </div>
                          <div className="text-right text-sm">
                            <div className="tabular-nums">
                              <span className="mo-muted text-xs">Продажа </span>
                              {money(p.service_amount)}
                            </div>
                            <div className="tabular-nums text-xs mo-muted">
                              Оплачено (кэш) {money(p.paid_amount)}
                            </div>
                          </div>
                        </div>
                        {events.length > 0 ? (
                          <ul className="mt-2 space-y-1 border-t border-[var(--mo-border)]/40 pt-2">
                            {events.map((ev) => (
                              <li
                                key={ev.id}
                                className="flex justify-between gap-2 text-xs tabular-nums"
                              >
                                <span className="mo-muted">
                                  {formatDate(ev.paid_at)} ·{" "}
                                  {ev.is_refund || ev.event_type === "refund" ? "Возврат" : "Оплата"}
                                </span>
                                <span
                                  className={
                                    ev.is_refund || Number(ev.signed_amount) < 0
                                      ? "text-red-300"
                                      : ""
                                  }
                                >
                                  {money(ev.signed_amount)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AnalyticsPatientsLtvPanel() {
  const qc = useQueryClient();
  const initial = useMemo(() => defaultMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [drawer, setDrawer] = useState<{ leadId: number; name: string } | null>(null);

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

  const topTransitions = useMemo(() => {
    const list = [...(data?.product_transitions ?? [])];
    list.sort((a, b) => b.transition_count - a.transition_count);
    return list.slice(0, 5);
  }, [data?.product_transitions]);

  const unresolvedMainProto = useMemo(() => {
    const rows = data?.unresolved_rows ?? [];
    return rows.filter((r) => {
      const k = (r.product_kind || "").toLowerCase();
      return k === "main_course" || k === "protocol";
    }).length;
  }, [data?.unresolved_rows]);

  const showCourse15Dq =
    Boolean(data) &&
    (j?.branch_main_course ?? 0) === 0 &&
    (j?.branch_protocols ?? 0) === 0 &&
    ((data?.coverage?.purchases_unresolved ?? 0) > 0 || unresolvedMainProto > 0);

  return (
    <div className="space-y-4">
      <div className="mo-section flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm mo-muted">
          Когорта по первой покупке — с
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
          Синхронизировать ledger
        </button>
        <p className="pb-2 text-xs mo-muted max-w-md">
          Период = когорта по дате первой покупки. Universal Journey = хронология всех Purchase
          Events. Курс 15 / МК — program context, не gate.
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
              ["Средний Paid LTV", money(data.avg_paid_ltv)],
              ["Средняя сумма продаж", money(data.avg_sales_value)],
              ["Повторная покупка", pct(data.repeat_purchase_rate)],
              ["Покупок на пациента", Number(data.purchases_per_patient).toFixed(2)],
              ["Средний lifetime (дн.)", Number(data.avg_lifetime_days).toFixed(0)],
            ].map(([label, value]) => (
              <div key={label} className="mo-section p-3">
                <div className="text-[11px] mo-muted">{label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </div>

          <div className="mo-section p-4">
            <h3 className="mb-2 text-sm font-semibold">Покрытие данных</h3>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span>
                Покрытие{" "}
                <strong className="tabular-nums">
                  {data.coverage?.coverage_pct != null ? `${data.coverage.coverage_pct}%` : "—"}
                </strong>
              </span>
              <span>
                Привязано{" "}
                <strong className="tabular-nums">{data.coverage?.purchases_linked ?? "—"}</strong>
              </span>
              <span>
                Не привязано{" "}
                <strong className="tabular-nums">{data.coverage?.purchases_unresolved ?? "—"}</strong>
              </span>
              {(data.coverage?.purchases_unresolved ?? 0) > 0 ? (
                <button
                  type="button"
                  className="text-sm text-[var(--mo-accent-hover)] underline"
                  onClick={() => setShowUnresolved((v) => !v)}
                >
                  {showUnresolved ? "Скрыть непривязанные" : "Посмотреть непривязанные"}
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] mo-muted">
              {data.coverage?.note ||
                "Непривязанные = без lead_id. Не входят в Patient LTV. Автослияние по телефону запрещено."}
            </p>
            {showUnresolved && (data.unresolved_rows ?? []).length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead>
                    <tr className="border-b border-[var(--mo-border)] text-left mo-muted">
                      <th className="px-2 py-1">Источник</th>
                      <th className="px-2 py-1">Продукт</th>
                      <th className="px-2 py-1">Клиент</th>
                      <th className="px-2 py-1 text-right">Продажа</th>
                      <th className="px-2 py-1 text-right">Оплачено</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.unresolved_rows!.slice(0, 50).map((r) => (
                      <tr key={r.purchase_id} className="border-b border-[var(--mo-border)]/40">
                        <td className="px-2 py-1">
                          {r.source_type}#{r.source_id}
                        </td>
                        <td className="px-2 py-1">
                          {productLabel(r.product_kind, r.product_name)}
                        </td>
                        <td className="px-2 py-1">
                          {r.client_name || "—"}
                          <div className="mo-muted">{r.client_phone || ""}</div>
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{money(r.service_amount)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{money(r.paid_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(data.unresolved_rows?.length ?? 0) > 50 ? (
                  <p className="mt-1 text-[11px] mo-muted">
                    Показаны первые 50 из {data.unresolved_rows!.length}.
                  </p>
                ) : null}
                <Link
                  to="/kpi"
                  className="mt-2 inline-block text-sm text-[var(--mo-accent-hover)] hover:underline"
                >
                  Привязать продажи в KPI →
                </Link>
              </div>
            ) : null}
          </div>

          <div className="mo-section p-4">
            <h3 className="mb-2 text-sm font-semibold">Рост LTV</h3>
            <div className="flex flex-wrap gap-3 text-sm">
              {Object.entries(data.ltv_windows ?? {}).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-[var(--mo-border)] px-3 py-2">
                  <span className="mo-muted uppercase">{LTV_WINDOW_LABELS[k] ?? k}</span>
                  <div className="font-semibold tabular-nums">{money(v)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mo-section p-4">
            <h3 className="mb-1 text-sm font-semibold">Первый продукт</h3>
            <p className="mb-2 text-xs mo-muted">
              По реальной первой покупке когорты (product kind). Любой продукт может быть первым.
            </p>
            <StatGrid entries={j?.first_product} labels={FIRST_PRODUCT_LABELS} />
          </div>

          <div className="mo-section overflow-x-auto p-4">
            <h3 className="mb-1 text-sm font-semibold">Переходы между продуктами</h3>
            <p className="mb-2 text-xs mo-muted">
              Соседние Purchase Events. Доля = переходы A→B / все A→*. Без нового calculation layer.
            </p>
            {topTransitions.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {topTransitions.map((t) => (
                  <div
                    key={`top-${t.from_product}→${t.to_product}`}
                    className="rounded-lg border border-[var(--mo-border)] px-3 py-1.5 text-xs"
                  >
                    <span className="font-medium">
                      {productLabel(t.from_product)} → {productLabel(t.to_product)}
                    </span>
                    <span className="ml-2 tabular-nums mo-muted">{t.transition_count}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {(data.product_transitions ?? []).length === 0 ? (
              <p className="text-xs mo-muted">Нет переходов в когорте (нужно ≥2 покупки у пациента).</p>
            ) : (
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--mo-border)] text-left text-xs mo-muted">
                    <th className="px-2 py-1">Из продукта</th>
                    <th className="px-2 py-1">В продукт</th>
                    <th className="px-2 py-1 text-right">Переходов</th>
                    <th className="px-2 py-1 text-right">Пациентов</th>
                    <th className="px-2 py-1 text-right">Доля</th>
                    <th className="px-2 py-1 text-right">Среднее дней</th>
                    <th className="px-2 py-1 text-right">Медиана дней</th>
                  </tr>
                </thead>
                <tbody>
                  {data.product_transitions!.map((t) => (
                    <tr
                      key={`${t.from_product}→${t.to_product}`}
                      className="border-b border-[var(--mo-border)]/50"
                    >
                      <td className="px-2 py-1">{productLabel(t.from_product)}</td>
                      <td className="px-2 py-1">{productLabel(t.to_product)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{t.transition_count}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{t.patients}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {t.share_of_from != null ? pct(t.share_of_from) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {t.avg_interval_days ?? "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {t.median_interval_days ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="mo-section p-4">
            <h3 className="mb-1 text-sm font-semibold">Путь после Курса 15</h3>
            <p className="mb-2 text-xs mo-muted">
              Program Journey (аналитика). МК — event; «не зафиксирован» ≠ отсутствие визита. Не
              gate для LTV.
            </p>
            {showCourse15Dq ? (
              <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                <p>
                  Недостаточно связанных данных. Часть продаж Основного курса/Протоколов не привязана
                  к пациентам и поэтому не включена в Patient Journey.
                </p>
                <p className="mt-1 text-xs mo-muted">
                  Непривязанных покупок:{" "}
                  <strong className="tabular-nums text-[var(--mo-text)]">
                    {data.coverage?.purchases_unresolved ?? 0}
                  </strong>
                  {unresolvedMainProto > 0 ? (
                    <>
                      {" "}
                      · из них Основной курс/Протокол в выборке:{" "}
                      <strong className="tabular-nums text-[var(--mo-text)]">
                        {unresolvedMainProto}
                      </strong>
                    </>
                  ) : null}
                </p>
                <Link
                  to="/kpi"
                  className="mt-2 inline-block text-sm text-[var(--mo-accent-hover)] hover:underline"
                >
                  Привязать продажи →
                </Link>
              </div>
            ) : null}
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm">
              <div>
                Купили Курс 15: <strong>{j?.course_15_buyers ?? j?.course_15_started ?? 0}</strong>
              </div>
              <div>
                Завершили: <strong>{j?.course_15_completed ?? 0}</strong>
              </div>
              <div>
                МК зафиксирован: <strong>{j?.master_class_recorded ?? j?.master_class ?? 0}</strong>
              </div>
              <div>
                МК не зафиксирован: <strong>{j?.master_class_not_recorded ?? 0}</strong>
              </div>
            </div>
            {!showCourse15Dq || (j?.course_15_buyers ?? 0) > 0 ? (
              <StatGrid entries={j?.funnel} labels={FUNNEL_LABELS} />
            ) : null}
          </div>

          <div className="mo-section p-4">
            <h3 className="mb-1 text-sm font-semibold">Конверсии</h3>
            <p className="mb-2 text-xs mo-muted">Метрики путей, не правила допуска к покупке.</p>
            <StatGrid entries={j?.conversions} labels={CONV_LABELS} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="mo-section p-4">
              <h3 className="mb-1 text-sm font-semibold">Вход в Основной курс</h3>
              <StatGrid entries={j?.main_course_origin} labels={ORIGIN_LABELS} />
            </div>
            <div className="mo-section p-4">
              <h3 className="mb-1 text-sm font-semibold">Вход в Протоколы</h3>
              <StatGrid entries={j?.protocol_origin} labels={ORIGIN_LABELS} />
            </div>
          </div>

          <div className="mo-section overflow-x-auto p-0">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-[var(--mo-border)] text-left text-xs mo-muted">
                  <th className="px-3 py-2">Пациент</th>
                  <th className="px-3 py-2">Первая покупка</th>
                  <th className="px-3 py-2">Последняя покупка</th>
                  <th className="px-3 py-2">Дата последней покупки</th>
                  <th className="px-3 py-2 text-right">Paid LTV</th>
                  <th className="px-3 py-2 text-right">Sales Value</th>
                  <th className="px-3 py-2 text-right">Refunds</th>
                  <th
                    className="px-3 py-2 text-right"
                    title="Математический остаток по активному обязательству. Не дебиторка."
                  >
                    Остаток
                  </th>
                  <th
                    className="px-3 py-2 text-right"
                    title="Операционная дебиторка. Refund ≠ automatic debt."
                  >
                    Дебиторка
                  </th>
                  <th className="px-3 py-2 text-right">Покупок</th>
                  <th className="px-3 py-2 text-right">Lifetime</th>
                </tr>
              </thead>
              <tbody>
                {(data.patients_rows ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center mo-muted">
                      Нет пациентов с первой покупкой в когорте. Нажмите «Синхронизировать ledger».
                    </td>
                  </tr>
                ) : (
                  data.patients_rows.map((r) => (
                    <tr key={r.lead_id} className="border-b border-[var(--mo-border)]/60">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-left font-medium text-[var(--mo-accent-hover)] hover:underline"
                          onClick={() =>
                            setDrawer({
                              leadId: r.lead_id,
                              name: r.patient_name || `#${r.lead_id}`,
                            })
                          }
                        >
                          {r.patient_name || `#${r.lead_id}`}
                        </button>
                        <div className="text-[11px] mo-muted">{r.patient_phone || ""}</div>
                      </td>
                      <td className="px-3 py-2">
                        {productLabel(
                          r.first_purchase_product_key,
                          r.first_purchase_product_name,
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {productLabel(
                          r.last_purchase_product_key,
                          r.last_purchase_product_name,
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{formatDate(r.last_purchase_at)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.paid_ltv)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.sales_value)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.refunds_total)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.outstanding)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(r.operational_debt ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.purchase_count}</td>
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

      {drawer ? (
        <PatientLtvDrawer
          leadId={drawer.leadId}
          patientName={drawer.name}
          onClose={() => setDrawer(null)}
        />
      ) : null}
    </div>
  );
}
