import { describe, expect, it } from "vitest";

import { financeTabFromPath } from "@/config/navByRole";

describe("financeTabFromPath", () => {
  it("maps subroutes", () => {
    expect(financeTabFromPath("/finance")).toBe("overview");
    expect(financeTabFromPath("/finance/accounting")).toBe("accounting");
    expect(financeTabFromPath("/finance/inventory")).toBe("overview");
    expect(financeTabFromPath("/finance/reports")).toBe("reports");
    expect(financeTabFromPath("/finance/accountant")).toBe("accountant");
    expect(financeTabFromPath("/finance/receivables")).toBe("receivables");
  });
});
