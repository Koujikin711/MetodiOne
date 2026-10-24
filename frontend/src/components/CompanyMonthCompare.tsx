import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";

const PALETTE = ["#2563EB", "#16A34A", "#EA580C", "#9333EA", "#0891B2", "#DB2777", "#CA8A04", "#64748B"];

type ServiceRow = { name: string; revenue: number[]; sales: number[] };
type MonthCompare = {
  year_month: string;
  labels: string[];
  revenue: number[];
  sales: number[];
  services: ServiceRow[];
};

type ChartTheme = { tick: string; grid: string };

function useChartTheme(): ChartTheme {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark",
  );
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.dataset.theme === "dark");
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return dark
    ? { tick: "#cbd5e1", grid: "rgba(148,163,184,0.16)" }
    : { tick: "#334155", grid: "rgba(15,23,42,0.08)" };
}

function pctDelta(current: number, previous: number): string {
  if (previous <= 0) return "—";
  const p = ((current - previous) / previous) * 100;
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(0)}%`;
}

function thousands(v: number): string {
  return `${Math.round(v / 1000)}к`;
}

const compactMoney = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

function shortMoney(v: number): string {
  return compactMoney.format(v);
}

function pieces(n: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(n)} шт.`;
}

type TipRow = { name?: string; value?: number | string; color?: string; dataKey?: string };

