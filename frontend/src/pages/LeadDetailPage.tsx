import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";

import { apiFetch, getStoredToken } from "@/lib/api";
import { visitDisplayValue } from "@/lib/bookingVisitDisplay";
import { decodeRoleFromToken } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import {
  BOOKING_TIME_ZONE,
  datetimeLocalBookingToIsoUtc,
  formatTimeRangeInBookingTz,
  weekdayMon0InBookingTz,
  ymdInBookingTz,
  zonedWallTimeToUtcMs,
} from "@/lib/bookingTz";
import { PatientPhone } from "@/components/PatientPhone";
import { BookingAttendancePanel } from "@/components/BookingAttendancePanel";
import { WaitingCallbackModal } from "@/components/WaitingCallbackModal";
import { auditActionLabel, auditDetailsLabel } from "@/lib/auditLabels";
import { leadStageChips } from "@/lib/leadStageChips";
import type {
  BookingAppointment,
  BookingSpecialist,
  BookingViewerContext,
  Lead,
  LeadAuditEvent,
  PipelineStage,
  SalesKpiLeadPriceHint,
} from "@/lib/types";

function isWaitingStageName(name: string | null | undefined): boolean {
  const n = (name || "").trim().toLowerCase();
  return n === "в ожидании" || n === "ожидание";
}

