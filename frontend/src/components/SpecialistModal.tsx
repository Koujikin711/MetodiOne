import { useEffect, useState } from "react";

import type { BookingDirection, BookingSpecialist } from "@/lib/types";

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
  }) => void;
};

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

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initial) {
      setFullName(initial.full_name);
      setDirectionId(initial.direction_id);
      setPhone(initial.phone ?? "");
      setSpecialization(initial.specialization ?? "");
    } else {
      setFullName("");
      setPhone("");
      setSpecialization("");
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

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !directionId) return;
    onSubmit({
      full_name: fullName.trim(),
      direction_id: directionId,
      phone: phone.trim(),
      specialization: specialization.trim(),
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
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        role="dialog"
        aria-labelledby="specialist-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="specialist-modal-title" className="text-lg font-semibold text-white">
          {mode === "add" ? "Добавить специалиста" : "Редактировать специалиста"}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Карточка в сетке записи. Учётная запись CRM не создаётся.
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
              disabled={isSubmitting || directions.length === 0}
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