function ChartTip({
  active,
  payload,
  label,
  formatValue,
}: {
  active?: boolean;
  payload?: TipRow[];
  label?: string;
  formatValue: (key: string, value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="mo-chart-tip">
      {label ? <div className="mo-chart-tip__title">{label}</div> : null}
      {payload.map((row, i) => {
        const key = String(row.dataKey || i);
        const raw = Number(row.value ?? 0);
        return (
          <div key={key} className="mo-chart-tip__row">
            <span className="mo-chart-tip__dot" style={{ background: row.color || "var(--mo-accent)" }} />
            <span className="min-w-0 truncate">{row.name || key}</span>
            <span className="ml-auto tabular-nums font-semibold">{formatValue(key, raw)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function CompanyMonthCompare({
  pipelineId,
  yearMonth,
}: {
  pipelineId: number;
  yearMonth: string;
}) {
  const theme = useChartTheme();
  const axis = { fill: theme.tick, fontSize: 11 };
  const [view, setView] = useState<"money" | "count">("money");
  const byCount = view === "count";

  const query = useQuery({
    queryKey: ["sales-kpi-month-compare", pipelineId, yearMonth],
    queryFn: () =>
      apiFetch<MonthCompare>(
        `/api/sales-kpi/company-month-compare?pipeline_id=${pipelineId}&year_month=${encodeURIComponent(yearMonth)}`,
      ),
    enabled: pipelineId > 0 && Boolean(yearMonth),
  });

  const data = query.data;
  const months = data?.labels ?? [];
  const services = data?.services ?? [];
  const bars = useMemo(
    () =>
      months.map((label, i) => ({
        label,
        revenue: Number(data?.revenue[i] ?? 0),
        sales: Number(data?.sales[i] ?? 0),
        current: i === months.length - 1,
      })),
    [data, months],
  );
  const lines = useMemo(
    () =>
      months.map((label, i) => {
        const row: Record<string, string | number> = { label };
        services.forEach((service, idx) => {
          row[`s${idx}`] = byCount ? Number(service.sales[i] ?? 0) : Number(service.revenue[i] ?? 0);
        });
        return row;
      }),
    [byCount, months, services],
  );

  const last = Math.max(bars.length - 1, 0);
  const prev = last - 1;
  const salesMax = Math.max(1, ...bars.map((row) => row.sales));

  return (
    <section className="mo-section print-screen-only space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-[var(--mo-text)]">Сравнение с прошлыми месяцами</h3>
          <p className="mt-1 text-xs mo-muted">
            Шесть месяцев до выбранного. Выручка — оплаты визитов по дате сдачи денег, как в карточке выше.
            Количество — записи месяца без отмен.
          </p>
        </div>
        <div className="inline-flex rounded-full border border-[var(--mo-border)] p-0.5" role="tablist" aria-label="Что показать">
          <button
            type="button"
            role="tab"
            aria-selected={!byCount}
            onClick={() => setView("money")}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${byCount ? "mo-muted" : "bg-[#3b82f6] text-white"}`}
          >
            Суммы
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={byCount}
            onClick={() => setView("count")}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${byCount ? "bg-[#3b82f6] text-white" : "mo-muted"}`}
          >
            Количество
          </button>
        </div>
      </div>

      {query.isLoading ? <p className="text-xs mo-muted">Считаем шесть месяцев…</p> : null}
      {query.isError ? <p className="text-xs text-red-300">Не удалось собрать сравнение месяцев.</p> : null}

      {data ? (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {byCount ? (
              <section className="mo-chart-card">
                <header className="mo-chart-card__head">
                  <h3>Количество записей</h3>
                  <p>
                    {bars[last] && bars[prev]
                      ? `${bars[last].label}: ${pieces(bars[last].sales)}, к ${bars[prev].label} ${pctDelta(bars[last].sales, bars[prev].sales)}. Выбранный месяц зелёным.`
                      : "Записи месяца без отмен. Выбранный месяц зелёным."}
                  </p>
                </header>
                <div style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={bars} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={theme.grid} vertical={false} />
                      <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
                      <YAxis
                        domain={[0, Math.ceil(salesMax * 1.22)]}
                        allowDecimals={false}
                        tick={axis}
                        axisLine={false}
                        tickLine={false}
                        width={36}
                      />
                      <Tooltip content={<ChartTip formatValue={(_key, value) => pieces(value)} />} />
                      <Bar dataKey="sales" name="Записи" fill="#3b82f6" radius={[8, 8, 0, 0]} maxBarSize={36}>
                        <LabelList
                          dataKey="sales"
                          position="top"
                          style={{ fill: theme.tick, fontSize: 11, fontWeight: 650 }}
                        />
                        {bars.map((row) => (
                          <Cell key={row.label} fill={row.current ? "#34d399" : "#3b82f6"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            ) : (
              <section className="mo-chart-card">
                <header className="mo-chart-card__head">
                  <h3>Выручка визитов</h3>
                  <p>
                    {bars[last] && bars[prev]
                      ? `${bars[last].label} к ${bars[prev].label}: ${pctDelta(bars[last].revenue, bars[prev].revenue)}`
                      : "Оплаты визитов по дате сдачи денег."}
                  </p>
                </header>
                <div style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={theme.grid} vertical={false} />
                      <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
                      <YAxis tick={axis} axisLine={false} tickLine={false} width={52} tickFormatter={thousands} />
                      <Tooltip content={<ChartTip formatValue={(_key, value) => formatMoney(value, { digits: 0 })} />} />
                      <Bar dataKey="revenue" name="Выручка" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={28}>
                        {bars.map((row) => (
                          <Cell key={row.label} fill={row.current ? "#34d399" : "#3b82f6"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            <section className="mo-chart-card">
              <header className="mo-chart-card__head">
                <h3>Услуги по месяцам</h3>
                <p>
                  {byCount ? "Сколько записей у каждой услуги." : "Оплаты визитов по услуге."} Выбранный месяц — справа.
                </p>
              </header>
              <div style={{ height: 280 }}>
                {services.length === 0 ? (
                  <p className="mo-chart-empty">За эти месяцы записей нет.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={lines} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={theme.grid} vertical={false} />
                      <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
                      <YAxis
                        allowDecimals={!byCount}
                        tick={axis}
                        axisLine={false}
                        tickLine={false}
                        width={byCount ? 36 : 52}
                        tickFormatter={byCount ? undefined : thousands}
                      />
                      <Tooltip
                        content={
                          <ChartTip
                            formatValue={(_key, value) => (byCount ? pieces(value) : formatMoney(value, { digits: 0 }))}
                          />
                        }
                      />
                      {services.map((service, idx) => (
                        <Line
                          key={service.name}
                          type="monotone"
                          dataKey={`s${idx}`}
                          name={service.name}
                          stroke={PALETTE[idx % PALETTE.length]}
                          strokeWidth={2}
                          dot={{ r: 2.5 }}
                        />
                      ))}
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>
          </div>

          <div className="overflow-x-auto">
            <table className="kpi-data-table w-full text-sm">
              <thead>
                <tr>
                  <th className="py-2 pr-3">{byCount ? "Записи, шт." : "Услуга"}</th>
                  {months.map((label, i) => (
                    <th key={label} className={`py-2 pr-3 ${i === last ? "text-emerald-300" : ""}`}>
                      {label}
                    </th>
                  ))}
                  <th className="py-2 pr-3">К прошлому</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service, idx) => {
                  const series = byCount ? service.sales : service.revenue;
                  return (
                    <tr key={service.name}>
                      <td className="py-2 pr-3 font-medium">
                        <span
                          className="mr-2 inline-block h-2 w-2 rounded-full"
                          style={{ background: PALETTE[idx % PALETTE.length] }}
                        />
                        {service.name}
                      </td>
                      {series.map((value, i) => (
                        <td key={months[i] ?? i} className="py-2 pr-3 tabular-nums">
                          {byCount ? value : shortMoney(Number(value))}
                        </td>
                      ))}
                      <td className="py-2 pr-3 tabular-nums">
                        {pctDelta(Number(series[last] ?? 0), Number(series[prev] ?? 0))}
                      </td>
                    </tr>
                  );
                })}
                <tr className="kpi-matrix-row-highlight">
                  <td className="py-2 pr-3 font-semibold">{byCount ? "Всего записей" : "Выручка визитов"}</td>
                  {(byCount ? data.sales : data.revenue).map((value, i) => (
                    <td key={months[i] ?? i} className="py-2 pr-3 font-semibold tabular-nums">
                      {byCount ? value : shortMoney(Number(value))}
                    </td>
                  ))}
                  <td className="py-2 pr-3 font-semibold tabular-nums">
                    {pctDelta(
                      Number((byCount ? data.sales : data.revenue)[last] ?? 0),
                      Number((byCount ? data.sales : data.revenue)[prev] ?? 0),
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
