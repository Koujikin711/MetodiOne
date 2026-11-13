import {
  bookedCountInClockHour,
  MAX_BOOKINGS_PER_SPECIALIST_HOUR,
} from "@/lib/bookingCapacity";
import { utcMsToHourMinuteInBookingTz, weekdayMon0InBookingTz } from "@/lib/bookingTz";
import type { BookingAppointment, BookingSpecialist } from "@/lib/types";

const DEFAULT_SLOT_STEP_MIN = 30;

function appointmentStartMinute(a: { start_at: string }): number {
  const { h, min } = utcMsToHourMinuteInBookingTz(new Date(a.start_at).getTime());
  return h * 60 + min;
}

function appointmentEndMinute(a: { start_at: string; end_at: string }): number {
  const { h, min } = utcMsToHourMinuteInBookingTz(new Date(a.end_at).getTime());
  return h * 60 + min;
}

/** Минута суток пересекается с активной записью [start, end). */
export function isMinuteCoveredByAppointments(
  minuteOfDay: number,
  appointments: ReadonlyArray<{ status: string; start_at: string; end_at: string }>,
): boolean {
  for (const a of appointments) {
    if (a.status === "cancelled") continue;
    const start = appointmentStartMinute(a);
    const end = appointmentEndMinute(a);
    if (minuteOfDay >= start && minuteOfDay < end) return true;
  }
  return false;
}

/**
 * Следующий старт внутри часа — сразу после конца стоящих записей (их end_at).
 * Учитывает любые длительности: 10 / 15 / 21 / 30 / 60 / 90 / 120 мин.
 * Пример: 10:00(21мин) → следующий 10:21; 10:00(30)+10:30(30) → час занят → null.
 * Не возвращает минуту внутри уже занятого интервала.
 */
export function suggestNextMinuteInHour(
  hourStart: number,
  appointments: ReadonlyArray<{ status: string; start_at: string; end_at: string }>,
  opts?: { slotDurationMin?: number | null },
): number | null {
  const hourEnd = hourStart + 60;
  const blocks = appointments
    .filter((a) => a.status !== "cancelled")
    .map((a) => ({ start: appointmentStartMinute(a), end: appointmentEndMinute(a) }))
    .filter((b) => b.start < hourEnd && b.end > hourStart)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let cursor = hourStart;
  for (const b of blocks) {
    const bStart = Math.max(b.start, hourStart);
    if (bStart > cursor) break;
    cursor = Math.max(cursor, Math.min(b.end, hourEnd));
  }
  if (cursor >= hourEnd) return null;
  if (isMinuteCoveredByAppointments(cursor, appointments)) return null;

  // Полчаса и час: не дробить на 10+10 — следующий свободный получас (:00/:30).
  const slot = Math.max(10, Number(opts?.slotDurationMin) || 30);
  if (slot >= 30) {
    const half = Math.ceil(cursor / 30) * 30;
    if (half >= hourEnd) return null;
    if (isMinuteCoveredByAppointments(half, appointments)) return null;
    return half;
  }
  return cursor;
}

/** Следующий старт за день — сразу после самой поздней записи (без округления до 10/30). */
export function suggestNextMinuteForDay(
  specialist: Pick<BookingSpecialist, "work_start_hour" | "work_end_hour" | "slot_duration_min">,
  appointments: ReadonlyArray<{ status: string; start_at: string; end_at: string }>,
): number {
  const startMin = (specialist.work_start_hour ?? 9) * 60;
  const endMin = (specialist.work_end_hour ?? 18) * 60;
  const active = appointments.filter((a) => a.status !== "cancelled");
  if (active.length === 0) return startMin;

  let latestEnd = startMin;
  for (const a of active) {
    const endMinute = appointmentEndMinute(a);
    if (endMinute > latestEnd) latestEnd = endMinute;
  }
  if (latestEnd >= endMin) return startMin;
  return latestEnd;
}

/** Шаг минут в форме: от слота специалиста (10→5, 15→5, 30→15, 60→30). */
export function datetimeMinuteStepForSpecialist(
  slotDurationMin: number | null | undefined,
): 5 | 10 | 15 | 30 {
  const n = Math.max(10, Number(slotDurationMin) || 30);
  if (n <= 10) return 5;
  if (n <= 15) return 5;
  if (n <= 30) return 15;
  return 30;
}

/** Свободные минуты суток для старта записи у специалиста. */
export function computeFreeStartMinutes(
  dateYmd: string,
  specialist: BookingSpecialist,
  appointments: BookingAppointment[],
  durationMin: number,
  ignoreAppointmentId: number,
  slotStepMin: number = DEFAULT_SLOT_STEP_MIN,
): number[] {
  const weekdays = specialist.work_weekdays?.length ? specialist.work_weekdays : [0, 1, 2, 3, 4];
  if (!weekdays.includes(weekdayMon0InBookingTz(dateYmd))) return [];
  const workStartMin = (specialist.work_start_hour ?? 9) * 60;
  const workEndMin = (specialist.work_end_hour ?? 18) * 60;
  const step = Math.max(10, slotStepMin);
  const busy = appointments.filter((a) => a.status === "booked" && a.id !== ignoreAppointmentId);
  const out: number[] = [];
  for (let m = workStartMin; m + durationMin <= workEndMin; m += step) {
    const inHour = bookedCountInClockHour(busy, Math.floor(m / 60));
    if (inHour < MAX_BOOKINGS_PER_SPECIALIST_HOUR) out.push(m);
  }
  return out;
}

export function formatMinuteOfDayLabel(minuteOfDay: number): string {
  const hh = Math.floor(minuteOfDay / 60);
  const mm = minuteOfDay % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
