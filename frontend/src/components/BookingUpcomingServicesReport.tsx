import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import type { BookingSpecialist } from "@/lib/types";

export type UpcomingPeriod = "today" | "tomorrow" | "next_7_days" | "next_30_days";

type Summary = {
  today: number;
  tomorrow: number;
  next_7_days: number;
  next_30_days: number;
  today_unique_patients: number;
  tomorrow_unique_patients: number;
  next_7_days_unique_patients: number;
  next_30_days_unique_patients: number;
  today_breakdown?: {
    total_load: number;
    booked: number;
    completed: number;
    no_show: number;
    cancelled: number;
  };
};

type ServiceRow = {
  direction_id: number;
  direction_name: string;
  today_appointments: number;
  today_unique_patients: number;
  tomorrow_appointments: number;
  tomorrow_unique_patients: number;
  next_7_days_appointments: number;
  next_7_days_unique_patients: number;
  next_30_days_appointments: number;
  next_30_days_unique_patients: number;
};

type Report = {
  timezone: string;
  today_ymd: string;
  tomorrow_ymd: string;
  next_7_days_from: string;
  next_7_days_to: string;
  next_30_days_from: string;
  next_30_days_to: string;
  summary: Summary;
  services: ServiceRow[];
};

type DrillRow = {
  id: number;
  start_at: string;
  date_ymd: string;
  time_label: string;
  patient_name: string;
  patient_phone: string;
  lead_id: number | null;
  direction_id: number;
  direction_name: string;
  specialist_id: number;
  specialist_name: string | null;
  manager_name: string | null;
  status: string;
  service_amount: string | number;
  paid_amount: string | number;
  remainder_amount: string | number;
};

type DrillDown = {
  period: UpcomingPeriod;
  direction_id: number | null;
  direction_name: string | null;
  from_ymd: string;
  to_ymd: string;
  appointments_total: number;
  unique_patients: number;
  page: number;
  page_size: number;
  daily: { date_ymd: string; appointments: number }[];
  rows: DrillRow[];
};

type SortKey = "name" | UpcomingPeriod;

type DrillTarget = {
  period: UpcomingPeriod;
  directionId: number | null;
  label: string;
};

type Props = {
  specialists: BookingSpecialist[];
  directions?: { id: number; name: string }[];
  onOpenAppointment?: (appointmentId: number) => void;
};

const PERIOD_LABEL: Record<UpcomingPeriod, string> = {
  today: "Сегодня",
  tomorrow: "Завтра",
  next_7_days: "Неделя",
  next_30_days: "Месяц",
};

const STATUS_LABEL: Record<string, string> = {
  booked: "Запись",
  completed: "Явился",
  no_show: "Не явился",
  cancelled: "Отмена",
};

function countWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "запись";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "записи";
  return "записей";
}

