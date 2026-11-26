import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { apiFetch } from "@/lib/api";
import { APP_CURRENCY } from "@/lib/money";

type ExpenseRow = {
  id: number;
  expense: number | string;
  bank: string | null;
  article: string | null;
};

const PALETTE = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4", "#a855f7", "#94a3b8", "#ef4444"];

function money(v: number) {
  return v.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

function shiftYearMonth(ym: string, delta: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string): string {
  const [ys, ms] = ym.split("-");
  const d = new Date(Number(ys), Number(ms) - 1, 1);
  if (Number.isNaN(d.getTime())) return ym;
  return d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" });
}

function sumRows(rows: ExpenseRow[]): number {
  return rows.reduce((s, r) => s + Math.abs(Number(r.expense || 0)), 0);
}

function groupSums(rows: ExpenseRow[], key: "article" | "bank"): { name: string; total: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const raw = (r[key] || "").trim();
    const name = raw || "Без названия";
    map.set(name, (map.get(name) || 0) + Math.abs(Number(r.expense || 0)));
  }
  return [...map.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
}

function pctDelta(current: number, previous: number): { text: string; tone: "up" | "down" | "flat" } {
  if (previous <= 0 && current <= 0) return { text: "—", tone: "flat" };
  if (previous <= 0) return { text: "новый", tone: "up" };
  const p = ((current - previous) / previous) * 100;
  const sign = p > 0 ? "+" : "";
  return {
    text: `${sign}${p.toFixed(0)}%`,
    tone: p > 0.5 ? "up" : p < -0.5 ? "down" : "flat",
  };
}

function useChartTheme() {
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

function BreakdownList({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { name: string; total: number }[];
  total: number;
}) {
  return (
    <section className="expenses-analytics__card">
      <h3 className="expenses-analytics__card-title">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm mo-muted">Нет данных за месяц</p>
      ) : (
        <ul className="expenses-analytics__bars">
          {rows.map((row, i) => {
            const pct = total > 0 ? (row.total / total) * 100 : 0;
            return (
              <li key={row.name} className="expenses-analytics__bar-row">
                <div className="expenses-analytics__bar-meta">
                  <span className="min-w-0 truncate font-medium">{row.name}</span>
                  <span className="tabular-nums mo-muted">
                    {money(row.total)} · {pct.toFixed(0)}%
                  </span>
                </div>
                <div className="expenses-analytics__bar-track">
                  <div
                    className="expenses-analytics__bar-fill"
                    style={{
                      width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`,
                      background: PALETTE[i % PALETTE.length],
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

type Props = {
  yearMonth: string;
};

export function ExpensesAnalyticsPanel({ yearMonth }: Props) {
  const theme = useChartTheme();
  const months = useMemo(() => {
    const out: string[] = [];
    for (let i = 5; i >= 0; i -= 1) out.push(shiftYearMonth(yearMonth, -i));
    return out;
  }, [yearMonth]);
  const prevYm = shiftYearMonth(yearMonth, -1);

  const queries = useQueries({
    queries: months.map((ym) => {
      const y = Number(ym.slice(0, 4));
      const m = Number(ym.slice(5, 7));
      return {
        queryKey: ["finance-expenses", y, m] as const,
        queryFn: () =>
          apiFetch<ExpenseRow[]>(`/api/finance/expenses?year=${y}&month=${m}&limit=1000`, {
            timeoutMs: 25_000,
          }),
        staleTime: 30_000,
      };
    }),
  });

  const byYm = useMemo(() => {
    const map = new Map<string, ExpenseRow[]>();
    months.forEach((ym, i) => {
      map.set(ym, queries[i]?.data ?? []);
    });
    return map;
  }, [months, queries]);

  const currentRows = byYm.get(yearMonth) ?? [];
  const prevRows = byYm.get(prevYm) ?? [];
  const currentTotal = sumRows(currentRows);
  const prevTotal = sumRows(prevRows);
  const delta = pctDelta(currentTotal, prevTotal);
  const byArticle = useMemo(() => groupSums(currentRows, "article"), [currentRows]);
  const byBank = useMemo(() => groupSums(currentRows, "bank"), [currentRows]);

  const chartData = useMemo(
    () =>
      months.map((ym) => ({
        ym,
        label: monthLabel(ym),
        total: sumRows(byYm.get(ym) ?? []),
        isCurrent: ym === yearMonth,
      })),
    [months, byYm, yearMonth],
  );

  const loading = queries.some((q) => q.isLoading);
  const error = queries.find((q) => q.isError)?.error as Error | undefined;

  return (
    <section className="expenses-analytics">
      <div className="expenses-month__head">
        <h2 className="expenses-month__title">Аналитика расходов</h2>
        <span className="expenses-month__total tabular-nums">
          {loading ? "…" : `${money(currentTotal)} ${APP_CURRENCY}`}
        </span>
      </div>

      {error ? (
        <p className="text-sm text-[var(--mo-danger,#ef4444)]">{error.message || "Ошибка загрузки"}</p>
      ) : null}

      <div className="expenses-analytics__kpis">
        <div className="expenses-analytics__kpi">
          <div className="expenses-analytics__kpi-label">Этот месяц</div>
          <div className="expenses-analytics__kpi-value tabular-nums">
            {loading ? "…" : money(currentTotal)}
            <span className="expenses-analytics__kpi-unit">{APP_CURRENCY}</span>
          </div>
        </div>
        <div className="expenses-analytics__kpi">
          <div className="expenses-analytics__kpi-label">Прошлый месяц</div>
          <div className="expenses-analytics__kpi-value tabular-nums">
            {loading ? "…" : money(prevTotal)}
            <span className="expenses-analytics__kpi-unit">{APP_CURRENCY}</span>
          </div>
          <div className="expenses-analytics__kpi-sub mo-muted">{monthLabel(prevYm)}</div>
        </div>
        <div className="expenses-analytics__kpi">
          <div className="expenses-analytics__kpi-label">К прошлому</div>
          <div
            className={[
              "expenses-analytics__kpi-value tabular-nums",
              delta.tone === "up" ? "is-up" : "",
              delta.tone === "down" ? "is-down" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {loading ? "…" : delta.text}
          </div>
          <div className="expenses-analytics__kpi-sub mo-muted">
            {loading
              ? ""
              : currentTotal >= prevTotal
                ? `+${money(currentTotal - prevTotal)} ${APP_CURRENCY}`
                : `−${money(prevTotal - currentTotal)} ${APP_CURRENCY}`}
          </div>
        </div>
      </div>

      <section className="expenses-analytics__card expenses-analytics__card--chart">
        <h3 className="expenses-analytics__card-title">6 месяцев</h3>
        <div className="expenses-analytics__chart">
          {loading ? (
            <p className="text-sm mo-muted px-2 py-8">Загрузка…</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={theme.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: theme.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: theme.tick, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}к` : String(v))}
                />
                <Tooltip
                  cursor={{ fill: "color-mix(in srgb, var(--mo-accent) 10%, transparent)" }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="mo-chart-tip">
                        <div className="mo-chart-tip__title">{label}</div>
                        <div className="mo-chart-tip__row">
                          <span>Расходы</span>
                          <span className="ml-auto tabular-nums font-semibold">
                            {money(Number(payload[0]?.value || 0))} {APP_CURRENCY}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="total" name="Расходы" radius={[6, 6, 0, 0]} maxBarSize={36}>
                  {chartData.map((row) => (
                    <Cell
                      key={row.ym}
                      fill={row.isCurrent ? "var(--mo-accent)" : "color-mix(in srgb, var(--mo-accent) 45%, #64748b)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <div className="expenses-analytics__grid">
        <BreakdownList title="По статьям" rows={byArticle} total={currentTotal} />
        <BreakdownList title="По банку" rows={byBank} total={currentTotal} />
      </div>
    </section>
  );
}
