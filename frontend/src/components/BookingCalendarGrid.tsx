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
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from "react";

import { Check, FileText, GripVertical, MessageCircle, MoreHorizontal, Pencil, Phone, Plus, Trash2 } from "@/components/icons";
import {
  BOOKING_TIME_ZONE,
  formatAppointmentTimeOnCard,
  utcMsToHourMinuteInBookingTz,
  weekdayMon0InBookingTz,
  ymdInBookingTz,
  zonedWallTimeToUtcMs,
} from "@/lib/bookingTz";
import { visitDisplayTitle, visitDisplayValue } from "@/lib/bookingVisitDisplay";
import type { BookingAppointment, BookingSpecialist } from "@/lib/types";

const GRID_START_HOUR = 7;
const GRID_END_HOUR = 20;
const PX_PER_HOUR = 64;
const SPEC_HEADER_PX = 42;
const SLOT_STEP_MIN = 30;

const SLOT_MINUTES = Array.from(
  { length: ((GRID_END_HOUR - GRID_START_HOUR) * 60) / SLOT_STEP_MIN },
  (_, i) => GRID_START_HOUR * 60 + i * SLOT_STEP_MIN,
);

const HOUR_LABELS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);

const DEFAULT_WEEKDAYS = [0, 1, 2, 3, 4];

const statusCardClass: Record<string, string> = {
  booked: "booking-appt booking-appt--booked",
  completed: "booking-appt booking-appt--completed",
  no_show: "booking-appt booking-appt--no_show",
  cancelled: "booking-appt booking-appt--cancelled",
};

const notifySentClass = "booking-appt booking-appt--notify";
const notifyRepliedClass = "booking-appt booking-appt--replied";

const appointmentHoverClass =
  "transition-[transform,box-shadow] duration-200 ease-out hover:z-30 hover:scale-[1.02] hover:shadow-md hover:ring-2 hover:ring-[var(--mo-gold)]/40";

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

function isSlotBookable(dateYmd: string, spec: BookingSpecialist, minuteOfDay: number): boolean {
  const wd = weekdayMon0InBookingTz(dateYmd);
  if (!specWeekdays(spec).includes(wd)) return false;
  const { start, end } = specWorkBounds(spec);
  const h = Math.floor(minuteOfDay / 60);
  return h >= start && h < end;
}

function hatchForSpec(
  dateYmd: string,
  spec: BookingSpecialist,
): { fullDay: true } | { morningPct: number; eveningPct: number; eveningTopPct: number } {
  const wd = weekdayMon0InBookingTz(dateYmd);
  if (!specWeekdays(spec).includes(wd)) return { fullDay: true };
  const { start: ws, end: we } = specWorkBounds(spec);
  const total = GRID_END_HOUR - GRID_START_HOUR;
  return {
    morningPct: ((ws - GRID_START_HOUR) / total) * 100,
    eveningPct: ((GRID_END_HOUR - we) / total) * 100,
    eveningTopPct: ((we - GRID_START_HOUR) / total) * 100,
  };
}

function dayWindowBounds(dateYmd: string): { startMs: number; endMs: number } {
  return {
    startMs: zonedWallTimeToUtcMs(dateYmd, GRID_START_HOUR, 0),
    endMs: zonedWallTimeToUtcMs(dateYmd, GRID_END_HOUR, 0),
  };
}

