import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";

import { BookingCalendarGrid } from "@/components/BookingCalendarGrid";
import { MiniMonthCalendar } from "@/components/MiniMonthCalendar";
import { SpecialistModal } from "@/components/SpecialistModal";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeDisplayNameFromToken, decodeRoleFromToken, decodeUserIdFromToken } from "@/lib/auth";
import { BOOKING_TIME_ZONE, datetimeLocalBookingToIsoUtc, ymdInBookingTz } from "@/lib/bookingTz";
import type {
  BookingAppointment,
  BookingDirection,
  BookingSpecialist,
  LeadSource,
  Pipeline,
  PipelineStage,
  SalesKpiPriceHint,
} from "@/lib/types";

type Tab = "online" | "dicts" | "journal";

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
  const formPanelRef = useRef<HTMLDivElement>(null);

  const [leadId, setLeadId] = useState<number | null>(null);
  const [newLeadPipelineId, setNewLeadPipelineId] = useState<number | null>(null);
  const [newLeadStageId, setNewLeadStageId] = useState<number | null>(null);
  const [directionPipelineId, setDirectionPipelineId] = useState<number | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [directionId, setDirectionId] = useState(0);
  const [specialistId, setSpecialistId] = useState(0);
  const [startAt, setStartAt] = useState("");
  const [serviceAmount, setServiceAmount] = useState<number>(0);
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [comment, setComment] = useState("");
  const token = getStoredToken();
  const currentRole = decodeRoleFromToken(token);
  const currentUserId = decodeUserIdFromToken(token);
  const currentUserName = decodeDisplayNameFromToken(token) || "Текущий пользователь";
  const isExpert = currentRole === "expert";
  const isManagerOrAdmin = currentRole === "manager" || currentRole === "admin";
  const canEditBooking = !isExpert;

  const [dirName, setDirName] = useState("");
  const [dirDuration, setDirDuration] = useState(30);
  const [specName, setSpecName] = useState("");
  const [specDirId, setSpecDirId] = useState(0);
  const [specPhone, setSpecPhone] = useState("");
  const [specSpecialization, setSpecSpecialization] = useState("");

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

  const directionsQuery = useQuery({
    queryKey: ["booking-directions"],
    queryFn: () => apiFetch<BookingDirection[]>("/api/booking/directions"),
  });

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
  const kpiPriceHintQuery = useQuery({
    queryKey: ["sales-kpi-price-hint", pipelineForKpiPrice, directionId, startAtIsoForKpi],
    queryFn: () =>
      apiFetch<SalesKpiPriceHint>(
        `/api/sales-kpi/price-hint?pipeline_id=${pipelineForKpiPrice}&direction_id=${directionId}&start_at=${encodeURIComponent(startAtIsoForKpi!)}`,
      ),
    enabled: Boolean(pipelineForKpiPrice && directionId && startAtIsoForKpi),
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

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<BookingAppointment>("/api/booking/appointments", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Запись создана.");
      setPatientName("");
      setPatientPhone("");
      setComment("");
      setServiceAmount(0);
      setPaidAmount(0);
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

  const addDirectionMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/booking/directions", {
        method: "POST",
        body: JSON.stringify({
          name: dirName.trim(),
          duration_min: dirDuration,
          pipeline_id: directionPipelineId,
        }),
      }),
    onSuccess: () => {
      toast.success("Направление добавлено");
      setDirName("");
      void queryClient.invalidateQueries({ queryKey: ["booking-directions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const patchDirectionMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiFetch<BookingDirection>(`/api/booking/directions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Услуга обновлена");
      void queryClient.invalidateQueries({ queryKey: ["booking-directions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteDirectionMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/api/booking/directions/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Услуга удалена");
      void queryClient.invalidateQueries({ queryKey: ["booking-directions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addSpecialistMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/booking/specialists", {
        method: "POST",
        body: JSON.stringify({
          full_name: specName.trim(),
          direction_id: specDirId,
          phone: specPhone.trim() || null,
          specialization: specSpecialization.trim() || null,
          work_start_hour: 9,
          work_end_hour: 18,
          work_weekdays: [0, 1, 2, 3, 4],
        }),
      }),
    onSuccess: () => {
      toast.success("Специалист добавлен");
      setSpecName("");
      setSpecPhone("");
      setSpecSpecialization("");
      void queryClient.invalidateQueries({ queryKey: ["booking-specialists"] });
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

  const directionsActive = useMemo(() => directionsQuery.data?.filter((d) => d.is_active) ?? [], [directionsQuery.data]);
  const directionsForPipeline = useMemo(() => {
    if (directionPipelineId == null) return directionsActive;
    return directionsActive.filter((d) => d.pipeline_id === directionPipelineId);
  }, [directionsActive, directionPipelineId]);

  const specialistsActive = useMemo(() => {
    const list = specialistsQuery.data?.filter((s) => s.is_active) ?? [];
    return [...list].sort((a, b) => {
      const o = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      return o !== 0 ? o : a.id - b.id;
    });
  }, [specialistsQuery.data]);

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

  const specialistsForDirection = useMemo(() => {
    if (!directionId) return [];
    return specialistsActive.filter((s) => s.direction_id === directionId);
  }, [specialistsActive, directionId]);

  useEffect(() => {
    if (directionsForPipeline.length === 0) {
      setDirectionId(0);
      return;
    }
    if (!directionsForPipeline.some((d) => d.id === directionId)) {
      setDirectionId(directionsForPipeline[0].id);
    }
  }, [directionsForPipeline, directionId]);

  useEffect(() => {
    if (!directionId) {
      setSpecialistId(0);
      return;
    }
    const first = specialistsForDirection[0];
    if (first && !specialistsForDirection.some((s) => s.id === specialistId)) {
      setSpecialistId(first.id);
    }
  }, [directionId, specialistsForDirection, specialistId]);

  useEffect(() => {
    if (directionsActive.length && !specDirId) {
      setSpecDirId(directionsActive[0].id);
    }
  }, [directionsActive, specDirId]);

  useEffect(() => {
    if (newLeadPipelineId != null) return;
    const first = pipelinesQuery.data?.[0];
    if (first) setNewLeadPipelineId(first.id);
  }, [newLeadPipelineId, pipelinesQuery.data]);
  useEffect(() => {
    if (directionPipelineId != null) return;
    const first = pipelinesQuery.data?.[0];
    if (first) setDirectionPipelineId(first.id);
  }, [directionPipelineId, pipelinesQuery.data]);
  useEffect(() => {
    if (!leadId && newLeadPipelineId != null) {
      setDirectionPipelineId(newLeadPipelineId);
    }
  }, [leadId, newLeadPipelineId]);
  useEffect(() => {
    if (!specialistId) return;
    const specialist = specialistsActive.find((s) => s.id === specialistId);
    if (!specialist) return;
    const specialistDirection = directionsActive.find((d) => d.id === specialist.direction_id);
    if (!specialistDirection || specialistDirection.pipeline_id == null) return;
    if (specialistDirection.pipeline_id !== directionPipelineId) {
      setDirectionPipelineId(specialistDirection.pipeline_id);
    }
    if (!leadId && specialistDirection.pipeline_id !== newLeadPipelineId) {
      setNewLeadPipelineId(specialistDirection.pipeline_id);
    }
    if (directionId !== specialistDirection.id) {
      setDirectionId(specialistDirection.id);
    }
  }, [
    specialistId,
    specialistsActive,
    directionsActive,
    directionPipelineId,
    leadId,
    newLeadPipelineId,
    directionId,
  ]);

  useEffect(() => {
    if (!canEditBooking && tab === "dicts") {
      setTab("online");
    }
  }, [canEditBooking, tab]);

  useEffect(() => {
    const first = leadStagesQuery.data?.[0];
    if (!first) return;
    if (newLeadStageId != null && leadStagesQuery.data?.some((s) => s.id === newLeadStageId)) return;
    setNewLeadStageId(first.id);
  }, [leadStagesQuery.data, newLeadStageId]);
  useEffect(() => {
    if (fixedServiceAmount == null) return;
    setServiceAmount(fixedServiceAmount);
  }, [fixedServiceAmount]);

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

  function handleSpecialistModalSubmit(values: {
    full_name: string;
    direction_id: number;
    phone: string;
    specialization: string;
    slot_duration_min: number;
    work_start_hour: number;
    work_end_hour: number;
    work_weekdays: number[];
  }) {
    const phone = values.phone.trim() || null;
    const specialization = values.specialization.trim() || null;
    if (specialistModalMode === "add") {
      createSpecialistUserMutation.mutate({
        full_name: values.full_name,
        direction_id: values.direction_id,
        phone,
        specialization,
        slot_duration_min: values.slot_duration_min,
        role: "specialist",
        work_start_hour: values.work_start_hour,
        work_end_hour: values.work_end_hour,
        work_weekdays: values.work_weekdays,
      });
      return;
    }
    if (specialistModalTarget) {
      patchSpecialistUserMutation.mutate({
        id: specialistModalTarget.id,
        body: {
          full_name: values.full_name,
          direction_id: values.direction_id,
          phone,
          specialization,
          slot_duration_min: values.slot_duration_min,
          work_start_hour: values.work_start_hour,
          work_end_hour: values.work_end_hour,
          work_weekdays: values.work_weekdays,
        },
      });
    }
  }

  function handleSlotClick(payload: { specialistId: number; directionId: number; minuteOfDay: number }) {
    const slotDirection = directionsActive.find((d) => d.id === payload.directionId);
    if (slotDirection?.pipeline_id != null) {
      setDirectionPipelineId(slotDirection.pipeline_id);
      if (!leadId) setNewLeadPipelineId(slotDirection.pipeline_id);
    }
    setDirectionId(payload.directionId);
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
    if (!directionPipelineId || !directionId || !specialistId || !startAt) {
      toast.error("Заполните направление, специалиста и дату.");
      return;
    }
    if (!specialistsForDirection.length) {
      toast.error("Для этого направления нет специалистов — добавьте в «Справочники».");
      return;
    }
    let startIso: string;
    try {
      startIso = datetimeLocalBookingToIsoUtc(startAt);
    } catch {
      toast.error("Неверная дата.");
      return;
    }
    const resolvedServiceAmount = fixedServiceAmount ?? serviceAmount;
    const payload: Record<string, unknown> = {
      patient_name: patientName.trim(),
      patient_phone: patientPhone.trim(),
      direction_id: directionId,
      specialist_id: specialistId,
      start_at: startIso,
      service_amount: resolvedServiceAmount,
      paid_amount: paidAmount,
      comment: comment.trim() || null,
    };
    if (paidAmount > resolvedServiceAmount) {
      toast.error("Оплата не может быть больше стоимости услуги");
      return;
    }
    if (isManagerOrAdmin && paidAmount > 0 && !currentUserId) {
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
    if (isManagerOrAdmin && paidAmount > 0 && currentUserId) {
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
        "rounded-xl px-4 py-2 text-sm font-medium transition-all",
        tab === id
          ? "bg-white/10 text-white ring-1 ring-purple-500/40"
          : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div className="relative mx-auto max-w-[1600px] space-y-4 pb-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-white">Онлайн-записи</h1>
          <p className="max-w-2xl text-base text-slate-400">
            Сетка по специалистам: клик по свободному часу открывает форму справа; клик по карточке записи с
            лидом — карточка клиента. После записи лид переходит в «В работе»; при завершении приёма —
            «Успешно реализован», при отмене / неявке — «Потерян».
          </p>
          <Link
            to="/"
            className="inline-flex text-sm font-medium text-purple-300 underline-offset-4 hover:text-purple-200 hover:underline"
          >
            ← К канбану
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabBtn("online", "Онлайн-записи")}
          {canEditBooking ? tabBtn("dicts", "Справочники") : null}
          {tabBtn("journal", "Журнал")}
        </div>
      </header>

      {tab === "online" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-300">
              Дата
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="ml-2 rounded-xl border border-slate-600/50 bg-slate-900/50 px-2 py-1.5 text-white"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span className="rounded border border-sky-300/40 bg-sky-500/15 px-2 py-0.5 text-sky-100">Записан</span>
              <span className="rounded border border-amber-300/50 bg-amber-500/15 px-2 py-0.5 text-amber-100">Уведомление отправлено</span>
              <span className="rounded border border-violet-300/50 bg-violet-500/20 px-2 py-0.5 text-violet-100">Клиент ответил</span>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
            <div className="min-w-0">
              <BookingCalendarGrid
                dateYmd={filterDate}
                specialists={specialistsActive}
                appointments={gridAppointmentsQuery.data ?? []}
                onAppointmentClick={onCalendarAppointmentClick}
                onSlotClick={canEditBooking ? handleSlotClick : undefined}
                onMoveAppointment={canEditBooking ? handleMoveAppointment : undefined}
                onAddSpecialist={canEditBooking ? openAddSpecialistModal : undefined}
                onEditSpecialist={canEditBooking ? openEditSpecialistModal : undefined}
                onDeleteSpecialist={canEditBooking ? (s) => deleteSpecialistUserMutation.mutate(s.id) : undefined}
                onReorderSpecialists={canEditBooking ? (orderedIds) => reorderSpecialistsMutation.mutate(orderedIds) : undefined}
              />
              {gridAppointmentsQuery.isLoading && (
                <p className="mt-3 text-sm text-slate-400">Загрузка записей…</p>
              )}
            </div>
            <aside className="flex w-full min-w-0 max-w-[340px] flex-col gap-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
              <MiniMonthCalendar value={filterDate} onChange={setFilterDate} />

              {canEditBooking ? (
                <section
                  ref={formPanelRef}
                  className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 shadow-inner backdrop-blur-sm ring-1 ring-purple-500/15"
                >
                  <h2 className="mb-1 text-lg font-semibold text-white">Новая запись</h2>
                  <p className="mb-4 text-[11px] text-slate-500">
                    Кликните по слоту в сетке и заполните данные клиента.
                  </p>
                  <form onSubmit={onSubmit} className="space-y-3">
                {leadId != null && (
                  <p className="text-xs text-emerald-400/90">
                    Привязан лид #{leadId} — после сохранения он перейдёт в «В работе».
                  </p>
                )}
                <label className="block text-sm text-slate-300">
                  Пациент / клиент
                  <input
                    required
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                  />
                </label>
                <label className="block text-sm text-slate-300">
                  Телефон
                  <input
                    required
                    value={patientPhone}
                    onChange={(e) => setPatientPhone(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                  />
                </label>
                {!leadId && (
                  <>
                    <label className="block text-sm text-slate-300">
                      Воронка для новой карточки
                      <select
                        required
                        value={newLeadPipelineId ?? ""}
                        onChange={(e) => setNewLeadPipelineId(Number(e.target.value))}
                        className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                      >
                        {(pipelinesQuery.data ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm text-slate-300">
                      Стадия для новой карточки
                      <select
                        required
                        value={newLeadStageId ?? ""}
                        onChange={(e) => setNewLeadStageId(Number(e.target.value))}
                        className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
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
                <label className="block text-sm text-slate-300">
                  Воронка услуги
                  <select
                    required
                    value={directionPipelineId ?? ""}
                    onChange={(e) => setDirectionPipelineId(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                  >
                    {(pipelinesQuery.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-300">
                  Направление
                  <select
                    required
                    value={directionId || ""}
                    onChange={(e) => setDirectionId(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                  >
                    {directionsForPipeline.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.duration_min} мин)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-300">
                  Специалист
                  <select
                    required
                    value={specialistId || ""}
                    onChange={(e) => setSpecialistId(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                  >
                    {specialistsForDirection.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-300">
                  Дата и время
                  <input
                    type="datetime-local"
                    required
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                  />
                  <p className="mt-1 text-[10px] text-slate-500">
                    Время в часовом поясе записи: {BOOKING_TIME_ZONE} (как на сервере).
                  </p>
                </label>
                <label className="block text-sm text-slate-300">
                  Стоимость услуги
                  <input
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={fixedServiceAmount ?? serviceAmount}
                    onChange={(e) => setServiceAmount(Number(e.target.value))}
                    disabled={fixedServiceAmount != null}
                    className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white disabled:opacity-70"
                  />
                  {fixedServiceAmount != null ? (
                    <p className="mt-1 text-xs text-emerald-300">
                      Цена зафиксирована в KPI ({kpiPriceHintQuery.data?.year_month}). Введите только сумму оплаты.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">
                      Если владелец задал цену услуги в KPI на этот месяц, поле подставится автоматически.
                    </p>
                  )}
                </label>
                <label className="block text-sm text-slate-300">
                  Оплатил клиент
                  <input
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                  />
                </label>
                {isManagerOrAdmin ? (
                  <label className="block text-sm text-slate-300">
                    Ответственный менеджер
                    <input
                      type="text"
                      value={currentUserName}
                      readOnly
                      className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white opacity-90"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Подставляется автоматически при оплате.
                    </p>
                  </label>
                ) : null}
                <label className="block text-sm text-slate-300">
                  Комментарий
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                  />
                </label>
                    <button
                      type="submit"
                      disabled={createMutation.isPending}
                      className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition hover:opacity-95 disabled:opacity-50"
                    >
                      {createMutation.isPending ? "Сохранение…" : "Записать"}
                    </button>
                  </form>
                </section>
              ) : (
                <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 text-sm text-slate-300 shadow-inner backdrop-blur-sm">
                  <h2 className="mb-2 text-lg font-semibold text-white">Режим эксперта</h2>
                  <p>Доступен только просмотр ваших записей в календаре и журнале.</p>
                </section>
              )}
            </aside>
          </div>
        </div>
      )}

      {tab === "dicts" && canEditBooking && (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
            <h2 className="mb-4 text-lg font-semibold text-white">Направления</h2>
            <form
              className="mb-4 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!dirName.trim() || !directionPipelineId) return;
                addDirectionMutation.mutate();
              }}
            >
              <select
                value={directionPipelineId ?? ""}
                onChange={(e) => setDirectionPipelineId(Number(e.target.value))}
                className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
              >
                {(pipelinesQuery.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="Название"
                value={dirName}
                onChange={(e) => setDirName(e.target.value)}
                className="min-w-[140px] flex-1 rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
              />
              <input
                type="number"
                min={10}
                step={5}
                value={dirDuration}
                onChange={(e) => setDirDuration(Number(e.target.value))}
                className="w-24 rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
              />
              <button
                type="submit"
                className="rounded-xl bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600"
              >
                Добавить
              </button>
            </form>
            <ul className="space-y-2 text-sm text-slate-300">
              {(directionsQuery.data ?? []).map((d) => (
                <li key={d.id} className="rounded-lg border border-slate-700/50 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      {d.name} — {d.duration_min} мин {d.is_active ? "" : "(выкл.)"}
                      {d.pipeline_name ? (
                        <span className="ml-2 text-xs text-slate-500">[{d.pipeline_name}]</span>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-white/10"
                        onClick={() => {
                          const name = window.prompt("Название услуги", d.name)?.trim();
                          if (!name) return;
                          const durRaw = window.prompt("Длительность (мин)", String(d.duration_min));
                          const duration = Number(durRaw ?? "");
                          if (!Number.isFinite(duration) || duration < 10) {
                            toast.error("Некорректная длительность");
                            return;
                          }
                          patchDirectionMutation.mutate({
                            id: d.id,
                            body: { name, duration_min: duration, pipeline_id: directionPipelineId },
                          });
                        }}
                      >
                        Изм.
                      </button>
                      <button
                        type="button"
                        className="rounded border border-rose-500/50 px-2 py-0.5 text-xs text-rose-300 hover:bg-rose-500/20"
                        onClick={() => {
                          if (!window.confirm("Удалить услугу полностью?")) return;
                          deleteDirectionMutation.mutate(d.id);
                        }}
                      >
                        Удал.
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
            <h2 className="mb-4 text-lg font-semibold text-white">Специалисты</h2>
            <form
              className="mb-4 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!specName.trim() || !specDirId) return;
                addSpecialistMutation.mutate();
              }}
            >
              <input
                placeholder="ФИО"
                value={specName}
                onChange={(e) => setSpecName(e.target.value)}
                className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
              />
              <select
                value={specDirId || ""}
                onChange={(e) => setSpecDirId(Number(e.target.value))}
                className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
              >
                {directionsActive.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="Телефон"
                value={specPhone}
                onChange={(e) => setSpecPhone(e.target.value)}
                className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
              />
              <input
                placeholder="Специализация (необязательно)"
                value={specSpecialization}
                onChange={(e) => setSpecSpecialization(e.target.value)}
                className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
              />
              <button
                type="submit"
                className="rounded-xl bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600"
              >
                Добавить
              </button>
            </form>
            <ul className="space-y-2 text-sm text-slate-300">
              {(specialistsQuery.data ?? []).map((s) => (
                <li key={s.id} className="rounded-lg border border-slate-700/50 px-3 py-2">
                  {s.full_name} — {s.direction_name ?? s.direction_id}
                  {s.specialization ? (
                    <span className="mt-0.5 block text-xs text-slate-500">{s.specialization}</span>
                  ) : null}
                  {!s.is_active && (
                    <span className="ml-2 text-xs text-amber-500/90">(скрыт)</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 md:col-span-2">
            <h2 className="mb-4 text-lg font-semibold text-white">Источники</h2>
            <form
              className="mb-4 flex flex-wrap gap-2"
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
                className="min-w-[220px] flex-1 rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
              />
              <button
                type="submit"
                className="rounded-xl bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600"
              >
                Добавить
              </button>
            </form>
            <ul className="space-y-2 text-sm text-slate-300">
              {(sourcesQuery.data ?? []).map((s) => (
                <li key={s.id} className="rounded-lg border border-slate-700/50 px-3 py-2">
                  {s.name} {!s.is_active ? <span className="text-xs text-amber-500/90">(выкл.)</span> : null}
                </li>
              ))}
              {!sourcesQuery.isLoading && (sourcesQuery.data ?? []).length === 0 && (
                <li className="text-sm text-slate-500">Источников пока нет</li>
              )}
            </ul>
          </section>
        </div>
      )}

      <SpecialistModal
        open={specialistModalOpen}
        mode={specialistModalMode}
        initial={specialistModalTarget}
        directions={directionsActive}
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
        <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-300">
              Дата
              <input
                type="date"
                value={journalDate}
                onChange={(e) => setJournalDate(e.target.value)}
                className="ml-2 rounded-xl border border-slate-600/50 bg-slate-900/50 px-2 py-1.5 text-white"
              />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-left text-sm text-slate-200">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="py-2 pr-4">Время</th>
                  <th className="py-2 pr-4">Пациент</th>
                  <th className="py-2 pr-4">Специалист</th>
                  <th className="py-2 pr-4">Стоимость</th>
                  <th className="py-2 pr-4">Оплачено</th>
                  <th className="py-2 pr-4">Дебиторка</th>
                  <th className="py-2 pr-4">Статус</th>
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
                      "border-b border-slate-800/80",
                      Number(a.service_amount ?? 0) > Number(a.paid_amount ?? 0) ? "bg-amber-500/5" : "",
                    ].join(" ")}
                  >
                    <td className="py-2 pr-4 whitespace-nowrap">{formatDt(a.start_at)}</td>
                    <td className="py-2 pr-4">
                      {a.patient_name}
                      <span className="block text-xs text-slate-500">{a.patient_phone}</span>
                    </td>
                    <td className="py-2 pr-4 text-slate-400">{a.specialist_name}</td>
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
                          className="w-28 rounded-lg border border-slate-600/50 bg-slate-900/80 px-2 py-1 text-white"
                        />
                      ) : (
                        <span>{a.paid_amount ?? 0}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs">
                      {Number(a.service_amount ?? 0) > Number(a.paid_amount ?? 0) ? (
                        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-300">Долг</span>
                      ) : (
                        <span className="text-emerald-300">Оплачено</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {canEditBooking ? (
                        <select
                          value={a.status}
                          onChange={(e) =>
                            statusMutation.mutate({ id: a.id, status: e.target.value })
                          }
                          className="rounded-lg border border-slate-600/50 bg-slate-900/80 px-2 py-1 text-white"
                        >
                          {Object.entries(statusLabels).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-slate-300">{statusLabels[a.status] ?? a.status}</span>
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
              <p className="py-6 text-center text-slate-500">Нет записей на эту дату</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
