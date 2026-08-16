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

/**
 * Компактные счётчики как в Instagram: 999 → «999», 1100 → «1,1К», 15400 → «15,4К», 1_200_000 → «1,2М».
 */
export function formatCompactCount(value: string | number | null | undefined): string {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  if (n < 1000) return String(n);

  const trim = (x: number) => {
    const s = x.toFixed(1).replace(/\.0$/, "").replace(".", ",");
    return s;
  };

  if (n < 1_000_000) {
    return `${trim(n / 1000)}К`;
  }
  if (n < 1_000_000_000) {
    return `${trim(n / 1_000_000)}М`;
  }
  return `${trim(n / 1_000_000_000)}Млрд`;
}
