import {
  isConsultationDirectionName,
  isCourseLikeDirectionName,
} from "@/lib/bookingDirectionKinds";

export type AnalyticsServiceGroup = "sales" | "clinic" | "extra";

export const ANALYTICS_SERVICE_GROUP_ORDER: AnalyticsServiceGroup[] = ["sales", "clinic", "extra"];

export const ANALYTICS_SERVICE_GROUP_LABELS: Record<AnalyticsServiceGroup, string> = {
  sales: "Продажи",
  clinic: "Клиника",
  extra: "Доп. услуги",
};

export const ANALYTICS_SERVICE_GROUP_HINTS: Record<AnalyticsServiceGroup, string> = {
  sales: "Курс 15, Курс, Протокол и Консультация",
  clinic: "Визиты и процедуры клиники",
  extra: "Анализы и УЗИ",
};

/** Разбивка строк аналитики «По услугам» на продажи / клинику / доп. */
export function analyticsServiceGroup(row: {
  direction_name: string;
  money_source?: string | null;
}): AnalyticsServiceGroup {
  const name = (row.direction_name || "").trim();
  if (name === "Долг прошлых месяцев") return "sales";
  const src = (row.money_source || "").trim();
  if (src === "extra") {
    const k = name.toLocaleLowerCase("ru");
    // Стол менеджера — не анализы/УЗИ
    if (k.startsWith("стол") || k.includes("продажи стола")) return "clinic";
    return "extra";
  }
  if (
    src === "kpi" ||
    isCourseLikeDirectionName(name) ||
    isConsultationDirectionName(name)
  ) {
    return "sales";
  }
  return "clinic";
}

export function partitionAnalyticsServices<T extends { direction_name: string; money_source?: string | null }>(
  rows: T[],
): Record<AnalyticsServiceGroup, T[]> {
  const out: Record<AnalyticsServiceGroup, T[]> = { sales: [], clinic: [], extra: [] };
  for (const row of rows) {
    out[analyticsServiceGroup(row)].push(row);
  }
  return out;
}
