import { useMemo } from "react";

import type { BookingAppointment, BookingSpecialist } from "@/lib/types";

const GRID_START_HOUR = 7;
const GRID_END_HOUR = 20;
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;
const PX_PER_HOUR = 48;
/** Высота строки заголовка специалиста (синхрон с padding у колонки времени) */
const SPEC_HEADER_PX = 40;

const HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);

const statusCardClass: Record<string, string> = {
  booked: "border-sky-400/45 bg-sky-500/15 text-sky-50 shadow-[0_0_20px_rgba(56,189,248,0.12)]",
  completed: "border-emerald-400/45 bg-emerald-500/15 text-emerald-50 shadow-[0_0_20px_rgba(52,211,153,0.12)]",
  no_show: "border-slate-500/50 bg-slate-600/25 text-slate-200",
  cancelled: "border-slate-500/50 bg-slate-700/30 text-slate-300",
};

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
};

export function BookingCalendarGrid({
  dateYmd,
  specialists,
  appointments,
  onAppointmentClick,
  onSlotClick,
}: Props) {
  const totalHours = GRID_END_HOUR - GRID_START_HOUR;
  const gridHeightPx = totalHours * PX_PER_HOUR;

  const hours = HOURS;

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

  if (specialists.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-600/50 bg-slate-900/30 px-6 py-16 text-center text-slate-400">
        Добавьте специалистов в разделе «Справочники», чтобы отобразить сетку.
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
            className="relative w-[min(100vw,240px)] shrink-0 border-r border-slate-700/40 last:border-r-0"
            style={{ minHeight: gridHeightPx + SPEC_HEADER_PX }}
          >
            <div
              className="sticky top-0 z-20 border-b border-slate-700/50 bg-slate-900/90 px-2 py-1.5 backdrop-blur-sm"
              style={{ minHeight: SPEC_HEADER_PX }}
            >
              <p className="truncate text-sm font-semibold text-white">{spec.full_name}</p>
              <p className="truncate text-[11px] text-slate-500">{spec.direction_name ?? "—"}</p>
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
                      "absolute inset-x-1 z-20 overflow-hidden rounded-lg border px-2 py-1.5 text-left text-xs transition-transform hover:z-30 hover:scale-[1.02] hover:ring-2 hover:ring-purple-500/40",
                      cls,
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
      </div>
    </div>
  );
}
