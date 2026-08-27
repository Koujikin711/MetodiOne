import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { BookingAttendancePanel } from "@/components/BookingAttendancePanel";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import { BookingDirectionsPanel } from "@/components/BookingDirectionsPanel";
import { BookingWeekSpecialistGrid } from "@/components/BookingWeekSpecialistGrid";
import { DirectionStreamsPanel } from "@/components/DirectionStreamsPanel";
import { MiniMonthCalendar } from "@/components/MiniMonthCalendar";
import { PatientPhone } from "@/components/PatientPhone";
import { BookingSpecialistsFilter } from "@/components/BookingSpecialistsFilter";
import { SpecialistModal, type SpecialistFormValues } from "@/components/SpecialistModal";
import { Trash2 } from "@/components/icons";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeDisplayNameFromToken, decodeRoleFromToken, decodeUserIdFromToken } from "@/lib/auth";
import {
  canBookCourseLike,
  isConsultationDirectionName,
  isCourseLikeDirectionName,
  isGanchinaSpecialistName,
} from "@/lib/bookingDirectionKinds";
import { formatMoney } from "@/lib/money";
import { BOOKING_TIME_ZONE, addCalendarDaysInBookingTz, datetimeLocalBookingToIsoUtc, formatWeekRangeLabel, weekWorkDayYmds, ymdInBookingTz } from "@/lib/bookingTz";
import {
  allSpecialistsSelected,
  allTypesSelected,
  clearBookingSpecialistFilterPrefs,
  collectTypeLabels,
  filterCalendarSpecialists,
  loadBookingSpecialistFilterPrefs,
  saveBookingSpecialistFilterPrefs,
} from "@/lib/bookingSpecialistFilter";
import type {
  BookingAppointment,
  BookingDirection,
  BookingPatientHistoryItem,
  BookingPatientSuggestItem,
  BookingSpecialist,
  BookingViewerContext,
  LeadSource,
  Pipeline,
  PipelineStage,
  SalesKpiPriceHint,
  Lead,
} from "@/lib/types";

type Tab = "online" | "journal";

const statusLabels: Record<string, string> = {
  booked: "Запись",
  completed: "Пришёл",
  no_show: "Неявка",
  cancelled: "Отмена",
};

function formatBookingToolbarDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "short",
  });
}

function formatJournalDateShort(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    weekday: "short",
  });
}

function shiftFilterDateYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

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

function phoneFromPatientSuggest(item: BookingPatientSuggestItem): string {
  if (item.patient_phone_can_view_full) {
    const p = (item.patient_phone || "").trim();
    return p && p !== "—" ? p : "";
  }
  return "";
}

function phonesMatchSuggest(termDigits: string, itemPhone: string): boolean {
  const itemPhoneDigits = (itemPhone || "").replace(/\D/g, "");
  if (termDigits.length < 4 || itemPhoneDigits.length < 4) return false;
  return (
    itemPhoneDigits.includes(termDigits) ||
    (termDigits.length >= 9 &&
      itemPhoneDigits.length >= 9 &&
      termDigits.slice(-9) === itemPhoneDigits.slice(-9))
  );
}

function nameMatchesSuggest(term: string, itemName: string): boolean {
  const itemNameNorm = itemName.trim().toLowerCase();
  const termNorm = term.trim().toLowerCase();
  if (!termNorm || !itemNameNorm) return false;
  return (
    itemNameNorm === termNorm ||
    (termNorm.length >= 3 && itemNameNorm.startsWith(termNorm)) ||
    (termNorm.length >= 3 && itemNameNorm.includes(termNorm))
  );
}

function patientSuggestItemKey(item: BookingPatientSuggestItem): string {
  return `${item.lead_id ?? "n"}|${item.patient_name}|${item.patient_phone}`;
}

