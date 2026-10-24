import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoney } from "@/lib/money";

/** Пример оформления. Цифры не из базы — только чтобы увидеть форму графика. */
const SAMPLE_REVENUE = [128_000, 141_500, 136_200, 168_400, 184_750, 205_000];
const SAMPLE_PLAN = [31.2, 34.8, 32.4, 39.1, 43.6, 39.6];

const SERVICES: { key: string; name: string; color: string; values: number[]; counts: number[] }[] = [
  { key: "osteo", name: "Остеопат", color: "#2563EB", values: [42_000, 46_500, 44_200, 52_800, 58_400, 54_200], counts: [28, 31, 29, 34, 38, 36] },
  { key: "tms", name: "ТМС", color: "#16A34A", values: [18_400, 21_200, 19_800, 26_500, 29_100, 33_600], counts: [12, 14, 13, 17, 19, 22] },
  { key: "massage", name: "Массаж", color: "#EA580C", values: [24_600, 26_100, 23_400, 29_800, 32_200, 35_400], counts: [22, 24, 20, 26, 28, 31] },
  { key: "course", name: "Курс", color: "#9333EA", values: [16_200, 19_400, 18_100, 22_600, 25_800, 31_200], counts: [8, 10, 9, 11, 13, 16] },
  { key: "course15", name: "Курс 15", color: "#0891B2", values: [14_800, 15_600, 16_900, 18_200, 20_400, 24_800], counts: [6, 6, 7, 8, 9, 11] },
  { key: "protocol", name: "Протокол", color: "#DB2777", values: [12_000, 12_700, 13_800, 18_500, 18_850, 25_800], counts: [5, 5, 6, 8, 8, 11] },
];

const SAMPLE_SALES = SERVICES[0].counts.map((_, i) => SERVICES.reduce((sum, s) => sum + (s.counts[i] ?? 0), 0));

const SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

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

