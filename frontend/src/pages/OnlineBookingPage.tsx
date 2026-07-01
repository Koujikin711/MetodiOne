import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";

import { BookingCalendarGrid } from "@/components/BookingCalendarGrid";
import { DirectionStreamsPanel } from "@/components/DirectionStreamsPanel";
import { MiniMonthCalendar } from "@/components/MiniMonthCalendar";
import { PatientPhone } from "@/components/PatientPhone";
import { SpecialistModal, type SpecialistFormValues } from "@/components/SpecialistModal";
import { visitDisplayValue } from "@/lib/bookingVisitDisplay";
import { Calendar } from "@/components/icons";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeDisplayNameFromToken, decodeRoleFromToken, decodeUserIdFromToken } from "@/lib/auth";
import { BOOKING_TIME_ZONE, datetimeLocalBookingToIsoUtc, ymdInBookingTz } from "@/lib/bookingTz";
import type {
  BookingAppointment,
  BookingPatientHistoryItem,
  BookingPatientSuggestItem,
  BookingSpecialist,
  BookingViewerContext,
  LeadSource,
  Pipeline,
  PipelineStage,
  SalesKpiPriceHint,
} from "@/lib/types";

type Tab = "online" | "journal";

const statusLabels: Record<string, string> = {
  booked: "Записан",
  completed: "Завершён",
  no_show: "Не явился",
  cancelled: "Отменён",
};

function formatDt(iso: string) {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: BOOKING_TIME_ZONE,
    });
  } catch {
    return iso;
  }
}

