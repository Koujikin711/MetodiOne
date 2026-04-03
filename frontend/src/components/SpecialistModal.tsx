import { useEffect, useState } from "react";

import type { BookingDirection, BookingSpecialist } from "@/lib/types";

const GRID_START = 7;
const GRID_END = 20;
const DEFAULT_WEEKDAYS = [0, 1, 2, 3, 4];

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const HOUR_OPTIONS_START = Array.from({ length: GRID_END - GRID_START - 1 }, (_, i) => GRID_START + i);
const HOUR_OPTIONS_END = Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + 1 + i);

type Props = {
  open: boolean;
  mode: "add" | "edit";
  initial: BookingSpecialist | null;
  directions: BookingDirection[];
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (values: {
    full_name: string;
    direction_id: number;
    phone: string;
    specialization: string;
    slot_duration_min: number;
    work_start_hour: number;
    work_end_hour: number;
    work_weekdays: number[];
  }) => void;
};

function normWeekdays(raw: number[] | undefined): number[] {
  if (!raw?.length) return [...DEFAULT_WEEKDAYS];
  return [...new Set(raw.filter((x) => x >= 0 && x <= 6))].sort((a, b) => a - b);
}

export function SpecialistModal({
  open,
  mode,
  initial,
  directions,
  isSubmitting,
  onClose,
  onSubmit,
}: Props) {
  const [fullName, setFullName] = useState("");
  const [directionId, setDirectionId] = useState(0);
  const [phone, setPhone] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [slotDurationMin, setSlotDurationMin] = useState(30);
  const [workStart, setWorkStart] = useState(9);
  const [workEnd, setWorkEnd] = useState(18);
  const [workWeekdays, setWorkWeekdays] = useState<number[]>([...DEFAULT_WEEKDAYS]);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initial) {
      setFullName(initial.full_name);
      setDirectionId(initial.direction_id);
      setPhone(initial.phone ?? "");
      setSpecialization(initial.specialization ?? "");
      setSlotDurationMin(initial.slot_duration_min ?? 30);
      setWorkStart(initial.work_start_hour ?? 9);
      setWorkEnd(initial.work_end_hour ?? 18);
      setWorkWeekdays(normWeekdays(initial.work_weekdays));
    } else {
      setFullName("");
      setPhone("");
      setSpecialization("");
      setSlotDurationMin(30);
      setWorkStart(9);
      setWorkEnd(18);
      setWorkWeekdays([...DEFAULT_WEEKDAYS]);
      const first = directions[0];
      setDirectionId(first?.id ?? 0);
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
    if (!fullName.trim() || !directionId) return;
    if (workStart >= workEnd) return;
    if (!workWeekdays.length) return;
    onSubmit({
      full_name: fullName.trim(),
      direction_id: directionId,
      phone: phone.trim(),
      specialization: specialization.trim(),
      slot_duration_min: slotDurationMin,
      work_start_hour: workStart,
      work_end_hour: workEnd,
      work_weekdays: [...workWeekdays],
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
        className="max-h-[min(92vh,720px)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        role="dialog"
        aria-labelledby="specialist-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="specialist-modal-title" className="text-lg font-semibold text-white">
          {mode === "add" ? "Добавить специалиста" : "Редактировать специалиста"}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Карточка в сетке записи. Учётная запись MetodiOne не создаётся. График — в часовом поясе онлайн-записи
          (по умолчанию Asia/Dushanbe, как на сервере; можно задать VITE_BOOKING_TIMEZONE на фронте).
        </p>

        {directions.length === 0 && (
          <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/90">
            Сначала добавьте хотя бы одно направление во вкладке «Справочники», затем создайте специалиста.
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <label className="block text-sm text-slate-300">
            Имя
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-950/50 px-3 py-2 text-white placeholder:text-slate-500"
              placeholder="ФИО"
            />
          </label>

          <label className="block text-sm text-slate-300">
            Услуга по умолчанию
            <select
              required
              disabled={directions.length === 0}
              value={directionId || ""}
              onChange={(e) => setDirectionId(Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-950/50 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {directions.length === 0 ? (
                <option value="">Нет направлений</option>
              ) : (
                directions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.duration_min} мин)
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="block text-sm text-slate-300">
            Роль
            <input
              readOnly
              value="Специалист"
              className="mt-1 w-full cursor-not-allowed rounded-xl border border-slate-600/40 bg-slate-950/30 px-3 py-2 text-slate-400"
            />
          </label>

          <div className="rounded-xl border border-slate-600/40 bg-slate-950/30 p-3">
            <p className="text-sm font-medium text-slate-200">График приёма (сетка 07:00–20:00)</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Вне интервала и в выходные слоты недоступны для записи.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-400 col-span-2">
                Длительность записи
                <select
                  value={slotDurationMin}
                  onChange={(e) => setSlotDurationMin(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-600/50 bg-slate-900 px-2 py-1.5 text-sm text-white"
                >
                  <option value={30}>30 минут</option>
                  <option value={60}>1 час</option>
                  <option value={90}>1.5 часа</option>
                  <option value={120}>2 часа</option>
                  <option value={180}>3 часа</option>
                </select>
              </label>
              <label className="text-xs text-slate-400">
                Начало
                <select
                  value={workStart}
                  onChange={(e) => setWorkStart(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-600/50 bg-slate-900 px-2 py-1.5 text-sm text-white"
                >
                  {HOUR_OPTIONS_START.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-400">
                Конец (не включая)
                <select
                  value={workEnd}
                  onChange={(e) => setWorkEnd(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-600/50 bg-slate-900 px-2 py-1.5 text-sm text-white"
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
            <p className="mt-3 text-xs text-slate-400">Рабочие дни</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleWeekday(d)}
                  className={[
                    "rounded-lg border px-2.5 py-1 text-xs font-medium transition",
                    workWeekdays.includes(d)
                      ? "border-purple-500/50 bg-purple-500/20 text-purple-100"
                      : "border-slate-600/60 bg-slate-900/80 text-slate-500 line-through opacity-70",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-sm text-slate-300">
            Специализация
            <input
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-950/50 px-3 py-2 text-white placeholder:text-slate-500"
              placeholder="Необязательно"
            />
          </label>

          <label className="block text-sm text-slate-300">
            Телефон
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-950/50 px-3 py-2 text-white placeholder:text-slate-500"
              placeholder="Необязательно"
            />
          </label>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-600 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSubmitting || directions.length === 0 || workStart >= workEnd || !workWeekdays.length}
              className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95 disabled:opacity-50"
            >
              {isSubmitting ? "Сохранение…" : mode === "add" ? "Добавить" : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
