import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { RopPageIntro } from "@/components/RopPageIntro";
import { PrintMasthead } from "@/components/PrintMasthead";
import { apiFetch } from "@/lib/api";
import { useRopContext } from "@/pages/rop/RopLayout";

type Month = {
  year_month: string;
  label: string;
  leads: number;
  revenue: number | string;
  sold_count: number;
  full_paid_count: number;
  conversion_percent: number;
  leads_delta_pct?: number | null;
  revenue_delta_pct?: number | null;
  conversion_delta_pp?: number | null;
};

type Scenario = { key: string; label: string; leads: number; revenue: number | string };

type Signal = {
  kind: string;
  severity: string;
  title: string;
  detail: string;
  count: number;
  manager_name?: string | null;
};

type PlanFact = {
  manager_id: number;
  manager_name: string;
  plan_amount: number | string;
  fact_amount: number | string;
  progress_percent: number;
};

type WeekMetric = {
  key: string;
  label: string;
  current: number | string;
  previous: number | string;
  percent?: number | null;
  note?: string;
  tracked?: boolean;
};

type WeekStep = { label: string; value: number; note?: string };

type WeekPace = {
  label: string;
  compare_label: string;
  metrics: WeekMetric[];
  funnel: WeekStep[];
};

type Outlook = {
  as_of: string;
  current: Month;
  previous: Month;
  scenarios: Scenario[];
  next_month?: Scenario | null;
  summary?: string;
  signals?: Signal[];
  plan_fact?: PlanFact[];
  plan_total?: number | string;
  fact_total?: number | string;
  week?: WeekPace | null;
};

