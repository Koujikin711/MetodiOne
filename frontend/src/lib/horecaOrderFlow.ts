export type HorecaOrderStage = "new" | "in_work" | "ready" | "closed";

export const HORECA_STAGE_META: Record<HorecaOrderStage, { title: string; hint: string }> = {
  new: { title: "Новые", hint: "Приняты и ждут начала" },
  in_work: { title: "В работе", hint: "Готовятся / обслуживаются" },
  ready: { title: "Готово", hint: "Ожидают выдачи/закрытия" },
  closed: { title: "Закрыты", hint: "Завершены за смену" },
};

/**
 * Унифицированная карта статусов booking -> стадия заказа HoReCa.
 * Держим в одном месте, чтобы UI заказов/столиков не расходился.
 */
export function bookingStatusToHorecaStage(status: string): HorecaOrderStage {
  const s = (status || "").toLowerCase();
  if (s === "booked") return "new";
  if (s === "arrived" || s === "in_service" || s === "confirmed") return "in_work";
  if (s === "ready" || s === "awaiting_payment") return "ready";
  return "closed";
}

