import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import { appLexicon } from "@/lib/appLexicon";
import { formatMoney } from "@/lib/money";
import type { AnalyticsOverviewRead, DetailedAnalyticsRead, FullAnalyticsRead, Pipeline } from "@/lib/types";

const moneyFmt = { format: (n: number) => formatMoney(n, { digits: 0 }) };

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const esc = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
  const csv = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function MetricCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "success" | "warning" | "accent" | "neutral";
}) {
  return (
    <div className={`mo-kpi analytics-kpi analytics-kpi--${tone}`}>
      <div className="mo-kpi-label">{label}</div>
      <div className="mo-kpi-value">{value}</div>
    </div>
  );
}

function AnalyticsPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="analytics-panel">
      <h3 className="analytics-panel-title">{title}</h3>
      {children}
    </section>
  );
}

function AnalyticsTable({ children, minWidth = 480 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="analytics-table-wrap">
      <table className="mo-table analytics-table" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function AnalyticsPage() {
  const lex = appLexicon;
  const [mode, setMode] = useState<"overview" | "full" | "detailed">("overview");
  const [period, setPeriod] = useState<"day" | "month" | "custom">("day");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pipelineId, setPipelineId] = useState<number | "all">("all");

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("period", period);
    if (pipelineId !== "all") p.set("pipeline_id", String(pipelineId));
    if (period === "custom") {
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
    }
    return p.toString();
  }, [period, dateFrom, dateTo, pipelineId]);

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines-for-analytics"],
    queryFn: () => apiFetch<Pipeline[]>("/api/pipelines"),
  });

  const fullQuery = useQuery({
    queryKey: ["analytics-full", qs],
    queryFn: () => apiFetch<FullAnalyticsRead>(`/api/analytics/full?${qs}`),
  });

  const detailedQuery = useQuery({
    queryKey: ["analytics-detailed", qs],
    queryFn: () => apiFetch<DetailedAnalyticsRead>(`/api/analytics/detailed?${qs}`),
  });

  const overviewQuery = useQuery({
    queryKey: ["analytics-overview", qs],
    queryFn: () => apiFetch<AnalyticsOverviewRead>(`/api/analytics/overview?${qs}`),
  });

  return (
    <div className="analytics-page mo-fill-page">
      <header className="analytics-page-header shrink-0">
        <h1 className="lux-heading-page">{lex.analyticsTitle}</h1>
        <p className="lux-body mt-1 max-w-2xl">{lex.analyticsIntro}</p>
      </header>

      <div className="mo-fill-page-scroll space-y-5">
      <section className="mo-section analytics-toolbar-section p-4 sm:p-5">
        <div className="analytics-toolbar">
          <label className="analytics-toolbar-field">
            <span>Режим</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "overview" | "full" | "detailed")}
              className="mo-input"
            >
              <option value="overview">Обзор 360</option>
              <option value="full">Полная</option>
              <option value="detailed">Детальная</option>
            </select>
          </label>
          <label className="analytics-toolbar-field">
            <span>Период</span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as "day" | "month" | "custom")}
              className="mo-input"
            >
              <option value="day">За день</option>
              <option value="month">За месяц</option>
              <option value="custom">За период</option>
            </select>
          </label>
          <label className="analytics-toolbar-field">
            <span>Воронка</span>
            <select
              value={pipelineId === "all" ? "all" : String(pipelineId)}
              onChange={(e) => setPipelineId(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="mo-input"
            >
              <option value="all">{lex.pipelineAll}</option>
              {(pipelinesQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="analytics-toolbar-field">
            <span>С</span>
            <input
              type="date"
              disabled={period !== "custom"}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mo-input disabled:opacity-50"
            />
          </label>
          <label className="analytics-toolbar-field">
            <span>По</span>
            <input
              type="date"
              disabled={period !== "custom"}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mo-input disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (mode === "overview" && overviewQuery.data) {
                downloadCsv(
                  "analytics_overview_sources.csv",
                  ["Источник", lex.leadCol, lex.csvLeadSharePct, "Продано", "Оплачено", "Не оплачено"],
                  overviewQuery.data.by_source.map((r) => [
                    r.source,
                    r.leads_count,
                    r.lead_share_pct,
                    Number(r.sold_amount),
                    Number(r.paid_amount),
                    Number(r.unpaid_amount),
                  ]),
                );
              }
              if (mode === "full" && fullQuery.data) {
                downloadCsv(
                  "analytics_full.csv",
                  [lex.thPipelineOrOutlet, lex.leadCol, lex.processedByStaff, "Получено", "Дебиторка"],
                  fullQuery.data.by_pipeline.map((r) => [
                    r.pipeline_name,
                    r.leads_count,
                    r.processed_by_manager_count,
                    Number(r.received_amount),
                    Number(r.debt_amount),
                  ]),
                );
              }
              if (mode === "detailed" && detailedQuery.data) {
                downloadCsv(
                  "analytics_detailed.csv",
                  [lex.thStaff, lex.leadCol, "Продано", "Не оплачено", "Ответили (клиент / менеджер)"],
                  detailedQuery.data.by_manager.map((r) => [
                    r.manager_name,
                    r.leads_count,
                    Number(r.sold_amount),
                    Number(r.unpaid_amount),
                    `${r.clients_messaged_count ?? 0} / ${r.manager_replied_count ?? 0}`,
                  ]),
                );
              }
            }}
            className="btn-secondary analytics-export-btn"
          >
            Экспорт CSV
          </button>
        </div>
      </section>

      {mode === "overview" && (
        <section className="space-y-4">
          {overviewQuery.isError && <p className="analytics-error">{(overviewQuery.error as Error).message}</p>}
          {overviewQuery.isLoading && <p className="lux-caption px-1">Загрузка…</p>}
          {overviewQuery.data && (
            <>
              <div className="analytics-kpi-grid">
                <MetricCard label={lex.guestsMetricLabel} value={overviewQuery.data.executive.leads_total} tone="accent" />
                <MetricCard label="Win Rate" value={`${overviewQuery.data.executive.win_rate_pct}%`} tone="neutral" />
                <MetricCard
                  label="Оплачено"
                  value={moneyFmt.format(Number(overviewQuery.data.executive.paid_amount))}
                  tone="success"
                />
                <MetricCard
                  label="Не оплачено"
                  value={moneyFmt.format(Number(overviewQuery.data.executive.unpaid_amount))}
                  tone="warning"
                />
                <MetricCard
                  label="Первый ответ"
                  value={
                    overviewQuery.data.executive.avg_first_response_minutes == null
                      ? "—"
                      : `${overviewQuery.data.executive.avg_first_response_minutes} мин`
                  }
                  tone="default"
                />
                <MetricCard
                  label={lex.leadCycle}
                  value={
                    overviewQuery.data.executive.avg_lead_cycle_hours == null
                      ? "—"
                      : `${overviewQuery.data.executive.avg_lead_cycle_hours} ч`
                  }
                  tone="neutral"
                />
              </div>

              <section
                className={`analytics-alerts ${overviewQuery.data.alerts.summary.length === 0 ? "analytics-alerts--ok" : ""}`}
              >
                <h3 className="analytics-alerts-title">Алерты</h3>
                {overviewQuery.data.alerts.summary.length === 0 ? (
                  <p className="analytics-alerts-ok">Критичных отклонений не найдено.</p>
                ) : (
                  <ul className="analytics-alerts-list">
                    {overviewQuery.data.alerts.summary.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <AnalyticsPanel title={lex.sectionStageFlow}>
                  <AnalyticsTable minWidth={520}>
                    <thead>
                      <tr>
                        <th className="py-2 pr-3">Стадия</th>
                        <th className="py-2 pr-3">{lex.leadCol}</th>
                        <th className="py-2 pr-3">В след. стадию</th>
                        <th className="py-2 pr-3">Ср. время</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overviewQuery.data.stage_conversion.map((r) => (
                        <tr key={r.stage_id}>
                          <td className="py-2.5 pr-3 font-medium">{r.stage_name}</td>
                          <td className="py-2.5 pr-3 tabular-nums">{r.leads_count}</td>
                          <td className="py-2.5 pr-3 tabular-nums">
                            {r.conversion_to_next_pct == null ? "—" : `${r.conversion_to_next_pct}%`}
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums">
                            {r.avg_time_in_stage_hours == null ? "—" : `${r.avg_time_in_stage_hours} ч`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </AnalyticsTable>
                </AnalyticsPanel>

                <AnalyticsPanel title="Причины потерь">
                  <AnalyticsTable minWidth={420}>
                    <thead>
                      <tr>
                        <th className="py-2 pr-3">Причина</th>
                        <th className="py-2 pr-3">Кол-во</th>
                        <th className="py-2 pr-3">Доля</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overviewQuery.data.loss_reasons.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="analytics-empty-cell">
                            Нет данных за период
                          </td>
                        </tr>
                      ) : (
                        overviewQuery.data.loss_reasons.map((r) => (
                          <tr key={r.reason}>
                            <td className="py-2.5 pr-3">{r.reason}</td>
                            <td className="py-2.5 pr-3 tabular-nums">{r.count}</td>
                            <td className="py-2.5 pr-3 tabular-nums">{r.share_pct}%</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </AnalyticsTable>
                </AnalyticsPanel>
              </div>

              <AnalyticsPanel title={lex.sourcesTitle}>
                <AnalyticsTable minWidth={760}>
                  <thead>
                    <tr>
                      <th className="py-2 pr-3">Источник</th>
                      <th className="py-2 pr-3">{lex.leadCol}</th>
                      <th className="py-2 pr-3">Доля</th>
                      <th className="py-2 pr-3">Продано</th>
                      <th className="py-2 pr-3">Оплачено</th>
                      <th className="py-2 pr-3">Не оплачено</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewQuery.data.by_source.map((r) => (
                      <tr key={r.source}>
                        <td className="py-2.5 pr-3 font-medium">{r.source}</td>
                        <td className="py-2.5 pr-3 tabular-nums">{r.leads_count}</td>
                        <td className="py-2.5 pr-3 tabular-nums">{r.lead_share_pct}%</td>
                        <td className="py-2.5 pr-3 tabular-nums">{moneyFmt.format(Number(r.sold_amount))}</td>
                        <td className="py-2.5 pr-3 tabular-nums text-[var(--mo-success)]">
                          {moneyFmt.format(Number(r.paid_amount))}
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums text-amber-700 dark:text-amber-300">
                          {moneyFmt.format(Number(r.unpaid_amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </AnalyticsTable>
              </AnalyticsPanel>

              <AnalyticsPanel title={lex.sectionPlanFact}>
                <AnalyticsTable minWidth={640}>
                  <thead>
                    <tr>
                      <th className="py-2 pr-3">{lex.thStaff}</th>
                      <th className="py-2 pr-3">План</th>
                      <th className="py-2 pr-3">Факт</th>
                      <th className="py-2 pr-3">Выполнение</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewQuery.data.manager_plan_fact.map((r) => (
                      <tr key={`${r.manager_id ?? "none"}-${r.manager_name}`}>
                        <td className="py-2.5 pr-3 font-medium">{r.manager_name}</td>
                        <td className="py-2.5 pr-3 tabular-nums">{moneyFmt.format(Number(r.plan_amount))}</td>
                        <td className="py-2.5 pr-3 tabular-nums">{moneyFmt.format(Number(r.fact_paid_amount))}</td>
                        <td className="py-2.5 pr-3 tabular-nums">{r.plan_completion_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </AnalyticsTable>
              </AnalyticsPanel>
            </>
          )}
        </section>
      )}

      {mode === "full" && (
        <section className="space-y-4">
          {fullQuery.isError && <p className="analytics-error">{(fullQuery.error as Error).message}</p>}
          {fullQuery.isLoading && <p className="lux-caption px-1">Загрузка…</p>}
          {fullQuery.data && (
            <>
              <div className="analytics-kpi-grid sm:grid-cols-3">
                <MetricCard label={lex.guestsMetricLabel} value={fullQuery.data.total_leads} tone="accent" />
                <MetricCard
                  label="Получено"
                  value={moneyFmt.format(Number(fullQuery.data.total_received_amount))}
                  tone="success"
                />
                <MetricCard
                  label="Дебиторка"
                  value={moneyFmt.format(Number(fullQuery.data.total_debt_amount))}
                  tone="warning"
                />
              </div>
              <AnalyticsPanel title="По воронкам">
                <AnalyticsTable minWidth={760}>
                  <thead>
                    <tr>
                      <th className="py-2 pr-4">{lex.thPipelineOrOutlet}</th>
                      <th className="py-2 pr-4">{lex.leadCol}</th>
                      <th className="py-2 pr-4">{lex.processedByStaff}</th>
                      <th className="py-2 pr-4">Получено</th>
                      <th className="py-2 pr-4">Дебиторка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullQuery.data.by_pipeline.map((r) => (
                      <tr key={`${r.pipeline_id ?? "none"}-${r.pipeline_name}`}>
                        <td className="py-2.5 pr-4 font-medium">{r.pipeline_name}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{r.leads_count}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{r.processed_by_manager_count}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{moneyFmt.format(Number(r.received_amount))}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{moneyFmt.format(Number(r.debt_amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </AnalyticsTable>
              </AnalyticsPanel>
            </>
          )}
        </section>
      )}

      {mode === "detailed" && (
        <section className="space-y-4">
          {detailedQuery.isError && <p className="analytics-error">{(detailedQuery.error as Error).message}</p>}
          {detailedQuery.isLoading && <p className="lux-caption px-1">Загрузка…</p>}
          {detailedQuery.data && (
            <>
              <div className="analytics-kpi-grid sm:grid-cols-3">
                <MetricCard label={lex.guestsMetricLabel} value={detailedQuery.data.total_leads} tone="accent" />
                <MetricCard
                  label="Продано"
                  value={moneyFmt.format(Number(detailedQuery.data.total_sold_amount))}
                  tone="success"
                />
                <MetricCard
                  label="Не оплачено"
                  value={moneyFmt.format(Number(detailedQuery.data.total_unpaid_amount))}
                  tone="warning"
                />
              </div>
              <AnalyticsPanel title="По менеджерам">
                <AnalyticsTable minWidth={760}>
                  <thead>
                    <tr>
                      <th className="py-2 pr-4">{lex.thStaff}</th>
                      <th className="py-2 pr-4">{lex.leadCol}</th>
                      <th className="py-2 pr-4">Продано</th>
                      <th className="py-2 pr-4">Не оплачено</th>
                      <th className="py-2 pr-4" title="Сколько лидов написали / скольким менеджер ответил">
                        Ответили
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailedQuery.data.by_manager.map((r) => (
                      <tr key={`${r.manager_id ?? "none"}-${r.manager_name}`}>
                        <td className="py-2.5 pr-4 font-medium">{r.manager_name}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{r.leads_count}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{moneyFmt.format(Number(r.sold_amount))}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{moneyFmt.format(Number(r.unpaid_amount))}</td>
                        <td className="py-2.5 pr-4 tabular-nums">
                          <span className="font-medium text-[var(--mo-text)]">{r.clients_messaged_count ?? 0}</span>
                          <span className="mo-muted"> / </span>
                          <span className="font-medium text-[var(--mo-accent-hover)]">{r.manager_replied_count ?? 0}</span>
                          <span className="mt-0.5 block text-[10px] mo-muted">клиент · ответ</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </AnalyticsTable>
              </AnalyticsPanel>
            </>
          )}
        </section>
      )}
      </div>
    </div>
  );
}
