import { describe, expect, it } from "vitest";

import {
  computeFreeStartMinutes,
  datetimeMinuteStepForSpecialist,
  formatMinuteOfDayLabel,
  suggestNextMinuteForDay,
  suggestNextMinuteInHour,
} from "./bookingFreeSlots";
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

  it("packs next start by exact end for short slots; half-hour for 30+", () => {
    const hour = 10 * 60;
    // Asia/Dushanbe UTC+5
    const a21 = {
      status: "booked",
      start_at: "2026-11-13T05:00:00.000Z",
      end_at: "2026-11-13T05:21:00.000Z",
    };
    const a15 = {
      status: "booked",
      start_at: "2026-11-13T05:21:00.000Z",
      end_at: "2026-11-13T05:36:00.000Z",
    };
    const a30 = {
      status: "booked",
      start_at: "2026-11-13T05:00:00.000Z",
      end_at: "2026-11-13T05:30:00.000Z",
    };
    expect(suggestNextMinuteInHour(hour, [], { slotDurationMin: 21 })).toBe(hour);
    expect(suggestNextMinuteInHour(hour, [a21], { slotDurationMin: 21 })).toBe(hour + 21);
    expect(suggestNextMinuteInHour(hour, [a21, a15], { slotDurationMin: 15 })).toBe(hour + 36);
    // 30 мин на :00 → оставшийся полчаса :30, без дырок :10/:20
    expect(suggestNextMinuteInHour(hour, [a30], { slotDurationMin: 30 })).toBe(hour + 30);
    expect(suggestNextMinuteInHour(hour, [a30, { ...a30, start_at: "2026-11-13T05:30:00.000Z", end_at: "2026-11-13T06:00:00.000Z" }], { slotDurationMin: 30 })).toBe(null);
  });

  it("suggests next minute for day after latest end (exact)", () => {
    const spec = { work_start_hour: 9, work_end_hour: 18 };
    const appt = {
      status: "booked",
      start_at: "2026-11-13T05:00:00.000Z",
      end_at: "2026-11-13T05:21:00.000Z",
    };
    expect(suggestNextMinuteForDay(spec, [appt])).toBe(10 * 60 + 21);
  });

  it("datetime step follows specialist slot", () => {
    expect(datetimeMinuteStepForSpecialist(10)).toBe(5);
    expect(datetimeMinuteStepForSpecialist(15)).toBe(5);
    expect(datetimeMinuteStepForSpecialist(30)).toBe(15);
    expect(datetimeMinuteStepForSpecialist(60)).toBe(30);
  });
});