export function OnlineBookingPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("online");
  const [filterDate, setFilterDate] = useState(() => ymdInBookingTz(Date.now()));
  const [journalDate, setJournalDate] = useState(() => ymdInBookingTz(Date.now()));
  const [journalSearch, setJournalSearch] = useState("");
  const [calendarDrawerOpen, setCalendarDrawerOpen] = useState(false);
  const formPanelRef = useRef<HTMLDivElement>(null);

  const [leadId, setLeadId] = useState<number | null>(null);
  const [newLeadPipelineId, setNewLeadPipelineId] = useState<number | null>(null);
  const [newLeadStageId, setNewLeadStageId] = useState<number | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [specialistId, setSpecialistId] = useState(0);
  const [serviceTitle, setServiceTitle] = useState("");
  const [startAt, setStartAt] = useState("");
  const [serviceAmount, setServiceAmount] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [comment, setComment] = useState("");
  const [patientSuggestOpen, setPatientSuggestOpen] = useState(false);
  const [patientSuggestDebounced, setPatientSuggestDebounced] = useState("");
  const [patientFieldFocus, setPatientFieldFocus] = useState<"name" | "phone" | null>(null);
  const patientSuggestRef = useRef<HTMLDivElement>(null);
  const token = getStoredToken();
  const currentRole = decodeRoleFromToken(token);
  const currentUserId = decodeUserIdFromToken(token);
  const currentUserName = decodeDisplayNameFromToken(token) || "Текущий пользователь";
  const isExpert = currentRole === "expert";
  const isManagerOrAdmin = currentRole === "manager" || currentRole === "admin";
  const canEditBooking = !isExpert;
  const canEditDirectionStreams = currentRole === "owner" || currentRole === "admin";

  const [specialistModalOpen, setSpecialistModalOpen] = useState(false);
  const [specialistModalMode, setSpecialistModalMode] = useState<"add" | "edit">("add");
  const [specialistModalTarget, setSpecialistModalTarget] = useState<BookingSpecialist | null>(null);
  const pipelineForKpiPrice = leadId ? null : newLeadPipelineId;
  const startAtIsoForKpi = useMemo(() => {
    if (!startAt) return null;
    try {
      return datetimeLocalBookingToIsoUtc(startAt);
    } catch {
      return null;
    }
  }, [startAt]);

  const bookingViewerQuery = useQuery({
    queryKey: ["booking-viewer-context"],
    queryFn: () => apiFetch<BookingViewerContext>("/api/booking/viewer-context"),
  });
  const showSessionInsteadOfTime = bookingViewerQuery.data?.show_session_instead_of_time ?? false;

  const specialistsQuery = useQuery({
    queryKey: ["booking-specialists"],
    queryFn: () => apiFetch<BookingSpecialist[]>("/api/booking/specialists"),
  });

  const sourcesQuery = useQuery({
    queryKey: ["lead-sources"],
    queryFn: () => apiFetch<LeadSource[]>("/api/sources"),
  });
  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<Pipeline[]>("/api/pipelines"),
  });
  const leadStagesQuery = useQuery({
    queryKey: ["stages", "booking-lead", newLeadPipelineId],
    queryFn: () =>
      newLeadPipelineId ? apiFetch<PipelineStage[]>(`/api/stages?pipeline_id=${newLeadPipelineId}`) : Promise.resolve([]),
    enabled: newLeadPipelineId != null,
  });
  const specialistDirectionForKpi = useMemo(() => {
    const list = specialistsQuery.data?.filter((s) => s.is_active) ?? [];
    const s = list.find((x) => x.id === specialistId);
    return s?.direction_id ?? 0;
  }, [specialistsQuery.data, specialistId]);
  const kpiPriceHintQuery = useQuery({
    queryKey: ["sales-kpi-price-hint", pipelineForKpiPrice, specialistDirectionForKpi, startAtIsoForKpi],
    queryFn: () =>
      apiFetch<SalesKpiPriceHint>(
        `/api/sales-kpi/price-hint?pipeline_id=${pipelineForKpiPrice}&direction_id=${specialistDirectionForKpi}&start_at=${encodeURIComponent(startAtIsoForKpi!)}`,
      ),
    enabled: Boolean(pipelineForKpiPrice && specialistDirectionForKpi > 0 && startAtIsoForKpi),
  });
  const fixedServiceAmount =
    kpiPriceHintQuery.data?.fixed_price != null ? Number(kpiPriceHintQuery.data.fixed_price) : null;

  const [sourceName, setSourceName] = useState("");
  const addSourceMutation = useMutation({
    mutationFn: () =>
      apiFetch<LeadSource>("/api/sources", {
        method: "POST",
        body: JSON.stringify({ name: sourceName.trim(), is_active: true }),
      }),
    onSuccess: () => {
      toast.success("Источник добавлен");
      setSourceName("");
      void queryClient.invalidateQueries({ queryKey: ["lead-sources"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const gridAppointmentsQuery = useQuery({
    queryKey: ["booking-appointments-grid", filterDate],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("date", filterDate);
      return apiFetch<BookingAppointment[]>(`/api/booking/appointments?${qs.toString()}`);
    },
    enabled: tab === "online",
  });

  const journalQuery = useQuery({
    queryKey: ["booking-journal", journalDate],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("date", journalDate);
      return apiFetch<BookingAppointment[]>(`/api/booking/appointments?${qs.toString()}`);
    },
    enabled: tab === "journal",
  });

  const patientHistoryQuery = useQuery({
    queryKey: ["booking-patient-history", journalSearch.trim()],
    queryFn: () =>
      apiFetch<BookingPatientHistoryItem[]>(
        `/api/booking/patient-history?q=${encodeURIComponent(journalSearch.trim())}&limit=20`,
      ),
    enabled: tab === "journal" && journalSearch.trim().length >= 2,
  });

  const patientSuggestTerm = useMemo(() => {
    const n = patientName.trim();
    const p = patientPhone.trim();
    if (n.length >= 2) return n;
    if (p.length >= 2) return p;
    return "";
  }, [patientName, patientPhone]);

  useEffect(() => {
    const t = window.setTimeout(() => setPatientSuggestDebounced(patientSuggestTerm), 220);
    return () => window.clearTimeout(t);
  }, [patientSuggestTerm]);

  const patientSuggestQuery = useQuery({
    queryKey: ["booking-patient-suggest", patientSuggestDebounced],
    queryFn: () =>
      apiFetch<BookingPatientSuggestItem[]>(
        `/api/booking/patient-suggest?q=${encodeURIComponent(patientSuggestDebounced)}&limit=12`,
      ),
    enabled:
      canEditBooking &&
      leadId == null &&
      patientSuggestDebounced.length >= 2 &&
      patientSuggestOpen &&
      patientFieldFocus === "name",
  });

  useEffect(() => {
    if (!patientSuggestOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (patientSuggestRef.current && !patientSuggestRef.current.contains(e.target as Node)) {
        setPatientSuggestOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [patientSuggestOpen]);

  function applyPatientSuggestion(item: BookingPatientSuggestItem) {
    setPatientName(item.patient_name);
    if (item.lead_id != null) {
      setLeadId(item.lead_id);
      setNewLeadPipelineId(null);
      setNewLeadStageId(null);
      if (item.patient_phone_can_view_full && item.patient_phone && item.patient_phone !== "—") {
        setPatientPhone(item.patient_phone);
      } else {
        setPatientPhone("");
      }
    } else if (item.patient_phone_can_view_full && item.patient_phone && item.patient_phone !== "—") {
      setPatientPhone(item.patient_phone);
    } else {
      setPatientPhone("");
    }
    setPatientSuggestOpen(false);
    setPatientFieldFocus(null);
    toast.success(item.lead_id != null ? "Клиент из CRM подставлен" : "Данные клиента подставлены");
  }

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<BookingAppointment>("/api/booking/appointments", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (created) => {
      if (created.whatsapp_confirmation_sent) {
        toast.success("Запись создана. Клиенту отправлено подтверждение в WhatsApp.");
      } else {
        toast.success(
          "Запись создана. WhatsApp не отправлен — проверьте Green API, телефон лида и шаблон «confirm» в интеграции.",
          { duration: 5500 },
        );
      }
      setPatientName("");
      setPatientPhone("");
      setComment("");
      setServiceTitle("");
      setServiceAmount("");
      setPaidAmount("");
      setLeadId(null);
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments-grid"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-journal"] });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/api/booking/appointments/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      toast.success("Статус обновлён. Этап лида на канбане синхронизирован.");
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments-grid"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-journal"] });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
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
      toast.success("Запись перенесена");
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments-grid"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-journal"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteAppointmentMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/booking/appointments/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Запись удалена");
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments-grid"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-journal"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics-full"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics-detailed"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const paymentMutation = useMutation({
    mutationFn: ({ id, paid_amount }: { id: number; paid_amount: number }) =>
      apiFetch(`/api/booking/appointments/${id}/payment`, {
        method: "PATCH",
        body: JSON.stringify({ paid_amount }),
      }),
    onSuccess: () => {
      toast.success("Оплата обновлена");
      void queryClient.invalidateQueries({ queryKey: ["booking-journal"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments-grid"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics-full"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics-detailed"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createSpecialistUserMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<BookingSpecialist>("/api/users", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Специалист добавлен");
      setSpecialistModalOpen(false);
      setSpecialistModalTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["booking-specialists"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchSpecialistUserMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiFetch<BookingSpecialist>(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Специалист обновлён");
      setSpecialistModalOpen(false);
      setSpecialistModalTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["booking-specialists"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteSpecialistUserMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/api/users/${id}`, {
        method: "DELETE",
      }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["booking-specialists"] });
      const previous = queryClient.getQueryData<BookingSpecialist[]>(["booking-specialists"]);
      queryClient.setQueryData<BookingSpecialist[]>(["booking-specialists"], (old) =>
        (old ?? []).filter((s) => s.id !== id),
      );
      return { previous };
    },
    onError: (e: Error, _id, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["booking-specialists"], ctx.previous);
      }
      toast.error(e.message);
    },
    onSuccess: () => {
      toast.success("Специалист скрыт из сетки");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["booking-specialists"] });
    },
  });

  const specialistsActive = useMemo(() => {
    const list = specialistsQuery.data?.filter((s) => s.is_active) ?? [];
    return [...list].sort((a, b) => {
      const o = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      return o !== 0 ? o : a.id - b.id;
    });
  }, [specialistsQuery.data]);

  const gridAppointmentSpecIds = useMemo(() => {
    const set = new Set<number>();
    for (const a of gridAppointmentsQuery.data ?? []) set.add(a.specialist_id);
    return set;
  }, [gridAppointmentsQuery.data]);

  /** Все активные специалисты в сетке; неактивное «направление» не скрывает колонку (иначе пропадают врачи без записей на этот день). Неактивные специалисты — только если есть запись на дату. */
  const specialistsForCalendar = useMemo(() => {
    const fromActive = [...specialistsActive];
    const ids = new Set(fromActive.map((s) => s.id));
    const inactiveWithAppts = (specialistsQuery.data ?? []).filter(
      (s) => !s.is_active && gridAppointmentSpecIds.has(s.id) && !ids.has(s.id),
    );
    const merged = [...fromActive, ...inactiveWithAppts];
    merged.sort((a, b) => {
      const o = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      return o !== 0 ? o : a.id - b.id;
    });
    return merged;
  }, [specialistsActive, specialistsQuery.data, gridAppointmentSpecIds]);

  /** Слот мог быть выбран в колонке неактивного специалиста — оставляем его в списке формы. */
  const specialistsForFormSelect = useMemo(() => {
    const list = [...specialistsActive];
    if (specialistId && !list.some((s) => s.id === specialistId)) {
      const extra = specialistsQuery.data?.find((s) => s.id === specialistId);
      if (extra) list.push(extra);
    }
    return list;
  }, [specialistsActive, specialistsQuery.data, specialistId]);

  const reorderSpecialistsMutation = useMutation({
    mutationFn: (ordered_ids: number[]) =>
      apiFetch<void>("/api/booking/specialists/reorder", {
        method: "POST",
        body: JSON.stringify({ ordered_ids }),
      }),
    onSuccess: () => {
      toast.success("Порядок колонок сохранён");
      void queryClient.invalidateQueries({ queryKey: ["booking-specialists"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (specialistId !== 0 && specialistsActive.some((s) => s.id === specialistId)) return;
    const first = specialistsActive[0];
    setSpecialistId(first?.id ?? 0);
  }, [specialistsActive, specialistId]);

  useEffect(() => {
    if (newLeadPipelineId != null) return;
    const first = pipelinesQuery.data?.[0];
    if (first) setNewLeadPipelineId(first.id);
  }, [newLeadPipelineId, pipelinesQuery.data]);

  useEffect(() => {
    const first = leadStagesQuery.data?.[0];
    if (!first) return;
    if (newLeadStageId != null && leadStagesQuery.data?.some((s) => s.id === newLeadStageId)) return;
    setNewLeadStageId(first.id);
  }, [leadStagesQuery.data, newLeadStageId]);
  useEffect(() => {
    if (fixedServiceAmount == null) return;
    setServiceAmount(String(fixedServiceAmount));
  }, [fixedServiceAmount]);

  useEffect(() => {
    if (!calendarDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCalendarDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [calendarDrawerOpen]);

  function onCalendarAppointmentClick(a: BookingAppointment) {
    if (a.lead_id) {
      navigate(`/leads/${a.lead_id}?appointment=${a.id}`);
    } else {
      toast.error("К этой записи не привязан лид в MetodiOne.");
    }
  }

  function openAddSpecialistModal() {
    setSpecialistModalMode("add");
    setSpecialistModalTarget(null);
    setSpecialistModalOpen(true);
  }

  function openEditSpecialistModal(s: BookingSpecialist) {
    setSpecialistModalMode("edit");
    setSpecialistModalTarget(s);
    setSpecialistModalOpen(true);
  }

  function handleSpecialistModalSubmit(values: SpecialistFormValues) {
    const phone = values.phone.trim() || null;
    const specialization = values.specialization.trim() || null;
    const streamFields = {
      course_streams_enabled: values.course_streams_enabled,
      course_stream_max_days: values.course_stream_max_days,
      course_stream_min_day_for_next: values.course_stream_min_day_for_next,
      course_stream_gap_days: values.course_stream_gap_days,
    };
    if (specialistModalMode === "add") {
      createSpecialistUserMutation.mutate({
        full_name: values.full_name,
        phone,
        specialization,
        slot_duration_min: values.slot_duration_min,
        role: "specialist",
        work_start_hour: values.work_start_hour,
        work_end_hour: values.work_end_hour,
        work_weekdays: values.work_weekdays,
        ...streamFields,
      });
      return;
    }
    if (specialistModalTarget) {
      patchSpecialistUserMutation.mutate({
        id: specialistModalTarget.id,
        body: {
          full_name: values.full_name,
          phone,
          specialization,
          slot_duration_min: values.slot_duration_min,
          work_start_hour: values.work_start_hour,
          work_end_hour: values.work_end_hour,
          work_weekdays: values.work_weekdays,
          ...streamFields,
        },
      });
    }
  }

  function handleSlotClick(payload: { specialistId: number; directionId: number; minuteOfDay: number }) {
    setSpecialistId(payload.specialistId);
    const hh = Math.floor(payload.minuteOfDay / 60);
    const mm = payload.minuteOfDay % 60;
    setStartAt(`${filterDate}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
    toast.success(`Слот ${hh}:${String(mm).padStart(2, "0")} — заполните форму справа`);
    window.setTimeout(() => {
      formPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
  }

  function handleMoveAppointment(payload: { appointmentId: number; specialistId: number; minuteOfDay: number }) {
    const hh = Math.floor(payload.minuteOfDay / 60);
    const mm = payload.minuteOfDay % 60;
    const localIso = `${filterDate}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    let startIso: string;
    try {
      startIso = datetimeLocalBookingToIsoUtc(localIso);
    } catch {
      toast.error("Неверная дата переноса");
      return;
    }
    moveAppointmentMutation.mutate({
      appointmentId: payload.appointmentId,
      specialist_id: payload.specialistId,
      start_at: startIso,
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEditBooking) {
      toast.error("Эксперт может только просматривать свои записи");
      return;
    }
    if (!specialistId || !startAt || !serviceTitle.trim()) {
      toast.error("Укажите услугу (текст), специалиста, дату и время.");
      return;
    }
    if (!specialistsActive.length) {
      toast.error("Нет специалистов в сетке — добавьте специалиста через меню колонки.");
      return;
    }
    let startIso: string;
    try {
      startIso = datetimeLocalBookingToIsoUtc(startAt);
    } catch {
      toast.error("Неверная дата.");
      return;
    }
    const resolvedServiceAmount =
      fixedServiceAmount ?? (serviceAmount.trim() === "" ? NaN : Number(serviceAmount));
    const resolvedPaidAmount = paidAmount.trim() === "" ? 0 : Number(paidAmount);
    if (!Number.isFinite(resolvedServiceAmount) || resolvedServiceAmount < 0) {
      toast.error("Укажите стоимость услуги");
      return;
    }
    if (!Number.isFinite(resolvedPaidAmount) || resolvedPaidAmount < 0) {
      toast.error("Сумма оплаты указана неверно");
      return;
    }
    const payload: Record<string, unknown> = {
      patient_name: patientName.trim(),
      patient_phone: patientPhone.trim(),
      specialist_id: specialistId,
      service_title: serviceTitle.trim(),
      start_at: startIso,
      service_amount: resolvedServiceAmount,
      paid_amount: resolvedPaidAmount,
      comment: comment.trim() || null,
    };
    if (resolvedPaidAmount > resolvedServiceAmount) {
      toast.error("Оплата не может быть больше стоимости услуги");
      return;
    }
    if (isManagerOrAdmin && resolvedPaidAmount > 0 && !currentUserId) {
      toast.error("Не удалось определить ответственного менеджера автоматически");
      return;
    }
    if (leadId) payload.lead_id = leadId;
    if (!leadId) {
      if (!newLeadPipelineId || !newLeadStageId) {
        toast.error("Выберите воронку и стадию для создания карточки клиента");
        return;
      }
      payload.lead_pipeline_id = newLeadPipelineId;
      payload.lead_stage_id = newLeadStageId;
    }
    if (isManagerOrAdmin && resolvedPaidAmount > 0 && currentUserId) {
      payload.responsible_manager_id = currentUserId;
    }
    createMutation.mutate(payload);
  }

  const tabBtn = (id: Tab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={[
        "rounded-xl border px-4 py-2 text-sm font-medium transition-all",
        tab === id
          ? "border-[#d4af37] bg-[#f7f2e8] text-[var(--mo-text)] shadow-[var(--mo-shadow-luxury)]"
          : "border-transparent mo-muted hover:border-[var(--mo-border)] hover:bg-[var(--mo-accent-soft)] hover:text-[var(--mo-text)]",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div className="mo-page relative max-w-[min(1920px,calc(100%-1rem))] space-y-3">
      <header className="mo-page-header">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="lux-heading-page">Онлайн-записи</h1>
          <Link to="/app" className="mo-link text-sm font-medium">
            ← К канбану
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabBtn("online", "Онлайн-записи")}
          {tabBtn("journal", "Журнал")}
        </div>
        {isExpert ? (
          <p className="lux-caption max-w-3xl">
            Если вы назначены главным экспертом воронки (в настройках канбана), здесь видны записи всех
            экспертов этой воронки. Иначе — только ваша колонка (просмотр).
          </p>
        ) : null}
      </header>

      {tab === "online" && (
        <div className="space-y-3">
          {calendarDrawerOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 block bg-[var(--mo-surface-elevated)]/70"
                aria-label="Закрыть календарь"
                onClick={() => setCalendarDrawerOpen(false)}
              />
              <aside className="fixed left-0 top-0 z-50 flex h-full w-[min(100vw,18rem)] flex-col border-r border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-4 shadow-2xl shadow-[var(--mo-shadow-luxury)] backdrop-blur-md">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="lux-subheading text-sm">Дата записи</h2>
                  <button
                    type="button"
                    onClick={() => setCalendarDrawerOpen(false)}
                    className="rounded-lg border border-[var(--mo-border-strong)] px-2 py-1 text-xs mo-muted hover:bg-white/10"
                  >
                    Закрыть
                  </button>
                </div>
                <MiniMonthCalendar
                  value={filterDate}
                  onChange={(d) => {
                    setFilterDate(d);
                    setCalendarDrawerOpen(false);
                  }}
                />
                <label className="mt-4 block text-xs lux-caption">
                  День (точно)
                  <input
                    type="date"
                    value={filterDate}
                    onChange={(e) => setFilterDate(e.target.value)}
                    className="mo-input mt-1 w-full text-sm"
                  />
                </label>
              </aside>
            </>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm mo-muted">
              Дата
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="mo-input ml-2 inline-block w-auto py-1.5"
              />
            </label>
            <button
              type="button"
              onClick={() => setCalendarDrawerOpen(true)}
              className="btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs xl:hidden"
            >
              <Calendar className="h-4 w-4 text-[var(--mo-accent-hover)]" />
              Месяц
            </button>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="booking-appt booking-appt--booked rounded px-2 py-0.5 font-semibold">Записан</span>
              <span className="booking-appt booking-appt--notify rounded px-2 py-0.5 font-semibold">Уведомление отправлено</span>
              <span className="booking-appt booking-appt--replied rounded px-2 py-0.5 font-semibold">Клиент ответил</span>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_min(100%,280px)] xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start">
            <div className="min-w-0">
              <BookingCalendarGrid
                dateYmd={filterDate}
                specialists={specialistsForCalendar}
                appointments={gridAppointmentsQuery.data ?? []}
                onAppointmentClick={onCalendarAppointmentClick}
                onSlotClick={canEditBooking ? handleSlotClick : undefined}
                onMoveAppointment={canEditBooking ? handleMoveAppointment : undefined}
                onAddSpecialist={canEditBooking ? openAddSpecialistModal : undefined}
                onEditSpecialist={canEditBooking ? openEditSpecialistModal : undefined}
                onDeleteSpecialist={canEditBooking ? (s) => deleteSpecialistUserMutation.mutate(s.id) : undefined}
                onReorderSpecialists={canEditBooking ? (orderedIds) => reorderSpecialistsMutation.mutate(orderedIds) : undefined}
                showSessionInsteadOfTime={showSessionInsteadOfTime}
              />
              {gridAppointmentsQuery.isLoading && (
                <p className="mt-3 text-sm lux-caption">Загрузка записей…</p>
              )}
            </div>
            <aside className="flex w-full min-w-0 flex-col gap-2 xl:sticky xl:top-4 xl:max-w-[280px]">
              <section className="hidden mo-section p-3 shadow-inner backdrop-blur-sm xl:block xl:max-h-[min(38vh,260px)] xl:overflow-y-auto">
                <h2 className="mb-2 lux-subheading text-sm">Дата записи</h2>
                <MiniMonthCalendar value={filterDate} onChange={setFilterDate} />
                <label className="mt-3 block text-xs lux-caption">
                  День (точно)
                  <input
                    type="date"
                    value={filterDate}
                    onChange={(e) => setFilterDate(e.target.value)}
                    className="mo-input mt-1 w-full text-sm"
                  />
                </label>
              </section>
              {canEditBooking ? (
                <section
                  ref={formPanelRef}
                  className="mo-section overflow-visible p-4 ring-1 ring-[#d4af37]/20"
                >
                  <h2 className="mb-3 lux-subheading">Новая запись</h2>
                  <form onSubmit={onSubmit} className="space-y-2.5">
                {leadId != null && (
                  <p className="text-xs text-[var(--mo-success)]">
                    Привязан лид #{leadId} — карточка уже в CRM, новая не создаётся. Менеджер сохранится.
                  </p>
                )}
                <div ref={patientSuggestRef} className="relative space-y-2.5">
                  <p className="text-[11px] mo-muted">
                    Начните вводить имя или телефон — если клиент уже есть, выберите его из списка или продолжайте
                    ввод вручную.
                  </p>
                  <label className="block text-sm mo-muted">
                    Пациент / клиент
                    <input
                      required
                      value={patientName}
                      onChange={(e) => {
                        setPatientName(e.target.value);
                        setPatientSuggestOpen(true);
                        if (leadId != null) setLeadId(null);
                      }}
                      onFocus={() => {
                        setPatientFieldFocus("name");
                        setPatientSuggestOpen(true);
                      }}
                      onBlur={() => {
                        window.setTimeout(() => {
                          setPatientFieldFocus((prev) => (prev === "name" ? null : prev));
                        }, 120);
                      }}
                      className="mt-1 w-full mo-input"
                      autoComplete="off"
                    />
                  </label>
                  <label className="block text-sm mo-muted">
                    Телефон
                    <input
                      required={leadId == null}
                      value={patientPhone}
                      onChange={(e) => {
                        setPatientPhone(e.target.value);
                        if (leadId != null) setLeadId(null);
                      }}
                      onFocus={() => {
                        setPatientFieldFocus("phone");
                        setPatientSuggestOpen(false);
                      }}
                      onBlur={() => {
                        window.setTimeout(() => {
                          setPatientFieldFocus((prev) => (prev === "phone" ? null : prev));
                        }, 120);
                      }}
                      placeholder={leadId != null ? "Необязательно — возьмём из карточки CRM" : undefined}
                      className="mt-1 w-full mo-input"
                      autoComplete="off"
                      inputMode="tel"
                    />
                  </label>
                  {leadId != null && !patientPhone.trim() ? (
                    <p className="text-[11px] text-[var(--mo-success)]">
                      Телефон подставится из карточки лида #{leadId}. Можете изменить имя или дописать телефон.
                    </p>
                  ) : null}
                  {patientSuggestOpen && patientFieldFocus === "name" && patientSuggestDebounced.length >= 2 ? (
                    <div className="absolute left-0 right-0 top-[4.5rem] z-[200] max-h-48 overflow-y-auto overscroll-contain rounded-xl border border-[var(--mo-border-strong)] bg-[var(--mo-surface-elevated)] py-1 shadow-lg sm:top-full sm:max-h-56">
                      <div className="flex items-center justify-between gap-2 border-b border-[var(--mo-border)] px-3 py-1.5">
                        <span className="text-[10px] font-medium mo-muted">Найдено в CRM</span>
                        <button
                          type="button"
                          className="text-[10px] font-medium text-[var(--mo-text)] underline"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setPatientSuggestOpen(false);
                            setPatientFieldFocus(null);
                          }}
                        >
                          Закрыть
                        </button>
                      </div>
                      {patientSuggestQuery.isError ? (
                        <p className="px-3 py-2 text-xs text-red-500">
                          {(patientSuggestQuery.error as Error).message || "Не удалось загрузить подсказки"}
                        </p>
                      ) : null}
                      {patientSuggestQuery.isLoading ? (
                        <p className="px-3 py-2 text-xs mo-muted">Поиск…</p>
                      ) : null}
                      {(patientSuggestQuery.data ?? []).map((item) => (
                        <button
                          key={`${item.lead_id ?? "n"}-${item.patient_name}-${item.patient_phone}`}
                          type="button"
                          className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition hover:bg-[var(--mo-accent-soft)]"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => applyPatientSuggestion(item)}
                        >
                          <span className="font-semibold text-[var(--mo-text)]">{item.patient_name}</span>
                          <span className="text-xs mo-muted">
                            <PatientPhone value={item} />
                            {item.manager_name ? ` · ${item.manager_name}` : ""}
                            {item.source === "crm" ? " · в CRM" : " · был на приёме"}
                          </span>
                        </button>
                      ))}
                      {!patientSuggestQuery.isLoading &&
                      patientSuggestQuery.isSuccess &&
                      (patientSuggestQuery.data ?? []).length === 0 ? (
                        <p className="px-3 py-2 text-xs mo-muted">Новый клиент — заполните поля ниже</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {!leadId && (
                  <>
                    <label className="block text-sm mo-muted">
                      Воронка для новой карточки
                      <select
                        required
                        value={newLeadPipelineId ?? ""}
                        onChange={(e) => setNewLeadPipelineId(Number(e.target.value))}
                        className="mt-1 w-full mo-input"
                      >
                        {(pipelinesQuery.data ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm mo-muted">
                      Стадия для новой карточки
                      <select
                        required
                        value={newLeadStageId ?? ""}
                        onChange={(e) => setNewLeadStageId(Number(e.target.value))}
                        className="mt-1 w-full mo-input"
                      >
                        {(leadStagesQuery.data ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <label className="block text-sm mo-muted">
                  Услуга (вручную)
                  <input
                    required
                    value={serviceTitle}
                    onChange={(e) => setServiceTitle(e.target.value)}
                    placeholder="Например: консультация, массаж…"
                    className="mt-1 w-full mo-input placeholder:mo-muted"
                  />
                </label>
                <label className="block text-sm mo-muted">
                  Специалист
                  <select
                    required
                    value={specialistId || ""}
                    onChange={(e) => setSpecialistId(Number(e.target.value))}
                    className="mt-1 w-full mo-input"
                  >
                    {specialistsForFormSelect.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm mo-muted">
                  Дата и время
                  <input
                    type="datetime-local"
                    required
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    className="mt-1 w-full mo-input"
                  />
                  <p className="mt-1 text-[10px] mo-muted">
                    Время в часовом поясе записи: {BOOKING_TIME_ZONE} (как на сервере).
                  </p>
                </label>
                <label className="block text-sm mo-muted">
                  Стоимость услуги
                  <input
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={fixedServiceAmount != null ? String(fixedServiceAmount) : serviceAmount}
                    onChange={(e) => setServiceAmount(e.target.value)}
                    disabled={fixedServiceAmount != null}
                    className="mt-1 w-full mo-input disabled:opacity-70"
                  />
                  {fixedServiceAmount != null ? (
                    <p className="mt-1 text-xs text-[#0f4c3a]">
                      Цена зафиксирована в KPI ({kpiPriceHintQuery.data?.year_month}). Введите только сумму оплаты.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs mo-muted">
                      Если владелец задал цену услуги в KPI на этот месяц, поле подставится автоматически.
                    </p>
                  )}
                </label>
                <label className="block text-sm mo-muted">
                  Оплатил клиент
                  <input
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    className="mt-1 w-full mo-input"
                  />
                </label>
                {isManagerOrAdmin ? (
                  <label className="block text-sm mo-muted">
                    Ответственный менеджер
                    <input
                      type="text"
                      value={currentUserName}
                      readOnly
                      className="mt-1 w-full mo-input opacity-90"
                    />
                    <p className="mt-1 text-xs mo-muted">
                      Подставляется автоматически при оплате.
                    </p>
                  </label>
                ) : null}
                <label className="block text-sm mo-muted">
                  Заметка к записи
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={2}
                    placeholder="Например: перенос с прошлой недели, пожелания клиента…"
                    className="mt-1 w-full mo-input"
                  />
                  <span className="mt-1 block text-[11px] mo-muted">
                    Появится при наведении на запись в календаре.
                  </span>
                </label>
                    <button
                      type="submit"
                      disabled={createMutation.isPending}
                      className="btn-primary w-full py-3 disabled:opacity-50"
                    >
                      {createMutation.isPending ? "Сохранение…" : "Записать"}
                    </button>
                  </form>
                </section>
              ) : (
                <section className="mo-section p-5 text-sm mo-muted shadow-inner backdrop-blur-sm">
                  <h2 className="mb-2 lux-subheading">Режим эксперта</h2>
                  <p>Доступен только просмотр ваших записей в календаре и журнале.</p>
                </section>
              )}
            </aside>
          </div>
          {canEditBooking ? (
            <section className="mo-section p-4">
              <h2 className="mb-3 lux-subheading text-sm">Источники заявок</h2>
              <form
                className="mb-3 flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!sourceName.trim()) return;
                  addSourceMutation.mutate();
                }}
              >
                <input
                  placeholder="Напр. Instagram / Рекомендация / Сайт"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  className="mo-input min-w-[200px] flex-1 text-sm"
                />
                <button
                  type="submit"
                  className="btn-primary text-sm"
                >
                  Добавить
                </button>
              </form>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-sm mo-muted">
                {(sourcesQuery.data ?? []).map((s) => (
                  <li key={s.id} className="rounded-lg border border-[var(--mo-border)] px-2 py-1.5">
                    {s.name} {!s.is_active ? <span className="text-xs text-amber-500/90">(выкл.)</span> : null}
                  </li>
                ))}
                {!sourcesQuery.isLoading && (sourcesQuery.data ?? []).length === 0 && (
                  <li className="text-sm mo-muted">Источников пока нет</li>
                )}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <SpecialistModal
        open={specialistModalOpen}
        mode={specialistModalMode}
        initial={specialistModalTarget}
        isSubmitting={
          createSpecialistUserMutation.isPending || patchSpecialistUserMutation.isPending
        }
        onClose={() => {
          setSpecialistModalOpen(false);
          setSpecialistModalTarget(null);
        }}
        onSubmit={handleSpecialistModalSubmit}
      />

      {tab === "journal" && (
        <section className="mo-section p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="text-sm mo-muted">
              Дата
              <input
                type="date"
                value={journalDate}
                onChange={(e) => setJournalDate(e.target.value)}
                className="ml-2 mo-input ml-2 py-1.5"
              />
            </label>
            <label className="text-sm mo-muted">
              Поиск клиента (ФИО / телефон)
              <input
                type="text"
                value={journalSearch}
                onChange={(e) => setJournalSearch(e.target.value)}
                placeholder="Напр. Иванов или 992..."
                className="mo-input ml-2 w-72 py-1.5 placeholder:mo-muted"
              />
            </label>
          </div>
          {journalSearch.trim().length >= 2 ? (
            <div className="mb-4 mo-section p-3">
              <h3 className="mb-2 lux-subheading text-sm">История клиента</h3>
              {patientHistoryQuery.isLoading && <p className="text-sm lux-caption">Ищем историю...</p>}
              {patientHistoryQuery.isError && (
                <p className="text-sm text-red-300">{(patientHistoryQuery.error as Error).message}</p>
              )}
              {patientHistoryQuery.data && patientHistoryQuery.data.length === 0 && (
                <p className="text-sm lux-caption">Ничего не найдено по запросу.</p>
              )}
              {patientHistoryQuery.data && patientHistoryQuery.data.length > 0 && (
                <div className="space-y-3">
                  {patientHistoryQuery.data.map((item) => (
                    <div key={`${item.patient_name}-${item.patient_phone}`} className="rounded-lg border border-[var(--mo-border)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="lux-subheading text-sm">{item.patient_name}</p>
                          <p className="text-xs lux-caption">
                            <PatientPhone value={item} />
                          </p>
                        </div>
                        <div className="text-right text-xs mo-muted">
                          <p>Всего записей: <b>{item.total_visits}</b></p>
                          <p>Последняя: <b>{item.last_visit_at ? formatDt(item.last_visit_at) : "—"}</b></p>
                        </div>
                      </div>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full min-w-[620px] text-left text-xs mo-muted">
                          <thead className="mo-muted">
                            <tr>
                              <th className="py-1 pr-3">Когда</th>
                              <th className="py-1 pr-3">Специалист</th>
                              <th className="py-1 pr-3">Услуга</th>
                              <th className="py-1 pr-3">Статус</th>
                              <th className="py-1 pr-3">Оплата</th>
                            </tr>
                          </thead>
                          <tbody>
                            {item.visits.map((v) => (
                              <tr
                                key={v.appointment_id}
                                className={[
                                  "border-t border-[var(--mo-border)]",
                                  v.status === "completed"
                                    ? "bg-emerald-500/10"
                                    : v.status === "no_show"
                                      ? "bg-rose-500/10"
                                      : "",
                                ].join(" ")}
                              >
                                <td className="py-1 pr-3 whitespace-nowrap">{formatDt(v.start_at)}</td>
                                <td className="py-1 pr-3">{v.specialist_name || "—"}</td>
                                <td className="py-1 pr-3">{(v.service_title || "").trim() || "—"}</td>
                                <td className="py-1 pr-3">{statusLabels[v.status] ?? v.status}</td>
                                <td className="py-1 pr-3">{v.paid_amount} / {v.service_amount}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] border-collapse text-left text-sm text-[var(--mo-text)]">
              <thead>
                <tr className="border-b border-[var(--mo-border)] lux-caption">
                  <th className="py-2 pr-4">{showSessionInsteadOfTime ? "Сеанс" : "Время"}</th>
                  <th className="py-2 pr-4">Пациент</th>
                  <th className="py-2 pr-4">Услуга</th>
                  <th className="py-2 pr-4">Специалист</th>
                  <th className="py-2 pr-4">Стоимость</th>
                  <th className="py-2 pr-4">Оплачено</th>
                  <th className="py-2 pr-4">Дебиторка</th>
                  <th className="py-2 pr-4">Статус</th>
                  <th className="py-2 pr-4 max-w-[200px]">Заметка</th>
                  {(journalQuery.data ?? []).some((x) => x.can_manage_journal) && (
                    <th className="py-2 pr-4">Действия</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {(journalQuery.data ?? []).map((a) => (
                  <tr
                    key={a.id}
                    className={[
                      "border-b border-[var(--mo-border)]",
                      Number(a.service_amount ?? 0) > Number(a.paid_amount ?? 0) ? "bg-amber-500/5" : "",
                    ].join(" ")}
                  >
                    <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                      {showSessionInsteadOfTime ? (
                        <span className="font-semibold text-indigo-800">{visitDisplayValue(a) ?? "—"}</span>
                      ) : (
                        formatDt(a.start_at)
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {a.patient_name}
                      <span className="block text-xs mo-muted">
                        <PatientPhone value={a} />
                      </span>
                    </td>
                    <td className="py-2 pr-4 mo-muted">
                      {(a.service_title || "").trim() || a.direction_name || "—"}
                    </td>
                    <td className="py-2 pr-4 lux-caption">{a.specialist_name}</td>
                    <td className="py-2 pr-4">{a.service_amount ?? 0}</td>
                    <td className="py-2 pr-4">
                      {a.can_manage_journal ? (
                        <input
                          type="number"
                          min={0}
                          step={1}
                          defaultValue={a.paid_amount ?? 0}
                          onBlur={(e) => {
                            const next = Number(e.target.value);
                            if (!Number.isFinite(next)) return;
                            if (next === Number(a.paid_amount ?? 0)) return;
                            paymentMutation.mutate({ id: a.id, paid_amount: next });
                          }}
                          className="mo-input w-28 py-1"
                        />
                      ) : (
                        <span>{a.paid_amount ?? 0}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs">
                      {Number(a.service_amount ?? 0) > Number(a.paid_amount ?? 0) ? (
                        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-300">Долг</span>
                      ) : (
                        <span className="text-[#0f4c3a]">Оплачено</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {canEditBooking ? (
                        <select
                          value={a.status}
                          onChange={(e) =>
                            statusMutation.mutate({ id: a.id, status: e.target.value })
                          }
                          className="mo-input py-1"
                        >
                          {Object.entries(statusLabels).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="mo-muted">{statusLabels[a.status] ?? a.status}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 max-w-[200px]">
                      {(a.comment || "").trim() ? (
                        <span
                          className="line-clamp-2 text-xs mo-muted"
                          title={(a.comment || "").trim()}
                        >
                          {(a.comment || "").trim()}
                        </span>
                      ) : (
                        <span className="mo-muted">—</span>
                      )}
                    </td>
                    {(journalQuery.data ?? []).some((x) => x.can_manage_journal) && (
                      <td className="py-2 pr-4">
                        {a.can_manage_journal ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (!window.confirm("Удалить эту запись?")) return;
                              deleteAppointmentMutation.mutate(a.id);
                            }}
                            className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-300 hover:bg-red-500/20"
                          >
                            Удалить
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!journalQuery.isLoading && (journalQuery.data ?? []).length === 0 && (
              <p className="py-6 text-center mo-muted">Нет записей на эту дату</p>
            )}
          </div>
        </section>
      )}

      {canEditDirectionStreams ? <DirectionStreamsPanel /> : null}
    </div>
  );
}
