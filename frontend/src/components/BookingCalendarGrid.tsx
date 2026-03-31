import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from "@/components/icons";
import type { BookingAppointment, BookingSpecialist } from "@/lib/types";

const GRID_START_HOUR = 7;
const GRID_END_HOUR = 20;
const PX_PER_HOUR = 48;
const SPEC_HEADER_PX = 42;

const HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);

const DEFAULT_WEEKDAYS = [0, 1, 2, 3, 4];

const statusCardClass: Record<string, string> = {
  booked: "border-sky-400/45 bg-sky-500/15 text-sky-50 shadow-[0_0_20px_rgba(56,189,248,0.12)]",
  completed: "border-emerald-400/45 bg-emerald-500/15 text-emerald-50 shadow-[0_0_20px_rgba(52,211,153,0.12)]",
  no_show: "border-slate-500/50 bg-slate-600/25 text-slate-200",
  cancelled: "border-slate-500/50 bg-slate-700/30 text-slate-300",
};

const notifySentClass =
  "border-amber-300/55 bg-amber-500/18 text-amber-50 shadow-[0_0_20px_rgba(245,158,11,0.16)]";
const notifyRepliedClass =
  "border-violet-300/60 bg-violet-500/20 text-violet-50 shadow-[0_0_24px_rgba(168,85,247,0.18)]";

const appointmentHoverClass =
  "transition-[transform,box-shadow,filter] duration-300 ease-out hover:z-30 hover:scale-[1.04] hover:shadow-[0_0_28px_rgba(139,92,246,0.35),0_0_48px_rgba(34,211,238,0.12)] hover:ring-2 hover:ring-purple-400/50 hover:brightness-[1.06]";

const hatchBg = `repeating-linear-gradient(
  -45deg,
  transparent,
  transparent 5px,
  rgba(148, 163, 184, 0.12) 5px,
  rgba(148, 163, 184, 0.12) 10px
)`;

function weekdayMon0FromYmd(dateYmd: string): number {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return (dt.getDay() + 6) % 7;
}

function specWeekdays(spec: BookingSpecialist): number[] {
  const w = spec.work_weekdays;
  if (w?.length) return w;
  return DEFAULT_WEEKDAYS;
}

function specWorkBounds(spec: BookingSpecialist) {
  return {
    start: spec.work_start_hour ?? 9,
    end: spec.work_end_hour ?? 18,
  };
}

function isSlotBookable(dateYmd: string, spec: BookingSpecialist, hour: number): boolean {
  const wd = weekdayMon0FromYmd(dateYmd);
  if (!specWeekdays(spec).includes(wd)) return false;
  const { start, end } = specWorkBounds(spec);
  return hour >= start && hour < end;
}

function hatchForSpec(
  dateYmd: string,
  spec: BookingSpecialist,
): { fullDay: true } | { morningPct: number; eveningPct: number; eveningTopPct: number } {
  const wd = weekdayMon0FromYmd(dateYmd);
  if (!specWeekdays(spec).includes(wd)) return { fullDay: true };
  const { start: ws, end: we } = specWorkBounds(spec);
  const total = GRID_END_HOUR - GRID_START_HOUR;
  return {
    morningPct: ((ws - GRID_START_HOUR) / total) * 100,
    eveningPct: ((GRID_END_HOUR - we) / total) * 100,
    eveningTopPct: ((we - GRID_START_HOUR) / total) * 100,
  };
}

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

function nowLineTopPct(dateYmd: string, now: Date): number | null {
  if (now.toISOString().slice(0, 10) !== dateYmd) return null;
  const mins = now.getHours() * 60 + now.getMinutes();
  const from = GRID_START_HOUR * 60;
  const to = GRID_END_HOUR * 60;
  if (mins < from || mins > to) return null;
  return ((mins - from) / (to - from)) * 100;
}

function appointmentVisualClass(a: BookingAppointment): string {
  const anyA = a as BookingAppointment & {
    notification_sent_at?: string | null;
    notification_replied_at?: string | null;
  };
  if (anyA.notification_replied_at) return notifyRepliedClass;
  if (anyA.notification_sent_at) return notifySentClass;
  const c = (a.comment || "").toLowerCase();
  if (c.includes("ответил") || c.includes("подтвердил")) return notifyRepliedClass;
  if (c.includes("уведом") || c.includes("напомин")) return notifySentClass;
  return statusCardClass[a.status] ?? statusCardClass.booked;
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
  onReorderSpecialists?: (orderedIds: number[]) => void;
};

type SortableColProps = {
  spec: BookingSpecialist;
  dateYmd: string;
  gridHeightPx: number;
  totalHours: number;
  hours: number[];
  bySpec: Map<number, BookingAppointment[]>;
  menuSpecId: number | null;
  setMenuSpecId: Dispatch<SetStateAction<number | null>>;
  showSpecMenu: boolean;
  onEditSpecialist?: (s: BookingSpecialist) => void;
  onDeleteSpecialist?: (s: BookingSpecialist) => void;
  onAppointmentClick: (a: BookingAppointment) => void;
  onSlotClick?: (payload: SlotClickPayload) => void;
  dragEnabled: boolean;
  nowTopPct: number | null;
};

