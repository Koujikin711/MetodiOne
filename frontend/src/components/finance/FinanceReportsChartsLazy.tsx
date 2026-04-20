import { lazy, Suspense } from "react";

import type { FinanceForecast, FinanceYearOverviewMonth } from "@/lib/types";

const LazyCharts = lazy(() =>
  import("./FinanceReportsCharts").then((m) => ({ default: m.FinanceReportsCharts })),
);

type Props = {
  yearRows: FinanceYearOverviewMonth[] | undefined;
  forecast: FinanceForecast | undefined;
  loadingYear: boolean;
  loadingForecast: boolean;
};

export function FinanceReportsChartsLazy(props: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Загрузка графиков…</p>}>
      <LazyCharts {...props} />
    </Suspense>
  );
}
