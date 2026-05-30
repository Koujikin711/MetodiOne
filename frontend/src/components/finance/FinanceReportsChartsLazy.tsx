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
    <Suspense fallback={<p className="text-sm lux-caption">Загрузка графиков…</p>}>
      <LazyCharts {...props} />
    </Suspense>
  );
}
