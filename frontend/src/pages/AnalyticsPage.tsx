import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import { appLexicon } from "@/lib/appLexicon";
import { formatMoney } from "@/lib/money";
import { AnalyticsServicesCharts } from "@/components/analytics/AnalyticsServicesCharts";
import { DateField } from "@/components/DateField";
import type {
  AnalyticsOverviewRead,
  DetailedAnalyticsRead,
  FullAnalyticsRead,
  ManagerPerformanceItem,
  Pipeline,
  ServicesAnalyticsExpertStat,
  ServicesAnalyticsRead,
  ServicesAnalyticsServiceStat,
} from "@/lib/types";

type AnalyticsDimension = "managers" | "services";

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
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "success" | "warning" | "accent" | "neutral";
  hint?: string;
}) {
  return (
    <div className={`mo-kpi analytics-kpi analytics-kpi--${tone}`}>
      <div className="mo-kpi-label">{label}</div>
      <div className="mo-kpi-value">{value}</div>
      {hint ? <div className="analytics-kpi-hint">{hint}</div> : null}
    </div>
  );
}

function scoreTone(score: number): "good" | "mid" | "low" {
  if (score >= 70) return "good";
  if (score >= 40) return "mid";
  return "low";
}

function ScoreBar({ value, label }: { value: number; label?: string }) {
  const tone = scoreTone(value);
  return (
    <div className={`analytics-score analytics-score--${tone}`} title={label}>
      <div className="analytics-score-track">
        <div className="analytics-score-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="analytics-score-num tabular-nums">{value}</span>
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

function analyticsErrorText(message: string): string {
  if (/date_from|date_to/i.test(message) || /дат/i.test(message)) {
    return "Выберите даты «С» и «По» — без них период не считается.";
  }
  return message;
}

export function AnalyticsPage() {
  const lex = appLexicon;
  const [dimension, setDimension] = useState<AnalyticsDimension>("managers");
  const [mode, setMode] = useState<"overview" | "full" | "detailed">("overview");
  const [period, setPeriod] = useState<"day" | "month" | "custom">("day");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pipelineId, setPipelineId] = useState<number | "all">("all");

  const periodReady = period !== "custom" || Boolean(dateFrom && dateTo);
  const managersMode = dimension === "managers";
  const servicesMode = dimension === "services";

  useEffect(() => {
    if (!servicesMode) return;
    // Для услуг удобнее сразу «за месяц» — живые данные клиники.
    setPeriod((p) => (p === "day" ? "month" : p));
  }, [servicesMode]);

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

  const pipelines = pipelinesQuery.data ?? [];
  const servicesPipelineId = typeof pipelineId === "number" ? pipelineId : pipelines[0]?.id ?? null;

  useEffect(() => {
    if (!servicesMode) return;
    if (typeof pipelineId === "number") return;
    const first = pipelines[0]?.id;
    if (first != null) setPipelineId(first);
  }, [servicesMode, pipelineId, pipelines]);

  const servicesQs = useMemo(() => {
    if (servicesPipelineId == null) return "";
    const p = new URLSearchParams();
    p.set("pipeline_id", String(servicesPipelineId));
    p.set("period", period);
    if (period === "custom") {
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
    }
    return p.toString();
  }, [servicesPipelineId, period, dateFrom, dateTo]);

  const fullQuery = useQuery({
    queryKey: ["analytics-full", qs],
    queryFn: () => apiFetch<FullAnalyticsRead>(`/api/analytics/full?${qs}`),
    enabled: managersMode && periodReady,
  });

  const detailedQuery = useQuery({
    queryKey: ["analytics-detailed", qs],
    queryFn: () => apiFetch<DetailedAnalyticsRead>(`/api/analytics/detailed?${qs}`),
    enabled: managersMode && periodReady,
  });

  const overviewQuery = useQuery({
    queryKey: ["analytics-overview", qs],
    queryFn: () => apiFetch<AnalyticsOverviewRead>(`/api/analytics/overview?${qs}`),
    enabled: managersMode && periodReady,
  });

  const servicesQuery = useQuery({
    queryKey: ["analytics-services", servicesQs],
    queryFn: async () => {
      try {
        return await apiFetch<ServicesAnalyticsRead>(`/api/analytics/services?${servicesQs}`, {
          timeoutMs: 60_000,
        });
      } catch (err) {
        // Fallback пока бэкенд Amvera без /analytics/services: отчёт компании за месяц.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/404|Not Found|Failed to fetch|Network/i.test(msg) && !/не найден/i.test(msg)) {
          // Если это 403/401 — пробрасываем
          if (/403|401|доступ|Unauthorized|Forbidden/i.test(msg)) throw err;
        }
        const ym =
          period === "custom" && dateFrom
            ? dateFrom.slice(0, 7)
            : (() => {
                const d = new Date();
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
              })();
        if (servicesPipelineId == null) throw err;
        const cr = await apiFetch<{
          pipeline_id: number;
          pipeline_name: string;
          year_month: string;
          revenue_total: string | number;
          debtor_total: string | number;
          creditor_total?: string | number;
          service_stats?: ServicesAnalyticsServiceStat[];
          expert_stats?: ServicesAnalyticsExpertStat[];
        }>(`/api/sales-kpi/company-report?pipeline_id=${servicesPipelineId}&year_month=${ym}`, {
          timeoutMs: 60_000,
        });
        const [y, m] = ym.split("-").map(Number);
        const last = new Date(y, m, 0).getDate();
        return {
          pipeline_id: cr.pipeline_id,
          pipeline_name: cr.pipeline_name,
          period: "month",
          period_start: `${ym}-01`,
          period_end: `${ym}-${String(last).padStart(2, "0")}`,
          date_from: `${ym}-01`,
          date_to: `${ym}-${String(last).padStart(2, "0")}`,
          revenue_total: cr.revenue_total,
          debtor_total: cr.debtor_total,
          creditor_total: cr.creditor_total ?? 0,
          service_stats: cr.service_stats ?? [],
          expert_stats: (cr.expert_stats ?? []).map((e) => ({
            ...e,
            booked_count: 0,
          })),
        } satisfies ServicesAnalyticsRead;
      }
    },
    enabled: servicesMode && Boolean(servicesQs) && periodReady,
  });

  const servicesLiveEmpty =
    Boolean(servicesQuery.data) &&
    (servicesQuery.data?.service_stats ?? []).length === 0 &&
    Number(servicesQuery.data?.revenue_total ?? 0) === 0;

  const snapshotQuery = useQuery({
    queryKey: ["analytics-services-snapshot"],
    queryFn: async () => {
      const res = await fetch("/reports/services-analytics-snapshot.json");
      if (!res.ok) throw new Error("Снимок отчёта не найден");
      return (await res.json()) as {
        pipeline_name: string;
        year_month?: string;
        period_start?: string;
        period_end?: string;
        revenue_total: number | string;
        debtor_total: number | string;
        service_stats: ServicesAnalyticsServiceStat[];
        expert_stats: ServicesAnalyticsExpertStat[];
      };
    },
    enabled: servicesMode && servicesLiveEmpty,
    staleTime: Infinity,
  });

  const chartServices =
    !servicesLiveEmpty && servicesQuery.data
      ? (servicesQuery.data.service_stats ?? [])
      : (snapshotQuery.data?.service_stats ?? []);
  const chartExperts =
    !servicesLiveEmpty && servicesQuery.data
      ? (servicesQuery.data.expert_stats ?? [])
      : (snapshotQuery.data?.expert_stats ?? []);

  const htmlReportHref = useMemo(() => {
    const p = new URLSearchParams();
    p.set("period", period);
    if (period === "custom") {
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
    }
    if (servicesPipelineId != null) p.set("pipeline_id", String(servicesPipelineId));
    if (servicesLiveEmpty) p.set("snapshot", "1");
    const q = p.toString();
    return `/reports/services-analytics.html${q ? `?${q}` : ""}`;
  }, [period, dateFrom, dateTo, servicesPipelineId, servicesLiveEmpty]);

  return (
    <div className="analytics-page mo-fill-page">
      <header className="mo-admin-page-head analytics-page-header">
        <h1 className="lux-heading-page">{lex.analyticsTitle}</h1>
        <p className="lux-body mt-1.5 max-w-2xl">{lex.analyticsIntro}</p>
        <div className="crm-view-switch mt-3 inline-flex" role="tablist" aria-label="Раздел аналитики">
          <button
            type="button"
            role="tab"
            data-active={managersMode ? "true" : "false"}
            aria-selected={managersMode}
            onClick={() => setDimension("managers")}
          >
            Менеджеры
          </button>
          <button
            type="button"
            role="tab"
            data-active={servicesMode ? "true" : "false"}
            aria-selected={servicesMode}
            onClick={() => setDimension("services")}
          >
            Услуги
          </button>
        </div>
      </header>

      <div className="mo-fill-page-scroll space-y-5 pt-4">
      <section className="mo-section analytics-toolbar-section p-4 sm:p-5">
        <div className="analytics-toolbar">
          {managersMode ? (
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
          ) : null}
          <label className="analytics-toolbar-field">
            <span>Период</span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as "day" | "month" | "custom")}
              className="mo-input"
            >
              <option value="day">{managersMode ? "За день (18:00→17:00)" : "За день"}</option>
              <option value="month">За месяц</option>
              <option value="custom">Свой период</option>
            </select>
          </label>
          <label className="analytics-toolbar-field">
            <span>Воронка</span>
            <select
              value={
                servicesMode
                  ? servicesPipelineId != null
                    ? String(servicesPipelineId)
                    : ""
                  : pipelineId === "all"
                    ? "all"
                    : String(pipelineId)
              }
              onChange={(e) => {
                if (servicesMode) {
                  setPipelineId(Number(e.target.value));
                  return;
                }
                setPipelineId(e.target.value === "all" ? "all" : Number(e.target.value));
              }}
              className="mo-input"
            >
              {!servicesMode ? <option value="all">{lex.pipelineAll}</option> : null}
              {pipelines.length === 0 && servicesMode ? <option value="">Нет воронок</option> : null}
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label
            className={["analytics-toolbar-field", period === "custom" && !dateFrom ? "is-needed" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <span>С</span>
            <DateField
              value={dateFrom}
              onChange={setDateFrom}
              disabled={period !== "custom"}
              aria-label="Дата с"
            />
          </label>
          <label
            className={["analytics-toolbar-field", period === "custom" && !dateTo ? "is-needed" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <span>По</span>
            <DateField
              value={dateTo}
              onChange={setDateTo}
              disabled={period !== "custom"}
              aria-label="Дата по"
            />
          </label>
          {servicesMode ? (
            <a
              className="btn-secondary analytics-export-btn analytics-html-link"
              href={htmlReportHref}
              target="_blank"
              rel="noreferrer"
            >
              HTML-отчёт с графиками
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (servicesMode && chartServices.length) {
                const stamp =
                  servicesQuery.data?.date_from && servicesQuery.data?.date_to
                    ? `${servicesQuery.data.date_from}_${servicesQuery.data.date_to}`
                    : period;
                downloadCsv(
                  `analytics_services_${stamp}.csv`,
                  [
                    "Услуга",
                    "Записей",
                    "Явились",
                    "Не явились",
                    "Ещё booked",
                    "Оплачено полностью",
                    "Оплачено при неявке",
                    "Всего оплат",
                    "Дебиторка",
                  ],
                  chartServices.map((s) => [
                    s.direction_name,
                    s.appointments_total,
                    s.appeared_count,
                    s.no_show_count,
                    s.booked_count ?? 0,
                    Number(s.paid_full_amount ?? 0),
                    Number(s.paid_no_show_amount ?? 0),
                    Number(s.revenue_paid),
                    Number(s.debtor_amount ?? 0),
                  ]),
                );
                return;
              }
              if (mode === "overview" && overviewQuery.data) {
                downloadCsv(
                  "analytics_overview_managers.csv",
                  [
                    lex.thStaff,
                    "Успеваемость",
                    "Активность",
                    "Win %",
                    "План %",
                    "Ответы %",
                    "Исх. сообщения",
                    "Первый ответ (мин)",
                  ],
                  (overviewQuery.data.manager_performance ?? []).map((r: ManagerPerformanceItem) => [
                    r.manager_name,
                    r.performance_score,
                    r.activity_score,
                    r.win_rate_pct,
                    r.plan_completion_pct,
                    r.reply_rate_pct,
                    r.outbound_messages_count,
                    r.avg_first_response_minutes ?? "",
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
                  [
                    lex.thStaff,
                    lex.leadCol,
                    "Продано",
                    "Не оплачено",
                    "Успеваемость",
                    "Активность",
                    "Win %",
                    "Ответы %",
                    "Исх. сообщения",
                  ],
                  detailedQuery.data.by_manager.map((r) => [
                    r.manager_name,
                    r.leads_count,
                    Number(r.sold_amount),
                    Number(r.unpaid_amount),
                    r.performance_score ?? "",
                    r.activity_score ?? "",
                    r.win_rate_pct ?? "",
                    r.reply_rate_pct ?? "",
                    r.outbound_messages_count ?? 0,
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

      {servicesMode && (
        <section className="space-y-4">
          {servicesPipelineId == null ? (
            <p className="analytics-hint">Сначала создайте воронку — без неё сводка по услугам недоступна.</p>
          ) : null}
          {servicesPipelineId != null && servicesQuery.isError ? (
            <p className="analytics-error">{analyticsErrorText((servicesQuery.error as Error).message)}</p>
          ) : null}
          {servicesQuery.isLoading ? <p className="lux-caption px-1">Загрузка…</p> : null}
          {servicesQuery.data ? (
            <>
              <div className="analytics-kpi-grid sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  label="Выручка"
                  value={moneyFmt.format(
                    Number(
                      servicesLiveEmpty
                        ? (snapshotQuery.data?.revenue_total ?? 0)
                        : servicesQuery.data.revenue_total,
                    ),
                  )}
                  tone="success"
                />
                <MetricCard
                  label="Дебиторка"
                  value={moneyFmt.format(
                    Number(
                      servicesLiveEmpty
                        ? (snapshotQuery.data?.debtor_total ?? 0)
                        : servicesQuery.data.debtor_total,
                    ),
                  )}
                  tone="warning"
                />
                <MetricCard
                  label="Услуг в сводке"
                  value={chartServices.length}
                  tone="accent"
                />
                <MetricCard
                  label="Воронка"
                  value={
                    servicesLiveEmpty
                      ? (snapshotQuery.data?.pipeline_name ?? servicesQuery.data.pipeline_name)
                      : servicesQuery.data.pipeline_name
                  }
                  tone="neutral"
                  hint={
                    servicesLiveEmpty
                      ? (snapshotQuery.data?.year_month ??
                          snapshotQuery.data?.period_start ??
                          "снимок")
                      : `${servicesQuery.data.date_from ?? ""} → ${servicesQuery.data.date_to ?? ""}`
                  }
                />
              </div>

              {servicesLiveEmpty ? (
                <p className="analytics-hint">
                  В этой базе за месяц пусто — ниже графики из снимка августа 2026 (live CRM). Полный
                  HTML-отчёт:{" "}
                  <a href={htmlReportHref} target="_blank" rel="noreferrer">
                    /reports/services-analytics.html
                  </a>
                </p>
              ) : null}

              <AnalyticsServicesCharts services={chartServices} experts={chartExperts} />

              <AnalyticsPanel title="По услугам">
                <p className="analytics-panel-note">
                  Отдельно: Курс, Курс 15, Протокол, Массаж и т.д. — итог по клинике за месяц.
                </p>
                <AnalyticsTable minWidth={1100}>
                  <thead>
                    <tr>
                      <th className="py-2 pr-3">Услуга</th>
                      <th className="py-2 pr-3">Записей</th>
                      <th className="py-2 pr-3">Явились</th>
                      <th className="py-2 pr-3">Не явились</th>
                      <th className="py-2 pr-3">Ещё booked</th>
                      <th className="py-2 pr-3">Оплачено полностью</th>
                      <th className="py-2 pr-3">Оплачено при неявке</th>
                      <th className="py-2 pr-3">Всего оплат</th>
                      <th className="py-2 pr-3">Дебиторка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartServices.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="analytics-empty-cell">
                          Нет записей за месяц
                        </td>
                      </tr>
                    ) : (
                      chartServices.map((s) => (
                        <tr key={s.direction_id ?? s.direction_name}>
                          <td className="py-2.5 pr-3 font-medium">{s.direction_name}</td>
                          <td className="py-2.5 pr-3 tabular-nums">{s.appointments_total}</td>
                          <td className="py-2.5 pr-3 tabular-nums">{s.appeared_count}</td>
                          <td className="py-2.5 pr-3 tabular-nums">{s.no_show_count}</td>
                          <td className="py-2.5 pr-3 tabular-nums">{s.booked_count ?? 0}</td>
                          <td className="py-2.5 pr-3 tabular-nums">
                            {moneyFmt.format(Number(s.paid_full_amount ?? 0))}
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums">
                            {moneyFmt.format(Number(s.paid_no_show_amount ?? 0))}
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums">{moneyFmt.format(Number(s.revenue_paid))}</td>
                          <td className="py-2.5 pr-3 tabular-nums">
                            {moneyFmt.format(Number(s.debtor_amount ?? 0))}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </AnalyticsTable>
              </AnalyticsPanel>

              <AnalyticsPanel title="По экспертам">
                <p className="analytics-panel-note">
                  Сводка по специалисту. Детализация по услугам — в таблице выше.
                </p>
                <AnalyticsTable minWidth={1000}>
                  <thead>
                    <tr>
                      <th className="py-2 pr-3">Эксперт</th>
                      <th className="py-2 pr-3">Записей</th>
                      <th className="py-2 pr-3">Явились</th>
                      <th className="py-2 pr-3">Не явились</th>
                      <th className="py-2 pr-3">Оплачено полностью</th>
                      <th className="py-2 pr-3">Оплачено при неявке</th>
                      <th className="py-2 pr-3">Всего оплат</th>
                      <th className="py-2 pr-3">Дебиторка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartExperts.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="analytics-empty-cell">
                          Нет данных за месяц
                        </td>
                      </tr>
                    ) : (
                      chartExperts.map((e) => (
                        <tr key={e.specialist_id}>
                          <td className="py-2.5 pr-3 font-medium">
                            <div>{e.specialist_name}</div>
                            {e.kpi_service_name ? (
                              <div className="text-[10px] mo-muted">KPI: {e.kpi_service_name}</div>
                            ) : null}
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums">{e.appointments_total}</td>
                          <td className="py-2.5 pr-3 tabular-nums">{e.appeared_count}</td>
                          <td className="py-2.5 pr-3 tabular-nums">{e.no_show_count}</td>
                          <td className="py-2.5 pr-3 tabular-nums">
                            {moneyFmt.format(Number(e.paid_full_amount ?? 0))}
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums">
                            {moneyFmt.format(Number(e.paid_no_show_amount ?? 0))}
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums">{moneyFmt.format(Number(e.revenue_paid))}</td>
                          <td className="py-2.5 pr-3 tabular-nums">{moneyFmt.format(Number(e.debtor_amount))}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </AnalyticsTable>
              </AnalyticsPanel>
            </>
          ) : null}
        </section>
      )}

      {managersMode && mode === "overview" && (
        <section className="space-y-4">
          {!periodReady ? (
            <p className="analytics-hint">Выберите даты «С» и «По» — тогда покажем аналитику за этот период.</p>
          ) : null}
          {periodReady && overviewQuery.isError && (
            <p className="analytics-error">{analyticsErrorText((overviewQuery.error as Error).message)}</p>
          )}
          {overviewQuery.isLoading && <p className="lux-caption px-1">Загрузка…</p>}
          {overviewQuery.data && (
            <>
              <div className="analytics-kpi-grid">
                <MetricCard label={lex.guestsMetricLabel} value={overviewQuery.data.executive.leads_total} tone="accent" />
                <MetricCard
                  label="Удачно"
                  value={`${overviewQuery.data.executive.win_rate_pct}%`}
                  tone="neutral"
                  hint="Доля лидов периода на стадии «Удачно»"
                />
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
                  label="Ответ в чате"
                  value={
                    overviewQuery.data.executive.avg_first_response_minutes == null
                      ? "—"
                      : `${overviewQuery.data.executive.avg_first_response_minutes} мин`
                  }
                  tone="default"
                  hint="От входящего сообщения до ответа менеджера"
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
                <MetricCard
                  label="Успеваемость"
                  value={
                    overviewQuery.data.executive.performance_score_avg == null
                      ? "—"
                      : overviewQuery.data.executive.performance_score_avg
                  }
                  tone="accent"
                  hint="План, ответы в чате и доля «Удачно»"
                />
                <MetricCard
                  label="Активность"
                  value={
                    overviewQuery.data.executive.activity_reply_rate_pct == null
                      ? "—"
                      : `${overviewQuery.data.executive.activity_reply_rate_pct}%`
                  }
                  tone="default"
                  hint="Доля диалогов с ответом менеджера"
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
                  <p className="analytics-panel-note">
                    «Дошли дальше» — сколько из дошедших до стадии уже на следующих. Не больше 100%. Время — только по реальным сменам стадии.
                  </p>
                  <AnalyticsTable minWidth={520}>
                    <thead>
                      <tr>
                        <th className="py-2 pr-3">Стадия</th>
                        <th className="py-2 pr-3">{lex.leadCol}</th>
                        <th className="py-2 pr-3">Дошли дальше</th>
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
                <p className="analytics-panel-note">
                  Строка появляется, только если в периоде есть лид с этим источником. Пустой канал не показываем.
                </p>
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

              <AnalyticsPanel title="Успеваемость и активность менеджеров">
                <p className="analytics-panel-note">
                  Успеваемость — план, win rate, скорость ответа. Активность — ответы в чате и исходящие сообщения.
                </p>
                <AnalyticsTable minWidth={880}>
                  <thead>
                    <tr>
                      <th className="py-2 pr-3">{lex.thStaff}</th>
                      <th className="py-2 pr-3">Успеваемость</th>
                      <th className="py-2 pr-3">Активность</th>
                      <th className="py-2 pr-3">Win</th>
                      <th className="py-2 pr-3">План</th>
                      <th className="py-2 pr-3">Ответы</th>
                      <th className="py-2 pr-3">Исх.</th>
                      <th className="py-2 pr-3">Первый ответ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(overviewQuery.data.manager_performance ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={8} className="analytics-empty-cell">
                          Нет данных за период
                        </td>
                      </tr>
                    ) : (
                      (overviewQuery.data.manager_performance ?? []).map((r) => (
                        <tr key={`${r.manager_id ?? "none"}-${r.manager_name}`}>
                          <td className="py-2.5 pr-3 font-medium">{r.manager_name}</td>
                          <td className="py-2.5 pr-3">
                            <ScoreBar
                              value={r.performance_score}
                              label="План 35% · Win 30% · ответы 25% · SLA 10%"
                            />
                          </td>
                          <td className="py-2.5 pr-3">
                            <ScoreBar value={r.activity_score} label="Ответы 65% · объём сообщений 35%" />
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums">{r.win_rate_pct}%</td>
                          <td className="py-2.5 pr-3 tabular-nums">{r.plan_completion_pct}%</td>
                          <td className="py-2.5 pr-3 tabular-nums">
                            {r.reply_rate_pct}%
                            <span className="mt-0.5 block text-[10px] mo-muted">
                              {r.manager_replied_count}/{r.clients_messaged_count}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums">{r.outbound_messages_count}</td>
                          <td className="py-2.5 pr-3 tabular-nums">
                            {r.avg_first_response_minutes == null ? "—" : `${r.avg_first_response_minutes} мин`}
                          </td>
                        </tr>
                      ))
                    )}
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

      {managersMode && mode === "full" && (
        <section className="space-y-4">
          {!periodReady ? (
            <p className="analytics-hint">Выберите даты «С» и «По» — тогда покажем аналитику за этот период.</p>
          ) : null}
          {periodReady && fullQuery.isError && (
            <p className="analytics-error">{analyticsErrorText((fullQuery.error as Error).message)}</p>
          )}
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

      {managersMode && mode === "detailed" && (
        <section className="space-y-4">
          {!periodReady ? (
            <p className="analytics-hint">Выберите даты «С» и «По» — тогда покажем аналитику за этот период.</p>
          ) : null}
          {periodReady && detailedQuery.isError && (
            <p className="analytics-error">{analyticsErrorText((detailedQuery.error as Error).message)}</p>
          )}
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
                <AnalyticsTable minWidth={920}>
                  <thead>
                    <tr>
                      <th className="py-2 pr-4">{lex.thStaff}</th>
                      <th className="py-2 pr-4">{lex.leadCol}</th>
                      <th className="py-2 pr-4">Продано</th>
                      <th className="py-2 pr-4">Не оплачено</th>
                      <th className="py-2 pr-4">Успеваемость</th>
                      <th className="py-2 pr-4">Активность</th>
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
                        <td className="py-2.5 pr-4">
                          <ScoreBar value={r.performance_score ?? 0} />
                        </td>
                        <td className="py-2.5 pr-4">
                          <ScoreBar value={r.activity_score ?? 0} />
                        </td>
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