function money(v: number | string | undefined) {
  return Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

function deltaText(v: number | null | undefined, unit = "%") {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}${unit}`;
}

function deltaClass(v: number | null | undefined) {
  if (v == null || v === 0) return "mo-muted";
  return v > 0 ? "rop-delta--up" : "rop-delta--down";
}

const RING_COLOR: Record<string, string> = {
  revenue: "#8b90ff",
  leads: "#ffae62",
  won: "#8b90ff",
  bookings: "#3ee0b0",
};

function MetricRing({ pct, color }: { pct: number | null; color: string }) {
  const radius = 42;
  const stroke = 12;
  const length = 2 * Math.PI * radius;
  const shown = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const full = pct != null && shown >= 99.5;
  const unfilled = ((100 - shown) / 100) * length;
  const gap = 3;
  const bridge = stroke + gap;
  const grayFits = unfilled >= stroke * 2.4;
  let grayDash = 0;
  let colorDash = length;
  let grayStart = 90;
  let colorStart = 90;
  if (grayFits) {
    grayDash = Math.max(stroke * 0.7, unfilled - stroke);
    colorDash = length - grayDash - 2 * bridge;
    if (colorDash < stroke * 0.4) {
      colorDash = stroke * 0.4;
      grayDash = Math.max(stroke * 0.7, length - colorDash - 2 * bridge);
    }
    const grayAngle = (grayDash / length) * 360;
    const bridgeAngle = (bridge / length) * 360;
    grayStart = 90 - grayAngle / 2;
    colorStart = grayStart + grayAngle + bridgeAngle;
  } else if (!full && pct != null) {
    const open = Math.max(unfilled, stroke * 0.85);
    colorDash = Math.max(stroke, length - open - stroke);
    colorStart = 90 + ((open / length) * 360) / 2;
  }
  return (
    <svg className="rop-plan__ring rop-plan__ring--metric" viewBox="0 0 120 120" aria-hidden>
      {pct == null || full ? (
        <circle
          className={full ? "rop-plan__value" : "rop-plan__track"}
          cx="60"
          cy="60"
          r={radius}
          stroke={full ? color : undefined}
        />
      ) : (
        <>
          {grayFits ? (
            <circle
              className="rop-plan__track"
              cx="60"
              cy="60"
              r={radius}
              strokeDasharray={`${grayDash} ${length}`}
              transform={`rotate(${grayStart} 60 60)`}
            />
          ) : null}
          {shown > 0 ? (
            <circle
              className="rop-plan__value"
              cx="60"
              cy="60"
              r={radius}
              stroke={color}
              strokeDasharray={`${colorDash} ${length}`}
              transform={`rotate(${colorStart} 60 60)`}
            />
          ) : null}
        </>
      )}
      <text x="60" y="66" textAnchor="middle" className="rop-plan__pct">
        {pct == null ? "—" : `${Math.round(pct)}%`}
      </text>
    </svg>
  );
}

const SCENARIO_COLOR: Record<string, string> = {
  worst: "#e0a15a",
  mid: "#8b90ff",
  best: "#3ee0b0",
};

export function MonthDynamics({ current, previous }: { current: Month; previous: Month }) {
  const rows = [
    {
      label: "Лиды",
      now: current.leads,
      then: previous.leads,
      nowText: current.leads.toLocaleString("ru-RU"),
      thenText: previous.leads.toLocaleString("ru-RU"),
      delta: deltaText(current.leads_delta_pct),
      tone: deltaClass(current.leads_delta_pct),
    },
    {
      label: "Выручка",
      now: Number(current.revenue) || 0,
      then: Number(previous.revenue) || 0,
      nowText: money(current.revenue),
      thenText: money(previous.revenue),
      delta: deltaText(current.revenue_delta_pct),
      tone: deltaClass(current.revenue_delta_pct),
    },
    {
      label: "Конверсия",
      now: current.conversion_percent,
      then: previous.conversion_percent,
      nowText: `${current.conversion_percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`,
      thenText: `${previous.conversion_percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`,
      delta: deltaText(current.conversion_delta_pp, " п.п."),
      tone: deltaClass(current.conversion_delta_pp),
    },
  ];
  return (
    <section className="rop-dynamics" aria-label="Ноябрь и октябрь">
      <div className="rop-panel__head">
        <h3 className="rop-panel__title">{current.label} и {previous.label}</h3>
        <span className="rop-panel__meta">динамика к прошлому месяцу</span>
      </div>
      {rows.map((row) => {
        const max = Math.max(row.now, row.then, 1);
        return (
          <div key={row.label} className="rop-dynamics__row">
            <div className="rop-dynamics__name">
              <span>{row.label}</span>
              <b className={row.tone}>{row.delta}</b>
            </div>
            <div className="rop-dynamics__bars">
              <div className="rop-dynamics__line">
                <em>{current.label}</em>
                <strong>{row.nowText}</strong>
                <i><b className="is-now" style={{ width: `${Math.max(4, (row.now / max) * 100)}%` }} /></i>
              </div>
              <div className="rop-dynamics__line">
                <em>{previous.label}</em>
                <strong>{row.thenText}</strong>
                <i><b className="is-then" style={{ width: `${Math.max(4, (row.then / max) * 100)}%` }} /></i>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function ScenarioChart({ fact, scenarios }: { fact: number; scenarios: Scenario[] }) {
  const rows = scenarios.map((item) => ({ ...item, value: Number(item.revenue) || 0 }));
  const max = Math.max(fact, ...rows.map((item) => item.value), 1) * 1.12;
  const width = 720;
  const height = 248;
  const padTop = 16;
  const padRight = 16;
  const padBottom = 28;
  const x0 = 12;
  const x1 = width - padRight;
  const yOf = (value: number) => padTop + (1 - value / max) * (height - padTop - padBottom);
  const yFact = yOf(fact);
  const curve = (end: number) => {
    const y1 = yOf(end);
    const dx = x1 - x0;
    return `M ${x0} ${yFact} C ${x0 + dx * 0.46} ${yFact}, ${x0 + dx * 0.7} ${y1}, ${x1} ${y1}`;
  };
  return (
    <section className="rop-panel rop-growth" aria-label="Если так пойдёт">
      <div className="rop-panel__head">
        <h3 className="rop-panel__title">Если так пойдёт</h3>
        <span className="rop-panel__meta">от факта сегодня до конца месяца</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        {[0.25, 0.5, 0.75].map((step) => (
          <line
            key={step}
            x1={x0}
            x2={x1}
            y1={yOf(max * step)}
            y2={yOf(max * step)}
            className="rop-growth__grid"
          />
        ))}
        {rows.map((item) => (
          <path key={item.key} d={curve(item.value)} className="rop-growth__line" stroke={SCENARIO_COLOR[item.key] ?? "#8b90ff"} />
        ))}
        <circle cx={x0} cy={yFact} r="4.5" className="rop-growth__now" />
        <text x={x0} y={height - 8} className="rop-growth__axis">сейчас</text>
        <text x={x1} y={height - 8} textAnchor="end" className="rop-growth__axis">конец месяца</text>
        {rows.map((item) => (
          <circle key={item.key} cx={x1} cy={yOf(item.value)} r="3.5" fill={SCENARIO_COLOR[item.key] ?? "#8b90ff"} />
        ))}
      </svg>
      <p className="rop-growth__leads">
        {rows.map((item) => (
          <span key={item.key} style={{ color: SCENARIO_COLOR[item.key] ?? "#d5deee" }}>
            {item.label}: {money(item.value)} · {item.leads.toLocaleString("ru-RU")} лид.
          </span>
        ))}
      </p>
    </section>
  );
}

function WeekPaceStrip({ week }: { week: WeekPace }) {
  const [active, setActive] = useState<string | null>(null);
  const funnelMax = Math.max(1, ...week.funnel.map((step) => step.value));
  return (
    <section className="rop-week" aria-label="Темп недели">
      <div className="rop-panel__head">
        <h3 className="rop-panel__title">Темп недели</h3>
        <span className="rop-panel__meta">
          {week.label} · было {week.compare_label}
        </span>
      </div>
      <div className="rop-week__rings">
        {week.metrics.map((metric) => {
          const tracked = metric.tracked !== false && metric.percent != null;
          const pct = tracked ? Number(metric.percent) : null;
          const color = RING_COLOR[metric.key] ?? "#8b97b8";
          const shown =
            metric.tracked === false
              ? "—"
              : metric.key === "revenue"
                ? money(metric.current)
                : Number(metric.current || 0).toLocaleString("ru-RU");
          const was =
            metric.tracked === false
              ? "нет учёта"
              : metric.key === "revenue"
                ? money(metric.previous)
                : Number(metric.previous || 0).toLocaleString("ru-RU");
          const on = active === metric.key;
          return (
            <button
              key={metric.key}
              type="button"
              className={on ? "rop-week__card is-on" : "rop-week__card"}
              style={{ ["--ring" as string]: color }}
              onClick={() => setActive(on ? null : metric.key)}
            >
              <MetricRing pct={pct} color={color} />
              <div className="rop-donut-stats">
                <strong>{shown}</strong>
                <span>{metric.label}</span>
                <b style={{ color }}>{was}</b>
                <em>{metric.tracked === false ? "в CRM нет длины" : "на прошлой неделе"}</em>
              </div>
            </button>
          );
        })}
      </div>
      <article className="rop-week__card rop-week__card--wide">
        <h4>Новые клиенты</h4>
        <div className="rop-week__funnel">
          {week.funnel.map((step) => (
            <div key={step.label}>
              <strong>{step.value.toLocaleString("ru-RU")}</strong>
              <i style={{ height: `${Math.max(10, Math.round((step.value / funnelMax) * 92))}px` }} />
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

export function RopOutlookPage() {
  const { pipelineId } = useRopContext();

  const query = useQuery({
    queryKey: ["rop-outlook", pipelineId],
    enabled: pipelineId != null,
    refetchInterval: 60_000,
    queryFn: () => apiFetch<Outlook>(`/api/rop/outlook?pipeline_id=${pipelineId}`),
  });

  if (pipelineId == null) return <p className="text-sm mo-muted">Выберите воронку</p>;

  const data = query.data;
  const cur = data?.current;
  const prev = data?.previous;

  return (
    <div className="mo-print-doc rop-dense flex flex-col gap-3">
      <PrintMasthead title="Прогноз отдела продаж" meta={data?.as_of ? `на ${data.as_of}` : undefined} />
      <RopPageIntro
        title="Прогноз"
        hint="Темп этой недели, месяцы, сценарии, сигналы и план/факт KPI."
      />

      {query.isLoading ? <p className="text-sm mo-muted">Загрузка…</p> : null}
      {query.isError ? <p className="text-sm text-red-600">Не удалось загрузить прогноз</p> : null}

      {cur && prev && data ? (
        <>
          {data.week ? <WeekPaceStrip week={data.week} /> : null}
          <MonthDynamics current={cur} previous={prev} />

          <ScenarioChart fact={Number(cur.revenue) || 0} scenarios={data.scenarios ?? []} />
          {data.next_month ? (
            <p className="rop-outlook-next">
              След. месяц: <strong>{money(data.next_month.revenue)}</strong>
              {" · "}
              {data.next_month.leads.toLocaleString("ru-RU")} лид.
            </p>
          ) : null}

          <div className="rop-outlook-split">
            <section className="rop-panel" aria-label="Сигналы">
              <div className="rop-panel__head">
                <h3 className="rop-panel__title">Сигналы</h3>
                <span className="rop-panel__meta">{(data?.signals ?? []).length || "ок"}</span>
              </div>
              {(data?.signals ?? []).length === 0 ? (
                <p className="text-sm mo-muted">Критичных сигналов нет.</p>
              ) : (
                <ul className="rop-outlook-signals">
                  {(data?.signals ?? []).map((s, i) => (
                    <li
                      key={`${s.kind}-${s.manager_name ?? i}`}
                      className={`rop-outlook-signal rop-outlook-signal--${s.severity}`}
                    >
                      <strong>{s.title}</strong>
                      <span>{s.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rop-panel" aria-label="План и факт">
              <div className="rop-panel__head">
                <h3 className="rop-panel__title">План / факт</h3>
                <span className="rop-panel__meta">
                  {money(data?.plan_total)} → {money(data?.fact_total)}
                </span>
              </div>
              {(data?.plan_fact ?? []).length === 0 ? (
                <p className="text-sm mo-muted">Планы KPI не заданы.</p>
              ) : (
                <table className="rop-dense-table">
                  <thead>
                    <tr>
                      <th>Менеджер</th>
                      <th className="text-right">План</th>
                      <th className="text-right">Факт</th>
                      <th className="text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.plan_fact ?? []).map((r) => (
                      <tr key={r.manager_id}>
                        <td>{r.manager_name}</td>
                        <td className="text-right tabular-nums">{money(r.plan_amount)}</td>
                        <td className="text-right tabular-nums">{money(r.fact_amount)}</td>
                        <td className="text-right tabular-nums">
                          {r.progress_percent.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {data?.summary ? <p className="rop-outlook-summary">{data.summary}</p> : null}
        </>
      ) : null}
    </div>
  );
}
