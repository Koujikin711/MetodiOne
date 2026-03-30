import { useEffect, useMemo, useState } from "react";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "@/components/icons";
import type { BookingAppointment, BookingSpecialist } from "@/lib/types";

const GRID_START_HOUR = 7;
const GRID_END_HOUR = 20;
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;
const PX_PER_HOUR = 48;
/** Высота строки заголовка специалиста (синхрон: колонка времени paddingTop и шапка колонки) */
const SPEC_HEADER_PX = 42;

const HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);

const statusCardClass: Record<string, string> = {
  booked: "border-sky-400/45 bg-sky-500/15 text-sky-50 shadow-[0_0_20px_rgba(56,189,248,0.12)]",
  completed: "border-emerald-400/45 bg-emerald-500/15 text-emerald-50 shadow-[0_0_20px_rgba(52,211,153,0.12)]",
  no_show: "border-slate-500/50 bg-slate-600/25 text-slate-200",
  cancelled: "border-slate-500/50 bg-slate-700/30 text-slate-300",
};

const appointmentHoverClass =
  "transition-[transform,box-shadow,filter] duration-300 ease-out hover:z-30 hover:scale-[1.04] hover:shadow-[0_0_28px_rgba(139,92,246,0.35),0_0_48px_rgba(34,211,238,0.12)] hover:ring-2 hover:ring-purple-400/50 hover:brightness-[1.06]";

function dayWindowBounds(dateYmd: string): { start: Date; end: Date } {
  const start = new Date(`${dateYmd}T${String(GRID_START_HOUR).padStart(2, "0")}:00:00`);
  const end = new Date(`${dateYmd}T${String(GRID_END_HOUR).padStart(2, "0")}:00:00`);
  return { start, end };
}

function layoutBlock(
  dateYmd: string,
  isoStart: string,
  isoEnd: string,
): { topPct: number; heightPct: number; visible: boolean } {
  const { start: winStart, end: winEnd } = dayWindowBounds(dateYmd);
  const t0 = new Date(isoStart).getTime();
  const t1 = new Date(isoEnd).getTime();
  const ws = winStart.getTime();
  const we = winEnd.getTime();
  const dur = we - ws;
  if (dur <= 0) return { topPct: 0, heightPct: 0, visible: false };
  const top = ((t0 - ws) / dur) * 100;
  const h = ((t1 - t0) / dur) * 100;
  if (top >= 100 || top + h <= 0) return { topPct: 0, heightPct: 0, visible: false };
  const topClamped = Math.max(0, top);
  const bottomClamped = Math.min(100, top + h);
  return {
    topPct: topClamped,
    heightPct: Math.max(2, bottomClamped - topClamped),
    visible: bottomClamped > topClamped,
  };
}

