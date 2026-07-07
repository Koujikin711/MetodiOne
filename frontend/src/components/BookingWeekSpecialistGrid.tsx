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
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from "@/components/icons";
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
import type { BookingAppointment, BookingSpecialist } from "@/lib/types";

export const MAX_BOOKINGS_PER_SPECIALIST_DAY = 15;

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

type Props = {
  anchorDateYmd: string;
  specialists: BookingSpecialist[];
  appointments: BookingAppointment[];
  onAppointmentClick: (a: BookingAppointment) => void;
  onSlotClick?: (payload: WeekSlotClickPayload) => void;
  onAddSpecialist?: () => void;
  onEditSpecialist?: (s: BookingSpecialist) => void;
  onDeleteSpecialist?: (s: BookingSpecialist) => void;
  onReorderSpecialists?: (orderedIds: number[]) => void;
  showSessionInsteadOfTime?: boolean;
  canEditNotes?: boolean;
  onAppointmentNoteClick?: (a: BookingAppointment) => void;
  canToggleComplete?: boolean;
  onAppointmentCompleteToggle?: (a: BookingAppointment, completed: boolean) => void;
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
  const anyA = a as BookingAppointment & {
    notification_sent_at?: string | null;
    notification_replied_at?: string | null;
  };
  if (a.status === "cancelled") return "booking-appt booking-appt--cancelled";
  if (a.status === "no_show") return "booking-appt booking-appt--no_show";
  if (a.status === "completed") return "booking-appt booking-appt--completed";
  if (anyA.notification_replied_at) return "booking-appt booking-appt--replied";
  if (anyA.notification_sent_at) return "booking-appt booking-appt--notify";
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
  for (let m = startMin; m < endMin && slots.length < MAX_BOOKINGS_PER_SPECIALIST_DAY; m += step) {
    slots.push(m);
  }
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

type DayRow =
  | { kind: "slot"; minute: number }
  | { kind: "appt"; appointment: BookingAppointment };

function buildDayRows(
  spec: BookingSpecialist,
  dateYmd: string,
  dayAppts: BookingAppointment[],
): DayRow[] | null {
  const slots = dayTimeSlots(spec, dateYmd);
  if (slots.length === 0) return null;

  const step = Math.max(15, spec.slot_duration_min ?? 30);
  const usedApptIds = new Set<number>();
  const rows: DayRow[] = [];

  for (const minute of slots) {
    const match = dayAppts.find((a) => {
      if (usedApptIds.has(a.id)) return false;
      const startMin = appointmentStartMinute(a);
      return startMin >= minute && startMin < minute + step;
    });
    if (match) {
      usedApptIds.add(match.id);
      rows.push({ kind: "appt", appointment: match });
    } else {
      rows.push({ kind: "slot", minute });
    }
  }

  for (const a of dayAppts) {
    if (!usedApptIds.has(a.id)) {
      rows.push({ kind: "appt", appointment: a });
    }
  }

  rows.sort((x, y) => {
    const mx = x.kind === "slot" ? x.minute : appointmentStartMinute(x.appointment);
    const my = y.kind === "slot" ? y.minute : appointmentStartMinute(y.appointment);
    return mx - my;
  });

  return rows;
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
  menuSpecId: number | null;
  setMenuSpecId: Dispatch<SetStateAction<number | null>>;
  showSpecMenu: boolean;
  dragEnabled: boolean;
  onEditSpecialist?: (s: BookingSpecialist) => void;
  onDeleteSpecialist?: (s: BookingSpecialist) => void;
  onAppointmentClick: (a: BookingAppointment) => void;
  onSlotClick?: (payload: WeekSlotClickPayload) => void;
  showSessionInsteadOfTime?: boolean;
  canEditNotes?: boolean;
  onAppointmentNoteClick?: (a: BookingAppointment) => void;
  canToggleComplete?: boolean;
  onAppointmentCompleteToggle?: (a: BookingAppointment, completed: boolean) => void;
  todayYmd: string;
};

function SortableSpecialistRow({
  spec,
  weekDays,
  counts,
  bySpecDay,
  expanded,
  onToggleExpand,
  menuSpecId,
  setMenuSpecId,
  showSpecMenu,
  dragEnabled,
  onEditSpecialist,
  onDeleteSpecialist,
  onAppointmentClick,
  onSlotClick,
  showSessionInsteadOfTime,
  canEditNotes,
  onAppointmentNoteClick,
  canToggleComplete,
  onAppointmentCompleteToggle,
  todayYmd,
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
        "flex border-b border-[var(--mo-border)] last:border-b-0",
        isDragging ? "opacity-90 ring-2 ring-purple-500/35" : "",
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
          {showSpecMenu && (
            <div className="absolute right-1 top-1" data-spec-menu-root>
              <button
                type="button"
                className="rounded-lg p-1 mo-muted hover:bg-[var(--mo-accent-soft)]"
                aria-label="Меню"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuSpecId((id) => (id === spec.id ? null : spec.id));
                }}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuSpecId === spec.id && (
                <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-xl border border-[var(--mo-border)] bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--mo-accent-soft)]"
                    onClick={() => {
                      setMenuSpecId(null);
                      onEditSpecialist?.(spec);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                    Редактировать
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-500 hover:bg-[var(--mo-accent-soft)]"
                    onClick={() => {
                      setMenuSpecId(null);
                      onDeleteSpecialist?.(spec);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Удалить
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1">
        {weekDays.map((dateYmd) => {
          const key = countsKey(spec.id, dateYmd);
          const count = counts.get(key) ?? 0;
          const full = count >= MAX_BOOKINGS_PER_SPECIALIST_DAY;
          const isToday = dateYmd === todayYmd;
          const dayAppts = (bySpecDay.get(key) ?? []).slice().sort((a, b) => a.start_at.localeCompare(b.start_at));
          const canAdd = Boolean(onSlotClick && !full);

          if (!expanded) {
            return (
              <button
                key={key}
                type="button"
                disabled={!canAdd}
                onClick={() => emitSlotClick(onSlotClick, spec, dateYmd, dayAppts)}
                className={[
                  DAY_COL_COLLAPSED_CLASS,
                  isToday ? "bg-[var(--mo-accent-soft)]/40" : "bg-[var(--mo-surface)]",
                  canAdd
                    ? "cursor-pointer transition hover:bg-purple-500/10 hover:ring-1 hover:ring-inset hover:ring-purple-500/25"
                    : "cursor-default",
                ].join(" ")}
                style={{ minHeight: COLLAPSED_ROW_PX }}
                title={
                  canAdd
                    ? `Записать на ${dateYmd} (${count} из ${MAX_BOOKINGS_PER_SPECIALIST_DAY})`
                    : full
                      ? `Лимит ${MAX_BOOKINGS_PER_SPECIALIST_DAY} записей`
                      : `Записей: ${count}`
                }
              >
                <span
                  className={[
                    "text-lg font-semibold tabular-nums",
                    full ? "text-red-600" : count > 0 ? "text-[var(--mo-text)]" : "mo-muted",
                  ].join(" ")}
                >
                  {count}
                </span>
              </button>
            );
          }

          const dayRows = buildDayRows(spec, dateYmd, dayAppts);
          const workingDay = isSpecWorkingDay(spec, dateYmd);

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
                isToday ? "bg-[var(--mo-accent-soft)]/30" : "bg-[var(--mo-surface)]",
                !workingDay ? "booking-week-grid__day-col--off" : "",
                canAdd && workingDay
                  ? "cursor-pointer transition hover:bg-purple-500/[0.06] hover:ring-1 hover:ring-inset hover:ring-purple-500/20"
                  : "",
              ].join(" ")}
              style={{ minHeight: EXPANDED_ROW_MIN_PX }}
              title={
                !workingDay
                  ? "Выходной"
                  : canAdd
                    ? `Записать на ${dateYmd}`
                    : full
                      ? `Лимит ${MAX_BOOKINGS_PER_SPECIALIST_DAY}`
                      : undefined
              }
            >
              <div className="flex items-center justify-between gap-1">
                <span className={`text-[10px] font-semibold tabular-nums ${full ? "text-red-600" : "mo-muted"}`}>
                  {count}/{MAX_BOOKINGS_PER_SPECIALIST_DAY}
                </span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-visible">
                {!workingDay ? (
                  <div className="booking-week-grid__off-day flex flex-1 items-center justify-center rounded-md px-1 py-2 text-center text-[10px] mo-muted">
                    Выходной
                  </div>
                ) : dayRows ? (
                  dayRows.map((row) => {
                    if (row.kind === "appt") {
                      const a = row.appointment;
                      const timeLabel = showSessionInsteadOfTime
                        ? null
                        : formatTimeInBookingTz(a.start_at);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAppointmentClick(a);
                          }}
                          className={[
                            "booking-appt-bitrix relative w-full overflow-visible rounded-md px-1 py-0.5 text-left sm:px-1.5 sm:py-1",
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
                        </button>
                      );
                    }

                    const slotCanAdd = Boolean(onSlotClick && !full);
                    return (
                      <button
                        key={`slot-${key}-${row.minute}`}
                        type="button"
                        disabled={!slotCanAdd}
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
                          "booking-week-grid__empty-slot w-full rounded-md border border-dashed px-1 py-1 text-left sm:px-1.5",
                          slotCanAdd
                            ? "cursor-pointer border-[var(--mo-border-strong)]/55 transition hover:border-purple-500/40 hover:bg-purple-500/[0.06]"
                            : "cursor-default border-[var(--mo-border)]/40 opacity-60",
                        ].join(" ")}
                        title={slotCanAdd ? `Записать на ${formatMinuteLabel(row.minute)}` : undefined}
                      >
                        <span className="text-[9px] font-semibold tabular-nums leading-none mo-muted sm:text-[10px]">
                          {formatMinuteLabel(row.minute)}
                        </span>
                      </button>
                    );
                  })
                ) : null}
              </div>
              {full ? <p className="text-center text-[9px] text-red-500">Лимит {MAX_BOOKINGS_PER_SPECIALIST_DAY}</p> : null}
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
  onAddSpecialist,
  onEditSpecialist,
  onDeleteSpecialist,
  onReorderSpecialists,
  showSessionInsteadOfTime,
  canEditNotes,
  onAppointmentNoteClick,
  canToggleComplete,
  onAppointmentCompleteToggle,
}: Props) {
  const weekDays = useMemo(() => weekWorkDayYmds(anchorDateYmd), [anchorDateYmd]);
  const todayYmd = ymdInBookingTz(Date.now());
  const sortedSpecs = useMemo(() => sortSpecs(specialists), [specialists]);
  const [expandedSpecId, setExpandedSpecId] = useState<number | null>(null);
  const [menuSpecId, setMenuSpecId] = useState<number | null>(null);

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

  const showSpecMenu = Boolean(onEditSpecialist && onDeleteSpecialist);
  const dragEnabled = Boolean(onReorderSpecialists && sortedSpecs.length > 1);

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
        <p>Добавьте специалистов — они появятся строками слева, дни недели сверху.</p>
        {onAddSpecialist && (
          <button type="button" onClick={onAddSpecialist} className="btn-secondary mt-4 inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Добавить специалиста
          </button>
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
      menuSpecId={menuSpecId}
      setMenuSpecId={setMenuSpecId}
      showSpecMenu={showSpecMenu}
      dragEnabled={dragEnabled}
      onEditSpecialist={onEditSpecialist}
      onDeleteSpecialist={onDeleteSpecialist}
      onAppointmentClick={onAppointmentClick}
      onSlotClick={onSlotClick}
      showSessionInsteadOfTime={showSessionInsteadOfTime}
      canEditNotes={canEditNotes}
      onAppointmentNoteClick={onAppointmentNoteClick}
      canToggleComplete={canToggleComplete}
      onAppointmentCompleteToggle={onAppointmentCompleteToggle}
      todayYmd={todayYmd}
    />
  ));

  return (
    <div className="booking-week-grid">
      <div className="booking-week-grid__inner">
        <div className="sticky top-0 z-30 flex w-full border-b border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]/98 backdrop-blur-sm">
          <div className="booking-week-grid__spec-col flex items-end px-2 py-2">
            <div>
              <p className="text-xs font-semibold text-[var(--mo-text)]">Специалисты</p>
              <p className="text-[10px] mo-muted">до {MAX_BOOKINGS_PER_SPECIALIST_DAY} / день</p>
              {onAddSpecialist && (
                <button
                  type="button"
                  onClick={onAddSpecialist}
                  className="mt-1 inline-flex items-center gap-1 rounded-md border border-[var(--mo-border)] px-2 py-0.5 text-[10px] mo-muted hover:bg-[var(--mo-accent-soft)]"
                >
                  <Plus className="h-3 w-3" />
                  Добавить
                </button>
              )}
            </div>
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
      </div>
      <p className="border-t border-[var(--mo-border)] px-3 py-2 text-[11px] mo-muted">
        Клик по ячейке дня — новая запись (форма справа). Имя специалиста — развернуть или свернуть список. Часовой
        пояс: {BOOKING_TIME_ZONE}.
      </p>
    </div>
  );
}
