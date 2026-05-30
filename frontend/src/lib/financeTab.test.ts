import { describe, expect, it } from "vitest";

import { financeTabFromPath } from "@/config/navByRole";

describe("financeTabFromPath", () => {
  it("maps subroutes", () => {
    expect(financeTabFromPath("/finance")).toBe("overview");
    expect(financeTabFromPath("/finance/accounting")).toBe("accounting");
    expect(financeTabFromPath("/finance/inventory")).toBe("inventory");
    expect(financeTabFromPath("/finance/reports")).toBe("reports");
  });
});
