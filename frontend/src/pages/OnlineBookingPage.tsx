import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";

import { BookingCalendarGrid } from "@/components/BookingCalendarGrid";
import { MiniMonthCalendar } from "@/components/MiniMonthCalendar";
import { apiFetch } from "@/lib/api";
import type { BookingAppointment, BookingDirection, BookingSpecialist, Lead } from "@/lib/types";

type Tab = "booking" | "dicts" | "journal";

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
    });
  } catch {
    return iso;
  }
}

export function OnlineBookingPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("grid");
  const [filterDate, setFilterDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [journalDate, setJournalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [specialistFilter, setSpecialistFilter] = useState<number | "">("");
  const [queueSearch, setQueueSearch] = useState("");

  const [leadId, setLeadId] = useState<number | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [directionId, setDirectionId] = useState(0);
  const [specialistId, setSpecialistId] = useState(0);
  const [startAt, setStartAt] = useState("");
  const [responsibleManagerId, setResponsibleManagerId] = useState("");
  const [comment, setComment] = useState("");

  const [dirName, setDirName] = useState("");
  const [dirDuration, setDirDuration] = useState(30);
  const [specName, setSpecName] = useState("");
  const [specDirId, setSpecDirId] = useState(0);
  const [specPhone, setSpecPhone] = useState("");

  const queueQuery = useQuery({
    queryKey: ["booking-queue"],
    queryFn: () => apiFetch<Lead[]>("/api/booking/queue"),
  });

  const directionsQuery = useQuery({
    queryKey: ["booking-directions"],
    queryFn: () => apiFetch<BookingDirection[]>("/api/booking/directions"),
  });

  const specialistsQuery = useQuery({
    queryKey: ["booking-specialists"],
    queryFn: () => apiFetch<BookingSpecialist[]>("/api/booking/specialists"),
  });

  const gridAppointmentsQuery = useQuery({
    queryKey: ["booking-appointments-grid", filterDate],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("date", filterDate);
      return apiFetch<BookingAppointment[]>(`/api/booking/appointments?${qs.toString()}`);
    },
    enabled: tab === "grid",
  });

  const appointmentsQuery = useQuery({
    queryKey: ["booking-appointments", filterDate, specialistFilter],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (filterDate) qs.set("date", filterDate);
      if (specialistFilter !== "") qs.set("specialist_id", String(specialistFilter));
      return apiFetch<BookingAppointment[]>(`/api/booking/appointments?${qs.toString()}`);
    },
    enabled: tab === "booking",
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
      toast.success("Запись создана. Лид на канбане переведён в «В работе».");
      void queryClient.invalidateQueries({ queryKey: ["booking-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments"] });
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
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-appointments-grid"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-journal"] });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addDirectionMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/booking/directions", {
        method: "POST",
        body: JSON.stringify({ name: dirName.trim(), duration_min: dirDuration }),
      }),
    onSuccess: () => {
      toast.success("Направление добавлено");
      setDirName("");
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
        }),
      }),
    onSuccess: () => {
      toast.success("Специалист добавлен");
      setSpecName("");
      setSpecPhone("");
      void queryClient.invalidateQueries({ queryKey: ["booking-specialists"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const directionsActive = useMemo(
    () => directionsQuery.data?.filter((d) => d.is_active) ?? [],
    [directionsQuery.data],
  );

  const specialistsActive = useMemo(
    () => specialistsQuery.data?.filter((s) => s.is_active) ?? [],
    [specialistsQuery.data],
  );

  const specialistsForDirection = useMemo(() => {
    if (!directionId) return [];
    return specialistsActive.filter((s) => s.direction_id === directionId);
  }, [specialistsActive, directionId]);

  useEffect(() => {
    if (directionsActive.length && !directionId) {
      setDirectionId(directionsActive[0].id);
    }
  }, [directionsActive, directionId]);

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

  const filteredQueue = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    const list = queueQuery.data ?? [];
    if (!q) return list;
    return list.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.phone ?? "").toLowerCase().includes(q) ||
        String(l.id).includes(q),
    );
  }, [queueQuery.data, queueSearch]);

  function pickFromQueue(lead: Lead) {
    setLeadId(lead.id);
    setPatientName(lead.name);
    setPatientPhone(lead.phone ?? "");
    setResponsibleManagerId(lead.manager_id ? String(lead.manager_id) : "");
    toast.success(`Выбран лид #${lead.id} — данные подставлены в форму`);
  }

  function onCalendarAppointmentClick(a: BookingAppointment) {
    if (a.lead_id) {
      navigate(`/leads/${a.lead_id}`);
    } else {
      toast.error(
        "К этой записи не привязан лид в CRM. Откройте вкладку «Запись» и создайте запись из очереди.",
      );
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!directionId || !specialistId || !startAt) {
      toast.error("Заполните направление, специалиста и дату.");
      return;
    }
    if (!specialistsForDirection.length) {
      toast.error("Для этого направления нет специалистов — добавьте в «Справочники».");
      return;
    }
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) {
      toast.error("Неверная дата.");
      return;
    }
    const payload: Record<string, unknown> = {
      patient_name: patientName.trim(),
      patient_phone: patientPhone.trim(),
      direction_id: directionId,
      specialist_id: specialistId,
      start_at: start.toISOString(),
      comment: comment.trim() || null,
    };
    if (leadId) payload.lead_id = leadId;
    if (responsibleManagerId.trim()) payload.responsible_manager_id = Number(responsibleManagerId);
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
    <div className="relative mx-auto max-w-[1600px] space-y-8 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-white">Онлайн запись</h1>
          <p className="max-w-2xl text-base text-slate-400">
            Сетка по специалистам: клик по записи с лидом открывает карточку клиента. Очередь — этап
            «Квалифицирован». После записи лид переходит в «В работе»; при завершении приёма — в «Успешно
            реализован», при отмене / неявке — в «Потерян».
          </p>
          <Link
            to="/"
            className="inline-flex text-sm font-medium text-purple-300 underline-offset-4 hover:text-purple-200 hover:underline"
          >
            ← К канбану
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabBtn("grid", "Сетка")}
          {tabBtn("booking", "Запись")}
          {tabBtn("dicts", "Справочники")}
          {tabBtn("journal", "Журнал")}
        </div>
      </header>

      {tab === "grid" && (
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 space-y-4">
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
            </div>
            <BookingCalendarGrid
              dateYmd={filterDate}
              specialists={specialistsActive}
              appointments={gridAppointmentsQuery.data ?? []}
              onAppointmentClick={onCalendarAppointmentClick}
            />
            {gridAppointmentsQuery.isLoading && (
              <p className="text-sm text-slate-400">Загрузка записей…</p>
            )}
          </div>
          <aside className="w-full shrink-0 space-y-4 xl:w-[280px]">
            <MiniMonthCalendar value={filterDate} onChange={setFilterDate} />
            <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4 shadow-inner backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">Лист ожидания</h3>
                <span className="text-xs text-slate-500">{filteredQueue.length}</span>
              </div>
              <p className="mb-3 text-[11px] text-slate-500">
                «Квалифицирован», без активной записи. Карточка — по имени.
              </p>
              <input
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Поиск…"
                className="mb-3 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white placeholder:text-slate-500"
              />
              <div className="max-h-[min(50vh,360px)] space-y-2 overflow-y-auto pr-0.5">
                {queueQuery.isLoading && <p className="text-xs text-slate-400">Загрузка…</p>}
                {filteredQueue.map((lead) => (
                  <div
                    key={lead.id}
                    className="rounded-xl border border-slate-600/40 bg-slate-900/50 px-3 py-2 text-sm"
                  >
                    <Link
                      to={`/leads/${lead.id}`}
                      className="font-medium text-purple-200 hover:text-white hover:underline"
                    >
                      {lead.name}
                    </Link>
                    <div className="mt-1 text-xs text-slate-400">{lead.phone ?? "—"}</div>
                    <button
                      type="button"
                      onClick={() => {
                        setTab("booking");
                        pickFromQueue(lead);
                      }}
                      className="mt-2 text-[11px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
                    >
                      Подставить в форму записи →
                    </button>
                  </div>
                ))}
                {!queueQuery.isLoading && filteredQueue.length === 0 && (
                  <p className="text-xs text-slate-500">Пусто</p>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}

      {tab === "booking" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 shadow-inner backdrop-blur-sm">
            <h2 className="mb-3 text-lg font-semibold text-white">Ожидают записи</h2>
            <p className="mb-3 text-xs text-slate-500">
              Лиды на этапе «Квалифицирован» без активной записи. Клик — подставить в форму.
            </p>
            <input
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              placeholder="Поиск по имени / телефону"
              className="mb-3 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white placeholder:text-slate-500"
            />
            <div className="max-h-[min(60vh,420px)] space-y-2 overflow-y-auto pr-1">
              {queueQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
              {queueQuery.isError && (
                <p className="text-sm text-red-300">{(queueQuery.error as Error).message}</p>
              )}
              {filteredQueue.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => pickFromQueue(lead)}
                  className="w-full rounded-xl border border-slate-600/40 bg-slate-900/40 px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:border-purple-500/40 hover:bg-slate-800/60"
                >
                  <span className="font-medium text-white">{lead.name}</span>
                  <span className="mt-1 block text-slate-400">{lead.phone ?? "—"}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    Лид #{lead.id}
                    {lead.manager_id != null ? ` · менеджер ${lead.manager_id}` : ""}
                  </span>
                </button>
              ))}
              {!queueQuery.isLoading && filteredQueue.length === 0 && (
                <p className="text-sm text-slate-500">Нет лидов в очереди</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 shadow-inner backdrop-blur-sm lg:col-span-1">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <label className="text-sm text-slate-300">
                Дата
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="ml-2 rounded-xl border border-slate-600/50 bg-slate-900/50 px-2 py-1.5 text-white"
                />
              </label>
              <label className="text-sm text-slate-300">
                Специалист
                <select
                  value={specialistFilter === "" ? "" : specialistFilter}
                  onChange={(e) =>
                    setSpecialistFilter(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  className="ml-2 rounded-xl border border-slate-600/50 bg-slate-900/50 px-2 py-1.5 text-white"
                >
                  <option value="">Все</option>
                  {specialistsActive.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <h2 className="mb-3 text-lg font-semibold text-white">Записи на день</h2>
            <div className="max-h-[min(60vh,420px)] space-y-2 overflow-y-auto pr-1">
              {appointmentsQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
              {(appointmentsQuery.data ?? []).map((a) => (
                <div
                  key={a.id}
                  className="rounded-xl border border-slate-600/40 bg-slate-900/40 px-3 py-2 text-sm text-slate-200"
                >
                  <div className="font-medium text-white">
                    {formatDt(a.start_at)} — {formatDt(a.end_at)}
                  </div>
                  <div className="mt-1">
                    {a.patient_name} · {a.patient_phone}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {a.specialist_name} / {a.direction_name}
                  </div>
                  <div className="mt-1 text-xs text-purple-300">{statusLabels[a.status] ?? a.status}</div>
                </div>
              ))}
              {!appointmentsQuery.isLoading && (appointmentsQuery.data ?? []).length === 0 && (
                <p className="text-sm text-slate-500">На эту дату записей нет</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 shadow-inner backdrop-blur-sm">
            <h2 className="mb-4 text-lg font-semibold text-white">Создать запись</h2>
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
              <label className="block text-sm text-slate-300">
                Направление
                <select
                  required
                  value={directionId || ""}
                  onChange={(e) => setDirectionId(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                >
                  {directionsActive.map((d) => (
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
              </label>
              <label className="block text-sm text-slate-300">
                ID ответственного менеджера (необязательно)
                <input
                  type="number"
                  min={1}
                  value={responsibleManagerId}
                  onChange={(e) => setResponsibleManagerId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                />
              </label>
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
        </div>
      )}

      {tab === "dicts" && (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
            <h2 className="mb-4 text-lg font-semibold text-white">Направления</h2>
            <form
              className="mb-4 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!dirName.trim()) return;
                addDirectionMutation.mutate();
              }}
            >
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
                  {d.name} — {d.duration_min} мин {d.is_active ? "" : "(выкл.)"}
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
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

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
            <table className="w-full min-w-[640px] border-collapse text-left text-sm text-slate-200">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="py-2 pr-4">Время</th>
                  <th className="py-2 pr-4">Пациент</th>
                  <th className="py-2 pr-4">Специалист</th>
                  <th className="py-2 pr-4">Статус</th>
                </tr>
              </thead>
              <tbody>
                {(journalQuery.data ?? []).map((a) => (
                  <tr key={a.id} className="border-b border-slate-800/80">
                    <td className="py-2 pr-4 whitespace-nowrap">{formatDt(a.start_at)}</td>
                    <td className="py-2 pr-4">
                      {a.patient_name}
                      <span className="block text-xs text-slate-500">{a.patient_phone}</span>
                    </td>
                    <td className="py-2 pr-4 text-slate-400">{a.specialist_name}</td>
                    <td className="py-2 pr-4">
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
                    </td>
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