function stageButtonLabel(name: string): string {
  const n = name.trim();
  return n === "В обработке" ? "В работе" : n;
}

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
  const [waitingModalOpen, setWaitingModalOpen] = useState(false);

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
      toast.success("Лид переведён в «Отказ»");
      void qc.invalidateQueries({ queryKey: ["lead", leadId] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["leads-table"] });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось оформить отказ"),
  });

  const role = decodeRoleFromToken(getStoredToken());
  const canRejectLead = role === "owner" || role === "admin" || role === "manager";
  const canEditLeadProfile = role === "owner" || role === "admin" || role === "manager";
  const canSetLeadStage = role === "owner" || role === "admin" || role === "manager";
  const canDeleteLead = role === "owner";
  const bookingViewerQuery = useQuery({
    queryKey: ["booking-viewer-context"],
    queryFn: () => apiFetch<BookingViewerContext>("/api/booking/viewer-context"),
  });
  const canEditBooking = role !== "expert" || Boolean(bookingViewerQuery.data?.is_chief_expert);
  const homeLink = role === "manager" || role === "admin" ? "/my-leads" : "/app";
  const homeLabel = role === "manager" || role === "admin" ? "Мои лиды" : "На главную";

  const pipelineId = query.data?.pipeline_id ?? null;
  const stagesQuery = useQuery({
    queryKey: ["stages", "lead-card", pipelineId],
    queryFn: () =>
      apiFetch<PipelineStage[]>(
        pipelineId ? `/api/stages?pipeline_id=${pipelineId}` : "/api/stages",
      ),
    enabled: canSetLeadStage && Number.isFinite(leadId) && leadId > 0 && pipelineId != null,
  });

  const setLeadStatusMutation = useMutation({
    mutationFn: async ({ statusId }: { statusId: number; stageName: string }) =>
      apiFetch(`/api/leads/${leadId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status_id: statusId, assign_to_me: true }),
      }),
    onSuccess: (_data, vars) => {
      toast.success(`Стадия: ${stageButtonLabel(vars.stageName)}`);
      void qc.invalidateQueries({ queryKey: ["lead", leadId] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["chat-threads"] });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось сменить стадию"),
  });

  const managerStages = useMemo(() => {
    return (stagesQuery.data ?? [])
      .filter((s) => {
        const n = s.name.trim();
        return (
          n === "В обработке" ||
          n === "В работе" ||
          n === "В ожидании" ||
          n === "Удачно" ||
          n === "Отказ"
        );
      })
      .sort((a, b) => a.order - b.order || a.id - b.id);
  }, [stagesQuery.data]);

  const appointmentFromUrl = Number(searchParams.get("appointment"));

  const leadAppointmentsQuery = useQuery({
    queryKey: ["booking-appointments-by-lead", leadId],
    queryFn: () => apiFetch<BookingAppointment[]>(`/api/booking/appointments?lead_id=${leadId}`),
    enabled: Number.isFinite(leadId) && leadId > 0,
  });

  const showSessionInsteadOfTime = bookingViewerQuery.data?.show_session_instead_of_time ?? false;

  const leadSessionNumber = useMemo(() => {
    if (showSessionInsteadOfTime) return null;
    const list = (leadAppointmentsQuery.data ?? []).filter(
      (a) => visitDisplayValue(a) != null && a.status !== "cancelled",
    );
    if (list.length === 0) return null;
    const now = Date.now();
    const booked = list
      .filter((a) => a.status === "booked")
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    const upcoming = booked.find((a) => new Date(a.start_at).getTime() >= now);
    const pick = upcoming ?? list.sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())[0];
    return pick ? visitDisplayValue(pick) : null;
  }, [leadAppointmentsQuery.data, showSessionInsteadOfTime]);

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

  const appointmentStatusMutation = useMutation({
    mutationFn: ({
      id,
      status,
      add_payment,
      payment_method,
    }: {
      id: number;
      status: string;
      add_payment?: number;
      payment_method?: "cash" | "alif" | "dc";
    }) =>
      apiFetch(`/api/booking/appointments/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          ...(typeof add_payment === "number" ? { add_payment } : {}),
          ...(payment_method ? { payment_method } : {}),
        }),
      }),
    onSuccess: (_data, vars) => {
      toast.success(
        vars.status === "completed" && typeof vars.add_payment === "number"
          ? "Явка и оплата остатка учтены"
          : "Явка обновлена",
      );
      void qc.invalidateQueries({ queryKey: ["booking-appointments-by-lead", leadId] });
      void qc.invalidateQueries({ queryKey: ["booking-appointments-grid"] });
      void qc.invalidateQueries({ queryKey: ["booking-journal"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["sales-kpi-debtors"] });
      void qc.invalidateQueries({ queryKey: ["sales-kpi-company-report"] });
    },
    onError: (e: Error) => toast.error(e.message),
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
  const deleteLeadMutation = useMutation({
    mutationFn: () =>
      apiFetch<void>(`/api/leads/${leadId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Клиент удалён");
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["leads-table"] });
      window.location.href = "/crm";
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось удалить клиента"),
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

  if (!Number.isFinite(leadId) || leadId <= 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center lux-caption">
        Некорректный идентификатор лида.
        <Link to="/booking" className="mt-4 block text-[var(--mo-accent-hover)] hover:underline">
          ← К онлайн-записи
        </Link>
      </div>
    );
  }

  const stageDisplay =
    query.data?.stage_name === "В обработке" ? "В работе" : (query.data?.stage_name || "").trim();
  const stageChips = query.data ? leadStageChips(query.data) : { primary: "" };
  const createdLabel = query.data?.created_at
    ? new Date(query.data.created_at).toLocaleString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const leadInitials = (() => {
    const t = (query.data?.name || "").trim();
    if (!t) return "?";
    const parts = t.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
    }
    return t.slice(0, 2).toUpperCase();
  })();

  return (
    <div className="relative mx-auto w-full max-w-2xl space-y-3 pb-10 sm:space-y-8">
      <div className="flex flex-wrap items-center gap-3 px-3 text-sm sm:px-0">
        <Link to={homeLink} className="font-medium text-[var(--mo-accent-hover)] underline-offset-4 hover:underline">
          ← {homeLabel}
        </Link>
        <Link to="/booking" className="mo-muted hover:text-[var(--mo-text)]">
          Онлайн запись
        </Link>
      </div>

      {query.isLoading && <p className="px-3 lux-caption sm:px-0">Загрузка карточки…</p>}
      {query.isError && (
        <p className="px-3 text-red-300 sm:px-0">{(query.error as Error).message ?? "Ошибка загрузки"}</p>
      )}

      {query.data && (
        <article className="mo-section relative w-full max-w-none overflow-hidden rounded-none border-x-0 p-5 shadow-none sm:rounded-2xl sm:border sm:p-8 sm:shadow-[var(--mo-shadow-luxury)]">
          <header className="flex flex-col gap-4">
            <div className="flex items-start gap-3.5">
              <span
                aria-hidden
                className="flex h-[4.25rem] w-[4.25rem] shrink-0 items-center justify-center rounded-2xl bg-[var(--mo-accent-soft)] text-[1.35rem] font-semibold tracking-wide text-[var(--mo-accent-hover)] sm:h-20 sm:w-20 sm:text-2xl"
              >
                {leadInitials}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="break-words text-[1.75rem] font-semibold leading-[1.15] tracking-tight text-[var(--mo-text)] sm:text-3xl">
                  {query.data.name}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {stageChips.secondary ? (
                    <>
                      <span className="inline-flex rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-600">
                        {stageChips.primary}
                      </span>
                      <span className="inline-flex rounded-full bg-[var(--mo-accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--mo-accent-hover)]">
                        {stageChips.secondary}
                      </span>
                    </>
                  ) : stageDisplay ? (
                    <span className="inline-flex rounded-full bg-[var(--mo-accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--mo-accent-hover)]">
                      {stageDisplay}
                    </span>
                  ) : null}
                  <span className="text-xs tabular-nums mo-muted" title="ID в MetodiOne">
                    #{query.data.id}
                    {leadSessionNumber != null
                      ? ` · ${leadSessionNumber.includes(":") ? leadSessionNumber : `сеанс ${leadSessionNumber}`}`
                      : ""}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-[1.55rem] font-semibold tabular-nums tracking-wide text-[var(--mo-text)] sm:text-2xl">
              <PatientPhone value={query.data} />
            </p>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Link
                to={`/chat?lead_id=${query.data.id}`}
                className="inline-flex items-center justify-center rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] px-3 py-3 text-sm font-semibold text-[var(--mo-text)] transition hover:bg-[var(--mo-accent-soft)]"
                title="Открыть чат с клиентом"
              >
                Чат
              </Link>
              <button
                type="button"
                onClick={() => setAuditOpen(true)}
                className="rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] px-3 py-3 text-sm font-semibold text-[var(--mo-text)] transition hover:bg-[var(--mo-accent-soft)]"
              >
                Аудит
              </button>
              {canEditLeadProfile ? (
                <button
                  type="button"
                  onClick={openEditLeadModal}
                  className="rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] px-3 py-3 text-sm font-semibold text-[var(--mo-text)] transition hover:bg-[var(--mo-accent-soft)]"
                >
                  Изменить
                </button>
              ) : null}
              {query.data.show_close_deal_button ? (
                <button
                  type="button"
                  onClick={() => {
                    setCloseAmount("");
                    setClosePaid("");
                    setCloseDealOpen(true);
                  }}
                  className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm font-semibold text-[var(--mo-success)] transition hover:bg-emerald-500/15"
                >
                  Закрыть сделку
                </button>
              ) : null}
              {canRejectLead ? (
                <button
                  type="button"
                  disabled={rejectMutation.isPending}
                  onClick={() => {
                    const reason = window.prompt("Причина отказа (необязательно):");
                    if (reason === null) return;
                    if (!window.confirm("Перевести лид в «Отказ»?")) return;
                    rejectMutation.mutate(reason);
                  }}
                  className="rounded-xl border border-[var(--mo-danger)]/40 bg-[var(--mo-danger)]/10 px-3 py-3 text-sm font-semibold text-[var(--mo-danger)] transition hover:bg-[var(--mo-danger)]/15 disabled:opacity-50"
                >
                  Отказ
                </button>
              ) : null}
            </div>
          </header>

          {canSetLeadStage ? (
            <section className="mt-5 border-t border-[var(--mo-border)] pt-5">
              <h2 className="text-sm font-semibold text-[var(--mo-text)]">Стадия</h2>
              <p className="mt-1 text-xs mo-muted">
                В работе / В ожидании / Удачно / Отказ — прямо с карточки. «Новый лид» ставится автоматически.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {managerStages.map((s) => {
                  const current = query.data.status_id === s.id;
                  const label = stageButtonLabel(s.name);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={setLeadStatusMutation.isPending || current}
                      onClick={() => {
                        if (isWaitingStageName(s.name)) {
                          setWaitingModalOpen(true);
                          return;
                        }
                        setLeadStatusMutation.mutate({ statusId: s.id, stageName: s.name });
                      }}
                      className={[
                        "rounded-xl border px-3 py-2 text-sm transition disabled:opacity-50",
                        current
                          ? "border-[var(--mo-accent)] bg-[var(--mo-accent-soft)] font-semibold text-[var(--mo-text)]"
                          : "border-[var(--mo-border)] bg-[var(--mo-surface)] text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]",
                      ].join(" ")}
                      style={{ borderLeftWidth: 3, borderLeftColor: s.color }}
                    >
                      {label}
                    </button>
                  );
                })}
                {stagesQuery.isLoading ? <span className="text-xs mo-muted">Загрузка стадий…</span> : null}
                {!stagesQuery.isLoading && managerStages.length === 0 ? (
                  <span className="text-xs mo-muted">Стадии воронки не найдены</span>
                ) : null}
              </div>
            </section>
          ) : null}

          <div className="mt-5 space-y-4 border-t border-[var(--mo-border)] pt-5">
            {(query.data.email || "").trim() ? (
              <div>
                <p className="text-xs font-medium mo-muted">Email</p>
                <p className="mt-1 truncate text-base text-[var(--mo-text)]">{query.data.email}</p>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium mo-muted">Источник</p>
                <p className="mt-1 text-sm font-medium text-[var(--mo-text)]">
                  {(query.data.source || "").trim() || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium mo-muted">Менеджер</p>
                <p className="mt-1 text-sm font-medium text-[var(--mo-text)]">
                  {(query.data.manager_name || "").trim() || "—"}
                </p>
              </div>
              {createdLabel ? (
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium mo-muted">Создан</p>
                  <p className="mt-1 text-sm font-medium tabular-nums text-[var(--mo-text)]">{createdLabel}</p>
                </div>
              ) : null}
              {(query.data.refusal_reason || "").trim() ? (
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium mo-muted">Причина отказа</p>
                  <p className="mt-1 text-sm font-medium text-[var(--mo-text)]">
                    {(query.data.refusal_reason || "").trim()}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {(leadAppointmentsQuery.data ?? []).length > 0 && (
            <section className="mt-6 border-t border-[var(--mo-border)] pt-5">
              <h2 className="text-sm font-semibold text-[var(--mo-text)]">Онлайн-запись</h2>
              <p className="mt-1 text-xs mo-muted">
                Активные записи по этому лиду. «Перенос» — выбор даты и времени.
              </p>
              {leadAppointmentsQuery.isLoading && <p className="mt-2 text-xs mo-muted">Загрузка…</p>}
              {leadAppointmentsQuery.isError && (
                <p className="mt-2 text-xs text-[var(--mo-danger)]">
                  {(leadAppointmentsQuery.error as Error).message ?? "Не удалось загрузить записи"}
                </p>
              )}
              <ul className="mt-3 space-y-3">
                {(leadAppointmentsQuery.data ?? []).map((a) => {
                  const isBooked = a.status === "booked";
                  const highlight =
                    Number.isFinite(appointmentFromUrl) && appointmentFromUrl === a.id && isBooked;
                  const statusShell =
                    a.status === "completed"
                      ? "border-[var(--mo-success)]/40 bg-[var(--mo-success)]/10"
                      : a.status === "no_show"
                        ? "border-[var(--mo-danger)]/40 bg-[var(--mo-danger)]/10"
                        : highlight
                          ? "border-[var(--mo-accent)]/50 bg-[var(--mo-accent-soft)]"
                          : "border-[var(--mo-border)] bg-[var(--mo-surface)]";
                  return (
                    <li
                      key={a.id}
                      className={["rounded-xl border p-4 text-sm", statusShell].join(" ")}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-[var(--mo-text)]">
                            {new Date(a.start_at).toLocaleDateString("ru-RU", {
                              day: "2-digit",
                              month: "long",
                              year: "numeric",
                              timeZone: BOOKING_TIME_ZONE,
                            })}
                          </p>
                          <p className="mt-0.5 mo-muted">
                            {formatTimeRangeInBookingTz(a.start_at, a.end_at)}
                            {a.specialist_name ? ` · ${a.specialist_name}` : ""}
                            {(a.service_title || "").trim()
                              ? ` · ${(a.service_title || "").trim()}`
                              : a.direction_name
                                ? ` · ${a.direction_name}`
                                : ""}
                          </p>
                          <p className="mt-1 text-xs">
                            <span
                              className={
                                a.status === "completed"
                                  ? "font-semibold text-[var(--mo-success)]"
                                  : a.status === "no_show"
                                    ? "font-semibold text-[var(--mo-danger)]"
                                    : "mo-muted"
                              }
                            >
                              {a.status === "booked"
                                ? "Записан"
                                : a.status === "completed"
                                  ? "Явился"
                                  : a.status === "no_show"
                                    ? "Не явился"
                                    : a.status === "cancelled"
                                      ? "Отменён"
                                      : a.status}
                            </span>
                          </p>
                          {(a.comment || "").trim() ? (
                            <p
                              className="mt-2 rounded-lg border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] px-2 py-1.5 text-xs text-[var(--mo-text)]"
                              title={(a.comment || "").trim()}
                            >
                              {(a.comment || "").trim()}
                            </p>
                          ) : null}
                          {canEditBooking ? (
                            <div className="mt-3">
                              <BookingAttendancePanel
                                status={a.status}
                                disabled={appointmentStatusMutation.isPending}
                                serviceAmount={Number(a.service_amount ?? 0)}
                                paidAmount={Number(a.paid_amount ?? 0)}
                                onStatusChange={(status, add_payment, payment_method) =>
                                  appointmentStatusMutation.mutate({
                                    id: a.id,
                                    status,
                                    add_payment,
                                    payment_method,
                                  })
                                }
                              />
                            </div>
                          ) : null}
                        </div>
                        {canEditBooking && isBooked && (
                          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                            <button
                              type="button"
                              disabled={moveAppointmentMutation.isPending || deleteAppointmentMutation.isPending}
                              onClick={() => openMoveAppointmentModal(a)}
                              className="rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] px-3 py-2 text-xs font-semibold text-[var(--mo-text)] transition hover:bg-[var(--mo-accent-soft)] disabled:opacity-50"
                            >
                              Перенос
                            </button>
                            <button
                              type="button"
                              disabled={moveAppointmentMutation.isPending || deleteAppointmentMutation.isPending}
                              onClick={() => handleDeleteAppointment(a)}
                              className="rounded-xl border border-[var(--mo-danger)]/40 bg-[var(--mo-danger)]/10 px-3 py-2 text-xs font-semibold text-[var(--mo-danger)] transition hover:bg-[var(--mo-danger)]/15 disabled:opacity-50"
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

          {canDeleteLead ? (
            <section className="mt-6 border-t border-[var(--mo-border)] pt-5">
              <button
                type="button"
                disabled={deleteLeadMutation.isPending}
                onClick={() => {
                  if (!window.confirm("Удалить клиента полностью? Действие необратимо.")) return;
                  deleteLeadMutation.mutate();
                }}
                className="rounded-xl border border-[var(--mo-danger)]/35 px-4 py-2 text-sm font-medium text-[var(--mo-danger)] transition hover:bg-[var(--mo-danger)]/10 disabled:opacity-50"
              >
                {deleteLeadMutation.isPending ? "Удаление..." : "Удалить клиента"}
              </button>
            </section>
          ) : null}
        </article>
      )}

      {closeDealOpen && query.data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#2c2520]/40 p-4"
          onClick={() => setCloseDealOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl crm-modal-panel border p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="lux-subheading">Закрыть сделку</h3>
            <p className="mt-2 text-sm lux-caption">
              {fixedCloseAmount != null
                ? "Для последней услуги по этому лиду цена зафиксирована в KPI. Укажите только фактическую оплату."
                : "Укажите стоимость услуги и фактическую оплату. Лид будет переведён на стадию успешного закрытия."}{" "}
              Повторно закрыть того же лида нельзя.
            </p>
            <div className="mt-4 grid gap-3">
              {fixedCloseAmount != null ? (
                <div className="rounded-xl border border-emerald-600/40 bg-emerald-900/10 px-3 py-2 text-sm text-[var(--mo-success)]">
                  Цена по KPI: {formatMoney(fixedCloseAmount)}
                </div>
              ) : (
                <label className="text-sm mo-muted">
                  Стоимость услуги (TJS)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={closeAmount}
                    onChange={(e) => setCloseAmount(e.target.value)}
                    className="mo-input mt-1 w-full"
                  />
                </label>
              )}
              <label className="text-sm mo-muted">
                Оплачено фактически (TJS)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={closePaid}
                  onChange={(e) => setClosePaid(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setCloseDealOpen(false)}
                className="rounded-xl border border-[var(--mo-border)] px-4 py-2 text-sm mo-muted hover:bg-[var(--mo-accent-soft)]"
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
                className="rounded-xl bg-emerald-600 px-4 py-2 lux-subheading text-sm hover:bg-emerald-500 disabled:opacity-50"
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}

      {editLeadOpen && query.data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#2c2520]/40 p-4"
          onClick={() => {
            if (patchLeadMutation.isPending) return;
            setEditLeadOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl crm-modal-panel border p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="lux-subheading">Редактировать клиента</h3>
            <p className="mt-2 text-sm lux-caption">
              Можно обновить ФИО, телефон, email и источник прямо из карточки.
            </p>
            <div className="mt-4 grid gap-3">
              <label className="text-sm mo-muted">
                ФИО
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="text-sm mo-muted">
                Телефон
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="text-sm mo-muted">
                Email
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="text-sm mo-muted">
                Источник
                <input
                  value={editSource}
                  onChange={(e) => setEditSource(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={patchLeadMutation.isPending}
                onClick={() => setEditLeadOpen(false)}
                className="rounded-xl border border-[var(--mo-border)] px-4 py-2 text-sm mo-muted hover:bg-[var(--mo-accent-soft)] disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={patchLeadMutation.isPending}
                onClick={submitLeadEdit}
                className="rounded-xl bg-sky-600 px-4 py-2 lux-subheading text-sm hover:bg-sky-500 disabled:opacity-50"
              >
                {patchLeadMutation.isPending ? "Сохранение..." : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {moveModalAppointment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#2c2520]/40 p-4"
          onClick={() => {
            if (moveAppointmentMutation.isPending) return;
            setMoveModalAppointment(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl crm-modal-panel border p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="lux-subheading">Перенос записи</h3>
            <p className="mt-2 text-sm lux-caption">
              Доступны только свободные даты и свободные слоты этого специалиста.
            </p>
            {specialistsQuery.isLoading || moveAvailableDaysQuery.isLoading ? (
              <p className="mt-4 text-sm lux-caption">Ищем свободные слоты…</p>
            ) : null}
            {moveAvailableDaysQuery.isError && (
              <p className="mt-4 text-sm text-[#6b1d2f]">
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
                <label className="text-sm mo-muted">
                  Свободная дата
                  <select
                    value={moveDateYmd}
                    onChange={(e) => setMoveDateYmd(e.target.value)}
                    className="mo-input mt-1 w-full"
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
                <label className="text-sm mo-muted">
                  Свободное время
                  <select
                    value={moveMinuteOfDay == null ? "" : String(moveMinuteOfDay)}
                    onChange={(e) => setMoveMinuteOfDay(Number(e.target.value))}
                    className="mo-input mt-1 w-full"
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
                className="rounded-xl border border-[var(--mo-border)] px-4 py-2 text-sm mo-muted hover:bg-[var(--mo-accent-soft)] disabled:opacity-50"
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
                className="rounded-xl bg-indigo-600 px-4 py-2 lux-subheading text-sm hover:bg-indigo-500 disabled:opacity-50"
              >
                {moveAppointmentMutation.isPending ? "Перенос..." : "Перенести"}
              </button>
            </div>
          </div>
        </div>
      )}

      {auditOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#2c2520]/40 p-4"
          onClick={() => setAuditOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-2xl crm-modal-panel border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--mo-border)]/70 px-4 py-3">
              <h3 className="lux-subheading text-sm">Аудит карточки лида #{leadId}</h3>
              <button
                type="button"
                onClick={() => setAuditOpen(false)}
                className="rounded-lg border border-[var(--mo-border)] px-2 py-1 text-xs mo-muted hover:bg-[var(--mo-accent-soft)]"
              >
                Закрыть
              </button>
            </div>
            <div className="max-h-[66vh] overflow-y-auto p-4">
              {auditQuery.isLoading && <p className="text-sm lux-caption">Загрузка аудита…</p>}
              {auditQuery.isError && (
                <p className="text-sm text-red-300">{(auditQuery.error as Error).message ?? "Ошибка загрузки аудита"}</p>
              )}
              {(auditQuery.data ?? []).length === 0 && !auditQuery.isLoading && (
                <p className="text-sm mo-muted">Пока нет событий.</p>
              )}
              <ul className="space-y-2">
                {(auditQuery.data ?? []).map((e) => {
                  const details = auditDetailsLabel(e.details);
                  return (
                  <li key={e.id} className="rounded-xl mo-section p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-[var(--mo-accent-soft)] px-2 py-0.5 text-[var(--mo-accent-hover)]">
                        {auditActionLabel(e.action)}
                      </span>
                      <span className="mo-muted">{e.user_name ?? `user#${e.user_id ?? "-"}`}</span>
                      <span className="mo-muted">
                        {new Date(e.created_at).toLocaleString("ru-RU")}
                      </span>
                    </div>
                    {details ? <p className="mt-1 text-sm text-[var(--mo-text)]">{details}</p> : null}
                  </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      {waitingModalOpen ? (
        <WaitingCallbackModal
          leadId={leadId}
          open
          onClose={() => setWaitingModalOpen(false)}
          onSaved={() => {
            setWaitingModalOpen(false);
            void qc.invalidateQueries({ queryKey: ["lead", leadId] });
            void qc.invalidateQueries({ queryKey: ["leads"] });
            void qc.invalidateQueries({ queryKey: ["tasks"] });
            void qc.invalidateQueries({ queryKey: ["chat-threads"] });
          }}
        />
      ) : null}
    </div>
  );
}