function SortableSpecialistColumn({
  spec,
  dateYmd,
  gridHeightPx,
  totalHours,
  hours,
  bySpec,
  menuSpecId,
  setMenuSpecId,
  showSpecMenu,
  onEditSpecialist,
  onDeleteSpecialist,
  onAppointmentClick,
  onSlotClick,
  dragEnabled,
  nowTopPct,
}: SortableColProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: spec.id,
    disabled: !dragEnabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 40 : undefined,
  };

  const hatch = hatchForSpec(dateYmd, spec);

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, minHeight: gridHeightPx + SPEC_HEADER_PX }}
      className="group/spec relative w-[min(100vw,240px)] shrink-0 border-r border-slate-700/40 last:border-r-0"
    >
      <div
        className="sticky top-0 z-20 border-b border-slate-700/50 bg-slate-900/90 backdrop-blur-sm"
        style={{ minHeight: SPEC_HEADER_PX }}
      >
        <div className="relative flex min-h-[inherit] items-center gap-0.5 px-1 py-1 pr-8">
          {dragEnabled && (
            <button
              type="button"
              className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              aria-label="Перетащить колонку"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
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

      <div
        className={`relative ${isDragging ? "opacity-90 ring-2 ring-purple-500/40" : ""}`}
        style={{ height: gridHeightPx }}
      >
        {"fullDay" in hatch && hatch.fullDay ? (
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.55]"
            style={{ backgroundImage: hatchBg }}
          />
        ) : (
          "morningPct" in hatch && (
            <>
              <div
                className="pointer-events-none absolute left-0 right-0 top-0 opacity-[0.55]"
                style={{
                  backgroundImage: hatchBg,
                  height: `${hatch.morningPct}%`,
                }}
              />
              <div
                className="pointer-events-none absolute left-0 right-0 opacity-[0.55]"
                style={{
                  backgroundImage: hatchBg,
                  height: `${hatch.eveningPct}%`,
                  top: `${hatch.eveningTopPct}%`,
                }}
              />
            </>
          )
        )}

        {hours.map((hh) => (
          <div
            key={hh}
            className="pointer-events-none absolute inset-x-0 border-t border-slate-700/35"
            style={{ top: ((hh - GRID_START_HOUR) / totalHours) * 100 + "%" }}
          />
        ))}

        {nowTopPct != null && (
          <div
            className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-400/85 shadow-[0_0_10px_rgba(248,113,113,0.45)]"
            style={{ top: `${nowTopPct}%` }}
            aria-hidden
          />
        )}

        {onSlotClick &&
          hours.map((hh) => {
            const ok = isSlotBookable(dateYmd, spec, hh);
            if (!ok) return null;
            return (
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
            );
          })}

        {(bySpec.get(spec.id) ?? []).map((a) => {
          const { topPct, heightPct, visible } = layoutBlock(dateYmd, a.start_at, a.end_at);
          if (!visible) return null;
          const cls = appointmentVisualClass(a);
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
                <span className="line-clamp-2 break-words pr-1 text-[13px] font-semibold leading-[1.25]">
                  {a.patient_name}
                </span>
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
  );
}

export function BookingCalendarGrid({
  dateYmd,
  specialists,
  appointments,
  onAppointmentClick,
  onSlotClick,
  onAddSpecialist,
  onEditSpecialist,
  onDeleteSpecialist,
  onReorderSpecialists,
}: Props) {
  const totalHours = GRID_END_HOUR - GRID_START_HOUR;
  const gridHeightPx = totalHours * PX_PER_HOUR;
  const hours = HOURS;
  const [menuSpecId, setMenuSpecId] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

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
  const dragEnabled = Boolean(onReorderSpecialists && specialists.length > 0);

  function handleDragEnd(e: DragEndEvent) {
    if (!onReorderSpecialists) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = specialists.map((s) => s.id);
    const oldIndex = ids.indexOf(Number(active.id));
    const newIndex = ids.indexOf(Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(specialists, oldIndex, newIndex);
    onReorderSpecialists(next.map((s) => s.id));
  }

  const colPropsBase = {
    dateYmd,
    gridHeightPx,
    totalHours,
    hours,
    bySpec,
    menuSpecId,
    setMenuSpecId,
    showSpecMenu,
    onEditSpecialist,
    onDeleteSpecialist,
    onAppointmentClick,
    onSlotClick,
    dragEnabled,
    nowTopPct: nowLineTopPct(dateYmd, new Date(nowTick)),
  };

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

  const columns = specialists.map((spec) => (
    <SortableSpecialistColumn key={spec.id} spec={spec} {...colPropsBase} />
  ));

  const nowTopPct = nowLineTopPct(dateYmd, new Date(nowTick));
  const nowTopPx = nowTopPct != null ? SPEC_HEADER_PX + (nowTopPct / 100) * gridHeightPx : null;
  const nowLabel =
    nowTopPct != null
      ? new Date(nowTick).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
      : "";

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
          {nowTopPct != null && (
            <>
              <div
                className="pointer-events-none absolute right-0 z-40 h-4 w-10 -translate-y-1/2 rounded-r-md bg-red-500/90 px-1 text-right text-[10px] font-semibold tabular-nums text-white shadow-md"
                style={{ top: `${nowTopPx}px` }}
              >
                {nowLabel}
              </div>
              <div
                className="pointer-events-none absolute inset-x-0 z-30 border-t-2 border-red-400/85 shadow-[0_0_8px_rgba(248,113,113,0.45)]"
                style={{ top: `${nowTopPx}px` }}
              />
            </>
          )}
        </div>

        {dragEnabled ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={specialists.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
              {columns}
            </SortableContext>
          </DndContext>
        ) : (
          columns
        )}

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
