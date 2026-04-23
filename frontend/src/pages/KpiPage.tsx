import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { AccessDenied } from "@/components/AccessDenied";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type {
  SalesKpiManagerSnapshot,
  SalesKpiOwnerDashboard,
  SalesKpiPipelineMeta,
} from "@/lib/types";

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

function defaultYearMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function parsePlanInput(s: string): string {
  const t = s.replace(/\s/g, "").replace(",", ".");
  if (!t) return "0";
  return t;
}

export function KpiPage() {
  const role = decodeRoleFromToken(getStoredToken());
  const queryClient = useQueryClient();
  const isOwnerLike = role === "owner" || role === "super_owner";

  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  const [pipelineId, setPipelineId] = useState<number | null>(null);
  const [planDraft, setPlanDraft] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const planDraftScopeLoaded = useRef<string | null>(null);

  const pipelinesQuery = useQuery({
    queryKey: ["sales-kpi-pipelines"],
    queryFn: () => apiFetch<SalesKpiPipelineMeta[]>("/api/sales-kpi/pipelines"),
    enabled: role !== "expert" && role !== "finance_analyst",
  });

  useEffect(() => {
    const list = pipelinesQuery.data;
    if (!list?.length) return;
    if (pipelineId == null || !list.some((p) => p.id === pipelineId)) {
      setPipelineId(list[0].id);
    }
  }, [pipelinesQuery.data, pipelineId]);

  const ownerQs = useMemo(() => {
    if (!pipelineId) return "";
    const p = new URLSearchParams();
    p.set("pipeline_id", String(pipelineId));
    p.set("year_month", yearMonth);
    return p.toString();
  }, [pipelineId, yearMonth]);

  const ownerDash = useQuery({
    queryKey: ["sales-kpi-owner", ownerQs],
    queryFn: () => apiFetch<SalesKpiOwnerDashboard>(`/api/sales-kpi/owner-dashboard?${ownerQs}`),
    enabled: Boolean(isOwnerLike && pipelineId),
  });

  const managerQs = ownerQs;

  const managerSnap = useQuery({
    queryKey: ["sales-kpi-manager", managerQs],
    queryFn: () => apiFetch<SalesKpiManagerSnapshot>(`/api/sales-kpi/manager?${managerQs}`),
    enabled: Boolean(!isOwnerLike && pipelineId && (role === "manager" || role === "admin")),
  });

  useEffect(() => {
    planDraftScopeLoaded.current = null;
  }, [pipelineId, yearMonth]);

  useEffect(() => {
    if (!ownerDash.data || !pipelineId) return;
    const scope = `${pipelineId}|${yearMonth}`;
    if (planDraftScopeLoaded.current === scope) return;
    planDraftScopeLoaded.current = scope;
    const next: Record<number, string> = {};
    for (const m of ownerDash.data.managers) {
      next[m.manager_id] = String(Number(m.plan_amount) || "");
    }
    setPlanDraft(next);
  }, [ownerDash.data, pipelineId, yearMonth]);

  const savePlans = useMutation({
    mutationFn: async () => {
      if (!pipelineId) throw new Error("Выберите воронку");
      const plans = Object.entries(planDraft).map(([manager_user_id, v]) => ({
        manager_user_id: Number(manager_user_id),
        plan_amount: parsePlanInput(v),
      }));
      await apiFetch<void>("/api/sales-kpi/plans", {
        method: "PUT",
        body: JSON.stringify({ pipeline_id: pipelineId, year_month: yearMonth, plans }),
      });
    },
    onSuccess: () => {
      planDraftScopeLoaded.current = null;
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-owner"] });
      toast.success("Планы сохранены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (role === "expert" || role === "finance_analyst") {
    return <AccessDenied message="Раздел KPI недоступен для вашей роли." />;
  }

  if (pipelinesQuery.isError) {
    return (
      <div className="mx-auto max-w-4xl p-6 text-red-300">
        {(pipelinesQuery.error as Error).message}
      </div>
    );
  }

  const pipelines = pipelinesQuery.data ?? [];
  const selectedPipe = pipelines.find((p) => p.id === pipelineId);

  return (
    <div className="relative mx-auto max-w-6xl space-y-6 pb-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white">KPI продаж</h1>
        <p className="text-sm text-slate-400">
          План на месяц по воронке эксперта и менеджерам. Факт — сумма оплат по онлайн‑записям с датой визита в
          выбранном месяце. Линейный темп: план × (день месяца / число дней в месяце).
        </p>
      </header>

      <section className="grid gap-3 rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Месяц
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-300 sm:col-span-2 lg:col-span-2">
          Воронка (эксперт)
          <select
            value={pipelineId ?? ""}
            onChange={(e) => setPipelineId(Number(e.target.value) || null)}
            className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.expert_name ? ` — ${p.expert_name}` : ""}
              </option>
            ))}
          </select>
        </label>
      </section>

      {pipelinesQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}

      {!pipelines.length && pipelinesQuery.isSuccess ? (
        <p className="text-sm text-amber-200">Нет доступных воронок. Для менеджера проверьте назначения в «Сотрудники».</p>
      ) : null}

      {isOwnerLike && pipelineId ? (
        <>
          <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-white">Планы менеджеров</h2>
              <button
                type="button"
                disabled={savePlans.isPending || ownerDash.isLoading}
                onClick={() => void savePlans.mutateAsync()}
                className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
              >
                Сохранить планы
              </button>
            </div>
            {ownerDash.isError && <p className="text-sm text-red-300">{(ownerDash.error as Error).message}</p>}
            {ownerDash.isLoading && <p className="text-sm text-slate-400">Загрузка планов и факта…</p>}
            {ownerDash.data && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm text-slate-200">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="py-2 pr-3">Менеджер</th>
                      <th className="py-2 pr-3">План / мес</th>
                      <th className="py-2 pr-3">Оплачено</th>
                      <th className="py-2 pr-3">% плана</th>
                      <th className="py-2 pr-3">Темп (к сегодня)</th>
                      <th className="py-2 pr-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {ownerDash.data.managers.map((m) => (
                      <Fragment key={m.manager_id}>
                        <tr className="border-t border-slate-800">
                          <td className="py-2 pr-3 font-medium">{m.manager_name}</td>
                          <td className="py-2 pr-3">
                            <input
                              type="text"
                              inputMode="decimal"
                              className="w-32 rounded-lg border border-slate-600/60 bg-slate-900/60 px-2 py-1 text-white"
                              value={planDraft[m.manager_id] ?? ""}
                              onChange={(e) =>
                                setPlanDraft((prev) => ({ ...prev, [m.manager_id]: e.target.value }))
                              }
                              placeholder="0"
                            />
                          </td>
                          <td className="py-2 pr-3">{moneyFmt.format(Number(m.actual_paid))}</td>
                          <td className="py-2 pr-3">
                            {m.month_progress_percent != null ? `${m.month_progress_percent.toFixed(1)}%` : "—"}
                          </td>
                          <td className="py-2 pr-3">
                            {m.pace_percent != null ? `${m.pace_percent.toFixed(1)}%` : "—"}
                          </td>
                          <td className="py-2 pr-3 text-right">
                            <button
                              type="button"
                              className="text-xs text-purple-300 hover:underline"
                              onClick={() =>
                                setExpanded((x) => ({ ...x, [m.manager_id]: !x[m.manager_id] }))
                              }
                            >
                              {expanded[m.manager_id] ? "Скрыть услуги" : "По услугам"}
                            </button>
                          </td>
                        </tr>
                        {expanded[m.manager_id] ? (
                          <tr className="bg-slate-900/30">
                            <td colSpan={6} className="px-3 pb-3 pt-0">
                              <div className="mt-1 rounded-lg border border-slate-700/50 p-2 text-xs">
                                <div className="mb-1 text-slate-500">
                                  Доля плана менеджера по направлению записи (оплачено / план × 100%)
                                </div>
                                <table className="w-full text-left text-slate-300">
                                  <thead>
                                    <tr className="text-slate-500">
                                      <th className="py-1 pr-2">Услуга</th>
                                      <th className="py-1 pr-2">Оплачено</th>
                                      <th className="py-1">% от плана</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {m.by_service.length === 0 ? (
                                      <tr>
                                        <td colSpan={3} className="py-2 text-slate-500">
                                          Нет оплат за период
                                        </td>
                                      </tr>
                                    ) : (
                                      m.by_service.map((s) => (
                                        <tr key={s.direction_id}>
                                          <td className="py-1 pr-2">{s.direction_name}</td>
                                          <td className="py-1 pr-2">
                                            {moneyFmt.format(Number(s.paid_amount))}
                                          </td>
                                          <td className="py-1">
                                            {s.percent_of_plan != null
                                              ? `${s.percent_of_plan.toFixed(1)}%`
                                              : "—"}
                                          </td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {selectedPipe ? (
            <p className="text-xs text-slate-500">
              Воронка «{selectedPipe.name}»
              {selectedPipe.expert_name ? `, эксперт: ${selectedPipe.expert_name}` : ""}. Дней в месяце:{" "}
              {ownerDash.data?.days_in_month ?? "—"}, для темпа учтено дней:{" "}
              {ownerDash.data?.elapsed_days_for_pacing ?? "—"}.
            </p>
          ) : null}
        </>
      ) : null}

      {!isOwnerLike && (role === "manager" || role === "admin") && pipelineId ? (
        <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4">
          <h2 className="mb-3 text-lg font-semibold text-white">Мой KPI</h2>
          {managerSnap.isError && <p className="text-sm text-red-300">{(managerSnap.error as Error).message}</p>}
          {managerSnap.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
          {managerSnap.data ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-900/40 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">План на месяц</div>
                <div className="mt-1 text-2xl font-semibold text-white">
                  {managerSnap.data.plan_amount != null
                    ? moneyFmt.format(Number(managerSnap.data.plan_amount))
                    : "Не задан"}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Дневная часть: {moneyFmt.format(Number(managerSnap.data.daily_plan))} ({managerSnap.data.days_in_month}{" "}
                  дн.)
                </div>
              </div>
              <div className="rounded-xl bg-slate-900/40 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Оплачено (факт)</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-300">
                  {moneyFmt.format(Number(managerSnap.data.actual_paid))}
                </div>
              </div>
              <div className="rounded-xl bg-slate-900/40 p-4 sm:col-span-2">
                <div className="mb-2 flex justify-between text-sm text-slate-300">
                  <span>Выполнение плана за месяц</span>
                  <span>
                    {managerSnap.data.month_progress_percent != null
                      ? `${managerSnap.data.month_progress_percent.toFixed(1)}%`
                      : "—"}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
                    style={{
                      width: `${Math.min(100, managerSnap.data.month_progress_percent ?? 0)}%`,
                    }}
                  />
                </div>
                <div className="mt-3 mb-2 flex justify-between text-sm text-slate-300">
                  <span>Темп к сегодня (факт / линейный план)</span>
                  <span>
                    {managerSnap.data.pace_percent != null
                      ? `${managerSnap.data.pace_percent.toFixed(1)}%`
                      : "—"}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 transition-all"
                    style={{
                      width: `${Math.min(100, managerSnap.data.pace_percent ?? 0)}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Линейный план на сегодня:{" "}
                  {moneyFmt.format(Number(managerSnap.data.linear_target_to_date))}. План задаёт владелец в этом
                  разделе.
                </p>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
