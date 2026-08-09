import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { AccessDenied } from "@/components/AccessDenied";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type {
  SalesKpiDebtorsReport,
  SalesKpiManualSale,
  SalesKpiPipelineMeta,
  SalesKpiSalesReport,
  SalesKpiWeightedPlan,
} from "@/lib/types";

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2,
});

type TabId = "plan" | "sales" | "manual" | "debtors";

type PlanDraftItem = {
  key: string;
  name: string;
  plan_qty: string;
  weight_percent: string;
  source_type: "direction" | "manual";
  direction_id: string;
  specialist_ids: number[];
};

function defaultYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function pctLabel(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function contribLabel(v: string | number): string {
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function num(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function KpiPage() {
  const queryClient = useQueryClient();
  const role = decodeRoleFromToken(getStoredToken());
  const isOwner = role === "owner" || role === "super_owner";
  const isAdminOrOwner = isOwner || role === "admin";
  const isManager = role === "manager";

  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  const [pipelineId, setPipelineId] = useState<number | null>(null);
  const [tab, setTab] = useState<TabId>(isOwner ? "plan" : "sales");

  const [bonusFund, setBonusFund] = useState("10000");
  const [planItems, setPlanItems] = useState<PlanDraftItem[]>([]);
  const [priceDraft, setPriceDraft] = useState<Record<number, string>>({});

  const [saleForm, setSaleForm] = useState({
    plan_item_id: "",
    manager_user_id: "",
    client_name: "",
    client_phone: "",
    service_amount: "",
    paid_amount: "",
    note: "",
  });
  const [payDraft, setPayDraft] = useState<Record<number, string>>({});

  const pipelinesQuery = useQuery({
    queryKey: ["sales-kpi-pipelines"],
    queryFn: () => apiFetch<SalesKpiPipelineMeta[]>("/api/sales-kpi/pipelines"),
    enabled: role !== "expert",
  });

  useEffect(() => {
    const list = pipelinesQuery.data ?? [];
    if (!list.length) return;
    if (pipelineId == null || !list.some((x) => x.id === pipelineId)) {
      setPipelineId(list[0].id);
    }
  }, [pipelinesQuery.data, pipelineId]);

  const qs = useMemo(() => {
    if (!pipelineId) return "";
    const p = new URLSearchParams();
    p.set("pipeline_id", String(pipelineId));
    p.set("year_month", yearMonth);
    return p.toString();
  }, [pipelineId, yearMonth]);

  const planQuery = useQuery({
    queryKey: ["sales-kpi-weighted-plan", qs],
    queryFn: () => apiFetch<SalesKpiWeightedPlan>(`/api/sales-kpi/weighted-plan?${qs}`),
    enabled: Boolean(pipelineId && (isOwner || isAdminOrOwner || isManager)),
  });

  const salesQuery = useQuery({
    queryKey: ["sales-kpi-sales-report", qs],
    queryFn: () => apiFetch<SalesKpiSalesReport>(`/api/sales-kpi/sales-report?${qs}`),
    enabled: Boolean(pipelineId && (tab === "sales" || tab === "plan")),
  });

  const manualQuery = useQuery({
    queryKey: ["sales-kpi-manual-sales", qs],
    queryFn: () => apiFetch<SalesKpiManualSale[]>(`/api/sales-kpi/manual-sales?${qs}`),
    enabled: Boolean(pipelineId && isAdminOrOwner && tab === "manual"),
  });

  const debtorsQuery = useQuery({
    queryKey: ["sales-kpi-debtors", qs],
    queryFn: () => apiFetch<SalesKpiDebtorsReport>(`/api/sales-kpi/debtors?${qs}`),
    enabled: Boolean(pipelineId && isAdminOrOwner && tab === "debtors"),
  });

  useEffect(() => {
    if (!planQuery.data) return;
    setBonusFund(String(num(planQuery.data.bonus_fund) || 10000));
    setPlanItems(
      planQuery.data.items.map((it, idx) => ({
        key: `id-${it.id}-${idx}`,
        name: it.name,
        plan_qty: String(it.plan_qty || ""),
        weight_percent: String(num(it.weight_percent) || ""),
        source_type: it.source_type === "direction" ? "direction" : "manual",
        direction_id: it.direction_id != null ? String(it.direction_id) : "",
        specialist_ids: Array.isArray(it.specialist_ids) ? it.specialist_ids.map(Number) : [],
      })),
    );
    const p: Record<number, string> = {};
    planQuery.data.directions.forEach((d) => {
      p[d.direction_id] = String(num(d.unit_price) || "");
    });
    setPriceDraft(p);
  }, [planQuery.data]);

  const savePlanMutation = useMutation({
    mutationFn: async () => {
      if (!pipelineId) throw new Error("Выберите воронку");
      const items = planItems
        .filter((x) => x.name.trim())
        .map((x, idx) => ({
          name: x.name.trim(),
          plan_qty: Number(x.plan_qty || 0),
          weight_percent: Number(x.weight_percent || 0),
          source_type: x.source_type,
          direction_id: x.source_type === "direction" ? Number(x.direction_id || 0) || null : null,
          specialist_ids: x.source_type === "direction" ? x.specialist_ids : [],
          sort_order: idx,
        }));
      for (const it of items) {
        if (it.source_type === "direction" && !(it.specialist_ids?.length || it.direction_id)) {
          throw new Error(`Для «${it.name}» привяжите экспертов онлайн-записи`);
        }
      }
      await apiFetch<void>("/api/sales-kpi/weighted-plan", {
        method: "PUT",
        body: JSON.stringify({
          pipeline_id: pipelineId,
          year_month: yearMonth,
          bonus_fund: Number(bonusFund || 10000),
          items,
          prices: (planQuery.data?.directions ?? []).map((d) => ({
            direction_id: d.direction_id,
            unit_price: Number(priceDraft[d.direction_id] || 0),
          })),
        }),
      });
    },
    onSuccess: () => {
      toast.success("План сохранён");
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-weighted-plan"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-sales-report"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createSaleMutation = useMutation({
    mutationFn: async () => {
      if (!pipelineId) throw new Error("Выберите воронку");
      await apiFetch<SalesKpiManualSale>("/api/sales-kpi/manual-sales", {
        method: "POST",
        body: JSON.stringify({
          pipeline_id: pipelineId,
          plan_item_id: Number(saleForm.plan_item_id),
          manager_user_id: Number(saleForm.manager_user_id),
          client_name: saleForm.client_name.trim(),
          client_phone: saleForm.client_phone.trim(),
          service_amount: Number(saleForm.service_amount),
          paid_amount: Number(saleForm.paid_amount || 0),
          note: saleForm.note.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Продажа добавлена");
      setSaleForm({
        plan_item_id: "",
        manager_user_id: "",
        client_name: "",
        client_phone: "",
        service_amount: "",
        paid_amount: "",
        note: "",
      });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-manual-sales"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-sales-report"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-debtors"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const payMutation = useMutation({
    mutationFn: async ({ id, paid }: { id: number; paid: number }) => {
      await apiFetch<SalesKpiManualSale>(`/api/sales-kpi/manual-sales/${id}/payment`, {
        method: "PATCH",
        body: JSON.stringify({ paid_amount: paid }),
      });
    },
    onSuccess: () => {
      toast.success("Оплата обновлена");
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-manual-sales"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-sales-report"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-debtors"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const returnMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiFetch<SalesKpiManualSale>(`/api/sales-kpi/manual-sales/${id}/return`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => {
      toast.success("Возврат отмечен — снято с KPI");
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-manual-sales"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-sales-report"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-debtors"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (role === "expert") {
    return <AccessDenied message="Раздел KPI недоступен для вашей роли." />;
  }

  const tabs: { id: TabId; label: string; show: boolean }[] = [
    { id: "plan", label: "План", show: isOwner },
    { id: "sales", label: "ПРОДАЖИ", show: true },
    { id: "manual", label: "Курсы / протоколы", show: isAdminOrOwner },
    { id: "debtors", label: "Дебиторка", show: isAdminOrOwner },
  ];

  const manualPlanItems = (planQuery.data?.items ?? []).filter((x) => x.source_type === "manual");
  const managers = planQuery.data?.managers ?? [];

  return (
    <div className="relative mx-auto max-w-[1500px] space-y-6 pb-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--mo-text)]">KPI продаж</h1>
        <p className="text-sm lux-caption">
          Услуги из онлайн-записи — в факт при 100% оплате. Курсы/протоколы вносит админ — в факт с оплаты ≥25%.
          Возвраты снимаются с расчёта. Бонус = фонд × сумма вкладов (перевыполнение не оплачивается).
        </p>
      </header>

      <section className="grid gap-3 mo-section p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm mo-muted">
          Месяц
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="mo-input"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm mo-muted">
          Воронка
          <select
            value={pipelineId ?? ""}
            onChange={(e) => setPipelineId(Number(e.target.value) || null)}
            className="mo-input"
          >
            {(pipelinesQuery.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.expert_name ? ` — эксперт: ${p.expert_name}` : ""}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="flex flex-wrap gap-2">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={tab === t.id ? "btn-primary text-sm" : "btn-secondary text-sm"}
            >
              {t.label}
            </button>
          ))}
      </div>

      {tab === "plan" && isOwner ? (
        <section className="mo-section space-y-4 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="lux-subheading">План на месяц</h2>
              <p className="mt-1 text-sm lux-caption">
                Один план на всех менеджеров. Для услуг из онлайн-записи привяжите экспертов — запись к
                ним пойдёт в факт этой услуги (при 100% оплате). Один эксперт = одна услуга KPI.
              </p>
            </div>
            <button
              type="button"
              onClick={() => savePlanMutation.mutate()}
              disabled={savePlanMutation.isPending}
              className="btn-primary text-sm disabled:opacity-50"
            >
              Сохранить план
            </button>
          </div>

          <label className="flex max-w-xs flex-col gap-1 text-sm mo-muted">
            Фонд бонуса на менеджера
            <input
              type="number"
              min={0}
              value={bonusFund}
              onChange={(e) => setBonusFund(e.target.value)}
              className="mo-input"
            />
          </label>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm text-[var(--mo-text)]">
              <thead>
                <tr className="border-b border-[var(--mo-border)] lux-caption">
                  <th className="py-2 pr-3">Показатель</th>
                  <th className="py-2 pr-3">Источник</th>
                  <th className="py-2 pr-3">Эксперты онлайн-записи</th>
                  <th className="py-2 pr-3">План (шт)</th>
                  <th className="py-2 pr-3">Вес (%)</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {planItems.map((row) => {
                  const takenElsewhere = new Set(
                    planItems
                      .filter((x) => x.key !== row.key && x.source_type === "direction")
                      .flatMap((x) => x.specialist_ids),
                  );
                  return (
                  <tr key={row.key} className="border-b border-[var(--mo-border)]/70">
                    <td className="py-2 pr-3">
                      <input
                        className="mo-input w-full min-w-[140px]"
                        value={row.name}
                        onChange={(e) =>
                          setPlanItems((prev) =>
                            prev.map((x) => (x.key === row.key ? { ...x, name: e.target.value } : x)),
                          )
                        }
                        placeholder="Логопед / Курс 15"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="mo-input"
                        value={row.source_type}
                        onChange={(e) =>
                          setPlanItems((prev) =>
                            prev.map((x) =>
                              x.key === row.key
                                ? {
                                    ...x,
                                    source_type: e.target.value === "direction" ? "direction" : "manual",
                                    specialist_ids:
                                      e.target.value === "direction" ? x.specialist_ids : [],
                                  }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="manual">Курс / протокол (админ)</option>
                        <option value="direction">Онлайн-запись</option>
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      {row.source_type === "direction" ? (
                        <div className="max-h-36 min-w-[220px] space-y-1 overflow-y-auto rounded border border-[var(--mo-border)] p-2">
                          {(planQuery.data?.specialists ?? []).filter((s) => s.is_active).length === 0 ? (
                            <span className="text-xs mo-muted">Нет экспертов в этой воронке</span>
                          ) : (
                            (planQuery.data?.specialists ?? [])
                              .filter((s) => s.is_active)
                              .map((s) => {
                                const checked = row.specialist_ids.includes(s.id);
                                const disabled = !checked && takenElsewhere.has(s.id);
                                return (
                                  <label
                                    key={s.id}
                                    className={`flex items-start gap-2 text-xs ${disabled ? "opacity-40" : ""}`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="mt-0.5"
                                      checked={checked}
                                      disabled={disabled}
                                      onChange={(e) => {
                                        const on = e.target.checked;
                                        setPlanItems((prev) =>
                                          prev.map((x) => {
                                            if (x.key !== row.key) return x;
                                            const next = on
                                              ? [...x.specialist_ids, s.id]
                                              : x.specialist_ids.filter((id) => id !== s.id);
                                            return {
                                              ...x,
                                              specialist_ids: next,
                                              direction_id: on
                                                ? String(s.direction_id)
                                                : x.direction_id,
                                            };
                                          }),
                                        );
                                      }}
                                    />
                                    <span>
                                      {s.full_name}
                                      {s.direction_name ? (
                                        <span className="mo-muted"> · {s.direction_name}</span>
                                      ) : null}
                                    </span>
                                  </label>
                                );
                              })
                          )}
                        </div>
                      ) : (
                        <span className="text-xs mo-muted">без записи</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        className="mo-input w-24"
                        value={row.plan_qty}
                        onChange={(e) =>
                          setPlanItems((prev) =>
                            prev.map((x) => (x.key === row.key ? { ...x, plan_qty: e.target.value } : x)),
                          )
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="mo-input w-24"
                        value={row.weight_percent}
                        onChange={(e) =>
                          setPlanItems((prev) =>
                            prev.map((x) =>
                              x.key === row.key ? { ...x, weight_percent: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => setPlanItems((prev) => prev.filter((x) => x.key !== row.key))}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() =>
              setPlanItems((prev) => [
                ...prev,
                {
                  key: `new-${Date.now()}`,
                  name: "",
                  plan_qty: "",
                  weight_percent: "",
                  source_type: "manual",
                  direction_id: "",
                  specialist_ids: [],
                },
              ])
            }
          >
            + Показатель
          </button>

          {(planQuery.data?.directions.length ?? 0) > 0 ? (
            <div className="space-y-2 pt-4">
              <h3 className="text-sm font-medium text-[var(--mo-text)]">Цены услуг записи (для формы бронирования)</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(planQuery.data?.directions ?? []).map((d) => (
                  <label key={d.direction_id} className="flex flex-col gap-1 text-sm mo-muted">
                    {d.direction_name}
                    <input
                      type="number"
                      min={0}
                      className="mo-input"
                      value={priceDraft[d.direction_id] ?? ""}
                      onChange={(e) =>
                        setPriceDraft((prev) => ({ ...prev, [d.direction_id]: e.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "sales" ? (
        <SalesReportSection data={salesQuery.data} loading={salesQuery.isLoading} error={salesQuery.error as Error | null} />
      ) : null}

      {tab === "manual" && isAdminOrOwner ? (
        <section className="mo-section space-y-4 p-4">
          <div>
            <h2 className="lux-subheading">Продажа курса / протокола</h2>
            <p className="mt-1 text-sm lux-caption">
              Без онлайн-записи. В KPI попадает с оплаты ≥25%. Возврат снимает продажу с факта.
            </p>
          </div>

          {manualPlanItems.length === 0 ? (
            <p className="text-sm text-amber-200/90">
              Сначала владелец должен добавить показатели с источником «Курс / протокол» во вкладке «План».
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm mo-muted">
                Показатель
                <select
                  className="mo-input"
                  value={saleForm.plan_item_id}
                  onChange={(e) => setSaleForm((s) => ({ ...s, plan_item_id: e.target.value }))}
                >
                  <option value="">—</option>
                  {manualPlanItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm mo-muted">
                Менеджер (кому в KPI)
                <select
                  className="mo-input"
                  value={saleForm.manager_user_id}
                  onChange={(e) => setSaleForm((s) => ({ ...s, manager_user_id: e.target.value }))}
                >
                  <option value="">—</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm mo-muted">
                Клиент
                <input
                  className="mo-input"
                  value={saleForm.client_name}
                  onChange={(e) => setSaleForm((s) => ({ ...s, client_name: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm mo-muted">
                Телефон
                <input
                  className="mo-input"
                  value={saleForm.client_phone}
                  onChange={(e) => setSaleForm((s) => ({ ...s, client_phone: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm mo-muted">
                Стоимость
                <input
                  type="number"
                  min={0}
                  className="mo-input"
                  value={saleForm.service_amount}
                  onChange={(e) => setSaleForm((s) => ({ ...s, service_amount: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm mo-muted">
                Оплачено сейчас
                <input
                  type="number"
                  min={0}
                  className="mo-input"
                  value={saleForm.paid_amount}
                  onChange={(e) => setSaleForm((s) => ({ ...s, paid_amount: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm mo-muted sm:col-span-2">
                Комментарий
                <input
                  className="mo-input"
                  value={saleForm.note}
                  onChange={(e) => setSaleForm((s) => ({ ...s, note: e.target.value }))}
                />
              </label>
            </div>
          )}

          <button
            type="button"
            className="btn-primary text-sm disabled:opacity-50"
            disabled={createSaleMutation.isPending || manualPlanItems.length === 0}
            onClick={() => createSaleMutation.mutate()}
          >
            Добавить продажу
          </button>

          <div className="overflow-x-auto pt-2">
            <table className="w-full min-w-[1100px] border-collapse text-left text-sm text-[var(--mo-text)]">
              <thead>
                <tr className="border-b border-[var(--mo-border)] lux-caption">
                  <th className="py-2 pr-3">Дата</th>
                  <th className="py-2 pr-3">Показатель</th>
                  <th className="py-2 pr-3">Менеджер</th>
                  <th className="py-2 pr-3">Клиент</th>
                  <th className="py-2 pr-3">Телефон</th>
                  <th className="py-2 pr-3">Сумма</th>
                  <th className="py-2 pr-3">Оплачено</th>
                  <th className="py-2 pr-3">Долг</th>
                  <th className="py-2 pr-3">KPI</th>
                  <th className="py-2 pr-3">Действия</th>
                </tr>
              </thead>
              <tbody>
                {(manualQuery.data ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-[var(--mo-border)]/70">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {s.sold_at ? new Date(s.sold_at).toLocaleString("ru-RU") : "—"}
                    </td>
                    <td className="py-2 pr-3">{s.plan_item_name}</td>
                    <td className="py-2 pr-3">{s.manager_name}</td>
                    <td className="py-2 pr-3">{s.client_name}</td>
                    <td className="py-2 pr-3">{s.client_phone}</td>
                    <td className="py-2 pr-3">{moneyFmt.format(num(s.service_amount))}</td>
                    <td className="py-2 pr-3">
                      {s.status === "returned" ? (
                        moneyFmt.format(num(s.paid_amount))
                      ) : (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            className="kpi-cell-input w-24"
                            value={payDraft[s.id] ?? String(num(s.paid_amount))}
                            onChange={(e) => setPayDraft((prev) => ({ ...prev, [s.id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() =>
                              payMutation.mutate({
                                id: s.id,
                                paid: Number(payDraft[s.id] ?? s.paid_amount),
                              })
                            }
                          >
                            OK
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">{moneyFmt.format(num(s.debt_amount))}</td>
                    <td className="py-2 pr-3">
                      {s.status === "returned" ? (
                        <span className="text-xs text-red-300">возврат</span>
                      ) : s.counts_in_kpi ? (
                        <span className="text-xs text-emerald-300">в факте</span>
                      ) : (
                        <span className="text-xs mo-muted">&lt;25%</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {s.status !== "returned" ? (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => {
                            if (window.confirm("Отметить возврат и снять с KPI?")) {
                              returnMutation.mutate(s.id);
                            }
                          }}
                        >
                          Возврат
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {manualQuery.isLoading ? <p className="mt-2 text-sm lux-caption">Загрузка…</p> : null}
          </div>
        </section>
      ) : null}

      {tab === "debtors" && isAdminOrOwner ? (
        <section className="mo-section space-y-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="lux-subheading">Дебиторка</h2>
            <p className="text-sm mo-muted">
              Итого долг:{" "}
              <span className="font-semibold text-[var(--mo-text)]">
                {moneyFmt.format(num(debtorsQuery.data?.total_debt))}
              </span>
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-left text-sm text-[var(--mo-text)]">
              <thead>
                <tr className="border-b border-[var(--mo-border)] lux-caption">
                  <th className="py-2 pr-3">Источник</th>
                  <th className="py-2 pr-3">Дата</th>
                  <th className="py-2 pr-3">Клиент</th>
                  <th className="py-2 pr-3">Телефон</th>
                  <th className="py-2 pr-3">Услуга</th>
                  <th className="py-2 pr-3">Менеджер</th>
                  <th className="py-2 pr-3">Сумма</th>
                  <th className="py-2 pr-3">Оплачено</th>
                  <th className="py-2 pr-3">Долг</th>
                </tr>
              </thead>
              <tbody>
                {(debtorsQuery.data?.rows ?? []).map((r) => (
                  <tr key={`${r.source}-${r.source_id}`} className="border-b border-[var(--mo-border)]/70">
                    <td className="py-2 pr-3">{r.source === "booking" ? "Запись" : "Курс/протокол"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.sold_at ? new Date(r.sold_at).toLocaleString("ru-RU") : "—"}
                    </td>
                    <td className="py-2 pr-3">{r.client_name}</td>
                    <td className="py-2 pr-3">{r.client_phone}</td>
                    <td className="py-2 pr-3">{r.indicator_name}</td>
                    <td className="py-2 pr-3">{r.manager_name ?? "—"}</td>
                    <td className="py-2 pr-3">{moneyFmt.format(num(r.service_amount))}</td>
                    <td className="py-2 pr-3">{moneyFmt.format(num(r.paid_amount))}</td>
                    <td className="py-2 pr-3 kpi-actual-value">{moneyFmt.format(num(r.debt_amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {debtorsQuery.isLoading ? <p className="text-sm lux-caption">Загрузка…</p> : null}
          {debtorsQuery.isError ? (
            <p className="text-sm text-red-300">{(debtorsQuery.error as Error).message}</p>
          ) : null}
        </section>
      ) : null}

      {(pipelinesQuery.isLoading || planQuery.isLoading) && tab === "plan" ? (
        <p className="text-sm lux-caption">Загрузка…</p>
      ) : null}
      {planQuery.isError ? (
        <p className="text-sm text-red-300">{(planQuery.error as Error).message}</p>
      ) : null}
    </div>
  );
}

function SalesReportSection({
  data,
  loading,
  error,
}: {
  data: SalesKpiSalesReport | undefined;
  loading: boolean;
  error: Error | null;
}) {
  if (loading) return <p className="text-sm lux-caption">Загрузка отчёта ПРОДАЖИ…</p>;
  if (error) return <p className="text-sm text-red-300">{error.message}</p>;
  if (!data) return null;

  if (!data.items.length) {
    return (
      <section className="mo-section p-4">
        <h2 className="lux-subheading">ПРОДАЖИ</h2>
        <p className="mt-2 text-sm lux-caption">План на этот месяц ещё не задан. Владелец заполняет вкладку «План».</p>
      </section>
    );
  }

  if (!data.managers.length) {
    return (
      <section className="mo-section p-4">
        <h2 className="lux-subheading">ПРОДАЖИ</h2>
        <p className="mt-2 text-sm lux-caption">
          Нет активных менеджеров на воронке. Назначьте менеджеров — блоки появятся автоматически.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="mo-section p-4">
        <h2 className="lux-subheading">ПРОДАЖИ · {data.year_month}</h2>
        <p className="mt-1 text-sm lux-caption">
          Фонд бонуса: {moneyFmt.format(num(data.bonus_fund))} на менеджера. Факт считается автоматически.
        </p>
      </section>

      {data.managers.map((m) => (
        <section key={m.manager_id} className="mo-section p-4">
          <h3 className="mb-3 text-lg font-semibold text-[var(--mo-text)]">{m.manager_name}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm text-[var(--mo-text)]">
              <thead>
                <tr className="border-b border-[var(--mo-border)] lux-caption">
                  <th className="py-2 pr-3">Показатель</th>
                  <th className="py-2 pr-3">План</th>
                  <th className="py-2 pr-3">Вес %</th>
                  <th className="py-2 pr-3">Факт</th>
                  <th className="py-2 pr-3">Выполн.</th>
                  <th className="py-2 pr-3">Вклад %</th>
                </tr>
              </thead>
              <tbody>
                {m.lines.map((line) => (
                  <tr key={line.plan_item_id} className="border-b border-[var(--mo-border)]/70">
                    <td className="py-2 pr-3">{line.name}</td>
                    <td className="py-2 pr-3">{line.plan_qty}</td>
                    <td className="py-2 pr-3">{num(line.weight_percent)}</td>
                    <td className="py-2 pr-3">{line.fact_qty}</td>
                    <td className="py-2 pr-3">{pctLabel(line.completion)}</td>
                    <td className="py-2 pr-3">{contribLabel(line.contribution)}</td>
                  </tr>
                ))}
                <tr className="kpi-matrix-row-highlight">
                  <td className="py-2 pr-3 font-semibold" colSpan={5}>
                    ИТОГО
                  </td>
                  <td className="py-2 pr-3 font-semibold">{contribLabel(m.total_contribution)}</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-semibold" colSpan={5}>
                    Бонус
                  </td>
                  <td className="py-2 pr-3 font-semibold kpi-actual-value">
                    {moneyFmt.format(num(m.bonus))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
