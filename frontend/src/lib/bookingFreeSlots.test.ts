import { describe, expect, it } from "vitest";

import { computeFreeStartMinutes, formatMinuteOfDayLabel } from "./bookingFreeSlots";
import type { BookingAppointment, BookingSpecialist } from "@/lib/types";

describe("bookingFreeSlots", () => {
  it("formats minute labels", () => {
    expect(formatMinuteOfDayLabel(0)).toBe("00:00");
    expect(formatMinuteOfDayLabel(9 * 60 + 30)).toBe("09:30");
  });

  it("returns :00 and :30 starts inside work hours", () => {
    const spec = {
      work_weekdays: [0, 1, 2, 3, 4],
      work_start_hour: 9,
      work_end_hour: 11,
    } as BookingSpecialist;
    // 2026-11-13 — пятница (weekdayMon0 = 4)
    const slots = computeFreeStartMinutes("2026-11-13", spec, [], 30, 0);
    expect(slots).toEqual([9 * 60, 9 * 60 + 30, 10 * 60, 10 * 60 + 30]);
  });

  it("ignores the moved appointment when counting busy hour", () => {
    const spec = {
      work_weekdays: [0, 1, 2, 3, 4],
      work_start_hour: 9,
      work_end_hour: 10,
    } as BookingSpecialist;
    const self = {
      id: 7,
      status: "booked",
      start_at: "2026-11-13T04:00:00.000Z", // 09:00 Asia/Dushanbe
    } as BookingAppointment;
    const slots = computeFreeStartMinutes("2026-11-13", spec, [self], 30, 7);
    expect(slots).toContain(9 * 60);
  });
});
