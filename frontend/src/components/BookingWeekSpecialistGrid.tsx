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
  /** Ужать/задать длительность (мин), напр. час → 30. */
  durationMin?: number;
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

function formatMinuteLabel(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function appointmentStartMinute(a: BookingAppointment): number {
  const { h, min } = utcMsToHourMinuteInBookingTz(new Date(a.start_at).getTime());
  return h * 60 + min;
}

function appointmentDurationMinutes(a: BookingAppointment): number {
  const ms = new Date(a.end_at).getTime() - new Date(a.start_at).getTime();
  return Math.max(15, Math.round(ms / 60000));
}

type DayRow =
  | { kind: "slot"; minute: number; closed?: boolean }
  /** Только записи на :00 — одна сетка на весь час (без колонки :30). */
  | { kind: "hourOnly"; hourStart: number; appointments: BookingAppointment[] }
  /** Есть :30 или обе половины — слева :00, справа :30. */
  | {
      kind: "hourSplit";
      hourStart: number;
      left: BookingAppointment[];
      right: BookingAppointment[];
    };

function appointmentPairBucket(a: BookingAppointment): number {
  return Math.floor(appointmentStartMinute(a) / 30) * 30;
}

function buildDayRows(
  spec: BookingSpecialist,
  dateYmd: string,
  dayAppts: BookingAppointment[],
): DayRow[] | null {
  // Запись только на час (:00) → одна сетка на час.
  // Если есть :30 → ряд :00 | :30 (свободно / карточка).
  if (!isSpecWorkingDay(spec, dateYmd)) return null;
  const startMin = (spec.work_start_hour ?? 9) * 60;
  const endMin = (spec.work_end_hour ?? 18) * 60;
  if (endMin <= startMin) return null;

  const byBucket = new Map<number, BookingAppointment[]>();
  for (const a of dayAppts) {
    const bucket = appointmentPairBucket(a);
    const list = byBucket.get(bucket);
    if (list) list.push(a);
    else byBucket.set(bucket, [a]);
  }
  for (const list of byBucket.values()) {
    list.sort((a, b) => appointmentStartMinute(a) - appointmentStartMinute(b) || a.id - b.id);
  }

  const out: DayRow[] = [];
  for (let hour = Math.floor(startMin / 60); hour < Math.ceil(endMin / 60); hour += 1) {
    const hourStart = hour * 60;
    if (hourStart < startMin || hourStart >= endMin) continue;
    const left = byBucket.get(hourStart) ?? [];
    const right = hourStart + 30 < endMin ? (byBucket.get(hourStart + 30) ?? []) : [];
    if (left.length === 0 && right.length === 0) {
      out.push({ kind: "slot", minute: hourStart });
      continue;
    }
    if (right.length === 0) {
      // Только час — без второй колонки «:30 свободно».
      out.push({ kind: "hourOnly", hourStart, appointments: left });
      continue;
    }
    out.push({ kind: "hourSplit", hourStart, left, right });
  }
  return out;
}

function CollapsedDayCell({
  count,
  canAdd,
  isToday,
  wideColumns,
  spec,
  dateYmd,
  dayAppts,
  onSlotClick,
}: {
  count: number;
  canAdd: boolean;
  isToday: boolean;
  wideColumns: boolean;
  spec: BookingSpecialist;
  dateYmd: string;
  dayAppts: BookingAppointment[];
  onSlotClick?: (payload: WeekSlotClickPayload) => void;
}) {
  return (
    <button
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

          if (!expanded) {
            return (
              <CollapsedDayCell
                key={key}
                count={count}
                canAdd={canAdd}
                isToday={isToday}
                wideColumns={wideColumns}
                spec={spec}
                dateYmd={dateYmd}
                dayAppts={dayAppts}
                onSlotClick={onSlotClick}
              />
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
                    const renderApptCard = (a: BookingAppointment, dropMinute: number) => {
                      const timeLabel = showSessionInsteadOfTime ? null : formatTimeInBookingTz(a.start_at);
                      const durMin = appointmentDurationMinutes(a);
                      const canShrinkToHalf =
                        Boolean(onMoveAppointment) && a.status === "booked" && durMin >= 55;
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
                            e.currentTarget.classList.add("is-dragging");
                            document.documentElement.classList.add("booking-appt-moving");
                          }}
                          onDragEnd={(e) => {
                            e.currentTarget.classList.remove("is-dragging");
                            document.documentElement.classList.remove("booking-appt-moving");
                          }}
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
                            document.documentElement.classList.remove("booking-appt-moving");
                            onMoveAppointment({
                              appointmentId: id,
                              specialistId: spec.id,
                              dateYmd,
                              minuteOfDay: dropMinute,
                            });
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
                            onMoveAppointment && a.status === "booked"
                              ? "cursor-grab active:cursor-grabbing"
                              : "",
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
                          {canShrinkToHalf ? (
                            <button
                              type="button"
                              className="booking-appt-resize-handle"
                              title="Ужать до полчаса (тянуть за край)"
                              aria-label="Ужать до полчаса"
                              draggable={false}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                onMoveAppointment?.({
                                  appointmentId: a.id,
                                  specialistId: spec.id,
                                  dateYmd,
                                  minuteOfDay: appointmentStartMinute(a),
                                  durationMin: 30,
                                });
                              }}
                            />
                          ) : null}
                        </div>
                      );
                    };

                    const renderHalfFree = (minute: number) => {
                      const slotCanAdd = Boolean(onSlotClick);
                      const slotCanDrop = Boolean(onMoveAppointment);
                      return (
                        <button
                          key={`half-free-${minute}`}
                          type="button"
                          className={[
                            "booking-week-grid__empty-slot booking-week-grid__half-free w-full rounded-md border border-dashed px-1.5 py-1 text-left",
                            slotCanAdd || slotCanDrop
                              ? "cursor-pointer border-[var(--mo-border-strong)]/55 transition hover:border-indigo-500/40 hover:bg-indigo-500/[0.06]"
                              : "cursor-default border-[var(--mo-border)]/40 opacity-60",
                          ].join(" ")}
                          title={
                            slotCanAdd
                              ? `Записать на ${formatMinuteLabel(minute)}`
                              : `Свободно ${formatMinuteLabel(minute)}`
                          }
                          onDragOver={(e) => {
                            if (!slotCanDrop) return;
                            e.preventDefault();
                            e.stopPropagation();
                            e.currentTarget.classList.add("is-drop-target");
                          }}
                          onDragLeave={(e) => e.currentTarget.classList.remove("is-drop-target")}
                          onDrop={(e) => {
                            if (!onMoveAppointment) return;
                            e.preventDefault();
                            e.stopPropagation();
                            e.currentTarget.classList.remove("is-drop-target");
                            const id = Number(e.dataTransfer.getData("text/appointment-id"));
                            if (!Number.isFinite(id)) return;
                            document.documentElement.classList.remove("booking-appt-moving");
                            onMoveAppointment({
                              appointmentId: id,
                              specialistId: spec.id,
                              dateYmd,
                              minuteOfDay: minute,
                            });
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!slotCanAdd) return;
                            onSlotClick?.({
                              specialistId: spec.id,
                              directionId: spec.direction_id,
                              dateYmd,
                              minuteOfDay: minute,
                            });
                          }}
                        >
                          <span className="text-[10px] font-semibold tabular-nums leading-none text-[var(--mo-text-muted)]">
                            {formatMinuteLabel(minute)} свободно
                          </span>
                        </button>
                      );
                    };

                    if (row.kind === "hourOnly") {
                      // Только час: каждая запись — одна сетка на всю ширину (не :00|:30).
                      return (
                        <div
                          key={`hour-only-${key}-${row.hourStart}`}
                          className="booking-week-grid__half-stack min-w-0"
                        >
                          {row.appointments.map((a) => renderApptCard(a, row.hourStart))}
                        </div>
                      );
                    }

                    if (row.kind === "hourSplit") {
                      const halves: { minute: number; appts: BookingAppointment[] }[] = [
                        { minute: row.hourStart, appts: row.left },
                        { minute: row.hourStart + 30, appts: row.right },
                      ];
                      return (
                        <div key={`hour-split-${key}-${row.hourStart}`} className="booking-week-grid__pair">
                          {halves.map(({ minute, appts }) => {
                            if (appts.length === 0) return renderHalfFree(minute);
                            return (
                              <div key={`half-${minute}`} className="booking-week-grid__half-stack min-w-0">
                                {appts.map((a) => renderApptCard(a, minute))}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    const slotCanAdd = Boolean(onSlotClick && !row.closed);
                    const slotCanDrop = Boolean(onMoveAppointment && !row.closed);
                    return (
                      <button
                        key={`slot-${key}-${row.minute}`}
                        type="button"
                        onDragOver={(e) => {
                          if (!slotCanDrop) return;
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.classList.add("is-drop-target");
                        }}
                        onDragLeave={(e) => {
                          e.currentTarget.classList.remove("is-drop-target");
                        }}
                        onDrop={(e) => {
                          if (!onMoveAppointment) return;
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.classList.remove("is-drop-target");
                          const id = Number(e.dataTransfer.getData("text/appointment-id"));
                          if (!Number.isFinite(id)) return;
                          document.documentElement.classList.remove("booking-appt-moving");
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
                          slotCanAdd || slotCanDrop
                            ? "cursor-pointer border-[var(--mo-border-strong)]/55 transition hover:border-indigo-500/40 hover:bg-indigo-500/[0.06]"
                            : "cursor-default border-[var(--mo-border)]/40 opacity-60",
                        ].join(" ")}
                        title={
                          row.closed
                            ? `В этот час уже ${MAX_BOOKINGS_PER_SPECIALIST_HOUR} записи`
                            : slotCanAdd
                              ? `Записать на ${formatMinuteLabel(row.minute)}`
                              : slotCanDrop
                                ? `Перенести на ${formatMinuteLabel(row.minute)}`
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

  useEffect(() => {
    return () => {
      document.documentElement.classList.remove("booking-appt-moving");
    };
  }, []);

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
      </div>
      <p className="px-1 py-2 text-[11px] leading-relaxed mo-muted">
        Клик по времени — новая запись. Карточку можно перетащить на другое время или день. Имя
        специалиста — развернуть или свернуть. Часовой пояс: {BOOKING_TIME_ZONE}.
      </p>
    </div>
  );
}
