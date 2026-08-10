import { useEffect, useState } from "react";

import type { BookingSpecialist } from "@/lib/types";

const GRID_START = 7;
const GRID_END = 20;
const DEFAULT_WEEKDAYS = [0, 1, 2, 3, 4];

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const HOUR_OPTIONS_START = Array.from({ length: GRID_END - GRID_START - 1 }, (_, i) => GRID_START + i);
const HOUR_OPTIONS_END = Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + 1 + i);

export type SpecialistFormValues = {
  full_name: string;
  phone: string;
  specialization: string;
  direction_id: number | null;
  slot_duration_min: number;
  work_start_hour: number;
  work_end_hour: number;
  work_weekdays: number[];
  course_streams_enabled: boolean;
  course_stream_max_days: number;
  course_stream_min_day_for_next: number;
  course_stream_gap_days: number;
};

type DirectionOption = {
  id: number;
  name: string;
  is_active: boolean;
};

type Props = {
  open: boolean;
  mode: "add" | "edit";
  initial: BookingSpecialist | null;
  directions?: DirectionOption[];
  isSubmitting: boolean;
  isDeleting?: boolean;
  onClose: () => void;
  onSubmit: (values: SpecialistFormValues) => void;
  onDelete?: () => void;
};

function normWeekdays(raw: number[] | undefined): number[] {
  if (!raw?.length) return [...DEFAULT_WEEKDAYS];
  return [...new Set(raw.filter((x) => x >= 0 && x <= 6))].sort((a, b) => a - b);
}

