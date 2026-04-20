import { describe, expect, it } from "vitest";

import { previousPeriodRange } from "./financePeriod";

describe("previousPeriodRange", () => {
  it("maps single day to previous calendar day", () => {
    const p = previousPeriodRange("2026-01-10", "2026-01-10");
    expect(p).not.toBeNull();
    expect(p!.from).toBe("2026-01-09");
    expect(p!.to).toBe("2026-01-09");
  });

  it("returns null for invalid order", () => {
    expect(previousPeriodRange("2026-03-10", "2026-03-01")).toBeNull();
  });
});
