import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { HorecaCapacityForecastRead } from "@/lib/types";

export function HorecaForecastPage() {
  const forecastQuery = useQuery({
    queryKey: ["horeca-capacity-forecast"],
    queryFn: () => apiFetch<HorecaCapacityForecastRead>("/api/horeca/forecast/capacity"),
    refetchInterval: 60_000,
  });
  const d = forecastQuery.data;
  return (
    <div className="mx-auto max-w-[1100px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / Прогнозирование</p>
        <h1 className="lux-heading-page">Максимальная производительная сила</h1>
      </header>

      {forecastQuery.isLoading ? <p className="text-sm lux-caption">Считаем прогноз…</p> : null}
      {forecastQuery.isError ? <p className="text-sm text-[#6b1d2f]">{(forecastQuery.error as Error).message}</p> : null}

      {d ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-2xl mo-section p-4">
            <p className="text-xs lux-caption">Столиков</p>
            <p className="mt-2 lux-heading-page">{d.tables_count}</p>
          </article>
          <article className="rounded-2xl mo-section p-4">
            <p className="text-xs lux-caption">HoReCa-сотрудников</p>
            <p className="mt-2 lux-heading-page">{d.staff_horeca_count}</p>
          </article>
          <article className="rounded-2xl mo-section p-4">
            <p className="text-xs lux-caption">Обороты стола за 4ч</p>
            <p className="mt-2 lux-heading-page">{d.turns_per_table_per_4h}</p>
          </article>
          <article className="rounded-2xl border border-emerald-500/40 bg-emerald-950/20 p-4">
            <p className="text-xs text-emerald-200/90">Макс. посадок за 4ч</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-200">{d.estimated_max_covers_4h}</p>
          </article>
        </section>
      ) : null}

      {d ? (
        <section className="rounded-2xl mo-section p-4 text-sm mo-muted">
          <p>Средний визит: {d.avg_visit_minutes} мин</p>
          <p className="mt-2">{d.notes}</p>
        </section>
      ) : null}
    </div>
  );
}
