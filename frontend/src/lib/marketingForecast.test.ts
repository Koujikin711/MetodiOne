import { describe, expect, it } from "vitest";

import { readAds } from "@/lib/marketingForecast";

function days(from: string, count: number, spend: number, leads: number) {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    return { date: iso, spend, leads };
  });
}

describe("readAds", () => {
  it("marks a cheaper campaign to keep and a dearer one to stop", () => {
    const early = days("2026-10-01", 7, 10, 20);
    const late = days("2026-10-08", 7, 10, 10);
    const reading = readAds({
      daily: [...early, ...late],
      accountSpend: 140,
      accountLeads: 210,
      periodEnd: "2026-10-25",
      campaigns: [
        { name: "Дешёвая", spend: 50, leads: 100 },
        { name: "Дорогая", spend: 40, leads: 10 },
        { name: "Пустая", spend: 0, leads: 0 },
        { name: "Средняя", spend: 30, leads: 30 },
      ],
    });

    expect(reading.alert).toBe(true);
    expect(reading.warningTitle).toBe("Предупреждение по рекламе");
    expect(reading.warningLines.join(" ")).toContain("Темп лидов упал");
    expect(reading.warningLines.join(" ")).toContain("«Дорогая»: не увеличивать бюджет");
    expect(reading.warningLines.join(" ")).not.toContain("Дешёвая");
    expect(reading.paceNote).toContain("Темп ниже");
    expect(reading.paceNote).toContain("лид стал дороже");
    expect(reading.forecastNote).toContain("к 31 октября");
    expect(reading.projectedSpend).toBeCloseTo(140 + 10 * 6, 5);
    expect(reading.projectedLeads).toBeCloseTo(210 + 10 * 6, 5);
    expect(reading.actions.map((row) => [row.name, row.tone])).toEqual([
      ["Дорогая", "stop"],
      ["Средняя", "hold"],
      ["Дешёвая", "keep"],
    ]);
  });

  it("does not invent a pace split from three days", () => {
    const reading = readAds({
      daily: days("2026-10-23", 3, 5, 4),
      accountSpend: 15,
      accountLeads: 12,
      periodEnd: "2026-10-31",
      campaigns: [],
    });
    expect(reading.alert).toBe(false);
    expect(reading.warningLines[0]).toContain("бюджет менять не нужно");
    expect(reading.paceNote).toContain("Дней мало");
    expect(reading.forecastNote).toContain("Период закрыт");
    expect(reading.projectedSpend).toBeCloseTo(5 * 7, 5);
  });
});
