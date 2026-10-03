import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import { DateField } from "@/components/DateField";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { productDisplayLabel } from "@/lib/productLexicon";

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

/** Phase 8A design compare — does not cut over production cohort. */
type EntryModeSnapshot = {
  entry_mode: string;
  patients: number;
  avg_paid_ltv: string | number;
  avg_sales_value: string | number;
  repeat_purchase_rate: string | number;
  purchases_per_patient: string | number;
  avg_lifetime_days: string | number;
  ltv_windows: Record<string, string | number>;
  first_product_top?: { product: string; patients: number }[];
};

type EntryCompareReport = {
  production_entry_mode: string;
  free_followup_inspections_count?: number;
  cutover_blocked_reason?: string;
  note?: string;
  current: EntryModeSnapshot;
  target: EntryModeSnapshot;
  diff: {
    patients_delta: number;
    first_at_changed_patients: number;
    entry_only_under_current: number;
    entry_only_under_target: number;
  };
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
const FIRST_PRODUCT_LABELS: Record<string, string> = {
  course_15: "Курс 15",
  main_course: "Курс",
  protocol: "Протокол",
  other_service: "Другая услуга",
  visit: "Визит",
  desk: "Desk",
  extra: "Доп. услуга",
};

const FUNNEL_LABELS: Record<string, string> = {
  mk_main: "МК зафиксирован → Курс",
  mk_protocol: "МК зафиксирован → Протокол",
  mk_both: "МК зафиксирован → Курс + Протокол",
  mk_none: "МК зафиксирован → нет Курса и Протокола",
  no_mk_main: "МК не зафиксирован → Курс",
  no_mk_protocol: "МК не зафиксирован → Протокол",
  no_mk_both: "МК не зафиксирован → Курс + Протокол",
  no_mk_none: "МК не зафиксирован → нет Курса и Протокола",
};

const CONV_LABELS: Record<string, string> = {
  course15_to_main: "Курс 15 → Курс",
  course15_to_protocol: "Курс 15 → Протокол",
  course15_to_masterclass: "Курс 15 → МК (зафиксирован)",
  masterclass_to_main: "МК → Курс",
  masterclass_to_protocol: "МК → Протокол",
  course15_to_main_without_mk: "Курс 15 → Курс без МК",
  course15_to_protocol_without_mk: "Курс 15 → Протокол без МК",
};

const ORIGIN_LABELS: Record<string, string> = {
  as_first_product: "как первая покупка",
  after_course15_with_mk: "после Курса 15 + МК",
  after_course15_mk_not_recorded: "после Курса 15, МК не зафиксирован",
  without_course15: "без Курса 15",
  other_previous_path: "другой предыдущий путь",
};

const LTV_WINDOW_STORY: { key: string; title: string; hint: string }[] = [
  { key: "d0", title: "В день покупки", hint: "Касса в первый день" },
  { key: "d30", title: "30 дней", hint: "Всё за первый месяц" },
  { key: "d90", title: "90 дней", hint: "Включая предыдущие дни" },
  { key: "d180", title: "Полгода", hint: "Накоплено с первого дня" },
  { key: "d365", title: "Год", hint: "Накоплено с первого дня" },
];

const COURSE15_STORY: Record<string, { title: string; hint: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  clear_full: { title: "Оплачено полностью", hint: "Сумма и оплата совпали", tone: "ok" },
  clear_partial: { title: "Аванс", hint: "Внесли меньше стоимости", tone: "warn" },
  technically_full_possible_deposit: {
    title: "Похоже на депозит",
    hint: "Сумма до 500 и она закрыта",
    tone: "warn",
  },
  unknown: { title: "Ошибка суммы", hint: "Стоимость не записана", tone: "bad" },
  free_followup_inspection: {
    title: "Бесплатный осмотр",
    hint: "После оплаченной программы",
    tone: "muted",
  },
};

function course15Meaning(depositClass: string): string {
  switch (depositClass) {
    case "clear_full":
      return "Договор закрыт. Следующий приём с нулевой ценой может быть бесплатным осмотром.";
    case "clear_partial":
      return "Это аванс, не полная оплата. Бесплатный осмотр не открывается.";
    case "technically_full_possible_deposit":
      return "Оплата совпала с суммой, но сумма небольшая. Похоже на депозит, не на курс.";
    case "free_followup_inspection":
      return "Бесплатный осмотр. В кассу и в дату первой покупки не входит.";
    default:
      return "Сумма не записана, а полной оплаты курса раньше не было. Это ошибка данных.";
  }
}

function OriginBlock({
  entries,
  linked,
  unresolved,
  productLabel,
}: {
  entries: Record<string, number> | undefined;
  linked: number;
  unresolved: number;
  productLabel: string;
}) {
  const hasCohort = Object.values(entries ?? {}).some((v) => Number(v) > 0);
  if (hasCohort) {
    return <StatGrid entries={entries} labels={ORIGIN_LABELS} />;
  }
  if (linked > 0) {
    return (
      <p className="text-xs mo-muted">
        В этой когорте нет связанного «{productLabel}». Связанных продаж в компании: {linked} — они
        вне окна первой покупки.
      </p>
    );
  }
  if (unresolved > 0) {
    return (
      <p className="text-xs mo-muted">
        Связанных нет — {unresolved} продаж требуют привязки (см. выше).
      </p>
    );
  }
  return <StatGrid entries={entries} labels={ORIGIN_LABELS} />;
}

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
          <span className="mo-muted">{labels[k] ?? productDisplayLabel(k)}</span>
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
            <p className="text-xs mo-muted">Карточка пациента · #{leadId}</p>
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
                  ["Касса", money(d.paid_ltv)],
                  ["Сумма услуг", money(d.sales_value)],
                  ["Возвраты", money(d.refunds_total)],
                  ["Остаток", money(d.outstanding)],
                  ["Долг", money(d.operational_debt ?? 0)],
                  ["Покупок", String(d.purchase_count)],
                  ["Дней с клиникой", d.lifetime_days != null ? `${d.lifetime_days}` : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-[var(--mo-border)]/60 px-3 py-2">
                    <div className="text-[11px] mo-muted">{label}</div>
                    <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
                  </div>
                ))}
              </div>

              <h4 className="mb-2 mt-4 text-sm font-semibold">Хронология покупок</h4>
              <p className="mb-3 text-[11px] mo-muted">
                Платежи и возвраты лежат внутри покупки и отдельно не считаются.
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
                              {productDisplayLabel(p.product_kind, p.product_name)}
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
  const [showProgramDq, setShowProgramDq] = useState(false);
  const [showDepositDq, setShowDepositDq] = useState(true);
  const [depositClassFilter, setDepositClassFilter] = useState("");
  const [depositQ, setDepositQ] = useState("");
  const [drawer, setDrawer] = useState<{ leadId: number; name: string } | null>(null);

  const syncMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/analytics/ltv/sync", { method: "POST" }),
    onSuccess: () => {
      toast.success("Ledger синхронизирован");
      void qc.invalidateQueries({ queryKey: ["analytics-ltv-cohort"] });
      void qc.invalidateQueries({ queryKey: ["analytics-ltv-program-unresolved"] });
      void qc.invalidateQueries({ queryKey: ["analytics-ltv-deposit-dq"] });
      void qc.invalidateQueries({ queryKey: ["analytics-ltv-entry-compare"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const linkLeadMutation = useMutation({
    mutationFn: async ({ saleId, leadId }: { saleId: number; leadId: number }) => {
      await apiFetch(`/api/sales-kpi/manual-sales/${saleId}/link-lead`, {
        method: "PATCH",
        body: JSON.stringify({ lead_id: leadId }),
      });
      await apiFetch("/api/analytics/ltv/sync", { method: "POST" });
    },
    onSuccess: () => {
      toast.success("Продажа привязана к пациенту");
      void qc.invalidateQueries({ queryKey: ["analytics-ltv-cohort"] });
      void qc.invalidateQueries({ queryKey: ["analytics-ltv-program-unresolved"] });
      void qc.invalidateQueries({ queryKey: ["analytics-ltv-deposit-dq"] });
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

  const entryCompareQuery = useQuery({
    queryKey: ["analytics-ltv-entry-compare", qs],
    queryFn: () => apiFetch<EntryCompareReport>(`/api/analytics/ltv/entry-compare?${qs}`),
    enabled: Boolean(dateFrom && dateTo),
  });

  type ProgramUnresolved = {
    unresolved_main_course: number;
    unresolved_protocol: number;
    linked_main_course: number;
    linked_protocol: number;
    note?: string;
    classification?: {
      main_course: Record<string, number>;
      protocol: Record<string, number>;
    };
    rows: {
      sale_id: number;
      sold_at?: string | null;
      client_name: string;
      client_phone: string;
      product_kind: string;
      product_display: string;
      service_amount: string | number;
      paid_amount: string | number;
      status: string;
      manager_name: string;
      suggestion_confidence: string;
      suggested_lead?: { lead_id: number; lead_name: string; lead_phone?: string | null } | null;
      candidate_leads?: { lead_id: number; lead_name: string; lead_phone?: string | null }[];
      match_evidence?: string[];
      evidence?: {
        phone?: boolean;
        fio?: string;
        booking?: boolean;
        warning?: string | null;
      };
    }[];
  };

  const programDqQuery = useQuery({
    queryKey: ["analytics-ltv-program-unresolved"],
    queryFn: () => apiFetch<ProgramUnresolved>("/api/analytics/ltv/program-unresolved"),
  });

  type DepositDqReport = {
    read_only: boolean;
    auto_fix: boolean;
    possible_deposit_max: string;
    note?: string;
    counts: Record<string, number>;
    free_followup_inspections_count?: number;
    total_in_scope: number;
    rows_returned: number;
    class_labels: Record<string, string>;
    rows: {
      deposit_class: string;
      deposit_class_label: string;
      purchase_id: number;
      lead_id?: number | null;
      patient_name: string;
      patient_phone?: string | null;
      product_label: string;
      source_type: string;
      booking_id?: number | null;
      kpi_sale_id?: number | null;
      service_amount: string | number;
      paid_amount: string | number;
      purchased_at?: string | null;
      manager_name?: string | null;
      payments_count: number;
      payments: { amount: string; source_type: string; is_refund: boolean }[];
      related_course15: {
        purchase_id: number;
        service_amount: string;
        paid_amount: string;
      }[];
      evidence_reasons: string[];
      target_entry_would_pass: boolean;
    }[];
  };

  const depositDqQs = useMemo(() => {
    const p = new URLSearchParams();
    if (depositClassFilter) p.set("deposit_class", depositClassFilter);
    if (depositQ.trim()) p.set("q", depositQ.trim());
    p.set("limit", "200");
    return p.toString();
  }, [depositClassFilter, depositQ]);

  const depositDqQuery = useQuery({
    queryKey: ["analytics-ltv-deposit-dq", depositDqQs],
    queryFn: () => apiFetch<DepositDqReport>(`/api/analytics/ltv/deposit-dq?${depositDqQs}`),
  });

  const data = cohortQuery.data;
  const entryCompare = entryCompareQuery.data;
  const j = data?.journey;
  const prog = programDqQuery.data;

  const topTransitions = useMemo(() => {
    const list = [...(data?.product_transitions ?? [])];
    list.sort((a, b) => b.transition_count - a.transition_count);
    return list.slice(0, 5);
  }, [data?.product_transitions]);

  const programNeedsDq =
    (prog?.unresolved_main_course ?? 0) > 0 || (prog?.unresolved_protocol ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="ltv-toolbar mo-section">
        <div>
          <h2 className="text-base font-semibold">Пациенты этого периода</h2>
          <p className="mt-1 max-w-xl text-sm mo-muted">
            Сюда попадают люди, у которых первая покупка была в выбранные даты. Деньги ниже — это
            касса: сколько уже оплатили, без долга.
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
              ["Пациентов", String(data.patients), "Первая покупка в этом периоде"],
              ["Касса на пациента", money(data.avg_paid_ltv), "Сколько в среднем уже оплатили"],
              ["Сумма услуг", money(data.avg_sales_value), "Оформлено, даже если долг ещё открыт"],
              ["Купили ещё раз", pct(data.repeat_purchase_rate), "Две покупки и больше"],
              ["Покупок на человека", Number(data.purchases_per_patient).toFixed(1), "В среднем по пациенту"],
              ["Дней с клиникой", Number(data.avg_lifetime_days).toFixed(0), "От первой покупки до последней"],
            ].map(([label, value, hint]) => (
              <div key={label} className="ltv-kpi">
                <div className="ltv-kpi__label">{label}</div>
                <div className="ltv-kpi__value">{value}</div>
                <div className="ltv-kpi__hint">{hint}</div>
              </div>
            ))}
          </div>

          {entryCompare ? (
            <div className="mo-section space-y-3 p-4">
              <div>
                <h3 className="text-base font-semibold">Если считать только полную оплату</h3>
                <p className="mt-1 max-w-2xl text-sm mo-muted">
                  Рабочий отчёт считает пациента с первой покупки, даже если он внёс только часть.
                  Справа — как выглядели бы те же цифры, если брать только закрытые договоры. Отчёт
                  на это не переключён: суммы до 500 иногда оказываются депозитом, а не курсом.
                </p>
                <p className="mt-2 text-sm mo-muted">
                  Бесплатные осмотры в периоде:{" "}
                  <strong className="tabular-nums text-[var(--mo-text)]">
                    {entryCompare.free_followup_inspections_count ?? 0}
                  </strong>
                  . Они не входят в кассу и не сдвигают дату первой покупки.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="ltv-compare w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="mo-muted">
                      <th className="py-2 pr-3 font-medium">Что смотрим</th>
                      <th className="py-2 pr-3 font-medium">С первой покупки</th>
                      <th className="py-2 pr-3 font-medium">Только полная оплата</th>
                      <th className="py-2 font-medium">Разница</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {(
                      [
                        ["Пациентов", "patients", "int"],
                        ["Касса на пациента", "avg_paid_ltv", "money"],
                        ["Купили ещё раз", "repeat_purchase_rate", "pct"],
                        ["Покупок на человека", "purchases_per_patient", "num2"],
                        ["Дней с клиникой", "avg_lifetime_days", "num0"],
                        ["В день покупки", "d0", "money_win"],
                        ["За 30 дней", "d30", "money_win"],
                        ["За 90 дней", "d90", "money_win"],
                        ["За полгода", "d180", "money_win"],
                        ["За год", "d365", "money_win"],
                      ] as const
                    ).map(([label, key, kind]) => {
                      const cur =
                        kind === "money_win"
                          ? entryCompare.current.ltv_windows[key]
                          : entryCompare.current[key as keyof EntryModeSnapshot];
                      const tgt =
                        kind === "money_win"
                          ? entryCompare.target.ltv_windows[key]
                          : entryCompare.target[key as keyof EntryModeSnapshot];
                      const fmt = (v: unknown) => {
                        if (kind === "money" || kind === "money_win") return money(v as string | number);
                        if (kind === "pct") return pct(v as string | number);
                        if (kind === "num2") return Number(v ?? 0).toFixed(2);
                        if (kind === "num0") return Number(v ?? 0).toFixed(0);
                        return String(v ?? "—");
                      };
                      const cn = Number(cur ?? 0);
                      const tn = Number(tgt ?? 0);
                      const delta =
                        kind === "pct"
                          ? `${(((tn - cn) * 100)).toFixed(1)} п.п.`
                          : kind === "money" || kind === "money_win"
                            ? money(tn - cn)
                            : kind === "int"
                              ? String(tn - cn)
                              : (tn - cn).toFixed(kind === "num0" ? 0 : 2);
                      return (
                        <tr key={label} className="border-t border-[var(--mo-border)]/60">
                          <td className="py-1.5 pr-2">{label}</td>
                          <td className="py-1.5 pr-2">{fmt(cur)}</td>
                          <td className="py-1.5 pr-2">{fmt(tgt)}</td>
                          <td className="py-1.5">{delta}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-sm mo-muted">
                Дата первой покупки сдвинулась бы у{" "}
                <strong className="tabular-nums text-[var(--mo-text)]">
                  {entryCompare.diff.first_at_changed_patients}
                </strong>{" "}
                пациентов. Только в текущем отчёте:{" "}
                <strong className="tabular-nums text-[var(--mo-text)]">
                  {entryCompare.diff.entry_only_under_current}
                </strong>
                . Только при полной оплате:{" "}
                <strong className="tabular-nums text-[var(--mo-text)]">
                  {entryCompare.diff.entry_only_under_target}
                </strong>
                .
              </p>
            </div>
          ) : entryCompareQuery.isLoading ? (
            <p className="lux-caption px-1">Считаем сравнение…</p>
          ) : null}

          <div className="mo-section space-y-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Как оплачен Курс 15</h3>
                <p className="mt-1 max-w-2xl text-sm mo-muted">
                  Сравниваем сумму, которую записал администратор, с тем, сколько внесли. Цену из
                  прайса не подставляем. Суммы до {depositDqQuery.data?.possible_deposit_max ?? "500"}{" "}
                  отмечаем отдельно: это может быть депозит, а не курс.
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary px-3 py-2 text-sm"
                onClick={() => setShowDepositDq((v) => !v)}
              >
                {showDepositDq ? "Скрыть список" : "Показать пациентов"}
              </button>
            </div>
            {depositDqQuery.data ? (
              <div className="ltv-pay-grid">
                {(
                  [
                    ["clear_full", depositDqQuery.data.counts.clear_full ?? 0],
                    ["clear_partial", depositDqQuery.data.counts.clear_partial ?? 0],
                    [
                      "technically_full_possible_deposit",
                      depositDqQuery.data.counts.technically_full_possible_deposit ?? 0,
                    ],
                    ["unknown", depositDqQuery.data.counts.unknown ?? 0],
                    [
                      "free_followup_inspection",
                      depositDqQuery.data.free_followup_inspections_count ?? 0,
                    ],
                  ] as const
                ).map(([key, count]) => {
                  const story = COURSE15_STORY[key];
                  return (
                    <div key={key} className={`ltv-pay ltv-pay--${story.tone}`}>
                      <div className="ltv-pay__label">{story.title}</div>
                      <div className="ltv-pay__value">{count}</div>
                      <div className="ltv-pay__hint">{story.hint}</div>
                    </div>
                  );
                })}
              </div>
            ) : depositDqQuery.isLoading ? (
              <p className="lux-caption">Считаем оплаты Курса 15…</p>
            ) : depositDqQuery.isError ? (
              <p className="text-sm text-red-400">{(depositDqQuery.error as Error).message}</p>
            ) : null}
            {showDepositDq && depositDqQuery.data ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="mo-input text-sm"
                    value={depositClassFilter}
                    onChange={(e) => setDepositClassFilter(e.target.value)}
                  >
                    <option value="">Все записи</option>
                    <option value="C">Оплачено полностью</option>
                    <option value="A">Аванс</option>
                    <option value="B">Похоже на депозит</option>
                    <option value="D">Ошибка суммы</option>
                    <option value="included">Бесплатный осмотр</option>
                  </select>
                  <input
                    className="mo-input text-sm"
                    placeholder="Поиск ФИО / телефон…"
                    value={depositQ}
                    onChange={(e) => setDepositQ(e.target.value)}
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="mo-muted">
                        <th className="py-2 pr-3 font-medium">Статус</th>
                        <th className="py-2 pr-3 font-medium">Пациент</th>
                        <th className="py-2 pr-3 font-medium">Стоимость</th>
                        <th className="py-2 pr-3 font-medium">Оплачено</th>
                        <th className="py-2 pr-3 font-medium">Дата</th>
                        <th className="py-2 font-medium">Что это значит</th>
                      </tr>
                    </thead>
                    <tbody>
                      {depositDqQuery.data.rows.map((r) => (
                        <tr key={r.purchase_id} className="border-t border-[var(--mo-border)]/60 align-top">
                          <td className="py-2 pr-3 whitespace-nowrap">
                            <span className={`ltv-tag ltv-tag--${COURSE15_STORY[r.deposit_class]?.tone ?? "muted"}`}>
                              {COURSE15_STORY[r.deposit_class]?.title ?? r.deposit_class_label}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            {r.lead_id ? (
                              <button
                                type="button"
                                className="text-left font-medium underline"
                                onClick={() =>
                                  setDrawer({ leadId: r.lead_id!, name: r.patient_name })
                                }
                              >
                                {r.patient_name}
                              </button>
                            ) : (
                              r.patient_name
                            )}
                            <div className="text-xs mo-muted">
                              {r.patient_phone || "—"}
                              {r.lead_id == null ? " · не привязан" : ""}
                            </div>
                          </td>
                          <td className="py-2 pr-3 tabular-nums">{money(r.service_amount)}</td>
                          <td className="py-2 pr-3 tabular-nums">{money(r.paid_amount)}</td>
                          <td className="py-2 pr-3">
                            {r.purchased_at
                              ? new Date(r.purchased_at).toLocaleDateString("ru-RU")
                              : "—"}
                            <div className="text-xs mo-muted">{r.manager_name || ""}</div>
                          </td>
                          <td className="py-2 max-w-[22rem] text-sm mo-muted">
                            {course15Meaning(r.deposit_class)}
                          </td>
                        </tr>
                      ))}
                      {!depositDqQuery.data.rows.length ? (
                        <tr>
                          <td colSpan={6} className="py-3 mo-muted">
                            Нет записей по этому фильтру
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <p className="text-sm mo-muted">
                  Список только для просмотра. Суммы в карточках продаж не меняются.
                </p>
              </>
            ) : null}
          </div>

          <div className="mo-section p-4">
            <h3 className="mb-1 text-base font-semibold">Продажи без карточки пациента</h3>
            <p className="mb-3 text-sm mo-muted">
              Эти деньги есть в кассе компании, но не привязаны к человеку, поэтому в средний чек
              пациента не входят. Телефон сам по себе карточку не склеивает.
            </p>
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
            <p className="mt-2 text-sm mo-muted">
              Привязано — продажи с карточкой пациента. Не привязано — продажи, которые ещё нужно
              открыть и указать пациента вручную.
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
                          {productDisplayLabel(r.product_kind, r.product_name)}
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
            <h3 className="mb-1 text-base font-semibold">Как растёт касса</h3>
            <p className="mb-3 max-w-2xl text-sm mo-muted">
              Средняя оплата на пациента. Каждое следующее окно включает предыдущие: «год» — это всё
              с первого дня, а не только последний месяц.
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

          <div className="mo-section p-4">
            <h3 className="mb-1 text-base font-semibold">С чего начинают</h3>
            <p className="mb-3 text-sm mo-muted">
              Первая услуга пациента в этом периоде. Курс 15, Курс и Протокол названы по виду
              программы, остальные — как в записи.
            </p>
            <StatGrid entries={j?.first_product} labels={FIRST_PRODUCT_LABELS} />
          </div>

          <div className="mo-section overflow-x-auto p-4">
            <h3 className="mb-1 text-base font-semibold">Что берут следом</h3>
            <p className="mb-3 text-sm mo-muted">
              Следующая покупка после предыдущей. Доля — сколько людей с этой услуги пошли именно
              сюда. Нужны хотя бы две покупки.
            </p>
            {topTransitions.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {topTransitions.map((t) => (
                  <div
                    key={`top-${t.from_product}→${t.to_product}`}
                    className="rounded-lg border border-[var(--mo-border)] px-3 py-1.5 text-xs"
                  >
                    <span className="font-medium">
                      {productDisplayLabel(t.from_product)} → {productDisplayLabel(t.to_product)}
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
                      <td className="px-2 py-1">{productDisplayLabel(t.from_product)}</td>
                      <td className="px-2 py-1">{productDisplayLabel(t.to_product)}</td>
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
            <h3 className="mb-1 text-base font-semibold">Курс и протокол: привязка к пациенту</h3>
            <p className="mb-3 text-sm mo-muted">
              Продажа из KPI попадает в путь пациента, только если её открыли и указали человека.
              Совпадение телефона — подсказка, карточки сами не склеиваются.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--mo-border)] px-3 py-2 text-sm">
                <div className="font-semibold">Курс</div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    Связано:{" "}
                    <strong className="tabular-nums">{prog?.linked_main_course ?? "…"}</strong>
                  </span>
                  <span>
                    Требуют привязки:{" "}
                    <strong className="tabular-nums">{prog?.unresolved_main_course ?? "…"}</strong>
                  </span>
                </div>
                {prog?.classification?.main_course ? (
                  <div className="mt-2 text-[11px] mo-muted space-y-0.5">
                    <div>
                      Совпало уверенно:{" "}
                      <strong className="tabular-nums text-[var(--mo-text)]">
                        {prog.classification.main_course.high_confidence ?? 0}
                      </strong>
                    </div>
                    <div>
                      Нужна проверка:{" "}
                      <strong className="tabular-nums text-[var(--mo-text)]">
                        {prog.classification.main_course.review_required ?? 0}
                      </strong>
                    </div>
                    <div>
                      Несколько пациентов:{" "}
                      <strong className="tabular-nums text-[var(--mo-text)]">
                        {prog.classification.main_course.ambiguous ?? 0}
                      </strong>
                    </div>
                    <div>
                      Нет подходящего:{" "}
                      <strong className="tabular-nums text-[var(--mo-text)]">
                        {prog.classification.main_course.no_candidate ?? 0}
                      </strong>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-lg border border-[var(--mo-border)] px-3 py-2 text-sm">
                <div className="font-semibold">Протоколы</div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    Связано:{" "}
                    <strong className="tabular-nums">{prog?.linked_protocol ?? "…"}</strong>
                  </span>
                  <span>
                    Требуют привязки:{" "}
                    <strong className="tabular-nums">{prog?.unresolved_protocol ?? "…"}</strong>
                  </span>
                </div>
                {prog?.classification?.protocol ? (
                  <div className="mt-2 text-[11px] mo-muted space-y-0.5">
                    <div>
                      Совпало уверенно:{" "}
                      <strong className="tabular-nums text-[var(--mo-text)]">
                        {prog.classification.protocol.high_confidence ?? 0}
                      </strong>
                    </div>
                    <div>
                      Нужна проверка:{" "}
                      <strong className="tabular-nums text-[var(--mo-text)]">
                        {prog.classification.protocol.review_required ?? 0}
                      </strong>
                    </div>
                    <div>
                      Несколько пациентов:{" "}
                      <strong className="tabular-nums text-[var(--mo-text)]">
                        {prog.classification.protocol.ambiguous ?? 0}
                      </strong>
                    </div>
                    <div>
                      Нет подходящего:{" "}
                      <strong className="tabular-nums text-[var(--mo-text)]">
                        {prog.classification.protocol.no_candidate ?? 0}
                      </strong>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            {programNeedsDq ? (
              <button
                type="button"
                className="mt-3 text-sm text-[var(--mo-accent-hover)] underline"
                onClick={() => setShowProgramDq((v) => !v)}
              >
                {showProgramDq ? "Скрыть непривязанные" : "Разобрать непривязанные"}
              </button>
            ) : (
              <p className="mt-2 text-xs mo-muted">Непривязанных продаж Курс/Протокол нет.</p>
            )}
            {showProgramDq && prog ? (
              <div className="mt-3 overflow-x-auto">
                <p className="mb-2 text-[11px] mo-muted">{prog.note}</p>
                <table className="w-full min-w-[900px] text-xs">
                  <thead>
                    <tr className="border-b border-[var(--mo-border)] text-left mo-muted">
                      <th className="px-2 py-1">Клиент</th>
                      <th className="px-2 py-1">Продукт</th>
                      <th className="px-2 py-1">Дата</th>
                      <th className="px-2 py-1 text-right">Сумма</th>
                      <th className="px-2 py-1 text-right">Оплачено</th>
                      <th className="px-2 py-1">Менеджер</th>
                      <th className="px-2 py-1">Подсказка</th>
                      <th className="px-2 py-1">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prog.rows.map((r) => (
                      <tr key={r.sale_id} className="border-b border-[var(--mo-border)]/40 align-top">
                        <td className="px-2 py-1.5">
                          {r.client_name || "—"}
                          <div className="mo-muted">{r.client_phone || ""}</div>
                        </td>
                        <td className="px-2 py-1.5">{r.product_display}</td>
                        <td className="px-2 py-1.5 tabular-nums">{formatDate(r.sold_at)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(r.service_amount)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(r.paid_amount)}</td>
                        <td className="px-2 py-1.5">{r.manager_name}</td>
                        <td className="px-2 py-1.5">
                          {(() => {
                            const conf = r.suggestion_confidence;
                            const ev = r.evidence;
                            const fioOk = ev?.fio === "exact" || ev?.fio === "partial";
                            return (
                              <div className="space-y-1">
                                {conf === "high_confidence" && r.suggested_lead ? (
                                  <div>
                                    <div className="font-medium text-emerald-600/90 dark:text-emerald-400/90">
                                      Совпало уверенно, само не привяжется
                                    </div>
                                    <div>
                                      Возможный пациент: {r.suggested_lead.lead_name} — №
                                      {r.suggested_lead.lead_id}
                                    </div>
                                  </div>
                                ) : null}
                                {conf === "review_required" && r.suggested_lead ? (
                                  <div>
                                    <div className="font-medium text-amber-600 dark:text-amber-400">
                                      Нужна проверка
                                    </div>
                                    <div>
                                      {r.suggested_lead.lead_name} — №{r.suggested_lead.lead_id}
                                    </div>
                                    <div className="text-amber-700/90 dark:text-amber-300/90">
                                      {ev?.warning ||
                                        "Телефон совпадает, данные пациента отличаются"}
                                    </div>
                                  </div>
                                ) : null}
                                {conf === "ambiguous" ? (
                                  <span className="text-amber-700 dark:text-amber-300">
                                    ⚠ Несколько возможных пациентов — автопривязка запрещена
                                  </span>
                                ) : null}
                                {conf === "no_candidate" || conf === "none" ? (
                                  <span className="mo-muted">Нет кандидата</span>
                                ) : null}
                                {/* legacy unique from old API */}
                                {conf === "unique" && r.suggested_lead ? (
                                  <div className="text-amber-700 dark:text-amber-300">
                                    Только телефон (нужен review) — {r.suggested_lead.lead_name} #
                                    {r.suggested_lead.lead_id}
                                  </div>
                                ) : null}
                                {ev ? (
                                  <div className="mo-muted text-[10px]">
                                    Телефон {ev.phone ? "✓" : "—"} · ФИО{" "}
                                    {fioOk ? "✓" : ev?.fio === "mismatch" ? "⚠" : "—"} · Booking{" "}
                                    {ev.booking ? "✓" : "—"}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex flex-col gap-1">
                            {r.suggested_lead ? (
                              <>
                                <Link
                                  to={`/leads/${r.suggested_lead.lead_id}`}
                                  className="text-[var(--mo-accent-hover)] hover:underline"
                                >
                                  Открыть карточку
                                </Link>
                                <button
                                  type="button"
                                  className="text-left text-[var(--mo-accent-hover)] underline"
                                  disabled={linkLeadMutation.isPending}
                                  onClick={() =>
                                    linkLeadMutation.mutate({
                                      saleId: r.sale_id,
                                      leadId: r.suggested_lead!.lead_id,
                                    })
                                  }
                                >
                                  Привязать
                                </button>
                              </>
                            ) : null}
                            <button
                              type="button"
                              className="text-left text-[var(--mo-accent-hover)] underline"
                              disabled={linkLeadMutation.isPending}
                              onClick={() => {
                                const raw = window.prompt(
                                  "Номер карточки пациента:",
                                );
                                const leadId = Number(raw || 0);
                                if (!leadId) return;
                                linkLeadMutation.mutate({ saleId: r.sale_id, leadId });
                              }}
                            >
                              Указать номер карточки
                            </button>
                            <span className="mo-muted">Пока не привязывать</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {prog.rows.length === 0 ? (
                  <p className="text-xs mo-muted">Список пуст.</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mo-section p-4">
            <h3 className="mb-1 text-base font-semibold">Куда идут после Курса 15</h3>
            <p className="mb-3 text-sm mo-muted">
              Мастер-класс считается, только если его отдельно отметили. Массаж и ТМС здесь не
              прячутся: они в блоке «Что берут следом».
            </p>
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
            <StatGrid entries={j?.funnel} labels={FUNNEL_LABELS} />
          </div>

          <div className="mo-section p-4">
            <h3 className="mb-1 text-base font-semibold">Переходы на курс и протокол</h3>
            <p className="mb-3 text-sm mo-muted">
              Только Курс, Протокол и мастер-класс. Массаж и ТМС смотрите выше.
            </p>
            <StatGrid entries={j?.conversions} labels={CONV_LABELS} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="mo-section p-4">
              <h3 className="mb-1 text-base font-semibold">Откуда приходят на Курс</h3>
              <p className="mb-2 text-sm mo-muted">
                Только продажи, уже привязанные к пациенту.
              </p>
              <OriginBlock
                entries={j?.main_course_origin}
                linked={prog?.linked_main_course ?? 0}
                unresolved={prog?.unresolved_main_course ?? 0}
                productLabel="Курс"
              />
            </div>
            <div className="mo-section p-4">
              <h3 className="mb-1 text-base font-semibold">Откуда приходят на Протокол</h3>
              <p className="mb-2 text-sm mo-muted">
                Протокол может быть первой покупкой или идти после любой услуги.
              </p>
              <OriginBlock
                entries={j?.protocol_origin}
                linked={prog?.linked_protocol ?? 0}
                unresolved={prog?.unresolved_protocol ?? 0}
                productLabel="Протокол"
              />
            </div>
          </div>

          <div className="mo-section overflow-x-auto p-0">
            <div className="px-4 pt-4">
              <h3 className="text-base font-semibold">Список пациентов</h3>
              <p className="mt-1 mb-2 text-sm mo-muted">
                Касса — уже оплачено. Сумма услуг — на какую сумму оформили. Долг в кассу не входит.
              </p>
            </div>
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-[var(--mo-border)] text-left text-xs mo-muted">
                  <th className="px-3 py-2">Пациент</th>
                  <th className="px-3 py-2">Первая покупка</th>
                  <th className="px-3 py-2">Последняя покупка</th>
                  <th className="px-3 py-2">Дата последней покупки</th>
                  <th className="px-3 py-2 text-right">Касса</th>
                  <th className="px-3 py-2 text-right">Сумма услуг</th>
                  <th className="px-3 py-2 text-right">Возвраты</th>
                  <th
                    className="px-3 py-2 text-right"
                    title="Математический остаток по активному обязательству. Не дебиторка."
                  >
                    Остаток
                  </th>
                  <th
                    className="px-3 py-2 text-right"
                    title="Сколько пациент ещё должен по открытым услугам."
                  >
                    Долг
                  </th>
                  <th className="px-3 py-2 text-right">Покупок</th>
                  <th className="px-3 py-2 text-right">Дней</th>
                </tr>
              </thead>
              <tbody>
                {(data.patients_rows ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center mo-muted">
                      В этом периоде нет пациентов с первой покупкой. Нажмите «Обновить данные».
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
                        {productDisplayLabel(
                          r.first_purchase_product_key,
                          r.first_purchase_product_name,
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {productDisplayLabel(
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