export function SpecialistModal({
  open,
  mode,
  initial,
  directions = [],
  isSubmitting,
  isDeleting = false,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [directionId, setDirectionId] = useState<number | "">("");
  const [slotDurationMin, setSlotDurationMin] = useState(30);
  const [workStart, setWorkStart] = useState(9);
  const [workEnd, setWorkEnd] = useState(18);
  const [workWeekdays, setWorkWeekdays] = useState<number[]>([...DEFAULT_WEEKDAYS]);
  const [courseStreamsEnabled, setCourseStreamsEnabled] = useState(false);
  const [courseStreamMaxDays, setCourseStreamMaxDays] = useState(15);
  const [courseStreamMinDay, setCourseStreamMinDay] = useState(10);
  const [courseStreamGapDays, setCourseStreamGapDays] = useState(10);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initial) {
      setFullName(initial.full_name);
      setPhone(initial.phone ?? "");
      setSpecialization(initial.specialization ?? "");
      const dirStillActive = directions.some((d) => d.id === initial.direction_id && d.is_active);
      setDirectionId(dirStillActive ? initial.direction_id : "");
      setSlotDurationMin(initial.slot_duration_min ?? 30);
      setWorkStart(initial.work_start_hour ?? 9);
      setWorkEnd(initial.work_end_hour ?? 18);
      setWorkWeekdays(normWeekdays(initial.work_weekdays));
      setCourseStreamsEnabled(Boolean(initial.course_streams_enabled));
      setCourseStreamMaxDays(initial.course_stream_max_days ?? 15);
      setCourseStreamMinDay(initial.course_stream_min_day_for_next ?? 10);
      setCourseStreamGapDays(initial.course_stream_gap_days ?? 10);
    } else {
      setFullName("");
      setPhone("");
      setSpecialization("");
      const firstActive = directions.find((d) => d.is_active);
      setDirectionId(firstActive?.id ?? "");
      setSlotDurationMin(30);
      setWorkStart(9);
      setWorkEnd(18);
      setWorkWeekdays([...DEFAULT_WEEKDAYS]);
      setCourseStreamsEnabled(false);
      setCourseStreamMaxDays(15);
      setCourseStreamMinDay(10);
      setCourseStreamGapDays(10);
    }
  }, [open, mode, initial, directions]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function toggleWeekday(d: number) {
    setWorkWeekdays((prev) => {
      if (prev.includes(d)) {
        const next = prev.filter((x) => x !== d);
        return next.length ? next : prev;
      }
      return [...prev, d].sort((a, b) => a - b);
    });
  }

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    if (workStart >= workEnd) return;
    if (!workWeekdays.length) return;
    if (typeof directionId !== "number") return;
    onSubmit({
      full_name: fullName.trim(),
      phone: phone.trim(),
      specialization: specialization.trim(),
      direction_id: directionId,
      slot_duration_min: slotDurationMin,
      work_start_hour: workStart,
      work_end_hour: workEnd,
      work_weekdays: [...workWeekdays],
      course_streams_enabled: courseStreamsEnabled,
      course_stream_max_days: courseStreamMaxDays,
      course_stream_min_day_for_next: courseStreamMinDay,
      course_stream_gap_days: courseStreamGapDays,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="max-h-[min(92vh,820px)] w-full max-w-lg overflow-y-auto rounded-2xl crm-modal-panel border p-6 shadow-2xl"
        role="dialog"
        aria-labelledby="specialist-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="specialist-modal-title" className="lux-subheading">
          Редактировать специалиста
        </h2>
        <p className="mt-1 text-xs mo-muted">
          График в часовом поясе онлайн-записи. Новых специалистов добавляют только через
          «Сотрудники» (роль эксперт).
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <label className="block text-sm mo-muted">
            Имя
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mo-input mt-1 w-full"
              placeholder="ФИО"
            />
          </label>

          <label className="block text-sm mo-muted">
            Роль
            <input
              readOnly
              value="Специалист"
              className="mt-1 w-full cursor-not-allowed rounded-xl border border-[var(--mo-border-strong)]/40 bg-[var(--mo-surface)] px-3 py-2 lux-caption"
            />
          </label>

          <div className="rounded-xl border border-[var(--mo-border-strong)]/40 bg-[var(--mo-surface)] p-3">
            <p className="text-sm font-medium text-[var(--mo-text)]">График приёма (сетка 07:00–20:00)</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs lux-caption col-span-2">
                Длительность записи
                <select
                  value={slotDurationMin}
                  onChange={(e) => setSlotDurationMin(Number(e.target.value))}
                  className="mo-input mt-1 w-full text-sm"
                >
                  <option value={30}>30 минут</option>
                  <option value={60}>1 час</option>
                  <option value={90}>1.5 часа</option>
                  <option value={120}>2 часа</option>
                  <option value={180}>3 часа</option>
                </select>
              </label>
              <label className="text-xs lux-caption">
                Начало
                <select
                  value={workStart}
                  onChange={(e) => setWorkStart(Number(e.target.value))}
                  className="mo-input mt-1 w-full text-sm"
                >
                  {HOUR_OPTIONS_START.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs lux-caption">
                Конец (не включая)
                <select
                  value={workEnd}
                  onChange={(e) => setWorkEnd(Number(e.target.value))}
                  className="mo-input mt-1 w-full text-sm"
                >
                  {HOUR_OPTIONS_END.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {workStart >= workEnd && (
              <p className="mt-2 text-xs text-red-400">Конец должен быть позже начала.</p>
            )}
            <p className="mt-3 text-xs lux-caption">Рабочие дни</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleWeekday(d)}
                  className={[
                    "rounded-lg border px-2.5 py-1 text-xs font-medium transition",
                    workWeekdays.includes(d)
                      ? "border-purple-500/50 bg-[#ece6f0] text-purple-100"
                      : "border-[var(--mo-border-strong)]/60 bg-white/80 mo-muted line-through opacity-70",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-[var(--mo-text)]">
              <input
                type="checkbox"
                checked={courseStreamsEnabled}
                onChange={(e) => setCourseStreamsEnabled(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">Курсы / потоки</span>
                <span className="mt-0.5 block text-xs mo-muted">
                  Сеанс как 1:1, 1:10, 2:1 (поток : день в потоке). Для 15‑дневных курсов.
                </span>
              </span>
            </label>
            {courseStreamsEnabled && (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <label className="text-xs mo-muted">
                  Длина потока (дн.)
                  <input
                    type="number"
                    min={5}
                    max={90}
                    value={courseStreamMaxDays}
                    onChange={(e) => setCourseStreamMaxDays(Number(e.target.value))}
                    className="mo-input mt-1 w-full tabular-nums"
                  />
                </label>
                <label className="text-xs mo-muted">
                  Мин. день для 2‑го потока
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={courseStreamMinDay}
                    onChange={(e) => setCourseStreamMinDay(Number(e.target.value))}
                    className="mo-input mt-1 w-full tabular-nums"
                  />
                </label>
                <label className="text-xs mo-muted">
                  Перерыв (дн.)
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={courseStreamGapDays}
                    onChange={(e) => setCourseStreamGapDays(Number(e.target.value))}
                    className="mo-input mt-1 w-full tabular-nums"
                  />
                </label>
              </div>
            )}
            {courseStreamsEnabled && (
              <p className="mt-2 text-[10px] leading-snug mo-muted">
                Новый поток: после {courseStreamMaxDays} дн. с начала потока или если достигнут день {courseStreamMinDay}+
                и нет визитов {courseStreamGapDays} дн. подряд.
              </p>
            )}
          </div>

          <label className="block text-sm mo-muted">
            Направление записи
            <select
              required
              value={directionId === "" ? "" : String(directionId)}
              onChange={(e) => setDirectionId(e.target.value ? Number(e.target.value) : "")}
              className="mo-input mt-1 w-full"
            >
              <option value="">— выберите активное направление —</option>
              {directions
                .filter((d) => d.is_active)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
            {initial?.direction_id != null &&
              directions.some((d) => d.id === initial.direction_id && !d.is_active) && (
                <span className="mt-1 block text-xs text-amber-600">
                  Сейчас назначено архивное направление — выберите активное и сохраните.
                </span>
              )}
          </label>

          <label className="block text-sm mo-muted">
            Специализация
            <input
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              className="mo-input mt-1 w-full"
              placeholder="Необязательно"
            />
          </label>

          <label className="block text-sm mo-muted">
            Телефон
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mo-input mt-1 w-full"
              placeholder="Необязательно"
            />
          </label>

          <div className="flex flex-col gap-2 pt-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting || isDeleting}
                className="flex-1 rounded-xl border border-[var(--mo-border-strong)] py-2.5 text-sm font-medium mo-muted transition hover:bg-[var(--mo-accent-soft)]"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isDeleting || workStart >= workEnd || !workWeekdays.length}
                className="flex-1 btn-primary"
              >
                {isSubmitting ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
            {mode === "edit" && onDelete ? (
              <button
                type="button"
                disabled={isSubmitting || isDeleting}
                onClick={onDelete}
                className="w-full rounded-xl border border-red-500/40 py-2.5 text-sm font-medium text-red-400 transition hover:bg-red-500/10"
              >
                {isDeleting ? "Удаление…" : "Удалить специалиста"}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
