import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import { appLexicon } from "@/lib/appLexicon";
import type { AnalyticsOverviewRead, DetailedAnalyticsRead, FullAnalyticsRead, Pipeline } from "@/lib/types";

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

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
    <div className="relative mx-auto max-w-6xl space-y-6 pb-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--mo-text)]">{lex.analyticsTitle}</h1>
        <p className="text-sm lux-caption">{lex.analyticsIntro}</p>
      </header>

      <section className="mo-section p-4">
        <div className="grid gap-3 md:grid-cols-[170px_170px_200px_1fr_1fr_auto]">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "overview" | "full" | "detailed")}
            className="mo-input"
          >
            <option value="overview">Обзор 360</option>
            <option value="full">Полная</option>
            <option value="detailed">Детальная</option>
          </select>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as "day" | "month" | "custom")}
            className="mo-input"
          >
            <option value="day">За день</option>
            <option value="month">За месяц</option>
            <option value="custom">За период</option>
          </select>
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
          <input
            type="date"
            disabled={period !== "custom"}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mo-input disabled:opacity-50"
          />
          <input
            type="date"
            disabled={period !== "custom"}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mo-input disabled:opacity-50"
          />
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
                  [lex.thStaff, lex.leadCol, "Продано", "Не оплачено"],
                  detailedQuery.data.by_manager.map((r) => [
                    r.manager_name,
                    r.leads_count,
                    Number(r.sold_amount),
                    Number(r.unpaid_amount),
                  ]),
                );
              }
            }}
            className="rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/60 px-4 py-2 text-sm text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]"
          >
            Экспорт CSV
          </button>
        </div>
      </section>

      {mode === "overview" && (
        <section className="space-y-4 mo-section p-4">
          {overviewQuery.isError && <p className="text-sm text-red-300">{(overviewQuery.error as Error).message}</p>}
          {overviewQuery.isLoading && <p className="text-sm lux-caption">Загрузка...</p>}
          {overviewQuery.data && (
            <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl bg-white p-3 text-sm text-[var(--mo-text)]">
                  {lex.guestsMetricLabel}: <b>{overviewQuery.data.executive.leads_total}</b>
                </div>
                <div className="rounded-xl bg-white p-3 text-sm text-[var(--mo-text)]">
                  Win Rate: <b>{overviewQuery.data.executive.win_rate_pct}%</b>
                </div>
                <div className="rounded-xl bg-white p-3 text-sm text-[var(--mo-text)]">
                  Оплачено: <b>{moneyFmt.format(Number(overviewQuery.data.executive.paid_amount))}</b>
                </div>
                <div className="rounded-xl bg-white p-3 text-sm text-[var(--mo-text)]">
                  Не оплачено: <b>{moneyFmt.format(Number(overviewQuery.data.executive.unpaid_amount))}</b>
                </div>
                <div className="rounded-xl bg-white p-3 text-sm text-[var(--mo-text)]">
                  Первый ответ:{" "}
                  <b>
                    {overviewQuery.data.executive.avg_first_response_minutes == null
                      ? "—"
                      : `${overviewQuery.data.executive.avg_first_response_minutes} мин`}
                  </b>
                </div>
                <div className="rounded-xl bg-white p-3 text-sm text-[var(--mo-text)]">
                  {lex.leadCycle}:{" "}
                  <b>
                    {overviewQuery.data.executive.avg_lead_cycle_hours == null
                      ? "—"
                      : `${overviewQuery.data.executive.avg_lead_cycle_hours} ч`}
                  </b>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--mo-border)] bg-white/30 p-3">
                <h3 className="mb-2 lux-subheading text-sm">Алерты</h3>
                {overviewQuery.data.alerts.summary.length === 0 ? (
                  <p className="text-sm text-[#0f4c3a]">Критичных отклонений не найдено.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-amber-200">
                    {overviewQuery.data.alerts.summary.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-[var(--mo-border)] bg-white/30 p-3">
                  <h3 className="mb-2 lux-subheading text-sm">{lex.sectionStageFlow}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-sm text-[var(--mo-text)]">
                      <thead className="lux-caption">
                        <tr>
                          <th className="py-2 pr-3">Стадия</th>
                          <th className="py-2 pr-3">{lex.leadCol}</th>
                          <th className="py-2 pr-3">В след. стадию</th>
                          <th className="py-2 pr-3">Ср. время</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overviewQuery.data.stage_conversion.map((r) => (
                          <tr key={r.stage_id} className="border-t border-[var(--mo-border)]">
                            <td className="py-2 pr-3">{r.stage_name}</td>
                            <td className="py-2 pr-3">{r.leads_count}</td>
                            <td className="py-2 pr-3">{r.conversion_to_next_pct == null ? "—" : `${r.conversion_to_next_pct}%`}</td>
                            <td className="py-2 pr-3">{r.avg_time_in_stage_hours == null ? "—" : `${r.avg_time_in_stage_hours} ч`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--mo-border)] bg-white/30 p-3">
                  <h3 className="mb-2 lux-subheading text-sm">Причины потерь</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-sm text-[var(--mo-text)]">
                      <thead className="lux-caption">
                        <tr>
                          <th className="py-2 pr-3">Причина</th>
                          <th className="py-2 pr-3">Кол-во</th>
                          <th className="py-2 pr-3">Доля</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overviewQuery.data.loss_reasons.map((r) => (
                          <tr key={r.reason} className="border-t border-[var(--mo-border)]">
                            <td className="py-2 pr-3">{r.reason}</td>
                            <td className="py-2 pr-3">{r.count}</td>
                            <td className="py-2 pr-3">{r.share_pct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--mo-border)] bg-white/30 p-3">
                <h3 className="mb-2 lux-subheading text-sm">{lex.sourcesTitle}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm text-[var(--mo-text)]">
                      <thead className="lux-caption">
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
                        <tr key={r.source} className="border-t border-[var(--mo-border)]">
                          <td className="py-2 pr-3">{r.source}</td>
                          <td className="py-2 pr-3">{r.leads_count}</td>
                          <td className="py-2 pr-3">{r.lead_share_pct}%</td>
                          <td className="py-2 pr-3">{moneyFmt.format(Number(r.sold_amount))}</td>
                          <td className="py-2 pr-3">{moneyFmt.format(Number(r.paid_amount))}</td>
                          <td className="py-2 pr-3">{moneyFmt.format(Number(r.unpaid_amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--mo-border)] bg-white/30 p-3">
                <h3 className="mb-2 lux-subheading text-sm">{lex.sectionPlanFact}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm text-[var(--mo-text)]">
                      <thead className="lux-caption">
                        <tr>
                          <th className="py-2 pr-3">{lex.thStaff}</th>
                        <th className="py-2 pr-3">План</th>
                        <th className="py-2 pr-3">Факт</th>
                        <th className="py-2 pr-3">Выполнение</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overviewQuery.data.manager_plan_fact.map((r) => (
                        <tr key={`${r.manager_id ?? "none"}-${r.manager_name}`} className="border-t border-[var(--mo-border)]">
                          <td className="py-2 pr-3">{r.manager_name}</td>
                          <td className="py-2 pr-3">{moneyFmt.format(Number(r.plan_amount))}</td>
                          <td className="py-2 pr-3">{moneyFmt.format(Number(r.fact_paid_amount))}</td>
                          <td className="py-2 pr-3">{r.plan_completion_pct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {mode === "full" && (
        <section className="mo-section p-4">
          {fullQuery.isError && <p className="text-sm text-red-300">{(fullQuery.error as Error).message}</p>}
          {fullQuery.isLoading && <p className="text-sm lux-caption">Загрузка...</p>}
          {fullQuery.data && (
            <>
              <div className="mb-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-white p-3 text-sm text-[var(--mo-text)]">
                  {lex.guestsMetricLabel}: <b>{fullQuery.data.total_leads}</b>
                </div>
                <div className="rounded-xl bg-white p-3 text-sm text-[var(--mo-text)]">
                  Получено: <b>{moneyFmt.format(Number(fullQuery.data.total_received_amount))}</b>
                </div>
                <div className="rounded-xl bg-white p-3 text-sm text-[var(--mo-text)]">
                  Дебиторка: <b>{moneyFmt.format(Number(fullQuery.data.total_debt_amount))}</b>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm text-[var(--mo-text)]">
                  <thead className="lux-caption">
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
                      <tr key={`${r.pipeline_id ?? "none"}-${r.pipeline_name}`} className="border-t border-[var(--mo-border)]">
                        <td className="py-2 pr-4">{r.pipeline_name}</td>
                        <td className="py-2 pr-4">{r.leads_count}</td>
                        <td className="py-2 pr-4">{r.processed_by_manager_count}</td>
                        <td className="py-2 pr-4">{moneyFmt.format(Number(r.received_amount))}</td>
                        <td className="py-2 pr-4">{moneyFmt.format(Number(r.debt_amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {mode === "detailed" && (
        <section className="mo-section p-4">
          {detailedQuery.isError && <p className="text-sm text-red-300">{(detailedQuery.error as Error).message}</p>}
          {detailedQuery.isLoading && <p className="text-sm lux-caption">Загрузка...</p>}
          {detailedQuery.data && (
            <>
              <div className="mb-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-white p-3 text-sm text-[var(--mo-text)]">
                  {lex.guestsMetricLabel}: <b>{detailedQuery.data.total_leads}</b>
                </div>
                <div className="rounded-xl bg-white p-3 text-sm text-[var(--mo-text)]">
                  Продано: <b>{moneyFmt.format(Number(detailedQuery.data.total_sold_amount))}</b>
                </div>
                <div className="rounded-xl bg-white p-3 text-sm text-[var(--mo-text)]">
                  Не оплачено: <b>{moneyFmt.format(Number(detailedQuery.data.total_unpaid_amount))}</b>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm text-[var(--mo-text)]">
                  <thead className="lux-caption">
                    <tr>
                      <th className="py-2 pr-4">{lex.thStaff}</th>
                      <th className="py-2 pr-4">{lex.leadCol}</th>
                      <th className="py-2 pr-4">Продано</th>
                      <th className="py-2 pr-4">Не оплачено</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailedQuery.data.by_manager.map((r) => (
                      <tr key={`${r.manager_id ?? "none"}-${r.manager_name}`} className="border-t border-[var(--mo-border)]">
                        <td className="py-2 pr-4">{r.manager_name}</td>
                        <td className="py-2 pr-4">{r.leads_count}</td>
                        <td className="py-2 pr-4">{moneyFmt.format(Number(r.sold_amount))}</td>
                        <td className="py-2 pr-4">{moneyFmt.format(Number(r.unpaid_amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