function formatTimeRange(isoStart: string, isoEnd: string) {
  const a = new Date(isoStart);
  const b = new Date(isoEnd);
  const fmt = (d: Date) =>
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fmt(a)} – ${fmt(b)}`;
}

export type SlotClickPayload = {
  specialistId: number;
  directionId: number;
  hour: number;
};

type Props = {
  dateYmd: string;
  specialists: BookingSpecialist[];
  appointments: BookingAppointment[];
  onAppointmentClick: (a: BookingAppointment) => void;
  onSlotClick?: (payload: SlotClickPayload) => void;
  onAddSpecialist?: () => void;
  onEditSpecialist?: (s: BookingSpecialist) => void;
  onDeleteSpecialist?: (s: BookingSpecialist) => void;
};

export function BookingCalendarGrid({
  dateYmd,
  specialists,
  appointments,
  onAppointmentClick,
  onSlotClick,
  onAddSpecialist,
  onEditSpecialist,
  onDeleteSpecialist,
}: Props) {
  const totalHours = GRID_END_HOUR - GRID_START_HOUR;
  const gridHeightPx = totalHours * PX_PER_HOUR;
  const hours = HOURS;
  const [menuSpecId, setMenuSpecId] = useState<number | null>(null);

  useEffect(() => {
    if (menuSpecId == null) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("[data-spec-menu-root]")) return;
      setMenuSpecId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuSpecId]);

  const morningHatchPct = ((WORK_START_HOUR - GRID_START_HOUR) / totalHours) * 100;
  const eveningHatchPct = ((GRID_END_HOUR - WORK_END_HOUR) / totalHours) * 100;
  const eveningTopPct = ((WORK_END_HOUR - GRID_START_HOUR) / totalHours) * 100;

  const bySpec = useMemo(() => {
    const m = new Map<number, BookingAppointment[]>();
    for (const s of specialists) m.set(s.id, []);
    for (const a of appointments) {
      const list = m.get(a.specialist_id);
      if (list) list.push(a);
    }
    return m;
  }, [specialists, appointments]);

  const showSpecMenu = Boolean(onEditSpecialist && onDeleteSpecialist);

  if (specialists.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-600/50 bg-slate-900/30 px-6 py-16 text-center text-slate-400">
        <p>Добавьте специалистов кнопкой «+» справа от сетки или в разделе «Справочники».</p>
        {onAddSpecialist && (
          <button
            type="button"
            onClick={onAddSpecialist}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800 p-2 text-slate-300 transition-all duration-300 hover:bg-slate-700"
            aria-label="Добавить специалиста"
          >
            <Plus className="h-4 w-4" />
            <span className="pr-1 text-sm">Добавить специалиста</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-700/40 bg-slate-950/40">
      <div className="flex min-w-max">
        <div
          className="sticky left-0 z-30 flex shrink-0 flex-col border-r border-slate-700/50 bg-slate-950/95 pr-2 backdrop-blur-sm"
          style={{ width: 52, paddingTop: SPEC_HEADER_PX }}
        >
          {hours.map((hh) => (
            <div
              key={hh}
              className="flex shrink-0 items-start justify-end text-[11px] tabular-nums text-slate-500"
              style={{ height: PX_PER_HOUR }}
            >
              {String(hh).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {specialists.map((spec) => (
          <div
            key={spec.id}
            className="group/spec relative w-[min(100vw,240px)] shrink-0 border-r border-slate-700/40 last:border-r-0"
            style={{ minHeight: gridHeightPx + SPEC_HEADER_PX }}
          >
            <div
              className="sticky top-0 z-20 border-b border-slate-700/50 bg-slate-900/90 backdrop-blur-sm"
              style={{ minHeight: SPEC_HEADER_PX }}
            >
              <div className="relative flex min-h-[inherit] items-center px-2 py-1 pr-8">
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                  <p className="truncate text-sm font-semibold leading-tight text-white">{spec.full_name}</p>
                  <p className="truncate text-xs leading-tight text-slate-500">
                    {spec.direction_name ?? "—"}
                  </p>
                </div>
                {showSpecMenu && (
                  <div className="absolute right-1 top-1 z-30" data-spec-menu-root>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-slate-400 opacity-0 transition-opacity duration-300 group-hover/spec:opacity-100 hover:bg-slate-800 hover:text-white"
                      aria-label="Меню специалиста"
                      aria-expanded={menuSpecId === spec.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuSpecId((id) => (id === spec.id ? null : spec.id));
                      }}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {menuSpecId === spec.id && (
                      <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/98 py-1 shadow-2xl shadow-black/40 backdrop-blur-md">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800"
                          onClick={() => {
                            setMenuSpecId(null);
                            onEditSpecialist?.(spec);
                          }}
                        >
                          <Pencil className="h-4 w-4 shrink-0 text-slate-400" />
                          Редактировать
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 transition hover:bg-slate-800"
                          onClick={() => {
                            setMenuSpecId(null);
                            onDeleteSpecialist?.(spec);
                          }}
                        >
                          <Trash2 className="h-4 w-4 shrink-0 text-red-400/90" />
                          Удалить
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="relative" style={{ height: gridHeightPx }}>
              <div
                className="pointer-events-none absolute left-0 right-0 top-0 opacity-[0.55]"
                style={{
                  backgroundImage: `repeating-linear-gradient(
                    -45deg,
                    transparent,
                    transparent 5px,
                    rgba(148, 163, 184, 0.12) 5px,
                    rgba(148, 163, 184, 0.12) 10px
                  )`,
                  height: `${morningHatchPct}%`,
                }}
              />
              <div
                className="pointer-events-none absolute left-0 right-0 opacity-[0.55]"
                style={{
                  backgroundImage: `repeating-linear-gradient(
                    -45deg,
                    transparent,
                    transparent 5px,
                    rgba(148, 163, 184, 0.12) 5px,
                    rgba(148, 163, 184, 0.12) 10px
                  )`,
                  height: `${eveningHatchPct}%`,
                  top: `${eveningTopPct}%`,
                }}
              />

              {hours.map((hh) => (
                <div
                  key={hh}
                  className="pointer-events-none absolute inset-x-0 border-t border-slate-700/35"
                  style={{ top: ((hh - GRID_START_HOUR) / totalHours) * 100 + "%" }}
                />
              ))}

              {onSlotClick &&
                hours.map((hh) => (
                  <button
                    key={`slot-${spec.id}-${hh}`}
                    type="button"
                    onClick={() =>
                      onSlotClick({
                        specialistId: spec.id,
                        directionId: spec.direction_id,
                        hour: hh,
                      })
                    }
                    className="absolute inset-x-1 z-[5] cursor-pointer rounded-md border border-transparent transition-colors hover:border-purple-500/35 hover:bg-purple-500/10"
                    style={{
                      top: `${((hh - GRID_START_HOUR) / totalHours) * 100}%`,
                      height: `${(1 / totalHours) * 100}%`,
                    }}
                    aria-label={`Свободный слот ${String(hh).padStart(2, "0")}:00, ${spec.full_name}`}
                  />
                ))}

              {(bySpec.get(spec.id) ?? []).map((a) => {
                const { topPct, heightPct, visible } = layoutBlock(dateYmd, a.start_at, a.end_at);
                if (!visible) return null;
                const cls = statusCardClass[a.status] ?? statusCardClass.booked;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onAppointmentClick(a)}
                    className={[
                      "absolute inset-x-1 z-20 overflow-hidden rounded-lg border bg-gradient-to-br from-white/[0.04] to-transparent px-2 py-1.5 text-left text-xs",
                      cls,
                      appointmentHoverClass,
                    ].join(" ")}
                    style={{
                      top: `${topPct}%`,
                      height: `${heightPct}%`,
                      minHeight: 36,
                    }}
                    title={a.lead_id ? "Открыть карточку клиента (лид)" : "Нет лида в CRM"}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="line-clamp-2 font-semibold leading-tight">{a.patient_name}</span>
                      {a.status === "completed" && (
                        <span className="shrink-0 text-emerald-300" aria-hidden>
                          ✓
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-[10px] opacity-90">
                      {formatTimeRange(a.start_at, a.end_at)}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                      <span className="rounded bg-slate-900/50 px-1 py-0.5">CRM</span>
                      {a.lead_id ? (
                        <span className="text-purple-300">#{a.lead_id}</span>
                      ) : (
                        <span>без лида</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {onAddSpecialist && (
          <div className="sticky right-0 z-[35] flex w-[48px] shrink-0 flex-col border-l border-slate-700/50 bg-slate-950/95 backdrop-blur-sm">
            <div
              className="flex shrink-0 items-center justify-center border-b border-slate-700/50 bg-slate-900/90"
              style={{ minHeight: SPEC_HEADER_PX }}
            >
              <button
                type="button"
                onClick={onAddSpecialist}
                className="rounded-full border border-slate-700 bg-slate-800 p-2 text-slate-300 transition-all duration-300 hover:bg-slate-700"
                aria-label="Добавить специалиста"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="bg-slate-950/30" style={{ height: gridHeightPx }} aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}
