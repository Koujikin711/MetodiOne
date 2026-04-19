import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { FinanceForecast, FinanceYearOverviewMonth } from "@/lib/types";

const grid = { stroke: "#334155", strokeOpacity: 0.45 };
const tick = { fill: "#94a3b8", fontSize: 11 };
const tooltipStyle = {
  backgroundColor: "rgba(15, 23, 42, 0.95)",
  border: "1px solid rgba(148, 163, 184, 0.25)",
  borderRadius: "12px",
  color: "#f1f5f9",
};

function rubShort(v: number) {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} млн`;
  if (abs >= 1000) return `${Math.round(v / 1000)} тыс`;
  return String(Math.round(v));
}

type Props = {
  yearRows: FinanceYearOverviewMonth[] | undefined;
  forecast: FinanceForecast | undefined;
  loadingYear: boolean;
  loadingForecast: boolean;
};

export function FinanceReportsCharts({ yearRows, forecast, loadingYear, loadingForecast }: Props) {
  const chartRevExp =
    yearRows?.map((r) => ({
      m: `${r.month}`,
      revF: Number(r.revenue_actual),
      revP: Number(r.revenue_plan),
      expF: Number(r.expense_actual),
      expP: Number(r.expense_plan),
      net: Number(r.net_actual),
    })) ?? [];

  const chartForecast =
    forecast?.points.map((p) => ({
      label: `${p.year}-${String(p.month).padStart(2, "0")}`,
      proj: Number(p.projected_revenue),
    })) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-medium text-white">Выручка: факт и план по месяцам</h3>
        <p className="mt-1 text-xs text-slate-500">Столбцы — выбранный год из блока «План–факт».</p>
        <div className="mt-3 h-[280px] w-full min-w-0">
          {loadingYear ? (
            <p className="text-sm text-slate-400">Загрузка графика…</p>
          ) : chartRevExp.length === 0 ? (
            <p className="text-sm text-slate-500">Нет данных.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRevExp} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...grid} vertical={false} />
                <XAxis dataKey="m" tick={tick} tickLine={false} axisLine={{ stroke: "#475569" }} label={{ value: "Месяц", position: "insideBottom", offset: -4, fill: "#64748b", fontSize: 10 }} />
                <YAxis tickFormatter={rubShort} tick={tick} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  formatter={(value: number) => [new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value), ""]}
                  contentStyle={tooltipStyle}
                  labelFormatter={(l) => `Месяц ${l}`}
                />
                <Legend wrapperStyle={{ color: "#cbd5e1", fontSize: 12 }} />
                <Bar dataKey="revF" name="Выручка факт" fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="revP" name="Выручка план" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium text-white">Расходы: факт и план</h3>
        <div className="mt-3 h-[260px] w-full min-w-0">
          {loadingYear ? (
            <p className="text-sm text-slate-400">Загрузка…</p>
          ) : chartRevExp.length === 0 ? (
            <p className="text-sm text-slate-500">Нет данных.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRevExp} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...grid} vertical={false} />
                <XAxis dataKey="m" tick={tick} tickLine={false} axisLine={{ stroke: "#475569" }} />
                <YAxis tickFormatter={rubShort} tick={tick} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  formatter={(value: number) => [new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value), ""]}
                  contentStyle={tooltipStyle}
                />
                <Legend wrapperStyle={{ color: "#cbd5e1", fontSize: 12 }} />
                <Bar dataKey="expF" name="Расходы факт" fill="#fb7185" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="expP" name="Расходы план" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium text-white">Чистый результат по месяцам</h3>
        <div className="mt-3 h-[240px] w-full min-w-0">
          {loadingYear ? (
            <p className="text-sm text-slate-400">Загрузка…</p>
          ) : chartRevExp.length === 0 ? (
            <p className="text-sm text-slate-500">Нет данных.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRevExp} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...grid} vertical={false} />
                <XAxis dataKey="m" tick={tick} tickLine={false} axisLine={{ stroke: "#475569" }} />
                <YAxis tickFormatter={rubShort} tick={tick} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  formatter={(value: number) => [new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value), ""]}
                  contentStyle={tooltipStyle}
                />
                <Bar dataKey="net" name="Чистый" fill="#a78bfa" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium text-white">Прогноз выручки (линейка)</h3>
        <p className="mt-1 text-xs text-slate-500">Точки из блока «Прогноз» (параметры года и горизонта там же).</p>
        <div className="mt-3 h-[240px] w-full min-w-0">
          {loadingForecast ? (
            <p className="text-sm text-slate-400">Загрузка…</p>
          ) : chartForecast.length === 0 ? (
            <p className="text-sm text-slate-500">Нет точек прогноза.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartForecast} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...grid} vertical={false} />
                <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: "#475569" }} angle={-25} textAnchor="end" height={50} interval={0} fontSize={10} />
                <YAxis tickFormatter={rubShort} tick={tick} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  formatter={(value: number) => [new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value), "Прогноз"]}
                  contentStyle={tooltipStyle}
                />
                <Line type="monotone" dataKey="proj" name="Прогноз" stroke="#22d3ee" strokeWidth={2} dot={{ r: 4, fill: "#22d3ee" }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

export function PlanFactBar({ actual, plan }: { actual: number; plan: number }) {
  if (plan <= 0 && actual <= 0) {
    return <span className="text-slate-600">—</span>;
  }
  const pct = plan > 0 ? (actual / plan) * 100 : actual > 0 ? 100 : 0;
  const w = Math.min(100, pct);
  let tone = "bg-violet-500";
  if (plan > 0) {
    if (actual >= plan) tone = "bg-emerald-500";
    else if (pct < 90) tone = "bg-amber-500";
  }
  return (
    <div className="flex min-w-[56px] max-w-[88px] flex-col gap-0.5">
      <div className="h-2 overflow-hidden rounded-full bg-slate-700/80">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${w}%` }} title={`${Math.round(pct)}%`} />
      </div>
      {plan > 0 ? <span className="text-[10px] text-slate-500">{Math.round(pct)}%</span> : null}
    </div>
  );
}

type DeltaProps = {
  current: string;
  previous: string | undefined;
  /** true: рост хуже (расходы) */
  invert?: boolean;
};

const deltaFmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });

export function PeriodDelta({ current, previous, invert }: DeltaProps) {
  if (previous === undefined) return null;
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
  const d = c - p;
  if (d === 0) {
    return <p className="mt-1 text-xs text-slate-500">Без изменений к пред. периоду</p>;
  }
  const better = invert ? d <= 0 : d >= 0;
  const color = better ? "text-emerald-400" : "text-rose-400";
  const arrow = d > 0 ? "↑" : "↓";
  const pct = p !== 0 ? ((d / p) * 100).toFixed(1) : null;
  return (
    <p className={`mt-1 text-xs ${color}`}>
      {arrow} {deltaFmt.format(d)}
      {pct != null ? ` (${pct}% к базе)` : null}
      <span className="text-slate-500"> · пред. период</span>
    </p>
  );
}
