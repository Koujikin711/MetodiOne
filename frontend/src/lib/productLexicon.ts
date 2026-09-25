/** Display labels for product kinds. Canonical keys stay English. */

export const PRODUCT_KIND_LABELS: Record<string, string> = {
  course_15: "Курс 15",
  main_course: "Курс",
  protocol: "Протокол",
  other_service: "Другая услуга",
  visit: "Визит",
  desk: "Desk",
  extra: "Доп. услуга",
};

/** main_course → «Курс»; otherwise catalog name or kind label. */
export function productDisplayLabel(
  kindOrKey: string | null | undefined,
  name?: string | null,
): string {
  const k = (kindOrKey || "").trim();
  const n = (name || "").trim();
  if (k === "main_course") return PRODUCT_KIND_LABELS.main_course;
  if (n) {
    if (k && PRODUCT_KIND_LABELS[k]) {
      const nl = n.toLowerCase();
      if (nl === k.toLowerCase() || nl === "основной курс" || nl === "main course") {
        return PRODUCT_KIND_LABELS[k];
      }
    }
    return n;
  }
  if (!k) return "—";
  return PRODUCT_KIND_LABELS[k] ?? k;
}