export function OnlineBookingPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const meQuery = useCurrentUserMe();
  const chatStages = meQuery.data?.chat_stages_enabled !== false;
  const leadFromQuery = useMemo(() => {
    const raw = searchParams.get("lead_id");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [searchParams]);
  const [tab, setTab] = useState<Tab>("online");
  const [filterDate, setFilterDate] = useState(() => ymdInBookingTz(Date.now()));
  const [journalDate, setJournalDate] = useState(() => ymdInBookingTz(Date.now()));
  const [journalSearch, setJournalSearch] = useState("");
  const [journalCalendarOpen, setJournalCalendarOpen] = useState(false);
  const journalDateWrapRef = useRef<HTMLDivElement>(null);
  const formPanelRef = useRef<HTMLDivElement>(null);
  const patientSuggestRef = useRef<HTMLDivElement>(null);
  const lastAutoSuggestKeyRef = useRef<string | null>(null);
  const specialistFilterInitializedRef = useRef(false);

  const [selectedFilterTypeNames, setSelectedFilterTypeNames] = useState<Set<string>>(() => new Set());
  const [selectedFilterSpecialistIds, setSelectedFilterSpecialistIds] = useState<Set<number>>(() => new Set());

  const [leadId, setLeadId] = useState<number | null>(null);
  const [newLeadPipelineId, setNewLeadPipelineId] = useState<number | null>(null);
  const [newLeadStageId, setNewLeadStageId] = useState<number | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [extraPhones, setExtraPhones] = useState<string[]>([""]);
  const [specialistId, setSpecialistId] = useState(0);
  const [serviceDirectionId, setServiceDirectionId] = useState<number | "">("");
  const [serviceTitle, setServiceTitle] = useState("");
  const [startAt, setStartAt] = useState("");
  const [serviceAmount, setServiceAmount] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [comment, setComment] = useState("");
  const [seriesBookingEnabled, setSeriesBookingEnabled] = useState(false);
  const [consecutiveDays, setConsecutiveDays] = useState(5);
  const [patientSuggestOpen, setPatientSuggestOpen] = useState(false);
  const [patientSuggestDebounced, setPatientSuggestDebounced] = useState("");
  const [patientFieldFocus, setPatientFieldFocus] = useState<"name" | "phone" | null>(null);
  const token = getStoredToken();
  const currentRole = decodeRoleFromToken(token);
  const currentUserId = decodeUserIdFromToken(token);
  const currentUserName = decodeDisplayNameFromToken(token) || "Текущий пользователь";
  const isExpert = currentRole === "expert";
  const isManagerOrAdmin = currentRole === "manager" || currentRole === "admin";
  const canBookCourses = canBookCourseLike(currentRole);
  const bookingViewerQuery = useQuery({
    queryKey: ["booking-viewer-context"],
    queryFn: () => apiFetch<BookingViewerContext>("/api/booking/viewer-context"),
  });
  const canEditBooking = !isExpert || Boolean(bookingViewerQuery.data?.is_chief_expert);
  const canEditDirectionStreams = currentRole === "owner" || currentRole === "admin";

  useEffect(() => {
    if (leadFromQuery == null || !canEditBooking) return;
    let cancelled = false;
    void (async () => {
      try {
        const lead = await apiFetch<Lead>(`/api/leads/${leadFromQuery}`);
        if (cancelled) return;
        setLeadId(lead.id);
        setPatientName((lead.name || "").trim());
        setPatientPhone((lead.phone_display || lead.phone || "").trim());
        toast.success("Данные лида подставлены — выберите эксперта, дату и сумму");
        window.setTimeout(() => {
          formPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 120);
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "Не удалось загрузить лида");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadFromQuery, canEditBooking]);

  const [specialistModalOpen, setSpecialistModalOpen] = useState(false);
  const [directionsPanelOpen, setDirectionsPanelOpen] = useState(false);
  const [specialistModalTarget, setSpecialistModalTarget] = useState<BookingSpecialist | null>(null);
  const [noteEditAppt, setNoteEditAppt] = useState<BookingAppointment | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [apptDetail, setApptDetail] = useState<BookingAppointment | null>(null);
  const pipelineForKpiPrice = leadId ? null : newLeadPipelineId;
  const startAtIsoForKpi = useMemo(() => {
    if (!startAt) return null;
    try {
      return datetimeLocalBookingToIsoUtc(startAt);
    } catch {
      return null;
    }
  }, [startAt]);

  const showSessionInsteadOfTime = bookingViewerQuery.data?.show_session_instead_of_time ?? false;

  const specialistsQuery = useQuery({
    queryKey: ["booking-specialists"],
    queryFn: () => apiFetch<BookingSpecialist[]>("/api/booking/specialists"),
  });

  const directionsQuery = useQuery({
    queryKey: ["booking-directions-all"],
    queryFn: () => apiFetch<BookingDirection[]>("/api/booking/directions"),
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
    if (serviceDirectionId !== "") return serviceDirectionId;
    const list = specialistsQuery.data?.filter((s) => s.is_active) ?? [];
    const s = list.find((x) => x.id === specialistId);
    return s?.direction_id ?? 0;
  }, [serviceDirectionId, specialistsQuery.data, specialistId]);
  const selectedSpecialistForForm = useMemo(() => {
    const list = specialistsQuery.data?.filter((s) => s.is_active) ?? [];
    return list.find((x) => x.id === specialistId);
  }, [specialistsQuery.data, specialistId]);
  const courseStreamsForForm = useMemo(() => {
    if (!selectedSpecialistForForm) return false;
    const selectedDir =
      serviceDirectionId !== ""
        ? directionsQuery.data?.find((d) => d.id === serviceDirectionId)
        : undefined;
    if (selectedDir?.course_streams_enabled) return true;
    const primaryDir = directionsQuery.data?.find(
      (d) => d.id === selectedSpecialistForForm.direction_id,
    );
    if (primaryDir?.course_streams_enabled) return true;
    return Boolean(selectedSpecialistForForm.course_streams_enabled);
  }, [selectedSpecialistForForm, directionsQuery.data, serviceDirectionId]);
  const seriesEndDateYmd = useMemo(() => {
    if (!startAt || !seriesBookingEnabled || consecutiveDays < 2) return null;
    const m = startAt.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!m) return null;
    return addCalendarDaysInBookingTz(m[1], consecutiveDays - 1);
  }, [startAt, seriesBookingEnabled, consecutiveDays]);
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

  const freeConsultHintQuery = useQuery({
    queryKey: [
      "booking-free-consult-hint",
      specialistId,
      serviceDirectionId,
      patientPhone,
      leadId,
    ],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("specialist_id", String(specialistId));
      qs.set("direction_id", String(serviceDirectionId));
      if (patientPhone.trim()) qs.set("patient_phone", patientPhone.trim());
      if (leadId != null) qs.set("lead_id", String(leadId));
      return apiFetch<{ eligible: boolean; reason: string | null }>(
        `/api/booking/free-consult-hint?${qs.toString()}`,
      );
    },
    enabled:
      Boolean(specialistId) &&
      serviceDirectionId !== "" &&
      isGanchinaSpecialistName(selectedSpecialistForForm?.full_name) &&
      isConsultationDirectionName(
        (directionsQuery.data ?? []).find((d) => d.id === serviceDirectionId)?.name,
      ),
  });
  const freeConsultEligible = Boolean(freeConsultHintQuery.data?.eligible);

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

  const gridWeekDays = useMemo(() => weekWorkDayYmds(filterDate), [filterDate]);
  const gridWeekStart = gridWeekDays[0];
  const gridWeekEnd = gridWeekDays[gridWeekDays.length - 1];

  const gridAppointmentsQuery = useQuery({
    queryKey: ["booking-appointments-grid", gridWeekStart, gridWeekEnd],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("date", gridWeekStart);
      qs.set("date_to", gridWeekEnd);
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

  useEffect(() => {
    if (!journalCalendarOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = journalDateWrapRef.current;
      if (el && !el.contains(e.target as Node)) setJournalCalendarOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [journalCalendarOpen]);

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

  useEffect(() => {
    if (!courseStreamsForForm) {
      setSeriesBookingEnabled(false);
    }
  }, [courseStreamsForForm]);

  const patientSuggestQuery = useQuery({
    queryKey: ["booking-patient-suggest", patientSuggestDebounced],
    queryFn: () =>
      apiFetch<BookingPatientSuggestItem[]>(
        `/api/booking/patient-suggest?q=${encodeURIComponent(patientSuggestDebounced)}&limit=12`,
      ),
    enabled: canEditBooking && patientSuggestDebounced.length >= 2,
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

  /** Явный выбор из списка — подставляет имя из CRM/WhatsApp. */
  function applyPatientSuggestion(item: BookingPatientSuggestItem, opts?: { silent?: boolean }) {
    setPatientName(item.patient_name);
    setPatientPhone(phoneFromPatientSuggest(item) || patientPhone);
    if (item.lead_id != null) {
      setLeadId(item.lead_id);
      setNewLeadPipelineId(null);
      setNewLeadStageId(null);
    }
    setPatientSuggestOpen(false);
    setPatientFieldFocus(null);
    lastAutoSuggestKeyRef.current = patientSuggestItemKey(item);
    if (!opts?.silent) {
      toast.success(item.lead_id != null ? "Клиент из CRM подставлен" : "Данные клиента подставлены");
    }
  }

  /** Автопривязка по телефону: CRM остаётся, имя не перезаписываем, если уже введено. */
  function autoLinkPatientFromSuggestion(item: BookingPatientSuggestItem) {
    const phone = phoneFromPatientSuggest(item);
    if (phone) setPatientPhone(phone);
    if (item.lead_id != null) {
      setLeadId(item.lead_id);
      setNewLeadPipelineId(null);
      setNewLeadStageId(null);
    }
    if (!patientName.trim()) {
      setPatientName(item.patient_name);
    }
    lastAutoSuggestKeyRef.current = patientSuggestItemKey(item);
  }

  useEffect(() => {
    if (!canEditBooking) return;
    if (patientSuggestDebounced.length < 2) {
      lastAutoSuggestKeyRef.current = null;
      return;
    }
    if (!patientSuggestQuery.isSuccess || patientSuggestQuery.isFetching) return;
    const items = patientSuggestQuery.data ?? [];
    if (items.length !== 1) {
      lastAutoSuggestKeyRef.current = null;
      return;
    }
    const item = items[0];
    const term = patientSuggestDebounced.trim();
    const phoneDigits = term.replace(/\D/g, "");
    const matched =
      nameMatchesSuggest(term, item.patient_name) ||
      phonesMatchSuggest(phoneDigits, item.patient_phone);

    if (!matched) return;

    const key = patientSuggestItemKey(item);
    if (lastAutoSuggestKeyRef.current === key) return;

    const phoneOk = phonesMatchSuggest(patientPhone.replace(/\D/g, ""), item.patient_phone);
    const alreadyLinked =
      item.lead_id != null &&
      leadId === item.lead_id &&
      (phoneOk || phonesMatchSuggest(phoneDigits, item.patient_phone));
    if (alreadyLinked) {
      lastAutoSuggestKeyRef.current = key;
      return;
    }

    autoLinkPatientFromSuggestion(item);
  }, [
    canEditBooking,
    patientSuggestDebounced,
    patientSuggestQuery.isSuccess,
    patientSuggestQuery.isFetching,
    patientSuggestQuery.data,
    patientName,
    patientPhone,
    leadId,
  ]);

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<BookingAppointment>("/api/booking/appointments", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (created, variables) => {
      const days = Math.max(1, Number(variables.consecutive_days ?? 1));
      const seriesMsg =
        days > 1 ? `Создано ${days} записей на ${days} дней подряд.` : "Запись создана.";
      if (created.whatsapp_confirmation_sent) {
        toast.success(`${seriesMsg} Клиенту отправлено подтверждение в WhatsApp.`);
      } else {
        toast.success(
          `${seriesMsg} WhatsApp не отправлен — проверьте Green API, телефон лида и шаблон «confirm» в интеграции.`,
          { duration: 5500 },
        );
      }
      setPatientName("");
      setPatientPhone("");
      setExtraPhones([""]);
      setComment("");
      setServiceTitle("");
      setServiceDirectionId("");
      setServiceAmount("");
      setPaidAmount("");
      setLeadId(null);
      setSeriesBookingEnabled(false);
      setConsecutiveDays(5);
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments-grid"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-journal"] });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["chat-threads"] });
      void queryClient.invalidateQueries({ queryKey: ["chat-thread-bucket-counts"] });
      if (chatStages && typeof variables.lead_id === "number") {
        navigate(`/chat?lead_id=${variables.lead_id}`, { replace: true });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({
      id,
      status,
      add_payment,
    }: {
      id: number;
      status: string;
      add_payment?: number;
    }) =>
      apiFetch<BookingAppointment>(`/api/booking/appointments/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          ...(typeof add_payment === "number" ? { add_payment } : {}),
        }),
      }),
    onSuccess: (data, { id, status }) => {
      toast.success(
        status === "completed" && Number(data?.paid_amount ?? 0) > 0
          ? "Явка и оплата учтены"
          : "Статус обновлён. Этап лида на канбане синхронизирован.",
      );
      setApptDetail((cur) =>
        cur && cur.id === id
          ? {
              ...cur,
              ...data,
              status: data?.status ?? status,
            }
          : cur,
      );
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments-grid"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-journal"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments-by-lead"] });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-debtors"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-company-report"] });
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
      toast.success("Специалист удалён");
      setSpecialistModalOpen(false);
      setSpecialistModalTarget(null);
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

  useEffect(() => {
    if (!specialistsActive.length || specialistFilterInitializedRef.current) return;
    specialistFilterInitializedRef.current = true;
    const allTypes = collectTypeLabels(specialistsActive);
    const allIds = specialistsActive.map((s) => s.id);
    const saved = loadBookingSpecialistFilterPrefs();
    if (saved) {
      const validTypes = saved.typeNames.filter((t) => allTypes.includes(t));
      const validIds = saved.specialistIds.filter((id) => specialistsActive.some((s) => s.id === id));
      setSelectedFilterTypeNames(new Set(validTypes.length ? validTypes : allTypes));
      setSelectedFilterSpecialistIds(new Set(validIds.length ? validIds : allIds));
    } else {
      setSelectedFilterTypeNames(new Set(allTypes));
      setSelectedFilterSpecialistIds(new Set(allIds));
    }
  }, [specialistsActive]);

  useEffect(() => {
    if (!specialistFilterInitializedRef.current) return;
    saveBookingSpecialistFilterPrefs({
      typeNames: [...selectedFilterTypeNames],
      specialistIds: [...selectedFilterSpecialistIds],
    });
  }, [selectedFilterTypeNames, selectedFilterSpecialistIds]);

  const bookingFilterActive = useMemo(() => {
    if (!specialistsActive.length) return false;
    const allTypes = collectTypeLabels(specialistsActive);
    return (
      !allTypesSelected(allTypes, selectedFilterTypeNames) ||
      !allSpecialistsSelected(specialistsActive, selectedFilterSpecialistIds)
    );
  }, [specialistsActive, selectedFilterTypeNames, selectedFilterSpecialistIds]);

  const specialistsForCalendarView = useMemo(
    () =>
      filterCalendarSpecialists(
        specialistsForCalendar,
        selectedFilterTypeNames,
        selectedFilterSpecialistIds,
        gridAppointmentSpecIds,
      ),
    [specialistsForCalendar, selectedFilterTypeNames, selectedFilterSpecialistIds, gridAppointmentSpecIds],
  );

  function resetBookingSpecialistFilter() {
    clearBookingSpecialistFilterPrefs();
    const allTypes = collectTypeLabels(specialistsActive);
    setSelectedFilterTypeNames(new Set(allTypes));
    setSelectedFilterSpecialistIds(new Set(specialistsActive.map((s) => s.id)));
  }

  /** Слот мог быть выбран в колонке неактивного специалиста — оставляем его в списке формы. */
  const specialistsForFormSelect = useMemo(() => {
    const list = [...specialistsActive];
    if (specialistId && !list.some((s) => s.id === specialistId)) {
      const extra = specialistsQuery.data?.find((s) => s.id === specialistId);
      if (extra) list.push(extra);
    }
    return list;
  }, [specialistsActive, specialistsQuery.data, specialistId]);

  /** Услуги = активные направления записи (+ выбранное, даже если архив).
   *  Курс/протокол — только admin/owner (менеджеры не видят и не могут выбрать). */
  const serviceDirectionOptions = useMemo(() => {
    const map = new Map<number, BookingDirection>();
    for (const d of directionsQuery.data ?? []) {
      if (!d.is_active) continue;
      if (!canBookCourses && isCourseLikeDirectionName(d.name)) continue;
      map.set(d.id, d);
    }
    if (serviceDirectionId !== "" && !map.has(serviceDirectionId)) {
      const cur = (directionsQuery.data ?? []).find((d) => d.id === serviceDirectionId);
      if (cur && (canBookCourses || !isCourseLikeDirectionName(cur.name))) {
        map.set(cur.id, cur);
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [directionsQuery.data, serviceDirectionId, canBookCourses]);

  // Если менеджер открыл форму с уже выбранным курсом — сбрасываем.
  useEffect(() => {
    if (canBookCourses || serviceDirectionId === "") return;
    const cur = (directionsQuery.data ?? []).find((d) => d.id === serviceDirectionId);
    if (cur && isCourseLikeDirectionName(cur.name)) {
      setServiceDirectionId("");
      setServiceTitle("");
    }
  }, [canBookCourses, serviceDirectionId, directionsQuery.data]);

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

  const noteMutation = useMutation({
    mutationFn: ({ id, comment: noteText }: { id: number; comment: string }) =>
      apiFetch<BookingAppointment>(`/api/booking/appointments/${id}/details`, {
        method: "PATCH",
        body: JSON.stringify({ comment: noteText.trim() || null }),
      }),
    onSuccess: () => {
      setNoteEditAppt(null);
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments-grid"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-journal"] });
      toast.success("Заметка сохранена");
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

  function onAppointmentCompleteToggle(a: BookingAppointment, completed: boolean) {
    if (!completed) {
      statusMutation.mutate({ id: a.id, status: "booked" });
      return;
    }
    const service = Number(a.service_amount ?? 0);
    const paid = Number(a.paid_amount ?? 0);
    const debt = service > 0 ? Math.max(0, service - paid) : 0;
    if (debt > 0.009) {
      // Нужен ввод остатка — открываем карточку записи с панелью явки.
      setApptDetail(a);
      toast("Укажите сумму остатка при явке");
      return;
    }
    statusMutation.mutate({ id: a.id, status: "completed" });
  }

  function onCalendarAppointmentClick(a: BookingAppointment) {
    setApptDetail(a);
  }

  function onAppointmentNoteClick(a: BookingAppointment) {
    setNoteEditAppt(a);
    setNoteDraft((a.comment || "").trim());
  }

  function onOpenChat(leadId: number) {
    navigate(`/chat?lead_id=${leadId}`);
  }

  function openEditSpecialistModal(s: BookingSpecialist) {
    setSpecialistModalTarget(s);
    setSpecialistModalOpen(true);
  }

  function handleDeleteSpecialistFromModal() {
    if (!specialistModalTarget) return;
    const name = specialistModalTarget.full_name;
    if (!window.confirm(`Удалить специалиста «${name}»?`)) return;
    deleteSpecialistUserMutation.mutate(specialistModalTarget.id);
  }

  function handleSpecialistModalSubmit(values: SpecialistFormValues) {
    if (!specialistModalTarget) return;
    const phone = values.phone.trim() || null;
    const specialization = values.specialization.trim() || null;
    patchSpecialistUserMutation.mutate({
      id: specialistModalTarget.id,
      body: {
        full_name: values.full_name,
        phone,
        specialization,
        direction_id: values.direction_id,
        direction_ids: values.direction_ids,
        slot_duration_min: values.slot_duration_min,
        work_start_hour: values.work_start_hour,
        work_end_hour: values.work_end_hour,
        work_weekdays: values.work_weekdays,
        course_streams_enabled: values.course_streams_enabled,
        course_stream_max_days: values.course_stream_max_days,
        course_stream_min_day_for_next: values.course_stream_min_day_for_next,
        course_stream_gap_days: values.course_stream_gap_days,
      },
    });
  }

  function handleSlotClick(payload: { specialistId: number; directionId: number; dateYmd: string; minuteOfDay: number }) {
    setSpecialistId(payload.specialistId);
    setFilterDate(payload.dateYmd);
    const hh = Math.floor(payload.minuteOfDay / 60);
    const mm = payload.minuteOfDay % 60;
    setStartAt(`${payload.dateYmd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
    toast.success(`Слот ${hh}:${String(mm).padStart(2, "0")} — заполните форму справа`);
    window.setTimeout(() => {
      formPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
  }

  function handleServiceDirectionChange(directionId: number) {
    const dir = serviceDirectionOptions.find((d) => d.id === directionId);
    if (!dir) return;
    if (!canBookCourses && isCourseLikeDirectionName(dir.name)) {
      toast.error("Курс и протокол может записывать только администратор");
      return;
    }
    setServiceDirectionId(dir.id);
    setServiceTitle(dir.name);
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
      toast.error("Укажите услугу, специалиста, дату и время.");
      return;
    }
    if (!specialistsActive.length) {
      toast.error("Нет специалистов в сетке — пригласите эксперта в «Сотрудники».");
      return;
    }
    let startIso: string;
    try {
      startIso = datetimeLocalBookingToIsoUtc(startAt);
    } catch {
      toast.error("Неверная дата.");
      return;
    }
    const resolvedServiceAmount = freeConsultEligible
      ? 0
      : fixedServiceAmount ?? (serviceAmount.trim() === "" ? NaN : Number(serviceAmount));
    const resolvedPaidAmount = freeConsultEligible
      ? 0
      : paidAmount.trim() === ""
        ? 0
        : Number(paidAmount);
    if (!Number.isFinite(resolvedServiceAmount) || resolvedServiceAmount < 0) {
      toast.error("Укажите стоимость услуги");
      return;
    }
    if (!Number.isFinite(resolvedPaidAmount) || resolvedPaidAmount < 0) {
      toast.error("Сумма оплаты указана неверно");
      return;
    }
    if (serviceDirectionId === "") {
      toast.error("Выберите услугу");
      return;
    }
    const selectedDir = (directionsQuery.data ?? []).find((d) => d.id === serviceDirectionId);
    if (selectedDir && !canBookCourses && isCourseLikeDirectionName(selectedDir.name)) {
      toast.error("Курс и протокол может записывать только администратор");
      return;
    }
    if (!canBookCourses && isCourseLikeDirectionName(serviceTitle)) {
      toast.error("Курс и протокол может записывать только администратор");
      return;
    }
    const payload: Record<string, unknown> = {
      patient_name: patientName.trim(),
      patient_phone: patientPhone.trim(),
      extra_phones: extraPhones.map((p) => p.trim()).filter(Boolean),
      specialist_id: specialistId,
      service_title: serviceTitle.trim(),
      direction_id: serviceDirectionId,
      start_at: startIso,
      service_amount: resolvedServiceAmount,
      paid_amount: resolvedPaidAmount,
      comment: comment.trim() || null,
    };
    if (resolvedPaidAmount > resolvedServiceAmount) {
      toast.error("Оплата не может быть больше стоимости услуги");
      return;
    }
    if (currentRole === "manager" && resolvedPaidAmount > 0 && !currentUserId) {
      toast.error("Не удалось определить ответственного менеджера автоматически");
      return;
    }
    if (leadId) payload.lead_id = leadId;
    if (!leadId) {
      if (!newLeadPipelineId || !newLeadStageId) {
        toast.error("Не удалось подготовить карточку клиента — обновите страницу");
        return;
      }
      payload.lead_pipeline_id = newLeadPipelineId;
      payload.lead_stage_id = newLeadStageId;
    }
    // Менеджер всегда ставится ответственным — иначе полная оплата не попадёт в KPI.
    if (currentRole === "manager" && currentUserId) {
      payload.responsible_manager_id = currentUserId;
    } else if (currentRole === "manager" && resolvedPaidAmount > 0 && !currentUserId) {
      toast.error("Не удалось определить ответственного менеджера автоматически");
      return;
    }
    if (seriesBookingEnabled && consecutiveDays > 1) {
      payload.consecutive_days = consecutiveDays;
    } else {
      payload.consecutive_days = 1;
    }
    createMutation.mutate(payload);
  }

  const tabBtn = (id: Tab, label: string) => (
    <button key={id} type="button" onClick={() => setTab(id)} data-active={tab === id}>
      {label}
    </button>
  );

  return (
    <div className="booking-page mo-page relative space-y-3">
      <header className="booking-page-header">
        <div className="booking-page-head">
          <div className="booking-page-brand">
            <Link to={chatStages ? "/chat" : "/app"} className="booking-page-back">
              {chatStages ? "← К чатам" : "← К канбану"}
            </Link>
            <div className="booking-page-title-row">
              <h1 className="booking-page-title">Онлайн-записи</h1>
              {tab === "online" ? (
                <div className="booking-page-legend" aria-label="Статусы записей">
                  <span className="booking-legend-item booking-legend-item--booked">Записан</span>
                  <span className="booking-legend-item booking-legend-item--notify">Уведомление отправлено</span>
                  <span className="booking-legend-item booking-legend-item--replied">Клиент ответил</span>
                  <span className="booking-legend-item booking-legend-item--completed">Завершён</span>
                </div>
              ) : null}
            </div>
            {chatStages && leadId ? (
              <p className="booking-page-note">
                Статус «Удачно»: заполните эксперта, дату и сумму — лид уже выбран (#{leadId}
                {patientName ? `, ${patientName}` : ""}).
              </p>
            ) : null}
            {isExpert ? (
              <p className="booking-page-note">
                Главный эксперт видит всех специалистов воронки; иначе — только свою колонку.
              </p>
            ) : null}
          </div>
          <div className="crm-view-switch booking-page-tabs flex flex-wrap items-center gap-2" role="tablist" aria-label="Раздел записи">
            {tabBtn("online", "Онлайн-записи")}
            {tabBtn("journal", "Журнал")}
            {canEditBooking ? (
              <button
                type="button"
                className="btn-secondary ml-auto px-3 py-1.5 text-xs sm:text-sm"
                onClick={() => setDirectionsPanelOpen(true)}
              >
                Направление записи
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {tab === "online" && (
        <div className="space-y-3">
          <div className="booking-page-toolbar-row">
            <div className="booking-page-date-nav" aria-label="Дата записи">
              <button
                type="button"
                className="booking-page-date-nav-btn"
                aria-label="Предыдущая неделя"
                onClick={() => setFilterDate((d) => shiftFilterDateYmd(d, -7))}
              >
                ‹
              </button>
              <span className="booking-page-date-label">{formatWeekRangeLabel(filterDate)}</span>
              <button
                type="button"
                className="booking-page-date-nav-btn"
                aria-label="Следующая неделя"
                onClick={() => setFilterDate((d) => shiftFilterDateYmd(d, 7))}
              >
                ›
              </button>
            </div>
            <BookingSpecialistsFilter
              specialists={specialistsActive}
              selectedTypeNames={selectedFilterTypeNames}
              selectedSpecialistIds={selectedFilterSpecialistIds}
              onChangeTypes={setSelectedFilterTypeNames}
              onChangeSpecialists={setSelectedFilterSpecialistIds}
              onResetAll={resetBookingSpecialistFilter}
              filterActive={bookingFilterActive}
            />
          </div>
          <div className="booking-page-shell">
            <div className="min-w-0">
              <BookingWeekSpecialistGrid
                anchorDateYmd={filterDate}
                specialists={specialistsForCalendarView}
                appointments={gridAppointmentsQuery.data ?? []}
                onAppointmentClick={onCalendarAppointmentClick}
                onSlotClick={canEditBooking ? handleSlotClick : undefined}
                onEditSpecialist={canEditBooking ? openEditSpecialistModal : undefined}
                onReorderSpecialists={canEditBooking ? (orderedIds) => reorderSpecialistsMutation.mutate(orderedIds) : undefined}
                showSessionInsteadOfTime={showSessionInsteadOfTime}
                canEditNotes={canEditBooking}
                onAppointmentNoteClick={canEditBooking ? onAppointmentNoteClick : undefined}
                canToggleComplete={canEditBooking}
                onAppointmentCompleteToggle={canEditBooking ? onAppointmentCompleteToggle : undefined}
              />
              {gridAppointmentsQuery.isLoading && (
                <p className="mt-3 text-sm lux-caption">Загрузка записей…</p>
              )}
            </div>
            <aside className="flex w-full min-w-0 flex-col gap-2 xl:sticky xl:top-4 xl:max-w-[280px]">
              {canEditBooking ? (
                <section
                  ref={formPanelRef}
                  className="mo-section overflow-visible p-4 ring-1 ring-[#d4af37]/20"
                >
                  <div className="booking-form-calendar mb-3">
                    <MiniMonthCalendar value={filterDate} onChange={setFilterDate} />
                  </div>
                  <h2 className="mb-3 lux-subheading">Новая запись</h2>
                  <form onSubmit={onSubmit} className="space-y-2.5">
                <div ref={patientSuggestRef} className="relative space-y-2.5">
                  <label className="block text-sm mo-muted">
                    Пациент / клиент
                    <input
                      required
                      value={patientName}
                      onChange={(e) => {
                        setPatientName(e.target.value);
                        setPatientSuggestOpen(true);
                        lastAutoSuggestKeyRef.current = null;
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
                        lastAutoSuggestKeyRef.current = null;
                        if (leadId != null) {
                          const digits = e.target.value.replace(/\D/g, "");
                          if (digits.length < 4) setLeadId(null);
                        }
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
                      className="mt-1 w-full mo-input"
                      autoComplete="off"
                      inputMode="tel"
                    />
                  </label>
                  <div className="space-y-2">
                    {extraPhones.map((ep, idx) => (
                      <div key={idx} className="flex gap-2">
                        <input
                          type="tel"
                          value={ep}
                          onChange={(e) => {
                            const next = [...extraPhones];
                            next[idx] = e.target.value;
                            setExtraPhones(next);
                          }}
                          placeholder={idx === 0 ? "+992 … доп. номер" : "Ещё номер"}
                          className="min-w-0 flex-1 mo-input text-sm"
                          autoComplete="off"
                        />
                        {extraPhones.length > 1 ? (
                          <button
                            type="button"
                            className="shrink-0 rounded-lg border border-[var(--mo-border)] px-2 text-xs mo-muted hover:bg-[var(--mo-accent-soft)]"
                            onClick={() => setExtraPhones(extraPhones.filter((_, i) => i !== idx))}
                          >
                            ✕
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {extraPhones.length < 5 ? (
                      <button
                        type="button"
                        className="text-xs font-medium text-[var(--mo-warning)] hover:underline"
                        onClick={() => setExtraPhones([...extraPhones, ""])}
                      >
                        + Добавить номер
                      </button>
                    ) : null}
                  </div>
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
                <label className="block text-sm mo-muted">
                  Услуга
                  <select
                    required
                    value={serviceDirectionId === "" ? "" : serviceDirectionId}
                    onChange={(e) => handleServiceDirectionChange(Number(e.target.value))}
                    className="mt-1 w-full mo-input"
                  >
                    <option value="" disabled>
                      — выберите услугу —
                    </option>
                    {serviceDirectionOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {!d.is_active ? " (архив)" : ""}
                      </option>
                    ))}
                  </select>
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
                </label>
                <div className="space-y-2 rounded-lg border border-[var(--mo-border)] bg-[var(--mo-surface-soft)] p-3">
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-[var(--mo-text)]">
                    <input
                      type="checkbox"
                      checked={seriesBookingEnabled}
                      onChange={(e) => setSeriesBookingEnabled(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Записать на несколько дней подряд
                      <span className="mt-0.5 block text-xs mo-muted">
                        {courseStreamsForForm
                          ? "Сеансы включены: каждый день — отдельная оплата (массаж, логопед…)"
                          : "Сеансы выключены: одна стоимость на весь период, доплаты суммируются"}
                      </span>
                    </span>
                  </label>
                      {seriesBookingEnabled ? (
                    <label className="block text-sm mo-muted">
                      Дней подряд
                      <select
                        value={consecutiveDays}
                        onChange={(e) => setConsecutiveDays(Number(e.target.value))}
                        className="mt-1 w-full mo-input"
                      >
                        {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {n} {n === 1 ? "день" : n < 5 ? "дня" : "дней"}
                          </option>
                        ))}
                      </select>
                      {seriesEndDateYmd && startAt ? (
                        <p className="mt-1 text-xs text-[var(--mo-success)]">
                          Будет {consecutiveDays}{" "}
                          {consecutiveDays === 1 ? "запись" : consecutiveDays < 5 ? "записи" : "записей"} с{" "}
                          {startAt.slice(0, 10)} по {seriesEndDateYmd} в одно время
                          {courseStreamsForForm
                            ? ` · стоимость × ${consecutiveDays}`
                            : " · стоимость один раз"}
                        </p>
                      ) : null}
                      {courseStreamsForForm && consecutiveDays > 1 ? (
                        <p className="mt-1 text-xs mo-muted">
                          Предоплата распределится по дням (каждый сеанс ≤ своей стоимости). Не оставляйте
                          оплату только на первый день.
                        </p>
                      ) : null}
                    </label>
                  ) : null}
                </div>
                <label className="block text-sm mo-muted">
                  Стоимость услуги (TJS)
                  <input
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={
                      freeConsultEligible
                        ? "0"
                        : fixedServiceAmount != null
                          ? String(fixedServiceAmount)
                          : serviceAmount
                    }
                    onChange={(e) => setServiceAmount(e.target.value)}
                    disabled={fixedServiceAmount != null || freeConsultEligible}
                    className="mt-1 w-full mo-input disabled:opacity-70"
                  />
                  {freeConsultEligible ? (
                    <p className="mt-1 text-xs text-[var(--mo-success)]">
                      {freeConsultHintQuery.data?.reason ||
                        "Клиент уже на курсе/протоколе — консультация бесплатно"}
                    </p>
                  ) : freeConsultHintQuery.data?.reason &&
                    isGanchinaSpecialistName(selectedSpecialistForForm?.full_name) ? (
                    <p className="mt-1 text-xs mo-muted">{freeConsultHintQuery.data.reason}</p>
                  ) : fixedServiceAmount != null ? (
                    <p className="mt-1 text-xs text-[var(--mo-success)]">
                      Цена зафиксирована в KPI ({kpiPriceHintQuery.data?.year_month}). Введите только сумму оплаты.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs mo-muted">
                      Если владелец задал цену услуги в KPI на этот месяц, поле подставится автоматически.
                    </p>
                  )}
                </label>
                <label className="block text-sm mo-muted">
                  Оплатил клиент (TJS)
                  <input
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={freeConsultEligible ? "0" : paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    disabled={freeConsultEligible}
                    className="mt-1 w-full mo-input disabled:opacity-70"
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
                </label>
                    <button
                      type="submit"
                      disabled={createMutation.isPending}
                      className="btn-primary w-full py-3 disabled:opacity-50"
                    >
                      {createMutation.isPending
                        ? "Сохранение…"
                        : seriesBookingEnabled && consecutiveDays > 1
                          ? `Записать на ${consecutiveDays} дней`
                          : "Записать"}
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
            <section className="mo-section p-3 sm:p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[var(--mo-text)]">Источники заявок</h2>
                <form
                  className="flex min-w-0 flex-1 items-center gap-1.5 sm:max-w-md sm:flex-none"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!sourceName.trim()) return;
                    addSourceMutation.mutate();
                  }}
                >
                  <input
                    placeholder="Instagram / Сайт…"
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    className="mo-input min-w-0 flex-1 py-1.5 text-xs sm:text-sm"
                  />
                  <button type="submit" className="btn-primary shrink-0 px-2.5 py-1.5 text-xs sm:text-sm">
                    +
                  </button>
                </form>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(sourcesQuery.data ?? []).map((s) => (
                  <span
                    key={s.id}
                    className={[
                      "inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide",
                      s.is_active
                        ? "border-[var(--mo-border)] bg-[var(--mo-surface)] text-[var(--mo-text)]"
                        : "border-dashed border-[var(--mo-border)] text-[var(--mo-text-muted)] opacity-70",
                    ].join(" ")}
                    title={s.is_active ? s.name : `${s.name} (выкл.)`}
                  >
                    <span className="truncate">{s.name}</span>
                    {!s.is_active ? <span className="ml-1 normal-case opacity-80">· выкл.</span> : null}
                  </span>
                ))}
                {!sourcesQuery.isLoading && (sourcesQuery.data ?? []).length === 0 && (
                  <span className="text-xs mo-muted">Источников пока нет</span>
                )}
              </div>
            </section>
          ) : null}
        </div>
      )}

      <SpecialistModal
        open={specialistModalOpen}
        mode="edit"
        initial={specialistModalTarget}
        directions={(directionsQuery.data ?? []).map((d) => ({
          id: d.id,
          name: d.name,
          is_active: d.is_active,
        }))}
        canAssignCourseDirections={canBookCourses}
        isSubmitting={patchSpecialistUserMutation.isPending}
        isDeleting={deleteSpecialistUserMutation.isPending}
        onClose={() => {
          if (patchSpecialistUserMutation.isPending || deleteSpecialistUserMutation.isPending) return;
          setSpecialistModalOpen(false);
          setSpecialistModalTarget(null);
        }}
        onSubmit={handleSpecialistModalSubmit}
        onDelete={canEditBooking ? handleDeleteSpecialistFromModal : undefined}
      />

      <BookingDirectionsPanel
        open={directionsPanelOpen}
        onClose={() => setDirectionsPanelOpen(false)}
        canManageCourseDirections={canBookCourses}
      />

      {tab === "journal" && (
        <section className="mo-section booking-journal-section p-3 sm:p-4">
          <div className="booking-journal-filters">
            <div ref={journalDateWrapRef} className="booking-journal-date-wrap">
              <div className="booking-page-date-nav booking-journal-date-nav" aria-label="Дата журнала">
                <button
                  type="button"
                  className="booking-page-date-nav-btn booking-journal-date-nav-btn"
                  aria-label="Предыдущий день"
                  onClick={() => setJournalDate((d) => shiftFilterDateYmd(d, -1))}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="booking-journal-date-btn"
                  aria-expanded={journalCalendarOpen}
                  aria-haspopup="dialog"
                  title="Выбрать дату"
                  onClick={() => setJournalCalendarOpen((o) => !o)}
                >
                  {formatJournalDateShort(journalDate)}
                </button>
                <button
                  type="button"
                  className="booking-page-date-nav-btn booking-journal-date-nav-btn"
                  aria-label="Следующий день"
                  onClick={() => setJournalDate((d) => shiftFilterDateYmd(d, 1))}
                >
                  ›
                </button>
              </div>
              {journalCalendarOpen ? (
                <div className="booking-journal-calendar-popover" role="dialog" aria-label="Выбор даты">
                  <MiniMonthCalendar
                    compact
                    value={journalDate}
                    onChange={(d) => {
                      setJournalDate(d);
                      setJournalCalendarOpen(false);
                    }}
                  />
                </div>
              ) : null}
            </div>
            <input
              type="search"
              value={journalSearch}
              onChange={(e) => setJournalSearch(e.target.value)}
              placeholder="Поиск: ФИО или телефон"
              aria-label="Поиск клиента по ФИО или телефону"
              className="mo-input booking-journal-search-input"
            />
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
                                <td className="py-1 pr-3">
                                  {formatMoney(v.paid_amount)} / {formatMoney(v.service_amount)}
                                </td>
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
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="booking-journal-table w-full min-w-[840px] border-collapse text-left text-[var(--mo-text)]">
              <thead>
                <tr className="border-b border-[var(--mo-border)] lux-caption">
                  <th>{showSessionInsteadOfTime ? "Сеанс" : "Время"}</th>
                  <th>Пациент</th>
                  <th>Услуга</th>
                  <th>Спец.</th>
                  <th>Сумма</th>
                  <th>Оплата</th>
                  <th>Долг</th>
                  <th className="booking-journal-col-status">Статус</th>
                  <th className="max-w-[140px]">Заметка</th>
                  {(journalQuery.data ?? []).some((x) => x.can_manage_journal) && (
                    <th className="booking-journal-col-actions w-9" aria-label="Действия" />
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
                    <td className="whitespace-nowrap tabular-nums">
                      {showSessionInsteadOfTime ? (
                        <span className="font-semibold text-indigo-800">{visitDisplayValue(a) ?? "—"}</span>
                      ) : (
                        formatDt(a.start_at)
                      )}
                    </td>
                    <td>
                      <span className="font-medium leading-tight">{a.patient_name}</span>
                      <span className="block text-[11px] leading-tight mo-muted">
                        <PatientPhone value={a} />
                      </span>
                    </td>
                    <td className="mo-muted">
                      {(a.service_title || "").trim() || a.direction_name || "—"}
                    </td>
                    <td className="lux-caption">{a.specialist_name}</td>
                    <td className="tabular-nums">{formatMoney(a.service_amount ?? 0)}</td>
                    <td className="tabular-nums">{formatMoney(a.paid_amount ?? 0)}</td>
                    <td>
                      {Number(a.service_amount ?? 0) > Number(a.paid_amount ?? 0) ? (
                        <span className="booking-journal-debt">
                          {formatMoney(Number(a.service_amount ?? 0) - Number(a.paid_amount ?? 0))}
                        </span>
                      ) : Number(a.service_amount ?? 0) > 0 ? (
                        <span className="text-[var(--mo-success)]">0</span>
                      ) : (
                        <span className="mo-muted">—</span>
                      )}
                    </td>
                    <td className="booking-journal-col-status">
                      {canEditBooking ? (
                        <select
                          value={a.status}
                          onChange={(e) => {
                            const next = e.target.value;
                            if (next === "completed") {
                              const service = Number(a.service_amount ?? 0);
                              const paid = Number(a.paid_amount ?? 0);
                              const debt = service > 0 ? Math.max(0, service - paid) : 0;
                              if (debt > 0.009) {
                                setApptDetail(a);
                                toast("Укажите сумму остатка при явке");
                                return;
                              }
                            }
                            statusMutation.mutate({ id: a.id, status: next });
                          }}
                          className="mo-input booking-journal-status"
                          aria-label={`Статус: ${statusLabels[a.status] ?? a.status}`}
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
                    <td className="max-w-[140px]">
                      {(a.comment || "").trim() ? (
                        <span
                          className="line-clamp-2 text-[11px] leading-snug mo-muted"
                          title={(a.comment || "").trim()}
                        >
                          {(a.comment || "").trim()}
                        </span>
                      ) : (
                        <span className="mo-muted">—</span>
                      )}
                    </td>
                    {(journalQuery.data ?? []).some((x) => x.can_manage_journal) && (
                      <td className="booking-journal-col-actions">
                        {a.can_manage_journal ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (!window.confirm("Удалить эту запись?")) return;
                              deleteAppointmentMutation.mutate(a.id);
                            }}
                            className="booking-journal-delete"
                            aria-label="Удалить запись"
                            title="Удалить"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!journalQuery.isLoading && (journalQuery.data ?? []).length === 0 && (
              <p className="py-4 text-center text-sm mo-muted">Нет записей на эту дату</p>
            )}
          </div>
        </section>
      )}

      {canEditDirectionStreams ? <DirectionStreamsPanel /> : null}

      {apptDetail ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--mo-text)]/40 p-3 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="booking-appt-detail-title"
          onClick={() => setApptDetail(null)}
        >
          <div className="booking-appt-detail-modal mo-card" onClick={(e) => e.stopPropagation()}>
            <div className="booking-appt-detail-modal__body">
              <p id="booking-appt-detail-title" className="booking-appt-detail-modal__eyebrow">
                Запись клиента
              </p>
              <p className="booking-appt-detail-modal__name">{apptDetail.patient_name}</p>
              <div className="booking-appt-detail-modal__meta-row">
                <span>{formatDt(apptDetail.start_at)}</span>
                {(apptDetail.service_title || "").trim() ? (
                  <span className="booking-appt-detail-modal__service">
                    Услуга: {(apptDetail.service_title || "").trim()}
                  </span>
                ) : null}
              </div>
              {canEditBooking ? (
                <BookingAttendancePanel
                  status={apptDetail.status}
                  disabled={statusMutation.isPending}
                  serviceAmount={Number(apptDetail.service_amount ?? 0)}
                  paidAmount={Number(apptDetail.paid_amount ?? 0)}
                  onStatusChange={(status, add_payment) =>
                    statusMutation.mutate({ id: apptDetail.id, status, add_payment })
                  }
                />
              ) : null}
            </div>
            <footer className="booking-appt-detail-modal__foot">
              {apptDetail.lead_id != null ? (
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  onClick={() => {
                    setApptDetail(null);
                    navigate(`/leads/${apptDetail.lead_id}?appointment=${apptDetail.id}`);
                  }}
                >
                  Карточка в CRM
                </button>
              ) : null}
              <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => setApptDetail(null)}>
                Закрыть
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {noteEditAppt ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--mo-text)]/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="booking-note-title"
          onClick={() => setNoteEditAppt(null)}
        >
          <div
            className="mo-card w-full max-w-md p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="booking-note-title" className="lux-subheading text-base">
              Заметка к записи
            </h2>
            <p className="mt-1 text-sm mo-muted">
              {noteEditAppt.patient_name} · {formatDt(noteEditAppt.start_at)}
            </p>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={4}
              autoFocus
              placeholder="Пожелания клиента, перенос, скидка…"
              className="mo-input mt-3 w-full text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={() => setNoteEditAppt(null)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn-primary text-sm disabled:opacity-50"
                disabled={noteMutation.isPending}
                onClick={() => noteMutation.mutate({ id: noteEditAppt.id, comment: noteDraft })}
              >
                {noteMutation.isPending ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