function formatYmdShort(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

function cellCount(row: ServiceRow, period: UpcomingPeriod): number {
  if (period === "today") return row.today_appointments;
  if (period === "tomorrow") return row.tomorrow_appointments;
  if (period === "next_7_days") return row.next_7_days_appointments;
  return row.next_30_days_appointments;
}

export function BookingUpcomingServicesReport({
  specialists,
  directions = [],
  onOpenAppointment,
}: Props) {
  const [specialistId, setSpecialistId] = useState<number | "">("");
  const [directionFilter, setDirectionFilter] = useState<number | "">("");
  const [sortKey, setSortKey] = useState<SortKey>("next_7_days");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [page, setPage] = useState(1);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (specialistId !== "") p.set("specialist_id", String(specialistId));
    if (directionFilter !== "") p.set("direction_id", String(directionFilter));
    return p.toString();
  }, [specialistId, directionFilter]);

  const reportQuery = useQuery({
    queryKey: ["booking-upcoming-services", qs],
    queryFn: () =>
      apiFetch<Report>(`/api/booking/reports/upcoming-services${qs ? `?${qs}` : ""}`),
  });

  const drillQs = useMemo(() => {
    if (!drill) return "";
    const p = new URLSearchParams();
    p.set("period", drill.period);
    p.set("page", String(page));
    p.set("page_size", "50");
    if (drill.directionId != null) p.set("direction_id", String(drill.directionId));
    if (specialistId !== "") p.set("specialist_id", String(specialistId));
    return p.toString();
  }, [drill, page, specialistId]);

  const drillQuery = useQuery({
    queryKey: ["booking-upcoming-drill", drillQs],
    queryFn: () =>
      apiFetch<DrillDown>(`/api/booking/reports/upcoming-services/appointments?${drillQs}`),
    enabled: Boolean(drill),
  });

  const services = useMemo(() => {
    const rows = reportQuery.data?.services ?? [];
    const sorted = [...rows];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = a.direction_name.localeCompare(b.direction_name, "ru");
      } else {
        cmp = cellCount(a, sortKey) - cellCount(b, sortKey);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [reportQuery.data?.services, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  function openDrill(period: UpcomingPeriod, directionId: number | null, label: string, count: number) {
    if (count <= 0) return;
    setPage(1);
    setDrill({ period, directionId, label });
  }

  const summary = reportQuery.data?.summary;
  const cards: { period: UpcomingPeriod; value: number; hint?: string }[] = [
    { period: "today", value: summary?.today ?? 0, hint: reportQuery.data?.today_ymd },
    { period: "tomorrow", value: summary?.tomorrow ?? 0, hint: reportQuery.data?.tomorrow_ymd },
    {
      period: "next_7_days",
      value: summary?.next_7_days ?? 0,
      hint: reportQuery.data
        ? `${formatYmdShort(reportQuery.data.next_7_days_from)} – ${formatYmdShort(reportQuery.data.next_7_days_to)}`
        : undefined,
    },
    {
      period: "next_30_days",
      value: summary?.next_30_days ?? 0,
      hint: reportQuery.data
        ? `${formatYmdShort(reportQuery.data.next_30_days_from)} – ${formatYmdShort(reportQuery.data.next_30_days_to)}`
        : undefined,
    },
  ];

  return (
    <div className="booking-upcoming space-y-4">
      <div className="booking-upcoming__filters flex flex-wrap items-end gap-3">
        <label className="block text-sm mo-muted">
          Услуга
          <select
            className="mo-input mt-1 min-w-[10rem]"
            value={directionFilter === "" ? "" : directionFilter}
            onChange={(e) =>
              setDirectionFilter(e.target.value ? Number(e.target.value) : "")
            }
          >
            <option value="">Все</option>
            {(directions.length > 0
              ? directions
              : (reportQuery.data?.services ?? []).map((s) => ({
                  id: s.direction_id,
                  name: s.direction_name,
                }))
            ).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm mo-muted">
          Специалист
          <select
            className="mo-input mt-1 min-w-[10rem]"
            value={specialistId === "" ? "" : specialistId}
            onChange={(e) => setSpecialistId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Все</option>
            {specialists.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </label>
        {reportQuery.data?.timezone ? (
          <p className="pb-2 text-xs mo-muted">Часовой пояс: {reportQuery.data.timezone}</p>
        ) : null}
      </div>

      {reportQuery.isLoading ? <p className="lux-caption">Загрузка отчёта…</p> : null}
      {reportQuery.isError ? (
        <p className="text-sm text-red-400">{(reportQuery.error as Error).message}</p>
      ) : null}

      {summary ? (
        <>
          <div className="booking-upcoming__kpis grid grid-cols-2 gap-2 sm:grid-cols-4">
            {cards.map((c) => (
              <button
                key={c.period}
                type="button"
                className="booking-upcoming__kpi mo-section p-3 text-left transition hover:ring-1 hover:ring-[var(--mo-accent)] disabled:opacity-50"
                disabled={c.value <= 0}
                onClick={() => openDrill(c.period, null, PERIOD_LABEL[c.period], c.value)}
              >
                <div className="text-[11px] font-medium uppercase tracking-wide mo-muted">
                  {PERIOD_LABEL[c.period]}
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--mo-text)]">
                  {c.value.toLocaleString("ru-RU")}
                </div>
                <div className="text-[11px] mo-muted">
                  {countWord(c.value)}
                  {c.hint ? ` · ${c.hint}` : ""}
                </div>
              </button>
            ))}
          </div>

          {summary.today_breakdown ? (
            <p className="text-xs mo-muted">
              Сегодня: ожидаются {summary.today_breakdown.booked}, явились{" "}
              {summary.today_breakdown.completed}, не явились {summary.today_breakdown.no_show}
              {summary.today_breakdown.cancelled
                ? `, отменены ${summary.today_breakdown.cancelled}`
                : ""}
            </p>
          ) : null}

          <div className="mo-section overflow-x-auto p-0">
            <table className="booking-upcoming__table w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-[var(--mo-border)] text-left text-xs mo-muted">
                  <th className="px-3 py-2">
                    <button type="button" className="hover:text-[var(--mo-text)]" onClick={() => toggleSort("name")}>
                      Услуга
                    </button>
                  </th>
                  {(
                    [
                      "today",
                      "tomorrow",
                      "next_7_days",
                      "next_30_days",
                    ] as UpcomingPeriod[]
                  ).map((p) => (
                    <th key={p} className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="hover:text-[var(--mo-text)]"
                        onClick={() => toggleSort(p)}
                      >
                        {PERIOD_LABEL[p]}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {services.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center mo-muted">
                      Нет услуг в каталоге
                    </td>
                  </tr>
                ) : (
                  services.map((s) => (
                    <tr key={s.direction_id} className="border-b border-[var(--mo-border)]/70">
                      <td className="px-3 py-2.5 font-medium text-[var(--mo-text)]">
                        {s.direction_name}
                      </td>
                      {(
                        [
                          "today",
                          "tomorrow",
                          "next_7_days",
                          "next_30_days",
                        ] as UpcomingPeriod[]
                      ).map((p) => {
                        const n = cellCount(s, p);
                        return (
                          <td key={p} className="px-3 py-2.5 text-right tabular-nums">
                            {n > 0 ? (
                              <button
                                type="button"
                                className="rounded px-1.5 py-0.5 font-medium text-[var(--mo-accent-hover)] hover:bg-[var(--mo-accent-soft)]"
                                onClick={() =>
                                  openDrill(p, s.direction_id, s.direction_name, n)
                                }
                              >
                                {n}
                              </button>
                            ) : (
                              <span className="mo-muted">0</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {drill ? (
        <div
          className="booking-upcoming__modal fixed inset-0 z-[400] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Записи периода"
          onClick={() => setDrill(null)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--mo-border)] px-4 py-3">
              <div>
                <h3 className="text-base font-semibold text-[var(--mo-text)]">{drill.label}</h3>
                <p className="text-xs mo-muted">
                  {PERIOD_LABEL[drill.period]}
                  {drillQuery.data
                    ? ` · ${formatYmdShort(drillQuery.data.from_ymd)}${
                        drillQuery.data.from_ymd !== drillQuery.data.to_ymd
                          ? ` – ${formatYmdShort(drillQuery.data.to_ymd)}`
                          : ""
                      }`
                    : ""}
                </p>
                {drillQuery.data ? (
                  <p className="mt-1 text-sm text-[var(--mo-text)]">
                    {drillQuery.data.appointments_total.toLocaleString("ru-RU")}{" "}
                    {countWord(drillQuery.data.appointments_total)} ·{" "}
                    {drillQuery.data.unique_patients.toLocaleString("ru-RU")} уник. пациентов
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="rounded-lg border border-[var(--mo-border)] px-2 py-1 text-sm mo-muted"
                onClick={() => setDrill(null)}
              >
                Закрыть
              </button>
            </div>

            {drillQuery.isLoading ? (
              <p className="px-4 py-6 lux-caption">Загрузка…</p>
            ) : null}
            {drillQuery.isError ? (
              <p className="px-4 py-4 text-sm text-red-400">
                {(drillQuery.error as Error).message}
              </p>
            ) : null}

            {drillQuery.data &&
            (drill.period === "next_7_days" || drill.period === "next_30_days") ? (
              <div className="flex gap-2 overflow-x-auto border-b border-[var(--mo-border)] px-4 py-2">
                {drillQuery.data.daily.map((d) => (
                  <div
                    key={d.date_ymd}
                    className="shrink-0 rounded-lg border border-[var(--mo-border)] px-2 py-1 text-center"
                  >
                    <div className="text-[10px] mo-muted">{formatYmdShort(d.date_ymd)}</div>
                    <div className="text-sm font-semibold tabular-nums">{d.appointments}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto">
              {drillQuery.data?.rows.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm mo-muted">Нет записей за период</p>
              ) : (
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="sticky top-0 bg-[var(--mo-surface-elevated)] text-left text-xs mo-muted">
                      <th className="px-3 py-2">Время</th>
                      <th className="px-3 py-2">Пациент</th>
                      <th className="px-3 py-2">Телефон</th>
                      <th className="px-3 py-2">Услуга</th>
                      <th className="px-3 py-2">Специалист</th>
                      <th className="px-3 py-2">Менеджер</th>
                      <th className="px-3 py-2">Статус</th>
                      <th className="px-3 py-2 text-right">Остаток</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(drillQuery.data?.rows ?? []).map((r) => (
                      <tr key={r.id} className="border-t border-[var(--mo-border)]/60">
                        <td className="px-3 py-2 tabular-nums">
                          <button
                            type="button"
                            className="text-left hover:underline"
                            onClick={() => onOpenAppointment?.(r.id)}
                          >
                            <span className="block text-[10px] mo-muted">
                              {formatYmdShort(r.date_ymd)}
                            </span>
                            {r.time_label}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          {r.lead_id != null ? (
                            <Link
                              to={`/leads/${r.lead_id}`}
                              className="font-medium text-[var(--mo-accent-hover)] hover:underline"
                            >
                              {r.patient_name}
                            </Link>
                          ) : (
                            <span className="font-medium">{r.patient_name}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums mo-muted">{r.patient_phone || "—"}</td>
                        <td className="px-3 py-2">{r.direction_name}</td>
                        <td className="px-3 py-2">{r.specialist_name || "—"}</td>
                        <td className="px-3 py-2">{r.manager_name || "—"}</td>
                        <td className="px-3 py-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatMoney(Number(r.remainder_amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {drillQuery.data && drillQuery.data.appointments_total > drillQuery.data.page_size ? (
              <div className="flex items-center justify-between gap-2 border-t border-[var(--mo-border)] px-4 py-2">
                <button
                  type="button"
                  className="btn-secondary px-3 py-1 text-xs"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Назад
                </button>
                <span className="text-xs mo-muted">
                  Стр. {page} · всего {drillQuery.data.appointments_total}
                </span>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1 text-xs"
                  disabled={page * drillQuery.data.page_size >= drillQuery.data.appointments_total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Далее
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
