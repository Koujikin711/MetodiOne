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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { GripVertical, Pencil } from "@/components/icons";
import { BookingAppointmentCardBody } from "@/components/BookingAppointmentCardBody";
import {
  BOOKING_TIME_ZONE,
  formatTimeInBookingTz,
  formatWeekdayHeader,
  utcMsToHourMinuteInBookingTz,
  weekWorkDayYmds,
  weekdayMon0InBookingTz,
  ymdInBookingTz,
} from "@/lib/bookingTz";
import { MAX_BOOKINGS_PER_SPECIALIST_HOUR } from "@/lib/bookingCapacity";
import type { BookingAppointment, BookingSpecialist } from "@/lib/types";

const DEFAULT_WORK_WEEKDAYS = [0, 1, 2, 3, 4];

const COLLAPSED_ROW_PX = 44;
const EXPANDED_ROW_MIN_PX = 168;

const DAY_COL_CLASS =
  "booking-week-grid__day-col flex flex-col gap-1 p-1.5 sm:p-2";
const DAY_COL_COLLAPSED_CLASS =
  "booking-week-grid__day-col flex items-center justify-center";

export type WeekSlotClickPayload = {
  specialistId: number;
  directionId: number;
  dateYmd: string;
  minuteOfDay: number;
};

export type WeekMovePayload = {
  appointmentId: number;
  specialistId: number;
  dateYmd: string;
  minuteOfDay: number;
};

type Props = {
  anchorDateYmd: string;
  specialists: BookingSpecialist[];
  appointments: BookingAppointment[];
  onAppointmentClick: (a: BookingAppointment) => void;
  onSlotClick?: (payload: WeekSlotClickPayload) => void;
  onMoveAppointment?: (payload: WeekMovePayload) => void;
  onEditSpecialist?: (s: BookingSpecialist) => void;
  onAddSpecialist?: () => void;
  onReorderSpecialists?: (orderedIds: number[]) => void;
  showSessionInsteadOfTime?: boolean;
  canEditNotes?: boolean;
  onAppointmentNoteClick?: (a: BookingAppointment) => void;
  canToggleComplete?: boolean;
  onAppointmentCompleteToggle?: (a: BookingAppointment, completed: boolean) => void;
  headerAddon?: ReactNode;
};

function sortSpecs(list: BookingSpecialist[]): BookingSpecialist[] {
  return [...list].sort((a, b) => {
    const ao = a.sort_order ?? 0;
    const bo = b.sort_order ?? 0;
    if (ao !== bo) return ao - bo;
    return a.full_name.localeCompare(b.full_name, "ru");
  });
}

function countsKey(specId: number, dateYmd: string): string {
  return `${specId}:${dateYmd}`;
}

function appointmentVisualClass(a: BookingAppointment): string {
  if (a.status === "cancelled") return "booking-appt booking-appt--cancelled";
  if (a.status === "no_show") return "booking-appt booking-appt--no_show";
  if (a.status === "completed") return "booking-appt booking-appt--completed";
  if (a.whatsapp_confirmation_sent) return "booking-appt booking-appt--notify";
  const c = (a.comment || "").toLowerCase();
  if (c.includes("ответил") || c.includes("подтвердил")) return "booking-appt booking-appt--replied";
  if (c.includes("уведом") || c.includes("напомин")) return "booking-appt booking-appt--notify";
  return "booking-appt booking-appt--booked";
}

function suggestMinuteForDay(spec: BookingSpecialist, dayAppts: BookingAppointment[]): number {
  const step = Math.max(15, spec.slot_duration_min ?? 30);
  const startMin = (spec.work_start_hour ?? 9) * 60;
  const endMin = (spec.work_end_hour ?? 18) * 60;
  const active = dayAppts.filter((a) => a.status !== "cancelled");
  if (active.length === 0) return startMin;

  let latestEnd = startMin;
  for (const a of active) {
    const { h, min } = utcMsToHourMinuteInBookingTz(new Date(a.end_at).getTime());
    const endMinute = h * 60 + min;
    if (endMinute > latestEnd) latestEnd = endMinute;
  }

  let next = latestEnd;
  if (next % step !== 0) next = Math.ceil(next / step) * step;
  if (next >= endMin) return startMin;
  return next;
}

