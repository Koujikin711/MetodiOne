import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoney } from "@/lib/money";
import type { SalesKpiCompanyExpertStat, SalesKpiCompanyServiceStat } from "@/lib/types";

/** Разнесённые оттенки: соседние услуги не из одного семейства. */
const PALETTE = [
  "#2563EB",
  "#16A34A",
  "#EA580C",
  "#9333EA",
  "#DB2777",
  "#0891B2",
  "#CA8A04",
  "#DC2626",
  "#4F46E5",
  "#0D9488",
  "#64748B",
  "#BE185D",
];

const PAID_KEYS = new Set(["paid"]);

const STATUS = {
  appeared: "#059669",
  noShow: "#E11D48",
  booked: "#2563EB",
} as const;

type ChartTheme = {
  tick: string;
  grid: string;
  cursor: string;
};

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
    ? { tick: "#cbd5e1", grid: "rgba(148,163,184,0.16)", cursor: "rgba(148,163,184,0.10)" }
    : { tick: "#334155", grid: "rgba(15,23,42,0.08)", cursor: "rgba(15,23,42,0.045)" };
}

function money(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function shortName(name: string, max = 16): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

type TipPayload = {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string;
  payload?: { name?: string };
};

function ChartTip({
  active,
  payload,
  label,
  moneyKeys,
}: {
  active?: boolean;
  payload?: TipPayload[];
  label?: string;
  moneyKeys?: Set<string>;
}) {
  if (!active || !payload?.length) return null;
  const title = String(payload[0]?.payload?.name || label || "");
  return (
    <div className="mo-chart-tip">
      {title ? <div className="mo-chart-tip__title">{title}</div> : null}
      {payload.map((row, i) => {
        const key = String(row.dataKey || row.name || i);
        const raw = Number(row.value ?? 0);
        const text = moneyKeys?.has(String(row.dataKey || "")) ? formatMoney(raw, { digits: 0 }) : String(raw);
        return (
          <div key={key} className="mo-chart-tip__row">
            <span className="mo-chart-tip__dot" style={{ background: row.color || "var(--mo-accent)" }} />
            <span className="min-w-0 truncate">{row.name || key}</span>
            <span className="tabular-nums font-semibold">{text}</span>
          </div>
        );
      })}
    </div>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mo-chart-card">
      <header className="mo-chart-card__head">
        <h3>{title}</h3>
        {hint ? <p>{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function ServiceRevenueCharts({
  services,
  experts,
}: {
  services: SalesKpiCompanyServiceStat[];
  experts: SalesKpiCompanyExpertStat[];
}) {
  const theme = useChartTheme();
  const axis = { fill: theme.tick, fontSize: 11 };

  const payRows = useMemo(
    () =>
      [...services]
        .map((s, i) => ({
          name: s.direction_name,
          short: shortName(s.direction_name),
          paid: money(s.revenue_paid),
          fill: PALETTE[i % PALETTE.length],
        }))
        .filter((r) => r.paid > 0)
        .sort((a, b) => b.paid - a.paid),
    [services],
  );

  const statusRows = useMemo(
    () =>
      services.map((s) => ({
        name: s.direction_name,
        short: shortName(s.direction_name, 14),
        appeared: s.appeared_count,
        noShow: s.no_show_count,
        booked: s.booked_count ?? 0,
      })),
    [services],
  );

  const expertRows = useMemo(
    () =>
      [...experts]
        .map((e, i) => ({
          name: e.specialist_name,
          short: shortName(e.specialist_name, 22),
          paid: money(e.revenue_paid),
          fill: PALETTE[i % PALETTE.length],
        }))
        .filter((r) => r.paid > 0)
        .sort((a, b) => b.paid - a.paid)
        .slice(0, 12),
    [experts],
  );

  const totalPaid = payRows.reduce((s, r) => s + r.paid, 0);
  const payH = Math.max(220, payRows.length * 28 + 24);
  const expertH = Math.max(220, expertRows.length * 32 + 24);
  const statusH = Math.max(220, statusRows.length * 28 + 36);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartCard title="Оплаты по услугам" hint="Сумма оплат за месяц">
        {payRows.length === 0 ? (
          <p className="mo-chart-empty">Нет оплат за период</p>
        ) : (
          <div style={{ height: payH }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={payRows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid stroke={theme.grid} horizontal={false} />
                <XAxis type="number" tick={axis} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="short" width={108} tick={axis} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: theme.cursor }}
                  content={<ChartTip moneyKeys={PAID_KEYS} />}
                />
                <Bar dataKey="paid" name="Оплаты" radius={[0, 6, 6, 0]} maxBarSize={16}>
                  {payRows.map((r) => (
                    <Cell key={r.name} fill={r.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      <ChartCard title="Доля выручки" hint="Только услуги с оплатами">
        {payRows.length === 0 ? (
          <p className="mo-chart-empty">Нет оплат за период</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center">
            <div className="mx-auto h-44 w-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={payRows}
                    dataKey="paid"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={2}
                    stroke="var(--mo-surface-elevated)"
                    strokeWidth={2}
                  >
                    {payRows.map((r) => (
                      <Cell key={r.name} fill={r.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTip moneyKeys={PAID_KEYS} />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mo-chart-legend">
              {payRows.map((r) => {
                const pct = totalPaid > 0 ? Math.round((r.paid / totalPaid) * 100) : 0;
                return (
                  <li key={r.name}>
                    <span className="mo-chart-tip__dot" style={{ background: r.fill }} />
                    <span className="min-w-0 truncate">{r.name}</span>
                    <span className="tabular-nums mo-muted">{pct}%</span>
                    <span className="tabular-nums font-medium">{formatMoney(r.paid, { digits: 0 })}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </ChartCard>

      <ChartCard title="Записи по статусу" hint="Явились, не явились, ещё в записи">
        {statusRows.length === 0 ? (
          <p className="mo-chart-empty">Нет записей за период</p>
        ) : (
          <>
            <div className="mo-chart-status-legend">
              <span><i style={{ background: STATUS.appeared }} /> Явились</span>
              <span><i style={{ background: STATUS.noShow }} /> Не явились</span>
              <span><i style={{ background: STATUS.booked }} /> Ещё в записи</span>
            </div>
            <div style={{ height: statusH }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusRows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid stroke={theme.grid} horizontal={false} />
                  <XAxis type="number" tick={axis} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="short" width={108} tick={axis} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: theme.cursor }} content={<ChartTip />} />
                  <Bar dataKey="appeared" name="Явились" stackId="s" fill={STATUS.appeared} maxBarSize={16} />
                  <Bar dataKey="noShow" name="Не явились" stackId="s" fill={STATUS.noShow} maxBarSize={16} />
                  <Bar dataKey="booked" name="Ещё в записи" stackId="s" fill={STATUS.booked} radius={[0, 6, 6, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </ChartCard>

      <ChartCard title="Оплаты по экспертам" hint="Топ специалистов по сумме оплат">
        {expertRows.length === 0 ? (
          <p className="mo-chart-empty">Нет оплат по экспертам</p>
        ) : (
          <div style={{ height: expertH }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={expertRows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid stroke={theme.grid} horizontal={false} />
                <XAxis type="number" tick={axis} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="short" width={128} tick={axis} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: theme.cursor }} content={<ChartTip moneyKeys={PAID_KEYS} />} />
                <Bar dataKey="paid" name="Оплаты" radius={[0, 6, 6, 0]} maxBarSize={14}>
                  {expertRows.map((r) => (
                    <Cell key={r.name} fill={r.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
