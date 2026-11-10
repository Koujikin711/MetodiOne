import { describe, expect, it } from "vitest";

import { analyticsServiceGroup, partitionAnalyticsServices } from "./analyticsServiceGroups";

describe("analyticsServiceGroup", () => {
  it("puts course-like, consultation and KPI into sales", () => {
    expect(analyticsServiceGroup({ direction_name: "Курс 15" })).toBe("sales");
    expect(analyticsServiceGroup({ direction_name: "Курс", money_source: "kpi" })).toBe("sales");
    expect(analyticsServiceGroup({ direction_name: "Протокол", money_source: "kpi" })).toBe("sales");
    expect(analyticsServiceGroup({ direction_name: "Консультация" })).toBe("sales");
    expect(analyticsServiceGroup({ direction_name: "Долг прошлых месяцев" })).toBe("sales");
  });

  it("puts analyses and ultrasound into extra", () => {
    expect(analyticsServiceGroup({ direction_name: "Анализы", money_source: "extra" })).toBe("extra");
    expect(analyticsServiceGroup({ direction_name: "УЗИ", money_source: "extra" })).toBe("extra");
  });

  it("puts clinic visits into clinic", () => {
    expect(analyticsServiceGroup({ direction_name: "Массаж" })).toBe("clinic");
    expect(analyticsServiceGroup({ direction_name: "ТМС" })).toBe("clinic");
    expect(analyticsServiceGroup({ direction_name: "ВЛОК" })).toBe("clinic");
    expect(analyticsServiceGroup({ direction_name: "Стол · Мебель", money_source: "extra" })).toBe(
      "clinic",
    );
  });

  it("partitions rows", () => {
    const g = partitionAnalyticsServices([
      { direction_name: "Курс 15" },
      { direction_name: "Массаж" },
      { direction_name: "УЗИ", money_source: "extra" },
    ]);
    expect(g.sales.map((r) => r.direction_name)).toEqual(["Курс 15"]);
    expect(g.clinic.map((r) => r.direction_name)).toEqual(["Массаж"]);
    expect(g.extra.map((r) => r.direction_name)).toEqual(["УЗИ"]);
  });
});