function specWorkWeekdays(spec: BookingSpecialist): number[] {
  const w = spec.work_weekdays;
  if (w?.length) return w;
  return DEFAULT_WORK_WEEKDAYS;
}

function isSpecWorkingDay(spec: BookingSpecialist, dateYmd: string): boolean {
  return specWorkWeekdays(spec).includes(weekdayMon0InBookingTz(dateYmd));
}

function dayTimeSlots(spec: BookingSpecialist, dateYmd: string): number[] {
  if (!isSpecWorkingDay(spec, dateYmd)) return [];
  const step = Math.max(15, spec.slot_duration_min ?? 30);
  const startMin = (spec.work_start_hour ?? 9) * 60;
  const endMin = (spec.work_end_hour ?? 18) * 60;
  const slots: number[] = [];
  for (let m = startMin; m < endMin; m += step) slots.push(m);
  return slots;
}

function formatMinuteLabel(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function appointmentStartMinute(a: BookingAppointment): number {
  const { h, min } = utcMsToHourMinuteInBookingTz(new Date(a.start_at).getTime());
  return h * 60 + min;
}

function hourHasVisibleAppointment(dayAppts: BookingAppointment[], hour: number): boolean {
  for (const appointment of dayAppts) {
    const { h } = utcMsToHourMinuteInBookingTz(new Date(appointment.start_at).getTime());
    if (h === hour) return true;
  }
  return false;
}

type FlatDayRow =
  | { kind: "slot"; minute: number; closed?: boolean }
  | { kind: "appt"; appointment: BookingAppointment };

type DayRow =
  | { kind: "slot"; minute: number; closed?: boolean }
  | { kind: "appts"; appointments: BookingAppointment[] };

/** Одинаковая минута старта — по две карточки в ряд. Другая минута — строка ниже. */
function pairSameStart(flat: FlatDayRow[]): DayRow[] {
  const out: DayRow[] = [];
  let i = 0;
  while (i < flat.length) {
    const row = flat[i];
    if (row.kind === "slot") {
      out.push(row);
      i += 1;
      continue;
    }
    const minute = appointmentStartMinute(row.appointment);
    const group: BookingAppointment[] = [];
    while (i < flat.length) {
      const cur = flat[i];
      if (cur.kind !== "appt" || appointmentStartMinute(cur.appointment) !== minute) break;
      group.push(cur.appointment);
      i += 1;
    }
    for (let j = 0; j < group.length; j += 2) {
      out.push({ kind: "appts", appointments: group.slice(j, j + 2) });
    }
  }
  return out;
}

function buildDayRows(
  spec: BookingSpecialist,
  dateYmd: string,
  dayAppts: BookingAppointment[],
): DayRow[] | null {
  const slots = dayTimeSlots(spec, dateYmd);
  if (slots.length === 0) return null;
  const step = Math.max(15, spec.slot_duration_min ?? 30);
  const usedApptIds = new Set<number>();
  const rows: FlatDayRow[] = [];
  for (const minute of slots) {
    const matches = dayAppts.filter((a) => {
      if (usedApptIds.has(a.id)) return false;
      const startMin = appointmentStartMinute(a);
      return startMin >= minute && startMin < minute + step;
    });
    for (const match of matches) {
      usedApptIds.add(match.id);
      rows.push({ kind: "appt", appointment: match });
    }
    // Пустой :30 не рисуем. Час, где уже есть карточка (в том числе «Пришёл»
    // и «Неявка»), не помечаем пунктиром: иначе занятая минута выглядит свободной.
    if (minute % 60 !== 0) continue;
    if (!hourHasVisibleAppointment(dayAppts, Math.floor(minute / 60))) {
      rows.push({ kind: "slot", minute });
    }
  }
  for (const a of dayAppts) {
    if (!usedApptIds.has(a.id)) rows.push({ kind: "appt", appointment: a });
  }
  rows.sort((x, y) => {
    const mx = x.kind === "slot" ? x.minute : appointmentStartMinute(x.appointment);
    const my = y.kind === "slot" ? y.minute : appointmentStartMinute(y.appointment);
    return mx - my || (x.kind === "appt" ? 0 : 1) - (y.kind === "appt" ? 0 : 1);
  });
  return pairSameStart(rows);
}

function emitSlotClick(
  onSlotClick: ((payload: WeekSlotClickPayload) => void) | undefined,
  spec: BookingSpecialist,
  dateYmd: string,
  dayAppts: BookingAppointment[],
) {
  onSlotClick?.({
    specialistId: spec.id,
    directionId: spec.direction_id,
    dateYmd,
    minuteOfDay: suggestMinuteForDay(spec, dayAppts),
  });
}

type SortableRowProps = {
  spec: BookingSpecialist;
  weekDays: string[];
  counts: Map<string, number>;
  bySpecDay: Map<string, BookingAppointment[]>;
  expanded: boolean;
  onToggleExpand: (specId: number) => void;
  showSpecEdit: boolean;
  dragEnabled: boolean;
  onEditSpecialist?: (s: BookingSpecialist) => void;
  onAppointmentClick: (a: BookingAppointment) => void;
  onSlotClick?: (payload: WeekSlotClickPayload) => void;
  onMoveAppointment?: (payload: WeekMovePayload) => void;
  showSessionInsteadOfTime?: boolean;
  canEditNotes?: boolean;
  onAppointmentNoteClick?: (a: BookingAppointment) => void;
  canToggleComplete?: boolean;
  onAppointmentCompleteToggle?: (a: BookingAppointment, completed: boolean) => void;
  todayYmd: string;
  wideColumns: boolean;
};

function SortableSpecialistRow({
  spec,
  weekDays,
  counts,
  bySpecDay,
  expanded,
  onToggleExpand,
  showSpecEdit,
  dragEnabled,
  onEditSpecialist,
  onAppointmentClick,
  onSlotClick,
  onMoveAppointment,
  showSessionInsteadOfTime,
  canEditNotes,
  onAppointmentNoteClick,
  canToggleComplete,
  onAppointmentCompleteToggle,
  todayYmd,
  wideColumns,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: spec.id,
    disabled: !dragEnabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "flex",
        isDragging ? "opacity-90 ring-2 ring-indigo-500/35" : "",
      ].join(" ")}
    >
      <div
        className="booking-week-grid__spec-col z-20 backdrop-blur-sm"
        style={{ minHeight: expanded ? EXPANDED_ROW_MIN_PX : COLLAPSED_ROW_PX }}
      >
        <div
          className="relative flex h-full min-h-[inherit] cursor-pointer items-stretch gap-1 px-2 py-1.5"
          role="button"
          tabIndex={0}
          onClick={() => onToggleExpand(spec.id)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            onToggleExpand(spec.id);
          }}
          title={expanded ? "Свернуть — только количество записей" : "Развернуть — список записей по дням"}
        >
          {dragEnabled && (
            <button
              type="button"
              className="shrink-0 self-center rounded-md p-0.5 mo-muted hover:bg-[var(--mo-accent-soft)]"
              aria-label="Изменить порядок"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          <div className="flex min-w-0 flex-1 flex-col justify-center text-left">
            <p className="truncate text-sm font-semibold leading-tight text-[var(--mo-text)]">{spec.full_name}</p>
            <p className="truncate text-[11px] leading-tight mo-muted">
              {(spec.specialization ?? "").trim() || spec.direction_name || "—"}
            </p>
            <p className="mt-0.5 text-[10px] mo-muted">{expanded ? "▲ свернуть" : "▼ развернуть"}</p>
          </div>
          {showSpecEdit && (
            <button
              type="button"
              className="absolute right-1 top-1 rounded-lg p-1 mo-muted hover:bg-[var(--mo-accent-soft)]"
              aria-label="Редактировать специалиста"
              title="Редактировать"
              onClick={(e) => {
                e.stopPropagation();
                onEditSpecialist?.(spec);
              }}
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1">
        {weekDays.map((dateYmd) => {
          const key = countsKey(spec.id, dateYmd);
          const count = counts.get(key) ?? 0;
          const isToday = dateYmd === todayYmd;
          const dayAppts = (bySpecDay.get(key) ?? []).slice().sort((a, b) => a.start_at.localeCompare(b.start_at));
          const canAdd = Boolean(onSlotClick);
          const dayLabel = formatWeekdayHeader(dateYmd);

          if (!expanded) {
            return (
              <button
                key={key}
                type="button"
                disabled={!canAdd}
                onClick={() => emitSlotClick(onSlotClick, spec, dateYmd, dayAppts)}
                className={[
                  DAY_COL_COLLAPSED_CLASS,
                  wideColumns ? "booking-week-grid__day-col--open" : "",
                  isToday ? "bg-[var(--mo-accent-soft)]/40" : "bg-[var(--mo-surface)]",
                  canAdd
                    ? "cursor-pointer transition hover:bg-indigo-500/10 hover:ring-1 hover:ring-inset hover:ring-indigo-500/25"
                    : "cursor-default",
                ].join(" ")}
                style={{ minHeight: COLLAPSED_ROW_PX }}
                title={canAdd ? `Записать на ${dayLabel.weekday} ${dayLabel.dayMonth}` : `Записей: ${count}`}
              >
                <span
                  className={[
                    "text-lg font-semibold tabular-nums",
                    count > 0 ? "text-[var(--mo-text)]" : "mo-muted",
                  ].join(" ")}
                >
                  {count}
                </span>
              </button>
            );
          }

          const workingDay = isSpecWorkingDay(spec, dateYmd);
          const dayRows = workingDay ? buildDayRows(spec, dateYmd, dayAppts) : null;

          return (
            <div
              key={key}
              role={canAdd && workingDay ? "button" : undefined}
              tabIndex={canAdd && workingDay ? 0 : undefined}
              onClick={() => {
                if (!canAdd || !workingDay) return;
                emitSlotClick(onSlotClick, spec, dateYmd, dayAppts);
              }}
              onKeyDown={(e) => {
                if (!canAdd || !workingDay || (e.key !== "Enter" && e.key !== " ")) return;
                e.preventDefault();
                emitSlotClick(onSlotClick, spec, dateYmd, dayAppts);
              }}
              className={[
                DAY_COL_CLASS,
                wideColumns ? "booking-week-grid__day-col--open" : "",
                isToday ? "bg-[var(--mo-accent-soft)]/30" : "bg-[var(--mo-surface)]",
                !workingDay ? "booking-week-grid__day-col--off" : "",
                canAdd && workingDay
                  ? "cursor-pointer transition hover:bg-indigo-500/[0.06] hover:ring-1 hover:ring-inset hover:ring-indigo-500/20"
                  : "",
              ].join(" ")}
              style={{ minHeight: EXPANDED_ROW_MIN_PX }}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-semibold tabular-nums mo-muted">{count}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1">
                {!workingDay ? (
                  <div className="booking-week-grid__off-day flex flex-1 items-center justify-center rounded-md px-1 py-2 text-center text-[10px] mo-muted">
                    Выходной
                  </div>
                ) : (
                  (dayRows ?? []).map((row) => {
                    if (row.kind === "appts") {
                      const sideBySide = row.appointments.length > 1;
                      return (
                        <div
                          key={row.appointments.map((a) => a.id).join("-")}
                          className={sideBySide ? "booking-week-grid__pair" : "min-w-0"}
                          onDragOver={(e) => {
                            if (!onMoveAppointment) return;
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onDrop={(e) => {
                            if (!onMoveAppointment) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const id = Number(e.dataTransfer.getData("text/appointment-id"));
                            if (!Number.isFinite(id)) return;
                            onMoveAppointment({
                              appointmentId: id,
                              specialistId: spec.id,
                              dateYmd,
                              minuteOfDay: appointmentStartMinute(row.appointments[0]),
                            });
                          }}
                        >
                          {row.appointments.map((a) => {
                            const timeLabel = showSessionInsteadOfTime ? null : formatTimeInBookingTz(a.start_at);
                            return (
                              <div
                                key={a.id}
                                role="button"
                                tabIndex={0}
                                draggable={Boolean(onMoveAppointment) && a.status === "booked"}
                                onDragStart={(e: ReactDragEvent) => {
                                  e.stopPropagation();
                                  e.dataTransfer.setData("text/appointment-id", String(a.id));
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAppointmentClick(a);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key !== "Enter" && e.key !== " ") return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onAppointmentClick(a);
                                }}
                                className={[
                                  "booking-appt-bitrix relative w-full overflow-visible rounded-md px-1.5 py-1 text-left",
                                  onMoveAppointment && a.status === "booked" ? "cursor-grab active:cursor-grabbing" : "",
                                  appointmentVisualClass(a),
                                ].join(" ")}
                              >
                                <BookingAppointmentCardBody
                                  appointment={a}
                                  timeLabel={timeLabel}
                                  canEditNotes={canEditNotes}
                                  onNoteClick={onAppointmentNoteClick}
                                  canToggleComplete={canToggleComplete}
                                  onCompleteToggle={onAppointmentCompleteToggle}
                                />
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    const slotCanAdd = Boolean(onSlotClick && !row.closed);
                    return (
                      <button
                        key={`slot-${key}-${row.minute}`}
                        type="button"
                        onDragOver={(e) => {
                          if (!onMoveAppointment) return;
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onDrop={(e) => {
                          if (!onMoveAppointment) return;
                          e.preventDefault();
                          e.stopPropagation();
                          const id = Number(e.dataTransfer.getData("text/appointment-id"));
                          if (!Number.isFinite(id)) return;
                          onMoveAppointment({
                            appointmentId: id,
                            specialistId: spec.id,
                            dateYmd,
                            minuteOfDay: row.minute,
                          });
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!slotCanAdd) return;
                          onSlotClick?.({
                            specialistId: spec.id,
                            directionId: spec.direction_id,
                            dateYmd,
                            minuteOfDay: row.minute,
                          });
                        }}
                        className={[
                          "booking-week-grid__empty-slot w-full rounded-md border border-dashed px-1.5 py-1 text-left",
                          slotCanAdd
                            ? "cursor-pointer border-[var(--mo-border-strong)]/55 transition hover:border-indigo-500/40 hover:bg-indigo-500/[0.06]"
                            : "cursor-default border-[var(--mo-border)]/40 opacity-60",
                        ].join(" ")}
                        title={
                          row.closed
                            ? `В этот час уже ${MAX_BOOKINGS_PER_SPECIALIST_HOUR} записи`
                            : slotCanAdd
                              ? `Записать на ${formatMinuteLabel(row.minute)}`
                              : undefined
                        }
                      >
                        <span className="text-[10px] font-semibold tabular-nums leading-none text-[var(--mo-text-muted)]">
                          {formatMinuteLabel(row.minute)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BookingWeekSpecialistGrid({
  anchorDateYmd,
  specialists,
  appointments,
  onAppointmentClick,
  onSlotClick,
  onMoveAppointment,
  onEditSpecialist,
  onAddSpecialist,
  onReorderSpecialists,
  showSessionInsteadOfTime,
  canEditNotes,
  onAppointmentNoteClick,
  canToggleComplete,
  onAppointmentCompleteToggle,
  headerAddon,
}: Props) {
  const weekDays = useMemo(() => weekWorkDayYmds(anchorDateYmd), [anchorDateYmd]);
  const todayYmd = ymdInBookingTz(Date.now());
  const sortedSpecs = useMemo(() => sortSpecs(specialists), [specialists]);
  const [expandedSpecId, setExpandedSpecId] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { counts, bySpecDay } = useMemo(() => {
    const counts = new Map<string, number>();
    const bySpecDay = new Map<string, BookingAppointment[]>();
    for (const s of sortedSpecs) {
      for (const d of weekDays) {
        counts.set(countsKey(s.id, d), 0);
        bySpecDay.set(countsKey(s.id, d), []);
      }
    }
    for (const a of appointments) {
      if (a.status === "cancelled") continue;
      const day = ymdInBookingTz(new Date(a.start_at).getTime());
      if (!weekDays.includes(day)) continue;
      const key = countsKey(a.specialist_id, day);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const list = bySpecDay.get(key);
      if (list) list.push(a);
    }
    return { counts, bySpecDay };
  }, [appointments, sortedSpecs, weekDays]);

  const showSpecEdit = Boolean(onEditSpecialist);
  const dragEnabled = Boolean(onReorderSpecialists && sortedSpecs.length > 1);
  const weekScrollRef = useRef<HTMLDivElement>(null);
  const panDragRef = useRef<{ pointerId: number; startX: number; startScroll: number } | null>(null);
  const [canPanLeft, setCanPanLeft] = useState(false);
  const [canPanRight, setCanPanRight] = useState(false);

  const syncPanEdges = useCallback(() => {
    const el = weekScrollRef.current;
    if (!el) {
      setCanPanLeft(false);
      setCanPanRight(false);
      return;
    }
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    setCanPanLeft(el.scrollLeft > 2);
    setCanPanRight(el.scrollLeft < max - 2);
  }, []);

  useEffect(() => {
    syncPanEdges();
    const el = weekScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncPanEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncPanEdges, expandedSpecId, sortedSpecs.length]);

  const scrollWeekBy = useCallback(
    (delta: number) => {
      const el = weekScrollRef.current;
      if (!el) return;
      el.scrollBy({ left: delta, behavior: "smooth" });
      window.setTimeout(syncPanEdges, 280);
    },
    [syncPanEdges],
  );

  const onWeekPanPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const el = weekScrollRef.current;
    if (!el) return;
    panDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: el.scrollLeft,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);

  const onWeekPanPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = panDragRef.current;
      const el = weekScrollRef.current;
      if (!drag || !el || drag.pointerId !== event.pointerId) return;
      el.scrollLeft = drag.startScroll - (event.clientX - drag.startX);
      syncPanEdges();
    },
    [syncPanEdges],
  );

  const onWeekPanPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    panDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    syncPanEdges();
  }, [syncPanEdges]);

  function handleToggleExpand(specId: number) {
    setExpandedSpecId((cur) => (cur === specId ? null : specId));
  }

  function handleDragEnd(e: DragEndEvent) {
    if (!onReorderSpecialists) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = sortedSpecs.map((s) => s.id);
    const oldIndex = ids.indexOf(Number(active.id));
    const newIndex = ids.indexOf(Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorderSpecialists(arrayMove(sortedSpecs, oldIndex, newIndex).map((s) => s.id));
  }

  if (sortedSpecs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--mo-border-strong)]/50 px-6 py-16 text-center lux-caption">
        <p>В сетке пока нет специалистов.</p>
        {onAddSpecialist ? (
          <button type="button" className="btn-primary mt-4 px-4 py-2 text-sm" onClick={onAddSpecialist}>
            Добавить специалиста
          </button>
        ) : (
          <p className="mt-2">Пригласите эксперта в разделе «Сотрудники» — строка появится здесь автоматически.</p>
        )}
      </div>
    );
  }

  const headerCells = weekDays.map((dateYmd) => {
    const { weekday, dayMonth } = formatWeekdayHeader(dateYmd);
    const isToday = dateYmd === todayYmd;
    return (
      <div
        key={dateYmd}
        className={[
          "booking-week-grid__day-col items-center justify-center px-1 py-2",
          expandedSpecId !== null ? "booking-week-grid__day-col--open" : "",
          isToday ? "bg-[var(--mo-accent-soft)]/50" : "",
        ].join(" ")}
      >
        <span className="text-[11px] font-semibold capitalize text-[var(--mo-text)]">{weekday}</span>
        <span className="text-[10px] tabular-nums mo-muted">{dayMonth}</span>
      </div>
    );
  });

  const rows = sortedSpecs.map((spec) => (
    <SortableSpecialistRow
      key={spec.id}
      spec={spec}
      weekDays={weekDays}
      counts={counts}
      bySpecDay={bySpecDay}
      expanded={expandedSpecId === spec.id}
      onToggleExpand={handleToggleExpand}
      showSpecEdit={showSpecEdit}
      dragEnabled={dragEnabled}
      onEditSpecialist={onEditSpecialist}
      onAppointmentClick={onAppointmentClick}
      onSlotClick={onSlotClick}
      onMoveAppointment={onMoveAppointment}
      showSessionInsteadOfTime={showSessionInsteadOfTime}
      canEditNotes={canEditNotes}
      onAppointmentNoteClick={onAppointmentNoteClick}
      canToggleComplete={canToggleComplete}
      onAppointmentCompleteToggle={onAppointmentCompleteToggle}
      todayYmd={todayYmd}
      wideColumns={expandedSpecId !== null}
    />
  ));

  return (
    <div>
      <div className="crm-board-pan-bar" aria-label="Прокрутка дней недели">
        <button
          type="button"
          className="crm-board-pan-btn"
          disabled={!canPanLeft}
          aria-label="Прокрутить дни влево"
          onClick={() => scrollWeekBy(-280)}
        >
          ‹
        </button>
        <div
          className="crm-board-pan-track"
          title="Перетащите влево или вправо, чтобы увидеть все дни недели"
          onPointerDown={onWeekPanPointerDown}
          onPointerMove={onWeekPanPointerMove}
          onPointerUp={onWeekPanPointerUp}
          onPointerCancel={onWeekPanPointerUp}
        >
          <span className="crm-board-pan-hint">← перетащите, чтобы увидеть все дни →</span>
        </div>
        <button
          type="button"
          className="crm-board-pan-btn"
          disabled={!canPanRight}
          aria-label="Прокрутить дни вправо"
          onClick={() => scrollWeekBy(280)}
        >
          ›
        </button>
      </div>
      <div ref={weekScrollRef} className="booking-week-grid" onScroll={syncPanEdges}>
      <div className="booking-week-grid__inner">
        <div className="booking-week-grid__head sticky top-0 z-30 flex w-full bg-[var(--mo-surface-elevated)]/98 backdrop-blur-sm">
          <div className="booking-week-grid__spec-col flex items-center justify-between gap-1 px-2 py-2">
            <p className="min-w-0 truncate text-xs font-semibold text-[var(--mo-text)]">Специалисты</p>
            {headerAddon}
          </div>
          <div className="flex min-w-0 flex-1">{headerCells}</div>
        </div>

        {dragEnabled ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortedSpecs.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {rows}
            </SortableContext>
          </DndContext>
        ) : (
          rows
        )}
        {onAddSpecialist ? (
          <button
            type="button"
            className="flex w-full items-center gap-2 border-t border-dashed border-[var(--mo-border)] px-3 py-3 text-left text-sm font-medium text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]"
            onClick={onAddSpecialist}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
              +
            </span>
            Добавить специалиста
          </button>
        ) : null}
      </div>
      <p className="border-t border-[var(--mo-border)] px-3 py-2 text-[11px] mo-muted">
        Клик по времени — новая запись. Карточку можно перетащить на другое время или день. Имя
        специалиста — развернуть или свернуть. Часовой пояс: {BOOKING_TIME_ZONE}.
      </p>
      </div>
    </div>
  );
}
