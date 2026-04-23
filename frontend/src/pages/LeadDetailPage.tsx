import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import {
  BOOKING_TIME_ZONE,
  datetimeLocalBookingToIsoUtc,
  formatTimeRangeInBookingTz,
  weekdayMon0InBookingTz,
  ymdInBookingTz,
  zonedWallTimeToUtcMs,
} from "@/lib/bookingTz";
import type {
  BookingAppointment,
  BookingSpecialist,
  FinanceJournalEntryDetail,
  Lead,
  LeadAuditEvent,
  SalesKpiLeadPriceHint,
} from "@/lib/types";

export function LeadDetailPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const leadId = Number(id);
  const qc = useQueryClient();
  const [auditOpen, setAuditOpen] = useState(false);
  const [closeDealOpen, setCloseDealOpen] = useState(false);
  const [closeAmount, setCloseAmount] = useState("");
  const [closePaid, setClosePaid] = useState("");
  const [editLeadOpen, setEditLeadOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editSource, setEditSource] = useState("");
  const [moveModalAppointment, setMoveModalAppointment] = useState<BookingAppointment | null>(null);
  const [moveDateYmd, setMoveDateYmd] = useState("");
  const [moveMinuteOfDay, setMoveMinuteOfDay] = useState<number | null>(null);

  const SLOT_STEP_MIN = 30;

  function addDaysInBookingTz(ymd: string, days: number): string {
    const noonMs = zonedWallTimeToUtcMs(ymd, 12, 0);
    return ymdInBookingTz(noonMs + days * 24 * 60 * 60 * 1000);
  }

  function computeFreeStartMinutes(
    dateYmd: string,
    specialist: BookingSpecialist,
    appointments: BookingAppointment[],
    durationMin: number,
    ignoreAppointmentId: number,
  ): number[] {
    const weekdays = specialist.work_weekdays?.length ? specialist.work_weekdays : [0, 1, 2, 3, 4];
    if (!weekdays.includes(weekdayMon0InBookingTz(dateYmd))) return [];
    const workStartMin = (specialist.work_start_hour ?? 9) * 60;
    const workEndMin = (specialist.work_end_hour ?? 18) * 60;
    const busy = appointments.filter((a) => a.status === "booked" && a.id !== ignoreAppointmentId);
    const out: number[] = [];
    for (let m = workStartMin; m + durationMin <= workEndMin; m += SLOT_STEP_MIN) {
      const startMs = zonedWallTimeToUtcMs(dateYmd, Math.floor(m / 60), m % 60);
      const endMs = startMs + durationMin * 60_000;
      const overlapped = busy.some((a) => {
        const aStart = new Date(a.start_at).getTime();
        const aEnd = new Date(a.end_at).getTime();
        return aEnd > startMs && aStart < endMs;
      });
      if (!overlapped) out.push(m);
    }
    return out;
  }

  const query = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => apiFetch<Lead>(`/api/leads/${leadId}`),
    enabled: Number.isFinite(leadId) && leadId > 0,
  });
  const leadPriceHintQuery = useQuery({
    queryKey: ["lead-kpi-price-hint", leadId],
    queryFn: () => apiFetch<SalesKpiLeadPriceHint>(`/api/sales-kpi/lead-price-hint?lead_id=${leadId}`),
    enabled: Number.isFinite(leadId) && leadId > 0,
  });
  const fixedCloseAmount =
    leadPriceHintQuery.data?.fixed_price != null ? Number(leadPriceHintQuery.data.fixed_price) : null;

  const closeDealMutation = useMutation({
    mutationFn: async (body: { amount?: number; paid_amount: number }) =>
      apiFetch<Lead>(`/api/leads/${leadId}/close-deal`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Сделка закрыта");
      setCloseDealOpen(false);
      void qc.invalidateQueries({ queryKey: ["lead", leadId] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось закрыть сделку"),
  });

  const rejectMutation = useMutation({
    mutationFn: async (reason?: string) =>
      apiFetch<Lead>(`/api/leads/${leadId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: reason?.trim() || null }),
      }),
    onSuccess: () => {
      toast.success("Лид переведён в «Неуспешно»");
      void qc.invalidateQueries({ queryKey: ["lead", leadId] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["leads-table"] });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось оформить отказ"),
  });

  const role = decodeRoleFromToken(getStoredToken());
  const canRejectLead = role === "owner" || role === "admin" || role === "manager";
  const canEditLeadProfile = role === "owner" || role === "admin";
  const canEditBooking = role !== "expert";
  const homeLink = role === "manager" || role === "admin" ? "/crm" : "/";
  const homeLabel = "Канбан";

  const appointmentFromUrl = Number(searchParams.get("appointment"));

  const leadAppointmentsQuery = useQuery({
    queryKey: ["booking-appointments-by-lead", leadId],
    queryFn: () => apiFetch<BookingAppointment[]>(`/api/booking/appointments?lead_id=${leadId}`),
    enabled: Number.isFinite(leadId) && leadId > 0,
  });

  const specialistsQuery = useQuery({
    queryKey: ["booking-specialists", "lead-move-modal"],
    queryFn: () => apiFetch<BookingSpecialist[]>("/api/booking/specialists"),
    enabled: Boolean(moveModalAppointment),
  });

  const moveTargetSpecialist = useMemo(() => {
    if (!moveModalAppointment) return null;
    return (specialistsQuery.data ?? []).find((s) => s.id === moveModalAppointment.specialist_id) ?? null;
  }, [specialistsQuery.data, moveModalAppointment]);

  const moveTargetDurationMin = useMemo(() => {
    if (!moveModalAppointment) return 30;
    const start = new Date(moveModalAppointment.start_at).getTime();
    const end = new Date(moveModalAppointment.end_at).getTime();
    const mins = Math.round((end - start) / 60_000);
    return mins > 0 ? mins : 30;
  }, [moveModalAppointment]);

  const moveAvailableDaysQuery = useQuery({
    queryKey: ["booking-move-available-days", moveModalAppointment?.id, moveModalAppointment?.specialist_id],
    enabled: Boolean(moveModalAppointment && moveTargetSpecialist),
    queryFn: async () => {
      if (!moveModalAppointment || !moveTargetSpecialist) return [] as Array<{ dateYmd: string; slots: number[] }>;
      const today = ymdInBookingTz(Date.now());
      const maxScanDays = 180;
      const wantedDays = 30;
      const out: Array<{ dateYmd: string; slots: number[] }> = [];
      for (let delta = 0; delta < maxScanDays && out.length < wantedDays; delta += 1) {
        const dateYmd = addDaysInBookingTz(today, delta);
        const dayAppointments = await apiFetch<BookingAppointment[]>(
          `/api/booking/appointments?date=${dateYmd}&specialist_id=${moveModalAppointment.specialist_id}`,
        );
        const slots = computeFreeStartMinutes(
          dateYmd,
          moveTargetSpecialist,
          dayAppointments,
          moveTargetDurationMin,
          moveModalAppointment.id,
        );
        if (slots.length > 0) out.push({ dateYmd, slots });
      }
      return out;
    },
  });

  const moveAppointmentMutation = useMutation({
    mutationFn: (body: { appointmentId: number; specialist_id: number; start_at: string }) =>
      apiFetch<BookingAppointment>(`/api/booking/appointments/${body.appointmentId}/move`, {
        method: "PATCH",
        body: JSON.stringify({
          specialist_id: body.specialist_id,
          start_at: body.start_at,
        }),
      }),
    onSuccess: () => {
      toast.success("Запись перенесена на следующий месяц");
      void qc.invalidateQueries({ queryKey: ["booking-appointments-by-lead", leadId] });
      void qc.invalidateQueries({ queryKey: ["booking-appointments-grid"] });
      void qc.invalidateQueries({ queryKey: ["booking-journal"] });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось перенести запись"),
  });

  const deleteAppointmentMutation = useMutation({
    mutationFn: (appointmentId: number) =>
      apiFetch(`/api/booking/appointments/${appointmentId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Запись удалена");
      void qc.invalidateQueries({ queryKey: ["booking-appointments-by-lead", leadId] });
      void qc.invalidateQueries({ queryKey: ["booking-appointments-grid"] });
      void qc.invalidateQueries({ queryKey: ["booking-journal"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["analytics-full"] });
      void qc.invalidateQueries({ queryKey: ["analytics-detailed"] });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось удалить запись"),
  });

  const patchLeadMutation = useMutation({
    mutationFn: (body: { name: string; phone: string | null; email: string | null; source: string | null }) =>
      apiFetch<Lead>(`/api/leads/${leadId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Карточка клиента обновлена");
      setEditLeadOpen(false);
      void qc.invalidateQueries({ queryKey: ["lead", leadId] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["leads-table"] });
      void qc.invalidateQueries({ queryKey: ["booking-appointments-by-lead", leadId] });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось обновить карточку"),
  });

  function openEditLeadModal() {
    if (!query.data) return;
    setEditName(query.data.name ?? "");
    setEditPhone(query.data.phone ?? "");
    setEditEmail(query.data.email ?? "");
    setEditSource(query.data.source ?? "");
    setEditLeadOpen(true);
  }

  function submitLeadEdit() {
    const name = editName.trim();
    if (!name) {
      toast.error("Введите ФИО клиента");
      return;
    }
    patchLeadMutation.mutate({
      name,
      phone: editPhone.trim() || null,
      email: editEmail.trim() || null,
      source: editSource.trim() || null,
    });
  }

  function openMoveAppointmentModal(a: BookingAppointment) {
    setMoveDateYmd("");
    setMoveMinuteOfDay(null);
    setMoveModalAppointment(a);
  }

  function handleMoveAppointmentSubmit() {
    if (!moveModalAppointment) return;
    if (!moveDateYmd || moveMinuteOfDay == null) {
      toast.error("Выберите свободные дату и время");
      return;
    }
    let startAtIso: string;
    try {
      const hh = Math.floor(moveMinuteOfDay / 60);
      const mm = moveMinuteOfDay % 60;
      startAtIso = datetimeLocalBookingToIsoUtc(
        `${moveDateYmd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
      );
    } catch {
      toast.error("Неверная дата или время");
      return;
    }
    moveAppointmentMutation.mutate(
      {
        appointmentId: moveModalAppointment.id,
        specialist_id: moveModalAppointment.specialist_id,
        start_at: startAtIso,
      },
      {
        onSuccess: () => {
          setMoveModalAppointment(null);
          setMoveDateYmd("");
          setMoveMinuteOfDay(null);
        },
      },
    );
  }

  function handleDeleteAppointment(a: BookingAppointment) {
    if (!window.confirm("Удалить эту запись из журнала онлайн-записи?")) return;
    deleteAppointmentMutation.mutate(a.id);
  }

  const selectedMoveDay = useMemo(
    () => (moveAvailableDaysQuery.data ?? []).find((d) => d.dateYmd === moveDateYmd),
    [moveAvailableDaysQuery.data, moveDateYmd],
  );

  useEffect(() => {
    if (!moveModalAppointment) return;
    const days = moveAvailableDaysQuery.data ?? [];
    if (days.length === 0) return;
    if (!moveDateYmd || !days.some((d) => d.dateYmd === moveDateYmd)) {
      setMoveDateYmd(days[0].dateYmd);
      setMoveMinuteOfDay(days[0].slots[0] ?? null);
      return;
    }
    const currentSlots = days.find((d) => d.dateYmd === moveDateYmd)?.slots ?? [];
    if (moveMinuteOfDay == null || !currentSlots.includes(moveMinuteOfDay)) {
      setMoveMinuteOfDay(currentSlots[0] ?? null);
    }
  }, [moveModalAppointment, moveAvailableDaysQuery.data, moveDateYmd, moveMinuteOfDay]);

  const auditQuery = useQuery({
    queryKey: ["lead-audit", leadId],
    queryFn: () => apiFetch<LeadAuditEvent[]>(`/api/leads/${leadId}/audit`),
    enabled: auditOpen && Number.isFinite(leadId) && leadId > 0,
  });

  const canSeeFinanceJournal =
    role === "owner" || role === "admin" || role === "super_owner" || role === "finance_analyst";

  const financeJournalQuery = useQuery({
    queryKey: ["lead-finance-journal", leadId],
    queryFn: () =>
      apiFetch<FinanceJournalEntryDetail[]>(`/api/finance/journal-entries?lead_id=${leadId}&limit=40`),
    enabled: canSeeFinanceJournal && Number.isFinite(leadId) && leadId > 0,
  });

  if (!Number.isFinite(leadId) || leadId <= 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-slate-400">
        Некорректный идентификатор лида.
        <Link to="/booking" className="mt-4 block text-purple-300 hover:underline">
          ← К онлайн-записи
        </Link>
      </div>
    );
  }

  return (
    <div className="relative mx-auto max-w-2xl space-y-8 pb-10">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Link
          to="/booking"
          className="font-medium text-purple-300 underline-offset-4 hover:text-purple-200 hover:underline"
        >
          ← Онлайн запись
        </Link>
        <Link to={homeLink} className="text-slate-400 hover:text-slate-200">
          {homeLabel}
        </Link>
      </div>

      {query.isLoading && <p className="text-slate-400">Загрузка карточки…</p>}
      {query.isError && (
        <p className="text-red-300">{(query.error as Error).message ?? "Ошибка загрузки"}</p>
      )}

      {query.data && (
        <article className="relative rounded-3xl border border-slate-700/40 bg-slate-800/40 p-8 shadow-2xl backdrop-blur-xl">
          <div className="absolute right-3 top-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setAuditOpen(true)}
              className="rounded-xl border border-slate-600/70 bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-purple-400/60 hover:bg-purple-500/15"
            >
              Аудит
            </button>
            {canEditLeadProfile && (
              <button
                type="button"
                onClick={openEditLeadModal}
                className="rounded-xl border border-slate-600/70 bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-sky-400/60 hover:bg-sky-500/15"
              >
                Редактировать
              </button>
            )}
            <Link
              to={`/chat?lead_id=${query.data.id}`}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-600/70 bg-slate-900/70 px-3 text-sm font-semibold text-slate-100 transition hover:border-indigo-400/60 hover:bg-indigo-500/20"
              title="Открыть чат с клиентом"
            >
              Чат
            </Link>
            {query.data.show_close_deal_button && (
              <button
                type="button"
                onClick={() => {
                  setCloseAmount("");
                  setClosePaid("");
                  setCloseDealOpen(true);
                }}
                className="rounded-xl border border-emerald-600/50 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:border-emerald-400/60 hover:bg-emerald-900/30"
              >
                Закрыть сделку
              </button>
            )}
            {canRejectLead && (
              <button
                type="button"
                disabled={rejectMutation.isPending}
                onClick={() => {
                  const reason = window.prompt("Причина отказа (необязательно)", "");
                  if (reason == null) return;
                  rejectMutation.mutate(reason.trim() || undefined);
                }}
                className="rounded-xl border border-rose-600/50 bg-rose-950/40 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:border-rose-400/60 hover:bg-rose-900/30 disabled:opacity-50"
              >
                Отказ
              </button>
            )}
          </div>
          <header className="mb-6 border-b border-slate-700/50 pb-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Клиент / лид</p>
            <h1 className="mt-1 text-3xl font-semibold text-white">{query.data.name}</h1>
            {query.data.stage_name && (
              <p className="mt-2 inline-flex rounded-full bg-purple-500/15 px-3 py-1 text-sm text-purple-200 ring-1 ring-purple-500/30">
                {query.data.stage_name}
              </p>
            )}
          </header>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Телефон</dt>
              <dd className="mt-1 text-lg text-slate-100">{query.data.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Email</dt>
              <dd className="mt-1 text-lg text-slate-100">{query.data.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Источник</dt>
              <dd className="mt-1 text-slate-200">{query.data.source ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Ответственный менеджер</dt>
              <dd className="mt-1 text-slate-200">{query.data.manager_name || "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">ID в MetodiOne</dt>
              <dd className="mt-1 font-mono text-slate-300">#{query.data.id}</dd>
            </div>
          </dl>

          {(leadAppointmentsQuery.data ?? []).length > 0 && (
            <section className="mt-8 border-t border-slate-700/50 pt-6">
              <h2 className="text-sm font-semibold text-white">Онлайн-запись</h2>
              <p className="mt-1 text-xs text-slate-500">
                Активные записи по этому лиду. «Перенос» открывает выбор даты и времени в календаре записи.
              </p>
              {leadAppointmentsQuery.isLoading && <p className="mt-2 text-xs text-slate-500">Загрузка…</p>}
              {leadAppointmentsQuery.isError && (
                <p className="mt-2 text-xs text-rose-300">
                  {(leadAppointmentsQuery.error as Error).message ?? "Не удалось загрузить записи"}
                </p>
              )}
              <ul className="mt-3 space-y-3">
                {(leadAppointmentsQuery.data ?? []).map((a) => {
                  const isBooked = a.status === "booked";
                  const highlight =
                    Number.isFinite(appointmentFromUrl) && appointmentFromUrl === a.id && isBooked;
                  return (
                    <li
                      key={a.id}
                      className={[
                        "rounded-xl border p-4 text-sm",
                        highlight
                          ? "border-sky-500/50 bg-sky-500/10 ring-1 ring-sky-400/30"
                          : "border-slate-700/50 bg-slate-900/40",
                      ].join(" ")}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-slate-100">
                            {new Date(a.start_at).toLocaleDateString("ru-RU", {
                              day: "2-digit",
                              month: "long",
                              year: "numeric",
                              timeZone: BOOKING_TIME_ZONE,
                            })}
                          </p>
                          <p className="mt-0.5 text-slate-300">
                            {formatTimeRangeInBookingTz(a.start_at, a.end_at)}
                            {a.specialist_name ? ` · ${a.specialist_name}` : ""}
                            {a.direction_name ? ` · ${a.direction_name}` : ""}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Статус:{" "}
                            {a.status === "booked"
                              ? "Записан"
                              : a.status === "completed"
                                ? "Завершён"
                                : a.status === "no_show"
                                  ? "Не явился"
                                  : a.status === "cancelled"
                                    ? "Отменён"
                                    : a.status}
                          </p>
                        </div>
                        {canEditBooking && isBooked && (
                          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                            <button
                              type="button"
                              disabled={moveAppointmentMutation.isPending || deleteAppointmentMutation.isPending}
                              onClick={() => openMoveAppointmentModal(a)}
                              className="rounded-xl border border-slate-600/70 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-purple-400/60 hover:bg-purple-500/15 disabled:opacity-50"
                            >
                              Перенос записи
                            </button>
                            <button
                              type="button"
                              disabled={moveAppointmentMutation.isPending || deleteAppointmentMutation.isPending}
                              onClick={() => handleDeleteAppointment(a)}
                              className="rounded-xl border border-rose-600/50 bg-rose-950/40 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:border-rose-400/60 hover:bg-rose-900/30 disabled:opacity-50"
                            >
                              Удалить запись
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {canSeeFinanceJournal ? (
            <section className="mt-8 border-t border-slate-700/50 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-white">Финансы: проводки по лиду</h2>
                <Link
                  to="/finance"
                  className="text-xs font-medium text-purple-300 hover:text-purple-200 hover:underline"
                >
                  Открыть финансы →
                </Link>
              </div>
              {financeJournalQuery.isLoading && <p className="mt-2 text-xs text-slate-500">Загрузка журнала…</p>}
              {financeJournalQuery.isError && (
                <p className="mt-2 text-xs text-rose-300">
                  {(financeJournalQuery.error as Error).message ?? "Нет доступа или ошибка API"}
                </p>
              )}
              {(financeJournalQuery.data ?? []).length === 0 && !financeJournalQuery.isLoading && (
                <p className="mt-2 text-xs text-slate-500">Проводок с привязкой к этому лиду пока нет.</p>
              )}
              <ul className="mt-3 space-y-2">
                {(financeJournalQuery.data ?? []).map((je) => (
                  <li key={je.id} className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3 text-xs">
                    <div className="flex flex-wrap gap-2 text-slate-300">
                      <span className="font-mono text-slate-400">#{je.id}</span>
                      <span>{new Date(je.entry_date).toLocaleString("ru-RU")}</span>
                      <span className="rounded bg-slate-700/60 px-2 py-0.5 text-slate-200">{je.source_type}</span>
                    </div>
                    {je.memo && <p className="mt-1 text-slate-400">{je.memo}</p>}
                    <ul className="mt-2 space-y-1 font-mono text-[11px] text-slate-500">
                      {je.lines.map((ln, i) => (
                        <li key={i}>
                          {ln.account_code} {ln.debit !== "0" ? `Дт ${ln.debit}` : ""}{" "}
                          {ln.credit !== "0" ? `Кт ${ln.credit}` : ""}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </article>
      )}

      {closeDealOpen && query.data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          onClick={() => setCloseDealOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">Закрыть сделку</h3>
            <p className="mt-2 text-sm text-slate-400">
              {fixedCloseAmount != null
                ? "Для последней услуги по этому лиду цена зафиксирована в KPI. Укажите только фактическую оплату."
                : "Укажите стоимость услуги и фактическую оплату. Лид будет переведён на стадию успешного закрытия."}{" "}
              Повторно закрыть того же лида нельзя.
            </p>
            <div className="mt-4 grid gap-3">
              {fixedCloseAmount != null ? (
                <div className="rounded-xl border border-emerald-600/40 bg-emerald-900/10 px-3 py-2 text-sm text-emerald-300">
                  Цена по KPI: {fixedCloseAmount.toLocaleString("ru-RU")}
                </div>
              ) : (
                <label className="text-sm text-slate-300">
                  Стоимость услуги
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={closeAmount}
                    onChange={(e) => setCloseAmount(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                  />
                </label>
              )}
              <label className="text-sm text-slate-300">
                Оплачено фактически
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={closePaid}
                  onChange={(e) => setClosePaid(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setCloseDealOpen(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={closeDealMutation.isPending}
                onClick={() => {
                  const amount = fixedCloseAmount ?? Number(closeAmount);
                  const paid = Number(closePaid);
                  if (!Number.isFinite(paid) || paid < 0) {
                    toast.error("Введите неотрицательные числа");
                    return;
                  }
                  if (!Number.isFinite(amount) || amount < 0) {
                    toast.error("Укажите стоимость услуги");
                    return;
                  }
                  if (fixedCloseAmount != null) {
                    closeDealMutation.mutate({ paid_amount: paid });
                    return;
                  }
                  closeDealMutation.mutate({ amount, paid_amount: paid });
                }}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}

      {editLeadOpen && query.data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          onClick={() => {
            if (patchLeadMutation.isPending) return;
            setEditLeadOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">Редактировать клиента</h3>
            <p className="mt-2 text-sm text-slate-400">
              Можно обновить ФИО, телефон, email и источник прямо из карточки.
            </p>
            <div className="mt-4 grid gap-3">
              <label className="text-sm text-slate-300">
                ФИО
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-slate-300">
                Телефон
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-slate-300">
                Email
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-slate-300">
                Источник
                <input
                  value={editSource}
                  onChange={(e) => setEditSource(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={patchLeadMutation.isPending}
                onClick={() => setEditLeadOpen(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={patchLeadMutation.isPending}
                onClick={submitLeadEdit}
                className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {patchLeadMutation.isPending ? "Сохранение..." : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {moveModalAppointment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          onClick={() => {
            if (moveAppointmentMutation.isPending) return;
            setMoveModalAppointment(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">Перенос записи</h3>
            <p className="mt-2 text-sm text-slate-400">
              Доступны только свободные даты и свободные слоты этого специалиста.
            </p>
            {specialistsQuery.isLoading || moveAvailableDaysQuery.isLoading ? (
              <p className="mt-4 text-sm text-slate-400">Ищем свободные слоты…</p>
            ) : null}
            {moveAvailableDaysQuery.isError && (
              <p className="mt-4 text-sm text-rose-300">
                {(moveAvailableDaysQuery.error as Error).message ?? "Не удалось загрузить свободные слоты"}
              </p>
            )}
            {!moveAvailableDaysQuery.isLoading &&
              !moveAvailableDaysQuery.isError &&
              (moveAvailableDaysQuery.data ?? []).length === 0 && (
                <p className="mt-4 text-sm text-amber-300">
                  Свободных слотов не найдено на ближайшие 180 дней для этого специалиста.
                </p>
              )}
            {(moveAvailableDaysQuery.data ?? []).length > 0 && (
              <div className="mt-4 grid gap-3">
                <label className="text-sm text-slate-300">
                  Свободная дата
                  <select
                    value={moveDateYmd}
                    onChange={(e) => setMoveDateYmd(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                  >
                    {(moveAvailableDaysQuery.data ?? []).map((d) => (
                      <option key={d.dateYmd} value={d.dateYmd}>
                        {new Date(zonedWallTimeToUtcMs(d.dateYmd, 12, 0)).toLocaleDateString("ru-RU", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                          timeZone: BOOKING_TIME_ZONE,
                        })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Свободное время
                  <select
                    value={moveMinuteOfDay == null ? "" : String(moveMinuteOfDay)}
                    onChange={(e) => setMoveMinuteOfDay(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                  >
                    {(selectedMoveDay?.slots ?? []).map((m) => (
                      <option key={m} value={m}>
                        {String(Math.floor(m / 60)).padStart(2, "0")}:{String(m % 60).padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={moveAppointmentMutation.isPending}
                onClick={() => setMoveModalAppointment(null)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={
                  moveAppointmentMutation.isPending ||
                  moveAvailableDaysQuery.isLoading ||
                  (moveAvailableDaysQuery.data ?? []).length === 0 ||
                  moveMinuteOfDay == null
                }
                onClick={handleMoveAppointmentSubmit}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {moveAppointmentMutation.isPending ? "Перенос..." : "Перенести"}
              </button>
            </div>
          </div>
        </div>
      )}

      {auditOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          onClick={() => setAuditOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">Аудит карточки лида #{leadId}</h3>
              <button
                type="button"
                onClick={() => setAuditOpen(false)}
                className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                Закрыть
              </button>
            </div>
            <div className="max-h-[66vh] overflow-y-auto p-4">
              {auditQuery.isLoading && <p className="text-sm text-slate-400">Загрузка аудита…</p>}
              {auditQuery.isError && (
                <p className="text-sm text-red-300">{(auditQuery.error as Error).message ?? "Ошибка загрузки аудита"}</p>
              )}
              {(auditQuery.data ?? []).length === 0 && !auditQuery.isLoading && (
                <p className="text-sm text-slate-500">Пока нет событий.</p>
              )}
              <ul className="space-y-2">
                {(auditQuery.data ?? []).map((e) => (
                  <li key={e.id} className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-purple-500/20 px-2 py-0.5 text-purple-200">{e.action}</span>
                      <span className="text-slate-300">{e.user_name ?? `user#${e.user_id ?? "-"}`}</span>
                      <span className="text-slate-500">
                        {new Date(e.created_at).toLocaleString("ru-RU")}
                      </span>
                    </div>
                    {e.details && <p className="mt-1 text-sm text-slate-200">{e.details}</p>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