function layoutBlock(
  dateYmd: string,
  isoStart: string,
  isoEnd: string,
): { topPct: number; heightPct: number; visible: boolean } {
  const { startMs: ws, endMs: we } = dayWindowBounds(dateYmd);
  const t0 = new Date(isoStart).getTime();
  const t1 = new Date(isoEnd).getTime();
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

/** Раскладка пересекающихся записей в одной колонке: несколько «дорожек» по ширине, без налезания текста. */
function assignAppointmentLanes(appointments: BookingAppointment[]): Map<number, { lane: number; laneCount: number }> {
  const out = new Map<number, { lane: number; laneCount: number }>();
  if (!appointments.length) return out;
  const dayItems = appointments
    .map((a) => ({ a, t0: new Date(a.start_at).getTime(), t1: new Date(a.end_at).getTime() }))
    .sort((x, y) => x.t0 - y.t0 || x.t1 - y.t1);
  const laneEnd: number[] = [];
  for (const { a, t0, t1 } of dayItems) {
    let lane = -1;
    for (let i = 0; i < laneEnd.length; i++) {
      if (laneEnd[i] <= t0) {
        lane = i;
        break;
      }
    }
    if (lane < 0) {
      lane = laneEnd.length;
      laneEnd.push(t1);
    } else {
      laneEnd[lane] = Math.max(laneEnd[lane], t1);
    }
    out.set(a.id, { lane, laneCount: 0 });
  }
  const laneCount = laneEnd.length;
  for (const { a } of dayItems) {
    const cur = out.get(a.id)!;
    out.set(a.id, { lane: cur.lane, laneCount });
  }
  return out;
}

function nowLineTopPct(dateYmd: string, nowMs: number): number | null {
  if (ymdInBookingTz(nowMs) !== dateYmd) return null;
  const { h, min } = utcMsToHourMinuteInBookingTz(nowMs);
  const mins = h * 60 + min;
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
  minuteOfDay: number;
};

type Props = {
  dateYmd: string;
  specialists: BookingSpecialist[];
  appointments: BookingAppointment[];
  /** Если задано, новые слоты (клик по пустому времени) только для этих специалистов; перенос записей не блокируется. */
  slotClickSpecialistIds?: ReadonlySet<number>;
  onAppointmentClick: (a: BookingAppointment) => void;
  onSlotClick?: (payload: SlotClickPayload) => void;
  onMoveAppointment?: (payload: { appointmentId: number; specialistId: number; minuteOfDay: number }) => void;
  onAddSpecialist?: () => void;
  onEditSpecialist?: (s: BookingSpecialist) => void;
  onDeleteSpecialist?: (s: BookingSpecialist) => void;
  onReorderSpecialists?: (orderedIds: number[]) => void;
  /** Главный эксперт: вместо времени на карточке — номер сеанса */
  showSessionInsteadOfTime?: boolean;
  canEditNotes?: boolean;
  onAppointmentNoteClick?: (a: BookingAppointment) => void;
  onOpenChat?: (leadId: number) => void;
  canToggleComplete?: boolean;
  onAppointmentCompleteToggle?: (a: BookingAppointment, completed: boolean) => void;
};

type SortableColProps = {
  spec: BookingSpecialist;
  dateYmd: string;
  gridHeightPx: number;
  totalHours: number;
  bySpec: Map<number, BookingAppointment[]>;
  menuSpecId: number | null;
  setMenuSpecId: Dispatch<SetStateAction<number | null>>;
  showSpecMenu: boolean;
  onEditSpecialist?: (s: BookingSpecialist) => void;
  onDeleteSpecialist?: (s: BookingSpecialist) => void;
  onAppointmentClick: (a: BookingAppointment) => void;
  onSlotClick?: (payload: SlotClickPayload) => void;
  onMoveAppointment?: (payload: { appointmentId: number; specialistId: number; minuteOfDay: number }) => void;
  dragEnabled: boolean;
  nowTopPct: number | null;
  slotClickSpecialistIds?: ReadonlySet<number>;
  showSessionInsteadOfTime?: boolean;
  canEditNotes?: boolean;
  onAppointmentNoteClick?: (a: BookingAppointment) => void;
  onOpenChat?: (leadId: number) => void;
  canToggleComplete?: boolean;
  onAppointmentCompleteToggle?: (a: BookingAppointment, completed: boolean) => void;
};

function SortableSpecialistColumn({
  spec,
  dateYmd,
  gridHeightPx,
  totalHours,
  bySpec,
  menuSpecId,
  setMenuSpecId,
  showSpecMenu,
  onEditSpecialist,
  onDeleteSpecialist,
  onAppointmentClick,
  onSlotClick,
  onMoveAppointment,
  dragEnabled,
  nowTopPct,
  slotClickSpecialistIds,
  showSessionInsteadOfTime,
  canEditNotes,
  onAppointmentNoteClick,
  onOpenChat,
  canToggleComplete,
  onAppointmentCompleteToggle,
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
  const specAppointments = bySpec.get(spec.id) ?? [];
  const laneLayout = assignAppointmentLanes(specAppointments);

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, minHeight: gridHeightPx + SPEC_HEADER_PX }}
      className="group/spec relative basis-[260px] grow shrink-0 border-r border-[var(--mo-border)] last:border-r-0"
    >
      <div
        className="sticky top-0 z-20 border-b border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]/95 backdrop-blur-sm"
        style={{ minHeight: SPEC_HEADER_PX }}
      >
        <div className="relative flex min-h-[inherit] items-center gap-0.5 px-1 py-1 pr-8">
          {dragEnabled && (
            <button
              type="button"
              className="shrink-0 rounded-md p-1 mo-muted hover:bg-[var(--mo-accent-soft)] hover:mo-muted"
              aria-label="Перетащить колонку"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
            <p className="truncate text-sm font-semibold leading-tight text-[var(--mo-text)]">{spec.full_name}</p>
            <p className="truncate text-xs leading-tight mo-muted">
              {(spec.specialization ?? "").trim() || spec.direction_name || "—"}
            </p>
          </div>
          {showSpecMenu && (
            <div className="absolute right-1 top-1 z-30" data-spec-menu-root>
              <button
                type="button"
                className="rounded-lg p-1.5 mo-muted/90 transition-colors duration-200 hover:bg-[var(--mo-accent-soft)] hover:text-[var(--mo-text)]"
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
                <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-[var(--mo-border)]/80 bg-white/98 py-1 shadow-2xl shadow-[var(--mo-shadow-luxury)] backdrop-blur-md">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--mo-text)] transition hover:bg-[var(--mo-accent-soft)]"
                    onClick={() => {
                      setMenuSpecId(null);
                      onEditSpecialist?.(spec);
                    }}
                  >
                    <Pencil className="h-4 w-4 shrink-0 lux-caption" />
                    Редактировать
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 transition hover:bg-[var(--mo-accent-soft)]"
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
          <div className="booking-grid-hatch pointer-events-none absolute inset-0 opacity-[0.55]" />
        ) : (
          "morningPct" in hatch && (
            <>
              <div
                className="booking-grid-hatch pointer-events-none absolute left-0 right-0 top-0 opacity-[0.55]"
                style={{ height: `${hatch.morningPct}%` }}
              />
              <div
                className="booking-grid-hatch pointer-events-none absolute left-0 right-0 opacity-[0.55]"
                style={{
                  height: `${hatch.eveningPct}%`,
                  top: `${hatch.eveningTopPct}%`,
                }}
              />
            </>
          )
        )}

        {SLOT_MINUTES.map((minuteOfDay) => (
          <div
            key={minuteOfDay}
            className={[
              "pointer-events-none absolute inset-x-0 border-t",
              minuteOfDay % 60 === 0 ? "border-[var(--mo-border)]/35" : "border-[var(--mo-border)]/20",
            ].join(" ")}
            style={{ top: `${((minuteOfDay - GRID_START_HOUR * 60) / ((GRID_END_HOUR - GRID_START_HOUR) * 60)) * 100}%` }}
          />
        ))}

        {nowTopPct != null && (
          <div
            className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-400/85 shadow-[0_0_10px_rgba(248,113,113,0.45)]"
            style={{ top: `${nowTopPct}%` }}
            aria-hidden
          />
        )}

        {(onSlotClick || onMoveAppointment) &&
          SLOT_MINUTES.map((minuteOfDay) => {
            const ok = isSlotBookable(dateYmd, spec, minuteOfDay);
            if (!ok) return null;
            const allowSlotClick =
              !slotClickSpecialistIds || slotClickSpecialistIds.size === 0 || slotClickSpecialistIds.has(spec.id);
            const topPct = ((minuteOfDay - GRID_START_HOUR * 60) / ((GRID_END_HOUR - GRID_START_HOUR) * 60)) * 100;
            const slotStyle = {
              top: `${topPct}%`,
              height: `${(SLOT_STEP_MIN / 60 / totalHours) * 100}%`,
            } as const;
            const dragHandlers =
              onMoveAppointment != null
                ? {
                    onDragOver: (e: DragEvent) => {
                      e.preventDefault();
                    },
                    onDrop: (e: DragEvent) => {
                      e.preventDefault();
                      const raw = e.dataTransfer.getData("text/appointment-id");
                      const id = Number(raw);
                      if (!Number.isFinite(id)) return;
                      onMoveAppointment({ appointmentId: id, specialistId: spec.id, minuteOfDay });
                    },
                  }
                : {};
            if (allowSlotClick && onSlotClick) {
              return (
                <button
                  key={`slot-${spec.id}-${minuteOfDay}`}
                  type="button"
                  onClick={() =>
                    onSlotClick({
                      specialistId: spec.id,
                      directionId: spec.direction_id,
                      minuteOfDay,
                    })
                  }
                  {...dragHandlers}
                  className="absolute inset-x-1 z-[5] cursor-pointer rounded-md border border-transparent transition-colors hover:border-purple-500/35 hover:bg-purple-500/10"
                  style={slotStyle}
                  aria-label={`Свободный слот ${Math.floor(minuteOfDay / 60)}:${String(minuteOfDay % 60).padStart(2, "0")}, ${spec.full_name}`}
                />
              );
            }
            if (onMoveAppointment) {
              return (
                <div
                  key={`slot-drop-${spec.id}-${minuteOfDay}`}
                  {...dragHandlers}
                  className="absolute inset-x-1 z-[5]"
                  style={slotStyle}
                  aria-hidden
                />
              );
            }
            return null;
          })}

        {specAppointments.map((a) => {
          const { topPct, heightPct, visible } = layoutBlock(dateYmd, a.start_at, a.end_at);
          if (!visible) return null;
          const laneInfo = laneLayout.get(a.id);
          const lane = laneInfo?.lane ?? 0;
          const laneCount = Math.max(1, laneInfo?.laneCount ?? 1);
          const cls = appointmentVisualClass(a);
          const narrow = laneCount > 1;
          const note = (a.comment || "").trim();
          const serviceLine = (a.service_title || "").trim();
          const phoneDigits = (a.patient_phone || "").replace(/\D+/g, "");
          const isCompleted = a.status === "completed";
          const canShowCompleteMark =
            isCompleted || (canToggleComplete && a.status !== "cancelled" && a.status !== "no_show");
          const timeLabel = showSessionInsteadOfTime
            ? (visitDisplayValue(a) ?? "—")
            : formatAppointmentTimeOnCard(a.start_at, a.end_at, narrow);
          const cardTitle = [
            a.patient_name,
            timeLabel,
            serviceLine ? `Услуга: ${serviceLine}` : null,
            note ? `Заметка: ${note}` : null,
            a.lead_id ? `CRM #${a.lead_id}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              key={a.id}
              className="group/appt absolute z-20"
              style={{
                top: `${topPct}%`,
                height: `${heightPct}%`,
                left: `calc(4px + ${lane} * (100% - 8px) / ${laneCount})`,
                width: `calc((100% - 8px) / ${laneCount})`,
                right: "auto",
                zIndex: 20 + lane,
              }}
            >
              {(note || serviceLine) && (
                <div
                  role="tooltip"
                  className="booking-appt-popover pointer-events-none absolute bottom-full left-0 right-0 z-[80] mb-1 hidden group-hover/appt:block"
                >
                  {serviceLine ? (
                    <p className="booking-appt-popover__service">
                      <span className="font-semibold opacity-75">Услуга: </span>
                      {serviceLine}
                    </p>
                  ) : null}
                  {note ? (
                    <p className={serviceLine ? "mt-1" : ""}>
                      <span className="font-semibold opacity-75">Заметка: </span>
                      {note}
                    </p>
                  ) : null}
                </div>
              )}
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/appointment-id", String(a.id));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onAppointmentClick(a)}
                className={[
                  "booking-appt-bitrix relative flex h-full w-full flex-col justify-between overflow-hidden rounded-md text-left",
                  narrow ? "px-1 py-0.5" : "px-1.5 py-1",
                  cls,
                  appointmentHoverClass,
                ].join(" ")}
                title={cardTitle}
              >
                <div className="flex min-h-0 items-center gap-1 overflow-hidden">
                  <span className="truncate text-[11px] font-bold leading-tight">{a.patient_name}</span>
                  {canShowCompleteMark ? (
                    canToggleComplete ? (
                      <button
                        type="button"
                        className={["booking-appt-check shrink-0", isCompleted ? "is-done" : ""].join(" ")}
                        title={isCompleted ? "Снять отметку «завершён»" : "Отметить как завершён"}
                        aria-label={isCompleted ? "Снять отметку завершён" : "Отметить как завершён"}
                        aria-pressed={isCompleted}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAppointmentCompleteToggle?.(a, !isCompleted);
                        }}
                      >
                        {isCompleted ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                      </button>
                    ) : (
                      <span className="booking-appt-check is-done pointer-events-none shrink-0" title="Завершён" aria-label="Завершён">
                        <Check className="h-2.5 w-2.5" strokeWidth={3} />
                      </span>
                    )
                  ) : null}
                </div>
                <div className="mt-0.5 flex items-end justify-between gap-0.5">
                  <div className="flex min-w-0 items-center gap-0.5">
                    <span
                      className="text-[10px] font-semibold tabular-nums leading-none"
                      title={showSessionInsteadOfTime ? visitDisplayTitle(a) : formatAppointmentTimeOnCard(a.start_at, a.end_at, false)}
                    >
                      {timeLabel}
                    </span>
                    {canEditNotes || note ? (
                      <button
                        type="button"
                        className={[
                          "booking-appt-note-btn shrink-0 rounded p-0.5 transition hover:bg-black/10",
                          note ? "is-filled" : "is-empty",
                        ].join(" ")}
                        title={note || "Добавить заметку"}
                        aria-label={note ? "Редактировать заметку" : "Добавить заметку"}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (canEditNotes && onAppointmentNoteClick) onAppointmentNoteClick(a);
                        }}
                      >
                        <FileText className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {phoneDigits.length >= 7 ? (
                      <a
                        href={`tel:${phoneDigits}`}
                        className="booking-appt-action rounded p-0.5 hover:bg-black/10"
                        title="Позвонить"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Phone className="h-3 w-3" />
                      </a>
                    ) : null}
                    {a.lead_id != null && onOpenChat ? (
                      <button
                        type="button"
                        className="booking-appt-action rounded p-0.5 hover:bg-black/10"
                        title="Чат с клиентом"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenChat(a.lead_id!);
                        }}
                      >
                        <MessageCircle className="h-3 w-3" />
                      </button>
                    ) : null}
                    {a.lead_id != null ? (
                      <button
                        type="button"
                        className="booking-appt-action rounded px-0.5 text-[8px] font-extrabold leading-none tracking-wide hover:bg-black/10"
                        title="Карточка в CRM"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAppointmentClick(a);
                        }}
                      >
                        CRM
                      </button>
                    ) : null}
                  </div>
                </div>
              </button>
            </div>
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
  slotClickSpecialistIds,
  onAppointmentClick,
  onSlotClick,
  onAddSpecialist,
  onEditSpecialist,
  onDeleteSpecialist,
  onReorderSpecialists,
  onMoveAppointment,
  showSessionInsteadOfTime,
  canEditNotes,
  onAppointmentNoteClick,
  onOpenChat,
  canToggleComplete,
  onAppointmentCompleteToggle,
}: Props) {
  const totalHours = GRID_END_HOUR - GRID_START_HOUR;
  const gridHeightPx = totalHours * PX_PER_HOUR;
  const [menuSpecId, setMenuSpecId] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 12 } }),
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
    bySpec,
    menuSpecId,
    setMenuSpecId,
    showSpecMenu,
    onEditSpecialist,
    onDeleteSpecialist,
    onAppointmentClick,
    onSlotClick,
    onMoveAppointment,
    dragEnabled,
    nowTopPct: nowLineTopPct(dateYmd, nowTick),
    slotClickSpecialistIds,
    showSessionInsteadOfTime,
    canEditNotes,
    onAppointmentNoteClick,
    onOpenChat,
    canToggleComplete,
    onAppointmentCompleteToggle,
  };

  if (specialists.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--mo-border-strong)]/50 bg-white/30 px-6 py-16 text-center lux-caption">
        <p>Добавьте специалистов кнопкой «+» справа от сетки или в разделе «Справочники».</p>
        {onAddSpecialist && (
          <button
            type="button"
            onClick={onAddSpecialist}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--mo-border)] bg-[var(--mo-accent-soft)] p-2 mo-muted transition-all duration-300 hover:bg-[var(--mo-accent-soft)]"
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

  const nowTopPct = nowLineTopPct(dateYmd, nowTick);
  const nowTopPx = nowTopPct != null ? SPEC_HEADER_PX + (nowTopPct / 100) * gridHeightPx : null;
  const nowLabel =
    nowTopPct != null
      ? new Date(nowTick).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: BOOKING_TIME_ZONE,
        })
      : "";

  return (
    <div className="relative overflow-x-auto rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)]">
      <div className="flex min-w-full">
        <div className="sticky left-0 z-30 flex w-[52px] shrink-0 flex-col border-r border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]/95 backdrop-blur-sm">
          <div
            className="flex shrink-0 items-center justify-end border-b border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]/95 px-0.5 py-1"
            style={{ minHeight: SPEC_HEADER_PX }}
          >
            {onAddSpecialist && (
              <button
                type="button"
                onClick={onAddSpecialist}
                className="rounded-full border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-1.5 mo-muted shadow-md transition-all duration-300 hover:bg-[var(--mo-accent-soft)] hover:text-[var(--mo-text)]"
                aria-label="Добавить специалиста"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="relative flex flex-col pr-1.5">
            {HOUR_LABELS.map((hour) => (
              <div key={hour} className="relative shrink-0" style={{ height: PX_PER_HOUR }}>
                <span className="absolute right-0 top-0 -translate-y-1/2 text-[10px] font-medium tabular-nums leading-none mo-muted">
                  {hour}:00
                </span>
              </div>
            ))}
            {nowTopPct != null && (
              <>
                <div
                  className="pointer-events-none absolute right-0 z-40 h-4 w-10 -translate-y-1/2 rounded-r-md bg-red-500/90 px-1 text-right text-[10px] font-semibold tabular-nums text-white shadow-md"
                  style={{ top: `${nowTopPx - SPEC_HEADER_PX}px` }}
                >
                  {nowLabel}
                </div>
                <div
                  className="pointer-events-none absolute inset-x-0 z-30 border-t-2 border-red-400/85 shadow-[0_0_8px_rgba(248,113,113,0.45)]"
                  style={{ top: `${nowTopPx - SPEC_HEADER_PX}px` }}
                />
              </>
            )}
          </div>
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

      </div>
    </div>
  );
}
