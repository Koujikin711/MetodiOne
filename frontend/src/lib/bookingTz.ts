/**
 * Часовой пояс онлайн-записи должен совпадать с backend (BOOKING_TIMEZONE).
 * Без этого datetime-local и сетка смотрят в TZ браузера → сдвиг на 1–3 ч.
 */
export const BOOKING_TIME_ZONE =
  (import.meta.env.VITE_BOOKING_TIMEZONE as string | undefined)?.trim() || "Asia/Dushanbe";

const tzPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BOOKING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const tzWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BOOKING_TIME_ZONE,
  weekday: "short",
});

function partsAtUtcMs(ms: number) {
  const parts = tzPartsFormatter.formatToParts(new Date(ms));
  const g = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value);
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour"), min: g("minute") };
}

/** Календарный день YYYY-MM-DD в TZ записи для момента времени (UTC ms). */
export function ymdInBookingTz(ms: number): string {
  const p = partsAtUtcMs(ms);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Пн=0 … Вс=6 — как на бэкенде (Python weekday). */
export function weekdayMon0InBookingTz(dateYmd: string): number {
  const ms = zonedWallTimeToUtcMs(dateYmd, 12, 0);
  const w = tzWeekdayFormatter.formatToParts(new Date(ms)).find((x) => x.type === "weekday")?.value;
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[w ?? "Mon"] ?? 0;
}

/**
 * UTC timestamp для «стеночных» часов dateYmd + hour:minute в TZ записи.
 */
export function zonedWallTimeToUtcMs(dateYmd: string, hour: number, minute: number): number {
  const [y, mo, d] = dateYmd.split("-").map(Number);
  let t = Date.UTC(y, mo - 1, d, hour, minute, 0, 0);
  for (let i = 0; i < 48; i++) {
    const p = partsAtUtcMs(t);
    const wantDay = y * 10_000 + mo * 100 + d;
    const gotDay = p.y * 10_000 + p.m * 100 + p.d;
    if (wantDay === gotDay) {
      const wantMin = hour * 60 + minute;
      const gotMin = p.h * 60 + p.min;
      if (wantMin === gotMin) return t;
      t += (wantMin - gotMin) * 60 * 1000;
      continue;
    }
    t += (wantDay > gotDay ? 1 : -1) * 24 * 60 * 60 * 1000;
  }
  return t;
}

export function utcMsToHourMinuteInBookingTz(ms: number): { h: number; min: number } {
  const p = partsAtUtcMs(ms);
  return { h: p.h, min: p.min };
}

export function formatTimeInBookingTz(iso: string): string {
  const { h, min } = utcMsToHourMinuteInBookingTz(new Date(iso).getTime());
  return `${h}:${String(min).padStart(2, "0")}`;
}

export function formatTimeRangeInBookingTz(isoStart: string, isoEnd: string): string {
  const a = utcMsToHourMinuteInBookingTz(new Date(isoStart).getTime());
  const b = utcMsToHourMinuteInBookingTz(new Date(isoEnd).getTime());
  const f = (x: { h: number; min: number }) => `${x.h}:${String(x.min).padStart(2, "0")}`;
  return `${f(a)} – ${f(b)}`;
}

/** Компактная подпись времени для карточки в календаре записи. */
export function formatAppointmentTimeOnCard(isoStart: string, isoEnd: string, compact: boolean): string {
  const start = formatTimeInBookingTz(isoStart);
  if (compact) return start;
  const end = formatTimeInBookingTz(isoEnd);
  return start === end ? start : `${start}–${end}`;
}

/** datetime-local «YYYY-MM-DDTHH:mm» трактуем как время в TZ записи → ISO UTC для API. */
export function datetimeLocalBookingToIsoUtc(datetimeLocal: string): string {
  const m = datetimeLocal.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error("Неверный формат даты и времени");
  const ms = zonedWallTimeToUtcMs(m[1], Number(m[2]), Number(m[3]));
  return new Date(ms).toISOString();
}

function isGregorianLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Число дней в календарном месяце 1–12 (григорианский). */
function daysInGregorianMonth(year: number, month1to12: number): number {
  if (month1to12 === 2) return isGregorianLeapYear(year) ? 29 : 28;
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month1to12 - 1];
}

/**
 * Сдвиг календарной даты в TZ записи на deltaMonths месяцев; локальное время (час:минута) сохраняется.
 * Используется для «переноса на следующий месяц» в онлайн-записи.
 */
export function addCalendarMonthsInBookingTz(isoUtc: string, deltaMonths: number): string {
  const ms0 = new Date(isoUtc).getTime();
  const p0 = partsAtUtcMs(ms0);
  let y = p0.y;
  let m = p0.m + deltaMonths;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  const dim = daysInGregorianMonth(y, m);
  const d = Math.min(p0.d, dim);
  const dateYmd = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const ms1 = zonedWallTimeToUtcMs(dateYmd, p0.h, p0.min);
  return new Date(ms1).toISOString();
}
