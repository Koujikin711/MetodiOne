import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoney } from "@/lib/money";
import type { ServicesAnalyticsExpertStat, ServicesAnalyticsServiceStat } from "@/lib/types";

const COLORS = [
  "#38bdf8",
  "#34d399",
  "#a78bfa",
  "#fbbf24",
  "#f472b6",
  "#2dd4bf",
  "#fb923c",
  "#60a5fa",
  "#c084fc",
  "#4ade80",
];

const tick = { fill: "var(--mo-text-muted, #64748b)", fontSize: 11 };

function ChartTip({
  active,
  payload,
  label,
  money,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string; payload?: { name?: string } }>;
  label?: string;
  money?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const title = String(payload[0]?.payload?.name || label || "");
  return (
    <div className="mo-chart-tip">
      {title ? <div className="mo-chart-tip__title">{title}</div> : null}
      {payload.map((row, i) => {
        const raw = Number(row.value ?? 0);
        const asMoney = money || row.dataKey === "paid" || row.dataKey === "value";
        return (
          <div key={`${row.dataKey || row.name || i}`} className="mo-chart-tip__row">
            <span className="mo-chart-tip__dot" style={{ background: row.color || "var(--mo-accent)" }} />
            <span className="min-w-0 truncate">{row.name || "Оплаты"}</span>
            <span className="tabular-nums font-semibold">
              {asMoney && Number.isFinite(raw) ? formatMoney(raw, { digits: 0 }) : String(row.value ?? "—")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function shortMoney(v: number) {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} млн`;
  if (abs >= 1000) return `${Math.round(v / 1000)}k`;
  return String(Math.round(v));
}

type Props = {
  services: ServicesAnalyticsServiceStat[];
  experts: ServicesAnalyticsExpertStat[];
};

export function AnalyticsServicesCharts({ services, experts }: Props) {
  const byPay = [...services].sort((a, b) => Number(b.revenue_paid) - Number(a.revenue_paid));
  const revenueRows = byPay.map((s) => ({
    name: s.direction_name,
    paid: Number(s.revenue_paid) || 0,
  }));
  const attendanceRows = byPay.map((s) => ({
    name: s.direction_name,
    appeared: Number(s.appeared_count) || 0,
    noshow: Number(s.no_show_count) || 0,
    booked: Number(s.booked_count) || 0,
  }));
  const shareRows = byPay
    .map((s) => ({ name: s.direction_name, value: Number(s.revenue_paid) || 0 }))
    .filter((r) => r.value > 0);
  const expertRows = [...experts]
    .sort((a, b) => Number(b.revenue_paid) - Number(a.revenue_paid))
    .slice(0, 10)
    .map((e) => ({
      name: e.specialist_name,
      paid: Number(e.revenue_paid) || 0,
    }));

  if (services.length === 0) {
    return (
      <p className="analytics-panel-note">
        Нет данных для графиков за выбранный месяц. Откройте HTML-отчёт со снимком августа 2026.
      </p>
    );
  }

  return (
    <div className="analytics-charts">
      <div className="analytics-charts-grid">
        <section className="analytics-panel analytics-chart-panel">
          <h3 className="analytics-panel-title">Оплаты по услугам</h3>
          <p className="analytics-panel-note">Сумма оплат за месяц (TJS)</p>
          <div className="analytics-chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueRows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                <XAxis dataKey="name" tick={tick} interval={0} angle={-25} textAnchor="end" height={64} />
                <YAxis tickFormatter={shortMoney} tick={tick} width={44} />
                <Tooltip cursor={false} content={<ChartTip money />} />
                <Bar dataKey="paid" name="Оплаты" radius={[4, 4, 0, 0]} maxBarSize={36}>
                  {revenueRows.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="analytics-panel analytics-chart-panel">
          <h3 className="analytics-panel-title">Доля выручки</h3>
          <p className="analytics-panel-note">Только услуги с оплатами</p>
          <div className="analytics-chart-box analytics-chart-box--sm">
            {shareRows.length === 0 ? (
              <p className="analytics-panel-note">Нет оплат за месяц</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={shareRows}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="48%"
                    outerRadius="72%"
                    paddingAngle={2}
                  >
                    {shareRows.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip cursor={false} content={<ChartTip money />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      <section className="analytics-panel analytics-chart-panel">
        <h3 className="analytics-panel-title">Явки / неявки / booked</h3>
        <p className="analytics-panel-note">Количество записей по статусу</p>
        <div className="analytics-chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={attendanceRows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
              <XAxis dataKey="name" tick={tick} interval={0} angle={-25} textAnchor="end" height={64} />
              <YAxis tick={tick} width={36} />
              <Tooltip cursor={false} content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="appeared" name="Явились" stackId="a" fill="#34d399" maxBarSize={36} />
              <Bar dataKey="noshow" name="Не явились" stackId="a" fill="#f87171" maxBarSize={36} />
              <Bar dataKey="booked" name="Ещё booked" stackId="a" fill="#38bdf8" maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {expertRows.length > 0 ? (
        <section className="analytics-panel analytics-chart-panel">
          <h3 className="analytics-panel-title">Оплаты по экспертам</h3>
          <p className="analytics-panel-note">Топ специалистов по сумме оплат</p>
          <div className="analytics-chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={expertRows}
                margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
              >
                <CartesianGrid stroke="rgba(148,163,184,0.15)" horizontal={false} />
                <XAxis type="number" tickFormatter={shortMoney} tick={tick} />
                <YAxis type="category" dataKey="name" width={120} tick={tick} />
                <Tooltip cursor={false} content={<ChartTip money />} />
                <Bar dataKey="paid" name="Оплаты" fill="#a78bfa" radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}
    </div>
  );
}
