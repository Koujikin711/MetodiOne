import { describe, expect, it } from "vitest";

import { maskDateDraft } from "./DateField";
import { maskDateTimeDraft } from "./DateTimeField";

function typeDigits(digits: string): string {
  let text = "";
  for (const ch of digits) {
    const raw = text + ch;
    text = maskDateDraft(raw, text, raw.length).text;
  }
  return text;
}

describe("maskDateDraft", () => {
  it("ставит точки после дня и месяца", () => {
    expect(typeDigits("2")).toBe("2");
    expect(typeDigits("29")).toBe("29.");
    expect(typeDigits("290")).toBe("29.0");
    expect(typeDigits("2909")).toBe("29.09.");
    expect(typeDigits("29092026")).toBe("29.09.2026");
  });

  it("стирание точки убирает цифру перед ней", () => {
    const next = maskDateDraft("29", "29.", 2);
    expect(next.text).toBe("2");
    expect(next.caret).toBe(1);
  });

  it("стирание последней цифры не возвращает точку", () => {
    const next = maskDateDraft("29.0", "29.09", 4);
    expect(next.text).toBe("29.0");
  });
});

function typeDateTime(digits: string): string {
  let text = "";
  for (const ch of digits) {
    const raw = text + ch;
    text = maskDateTimeDraft(raw, text, raw.length).text;
  }
  return text;
}

describe("maskDateTimeDraft", () => {
  it("ставит точки, запятую и двоеточие", () => {
    expect(typeDateTime("29")).toBe("29.");
    expect(typeDateTime("2909")).toBe("29.09.");
    expect(typeDateTime("29092026")).toBe("29.09.2026, ");
    expect(typeDateTime("2909202614")).toBe("29.09.2026, 14:");
    expect(typeDateTime("290920261430")).toBe("29.09.2026, 14:30");
  });
});
