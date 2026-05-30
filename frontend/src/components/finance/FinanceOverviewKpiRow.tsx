import { useQuery } from "@tanstack/react-query";

import { StatTile } from "@/components/ui/StatTile";
import { apiFetch } from "@/lib/api";
import type { FinanceYearOverviewMonth } from "@/lib/types";

function sumField(rows: FinanceYearOverviewMonth[], key: "revenue_actual" | "expense_actual" | "net_actual") {
  return rows.reduce((acc, r) => {
    const n = Number(r[key]);
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
}

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "TJS",
  maximumFractionDigits: 0,
});

type Props = {
  year: number;
};

/** KPI-полоса на вкладке «Обзор» финансов. */
export function FinanceOverviewKpiRow({ year }: Props) {
  const q = useQuery({
    queryKey: ["finance-reports", "year-overview", year],
    queryFn: () => apiFetch<FinanceYearOverviewMonth[]>(`/api/finance/reports/year-overview?year=${year}`),
    staleTime: 60_000,
  });

  const rows = q.data ?? [];
  const revenue = sumField(rows, "revenue_actual");
  const expense = sumField(rows, "expense_actual");
  const net = sumField(rows, "net_actual");

  const fmt = (n: number) => (Number.isFinite(n) ? moneyFmt.format(n) : "—");

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatTile label={`Выручка ${year}`} value={q.isLoading ? "…" : fmt(revenue)} tone="sales" />
      <StatTile label={`Расходы ${year}`} value={q.isLoading ? "…" : fmt(expense)} tone="warning" />
      <StatTile label={`Чистый результат`} value={q.isLoading ? "…" : fmt(net)} tone="service" />
    </div>
  );
}
