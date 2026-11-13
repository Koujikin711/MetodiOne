import {
  bookedCountInClockHour,
  MAX_BOOKINGS_PER_SPECIALIST_HOUR,
} from "@/lib/bookingCapacity";
import { weekdayMon0InBookingTz } from "@/lib/bookingTz";
import type { BookingAppointment, BookingSpecialist } from "@/lib/types";

const DEFAULT_SLOT_STEP_MIN = 30;

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
