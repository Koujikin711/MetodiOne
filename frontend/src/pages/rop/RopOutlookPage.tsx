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

function WeekPaceStrip({ week }: { week: WeekPace }) {
  const [active, setActive] = useState<string | null>(null);
  const revenue = week.metrics.find((metric) => metric.key === "revenue");
  const revenuePct =
    revenue?.previous != null && Number(revenue.previous) > 0
      ? Math.round((Number(revenue.current) / Number(revenue.previous) - 1) * 100)
      : null;
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
      <div className="rop-week__bottom">
        <article className="rop-week__card rop-week__card--wide">
          <h4>Главное</h4>
          <div className="rop-week__pair">
            <div>
              <span>Факт</span>
              <strong>{money(revenue?.current)}</strong>
              <em className={deltaClass(revenuePct)}>{deltaText(revenuePct)}</em>
            </div>
            <div>
              <span>Должно быть</span>
              <strong>{money(revenue?.previous)}</strong>
              <em>те же дни</em>
            </div>
          </div>
        </article>
        <article className="rop-week__card rop-week__card--wide">
          <h4>Новые клиенты</h4>
          <div className="rop-week__funnel">
            {week.funnel.map((step) => (
              <div key={step.label}>
                <span>{step.label}</span>
                <strong>{step.value.toLocaleString("ru-RU")}</strong>
              </div>
            ))}
          </div>
        </article>
      </div>
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
          <section className="rop-outlook-compare" aria-label="Сравнение месяцев">
            <article className="rop-outlook-month">
              <div className="rop-outlook-month__top">
                <h3 className="rop-outlook-month__label">{cur.label}</h3>
                <span className="rop-outlook-month__hint">текущий</span>
              </div>
              <dl className="rop-outlook-month__metrics">
                <div>
                  <dt>Лиды</dt>
                  <dd>
                    {cur.leads.toLocaleString("ru-RU")}
                    <span className={deltaClass(cur.leads_delta_pct)}>{deltaText(cur.leads_delta_pct)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Выручка</dt>
                  <dd>
                    {money(cur.revenue)}
                    <span className={deltaClass(cur.revenue_delta_pct)}>{deltaText(cur.revenue_delta_pct)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Конверсия</dt>
                  <dd>
                    {cur.conversion_percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%
                    <span className={deltaClass(cur.conversion_delta_pp)}>
                      {deltaText(cur.conversion_delta_pp, " п.п.")}
                    </span>
                  </dd>
                </div>
              </dl>
            </article>
            <article className="rop-outlook-month rop-outlook-month--prev">
              <div className="rop-outlook-month__top">
                <h3 className="rop-outlook-month__label">{prev.label}</h3>
                <span className="rop-outlook-month__hint">прошлый</span>
              </div>
              <dl className="rop-outlook-month__metrics">
                <div>
                  <dt>Лиды</dt>
                  <dd>{prev.leads.toLocaleString("ru-RU")}</dd>
                </div>
                <div>
                  <dt>Выручка</dt>
                  <dd>{money(prev.revenue)}</dd>
                </div>
                <div>
                  <dt>Конверсия</dt>
                  <dd>{prev.conversion_percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</dd>
                </div>
              </dl>
            </article>
          </section>

          <section className="rop-panel" aria-label="Сценарии">
            <div className="rop-panel__head">
              <h3 className="rop-panel__title">Если так пойдёт</h3>
              <span className="rop-panel__meta">−15% / текущий / +15%</span>
            </div>
            <div className="rop-outlook-scenarios">
              {(data.scenarios ?? []).map((s) => (
                <div key={s.key} className={`rop-outlook-scenario rop-outlook-scenario--${s.key}`}>
                  <span className="rop-outlook-scenario__label">{s.label}</span>
                  <strong className="rop-outlook-scenario__rev">{money(s.revenue)}</strong>
                  <span className="rop-outlook-scenario__leads">{s.leads.toLocaleString("ru-RU")} лид.</span>
                </div>
              ))}
            </div>
            {data.next_month ? (
              <p className="rop-outlook-next">
                След. месяц: <strong>{money(data.next_month.revenue)}</strong>
                {" · "}
                {data.next_month.leads.toLocaleString("ru-RU")} лид.
              </p>
            ) : null}
          </section>

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
