import type { BookingAppointment } from "@/lib/types";

/** Подпись сеанса: поток 1:10 или обычный номер 3 */
export function visitDisplayValue(a: Pick<BookingAppointment, "visit_label" | "visit_number">): string | null {
  const label = (a.visit_label ?? "").trim();
  if (label) return label;
  if (a.visit_number != null && a.visit_number > 0) return String(a.visit_number);
  return null;
}

export function visitDisplayTitle(a: Pick<BookingAppointment, "visit_label" | "visit_number" | "visit_stream">): string {
  const v = visitDisplayValue(a);
  if (!v) return "Сеанс";
  if (a.visit_label?.includes(":")) return `Поток ${v}`;
  return `${v}-й сеанс`;
}
