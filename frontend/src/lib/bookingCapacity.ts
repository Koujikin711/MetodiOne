import { utcMsToHourMinuteInBookingTz } from "@/lib/bookingTz";

/** Сколько активных записей («Запись») можно поставить одному специалисту в один час. */
export const MAX_BOOKINGS_PER_SPECIALIST_HOUR = 4;

export function bookedCountInClockHour(
  appointments: ReadonlyArray<{ id?: number; status: string; start_at: string }>,
  hour: number,
  ignoreAppointmentId?: number,
): number {
  let count = 0;
  for (const appointment of appointments) {
    if (appointment.status !== "booked") continue;
    if (ignoreAppointmentId != null && appointment.id === ignoreAppointmentId) continue;
    const { h } = utcMsToHourMinuteInBookingTz(new Date(appointment.start_at).getTime());
    if (h === hour) count += 1;
  }
  return count;
}
