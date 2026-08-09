/** Единая валюта продукта — сомони (TJS). */
export const APP_CURRENCY = "TJS" as const;

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: APP_CURRENCY,
  maximumFractionDigits: 2,
});

const moneyFmtInt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: APP_CURRENCY,
  maximumFractionDigits: 0,
});

export function formatMoney(
  value: string | number | null | undefined,
  opts?: { digits?: number; empty?: string },
): string {
  if (value === null || value === undefined || value === "") {
    return opts?.empty ?? "—";
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return opts?.empty ?? "—";
  if (opts?.digits === 0) return moneyFmtInt.format(n);
  return moneyFmt.format(n);
}