function monthWindow(yearMonth: string): { label: string }[] {
  const [ys, ms] = yearMonth.split("-");
  const y0 = Number(ys);
  const m0 = Number(ms);
  const points: { y: number; m: number }[] = [];
  for (let back = 5; back >= 0; back -= 1) {
    let m = m0 - back;
    let y = y0;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    points.push({ y, m });
  }
  const mixedYear = new Set(points.map((p) => p.y)).size > 1;
  return points.map((p) => ({
    label: mixedYear ? `${SHORT[p.m - 1]} ${String(p.y).slice(2)}` : SHORT[p.m - 1],
  }));
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

function pieces(n: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(n)} шт.`;
}

export function CompanyMonthCompare({ yearMonth }: { yearMonth: string }) {
  const theme = useChartTheme();
  const axis = { fill: theme.tick, fontSize: 11 };
  const months = useMemo(() => monthWindow(yearMonth), [yearMonth]);

  const bars = useMemo(
    () =>
      months.map((m, i) => ({
        label: m.label,
        revenue: SAMPLE_REVENUE[i] ?? 0,
        plan: SAMPLE_PLAN[i] ?? 0,
        sales: SAMPLE_SALES[i] ?? 0,
        current: i === months.length - 1,
      })),
    [months],
  );

  const lines = useMemo(
    () =>
      months.map((m, i) => {
        const row: Record<string, string | number> = { label: m.label };
        for (const s of SERVICES) row[s.key] = s.values[i] ?? 0;
        return row;
      }),
    [months],
  );

  const countLines = useMemo(
    () =>
      months.map((m, i) => {
        const row: Record<string, string | number> = { label: m.label };
        for (const s of SERVICES) row[s.key] = s.counts[i] ?? 0;
        return row;
      }),
    [months],
  );

  const [view, setView] = useState<"money" | "count">("money");
  const byCount = view === "count";
  const salesMax = Math.max(1, ...bars.map((row) => row.sales));
  const last = bars.length - 1;
  const prev = last - 1;
  const serviceRows = byCount ? countLines : lines;

  return (
    <section className="mo-section print-screen-only space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-[var(--mo-text)]">Сравнение с прошлыми месяцами</h3>
          <p className="mt-1 text-xs mo-muted">
            Шесть месяцев до выбранного. Переключатель меняет сводку, услуги и таблицу.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-200">
            пример оформления
          </span>
        </div>
      </div>
      <p className="text-xs text-amber-100/80">
        Цифры на графике выдуманные. В локальной базе нет оплат за прошлые месяцы, поэтому так
        показана форма. На сайте сюда встанут ваши месяцы.
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        {byCount ? null : (
        <section className="mo-chart-card">
          <header className="mo-chart-card__head">
            <h3>Выручка и план</h3>
            <p>
              {bars[last] && bars[prev]
                ? `${bars[last].label} к ${bars[prev].label}: выручка ${pctDelta(bars[last].revenue, bars[prev].revenue)}, план ${bars[last].plan}%`
                : "—"}
            </p>
          </header>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={theme.grid} vertical={false} />
                <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
                <YAxis
                  yAxisId="money"
                  tick={axis}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  tickFormatter={thousands}
                />
                <YAxis
                  yAxisId="plan"
                  orientation="right"
                  domain={[0, 100]}
                  tick={axis}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  content={
                    <ChartTip
                      formatValue={(key, value) =>
                        key === "plan" ? `${value}%` : formatMoney(value, { digits: 0 })
                      }
                    />
                  }
                />
                <Bar yAxisId="money" dataKey="revenue" name="Выручка" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={28}>
                  {bars.map((row) => (
                    <Cell key={row.label} fill={row.current ? "#34d399" : "#3b82f6"} />
                  ))}
                </Bar>
                <Line
                  yAxisId="plan"
                  type="monotone"
                  dataKey="plan"
                  name="План %"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#fbbf24" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
        )}

        {byCount ? (
        <section className="mo-chart-card">
          <header className="mo-chart-card__head">
            <h3>Количество продаж</h3>
            <p>
              {bars[last] && bars[prev]
                ? `${bars[last].label}: ${pieces(bars[last].sales)}, к ${bars[prev].label} ${pctDelta(bars[last].sales, bars[prev].sales)}. Выбранный месяц зелёным.`
                : "Сколько продаж за месяц. Выбранный месяц зелёным."}
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
                <Bar dataKey="sales" name="Продажи" fill="#3b82f6" radius={[8, 8, 0, 0]} maxBarSize={36}>
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
        ) : null}

        <section className="mo-chart-card">
          <header className="mo-chart-card__head">
            <h3>Услуги по месяцам</h3>
            <p>{byCount ? "Сколько продаж у каждой услуги." : "Оплаты визитов по услуге."} Выбранный месяц — справа.</p>
          </header>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serviceRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                {SERVICES.map((s) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="overflow-x-auto">
        <table className="kpi-data-table w-full text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-3">Услуга</th>
              {months.map((m, i) => (
                <th key={m.label} className={`py-2 pr-3 ${i === last ? "text-emerald-300" : ""}`}>
                  {m.label}
                </th>
              ))}
              <th className="py-2 pr-3">К прошлому</th>
            </tr>
          </thead>
          <tbody>
            {SERVICES.map((s) => {
              const series = byCount ? s.counts : s.values;
              return (
                <tr key={s.key}>
                  <td className="py-2 pr-3 font-medium">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.name}
                  </td>
                  {series.map((v, i) => (
                    <td key={months[i]?.label ?? i} className="py-2 pr-3 tabular-nums">
                      {byCount ? v : shortMoney(v)}
                    </td>
                  ))}
                  <td className="py-2 pr-3 tabular-nums">{pctDelta(series[last] ?? 0, series[prev] ?? 0)}</td>
                </tr>
              );
            })}
            <tr className="kpi-matrix-row-highlight">
              <td className="py-2 pr-3 font-semibold">{byCount ? "Всего продаж" : "Выручка визитов"}</td>
              {(byCount ? SAMPLE_SALES : SAMPLE_REVENUE).map((v, i) => (
                <td key={months[i]?.label ?? i} className="py-2 pr-3 font-semibold tabular-nums">
                  {byCount ? v : shortMoney(v)}
                </td>
              ))}
              <td className="py-2 pr-3 font-semibold tabular-nums">
                {pctDelta(
                  (byCount ? SAMPLE_SALES : SAMPLE_REVENUE)[last] ?? 0,
                  (byCount ? SAMPLE_SALES : SAMPLE_REVENUE)[prev] ?? 0,
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
