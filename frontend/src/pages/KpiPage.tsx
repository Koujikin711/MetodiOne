import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";

import { AccessDenied } from "@/components/AccessDenied";
import { MonthYearPicker } from "@/components/MonthYearPicker";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import type {
  SalesKpiCompanyReport,
  SalesKpiDebtorsReport,
  SalesKpiManualSale,
  SalesKpiPipelineMeta,
  SalesKpiSalesReport,
  SalesKpiWeightedPlan,
} from "@/lib/types";

type TabId = "plan" | "sales" | "company" | "manual" | "debtors";

type PlanDraftItem = {
  key: string;
  name: string;
  plan_qty: string;
  weight_percent: string;
  source_type: "direction" | "manual";
  direction_id: string;
  specialist_ids: number[];
};

function SaleRowActionsMenu({
  onReturn,
  onRefuse,
  onComplete,
}: {
  onReturn: () => void;
  onRefuse: () => void;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if ((e.target as Element | null)?.closest?.(".kpi-actions-menu")) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = 200;
      let left = r.right - w;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = r.bottom + 6;
      if (top + 200 > window.innerHeight - 8) top = Math.max(8, r.top - 200 - 6);
      setPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const menu =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            role="menu"
            aria-label="Действия по продаже"
            className="kpi-actions-menu"
            style={{ top: pos.top, left: pos.left, width: 168 }}
          >
            <button
              type="button"
              role="menuitem"
              className="kpi-actions-menu__item kpi-actions-menu__item--return"
              onClick={() => {
                setOpen(false);
                onReturn();
              }}
            >
              <span className="kpi-actions-menu__mark" aria-hidden />
              Возврат
            </button>
            <button
              type="button"
              role="menuitem"
              className="kpi-actions-menu__item kpi-actions-menu__item--refuse"
              onClick={() => {
                setOpen(false);
                onRefuse();
              }}
            >
              <span className="kpi-actions-menu__mark" aria-hidden />
              Отказ
            </button>
            <button
              type="button"
              role="menuitem"
              className="kpi-actions-menu__item kpi-actions-menu__item--done"
              onClick={() => {
                setOpen(false);
                onComplete();
              }}
            >
              <span className="kpi-actions-menu__mark" aria-hidden />
              Завершён
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="kpi-actions-wrap">
      <button
        ref={btnRef}
        type="button"
        className="kpi-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Действия"
        onClick={() => setOpen((v) => !v)}
      >
        Действия
        <svg className="kpi-actions-trigger__chev" width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M6 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {menu}
    </div>
  );
}

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

const KPI_GROUP_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1);
const KPI_STREAM_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

function groupLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) < 1) return "—";
  return `Группа ${Number(n)}`;
}

function streamLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) < 1) return "—";
  return `Поток ${Number(n)}`;
}

function formatSaleDt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function KpiPage() {
  const queryClient = useQueryClient();
  const role = decodeRoleFromToken(getStoredToken());
  const isOwner = role === "owner" || role === "super_owner";
  const isAdminOrOwner = isOwner || role === "admin" || role === "administrator";
  const isManager = role === "manager";
  const isCurator = role === "curator";
  const isAccountant = role === "accountant";
  const meQuery = useCurrentUserMe();
  const salesSpace =
    meQuery.data?.crm_mode === "sales" || Boolean(meQuery.data?.desk_sales_enabled);

  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  const [pipelineId, setPipelineId] = useState<number | null>(null);
  const [tab, setTab] = useState<TabId>(
    isCurator ? "debtors" : isAccountant ? "company" : isOwner ? "plan" : "sales",
  );

  const [bonusFund, setBonusFund] = useState("10000");
  const [planItems, setPlanItems] = useState<PlanDraftItem[]>([]);
  const [priceDraft, setPriceDraft] = useState<Record<number, string>>({});

  const [saleForm, setSaleForm] = useState({
    plan_item_id: "",
    manager_user_id: "",
    stream_no: "",
    group_no: "",
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
    enabled: Boolean(pipelineId && (isOwner || isAdminOrOwner || isManager) && !isCurator),
  });

  const salesQuery = useQuery({
    queryKey: ["sales-kpi-sales-report", qs],
    queryFn: () => apiFetch<SalesKpiSalesReport>(`/api/sales-kpi/sales-report?${qs}`),
    enabled: Boolean(pipelineId && (tab === "sales" || tab === "plan") && !isCurator),
  });

  const manualQuery = useQuery({
    queryKey: ["sales-kpi-manual-sales", qs],
    queryFn: () => apiFetch<SalesKpiManualSale[]>(`/api/sales-kpi/manual-sales?${qs}`),
    enabled: Boolean(pipelineId && isAdminOrOwner && tab === "manual"),
  });

  const debtorsQuery = useQuery({
    queryKey: ["sales-kpi-debtors", qs],
    queryFn: () => apiFetch<SalesKpiDebtorsReport>(`/api/sales-kpi/debtors?${qs}`),
    enabled: Boolean(pipelineId && (isAdminOrOwner || isCurator) && tab === "debtors"),
  });

  const companyQuery = useQuery({
    queryKey: ["sales-kpi-company-report", qs],
    queryFn: () =>
      apiFetch<SalesKpiCompanyReport>(`/api/sales-kpi/company-report?${qs}`, {
        timeoutMs: 60_000,
      }),
    enabled: Boolean(pipelineId && (isOwner || isAccountant) && tab === "company"),
    staleTime: 30_000,
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
        source_type: salesSpace ? "manual" : it.source_type === "direction" ? "direction" : "manual",
        direction_id: salesSpace ? "" : it.direction_id != null ? String(it.direction_id) : "",
        specialist_ids: salesSpace
          ? []
          : Array.isArray(it.specialist_ids)
            ? it.specialist_ids.map(Number)
            : [],
      })),
    );
    const p: Record<number, string> = {};
    planQuery.data.directions.forEach((d) => {
      p[d.direction_id] = String(num(d.unit_price) || "");
    });
    setPriceDraft(p);
  }, [planQuery.data, salesSpace]);

  const savePlanMutation = useMutation({
    mutationFn: async () => {
      if (!pipelineId) throw new Error("Выберите воронку");
      const items = planItems
        .filter((x) => x.name.trim())
        .map((x, idx) => ({
          name: x.name.trim(),
          plan_qty: Number(x.plan_qty || 0),
          weight_percent: Number(x.weight_percent || 0),
          source_type: salesSpace ? ("manual" as const) : x.source_type,
          direction_id:
            salesSpace || x.source_type !== "direction" ? null : Number(x.direction_id || 0) || null,
          specialist_ids: salesSpace || x.source_type !== "direction" ? [] : x.specialist_ids,
          sort_order: idx,
        }));
      if (!salesSpace) {
        for (const it of items) {
          if (it.source_type === "direction" && !(it.specialist_ids?.length || it.direction_id)) {
            throw new Error(`Для «${it.name}» привяжите экспертов онлайн-записи`);
          }
        }
      }
      await apiFetch<void>("/api/sales-kpi/weighted-plan", {
        method: "PUT",
        body: JSON.stringify({
          pipeline_id: pipelineId,
          year_month: yearMonth,
          bonus_fund: Number(bonusFund || 10000),
          items,
          prices: salesSpace
            ? []
            : (planQuery.data?.directions ?? []).map((d) => ({
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
      if (!saleForm.stream_no) throw new Error("Укажите поток");
      if (!saleForm.group_no) throw new Error("Укажите группу");
      await apiFetch<SalesKpiManualSale>("/api/sales-kpi/manual-sales", {
        method: "POST",
        body: JSON.stringify({
          pipeline_id: pipelineId,
          plan_item_id: Number(saleForm.plan_item_id),
          manager_user_id: Number(saleForm.manager_user_id),
          stream_no: Number(saleForm.stream_no),
          group_no: Number(saleForm.group_no),
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
        stream_no: "",
        group_no: "",
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
    mutationFn: async ({ id, add }: { id: number; add: number }) => {
      await apiFetch<SalesKpiManualSale>(`/api/sales-kpi/manual-sales/${id}/payment`, {
        method: "PATCH",
        body: JSON.stringify({ add_amount: add }),
      });
    },
    onSuccess: () => {
      toast.success("Доплата записана в журнал");
      setPayDraft({});
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

  const closeSaleMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      reason,
    }: {
      id: number;
      status: "refused" | "completed";
      reason: string;
    }) => {
      await apiFetch<SalesKpiManualSale>(`/api/sales-kpi/manual-sales/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, reason }),
      });
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.status === "refused" ? "Статус: отказ" : "Статус: завершён");
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-manual-sales"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-sales-report"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-debtors"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function askCloseSale(id: number, status: "refused" | "completed") {
    const label = status === "refused" ? "отказ" : "завершён";
    const reason = window.prompt(`Причина статуса «${label}» (обязательно):`)?.trim() ?? "";
    if (!reason) {
      toast.error("Укажите причину");
      return;
    }
    closeSaleMutation.mutate({ id, status, reason });
  }

  if (role === "expert" || role === "finance_analyst") {
    return <AccessDenied message="Раздел KPI недоступен для вашей роли." />;
  }

  const tabs: { id: TabId; label: string; shortLabel: string; show: boolean }[] = [
    { id: "plan", label: "План", shortLabel: "План", show: isOwner },
    {
      id: "sales",
      label: "Продажи",
      shortLabel: "Продажи",
      show: (isOwner || isAdminOrOwner || isManager) && !isCurator && !isAccountant,
    },
    { id: "company", label: "Отчёт компании", shortLabel: "Отчёт", show: isOwner || isAccountant },
    { id: "manual", label: "Курсы / протоколы", shortLabel: "Курсы", show: isAdminOrOwner },
    {
      id: "debtors",
      label: isCurator ? "Дебиторка курсов / протоколов" : "Дебиторка",
      shortLabel: "Долги",
      show: isAdminOrOwner || isCurator,
    },
  ];

  function addPlanIndicator() {
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
    ]);
  }

  const manualPlanItems = (planQuery.data?.items ?? []).filter((x) => x.source_type === "manual");
  const managers = planQuery.data?.managers ?? [];
  const visibleTabs = tabs.filter((t) => t.show);

  return (
    <div
      className={[
        "sales-space-page relative mx-auto w-full max-w-none space-y-2 sm:space-y-5 sm:pb-10",
        tab === "plan" && isOwner ? "pb-[6.5rem]" : "pb-4",
      ].join(" ")}
    >
      <header className="mo-admin-page-head !border-b-0 pb-0 sm:border-b sm:pb-3">
        <PageHeader
          className="mb-0"
          title="KPI продаж"
          description={
            salesSpace
              ? "Условия KPI без онлайн-записи: факт из окна «Продажи» (полная оплата) и курсов/протоколов (≥25%). Имя продукта = сфера/услуга в продажах."
              : "Онлайн-запись — в факт при 100% оплате. Окно «Продажи» — полная оплата тоже в факт. Курсы/протоколы вносит админ — в факт с оплаты ≥25%."
          }
        />
      </header>

      <section className="kpi-toolbar grid grid-cols-2 gap-1.5 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] px-2 py-1.5 sm:gap-2 sm:rounded-2xl sm:px-2.5 sm:py-2">
        <label className="flex min-w-0 flex-col gap-0.5 text-[10px] font-medium leading-tight mo-muted sm:text-[11px]">
          Месяц
          <MonthYearPicker compact value={yearMonth} onChange={setYearMonth} className="kpi-toolbar__control" />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 text-[10px] font-medium leading-tight mo-muted sm:text-[11px]">
          Воронка
          <select
            value={pipelineId ?? ""}
            onChange={(e) => setPipelineId(Number(e.target.value) || null)}
            className="mo-input kpi-toolbar__control truncate"
          >
            {(pipelinesQuery.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="kpi-tabs" role="tablist" aria-label="Разделы KPI">
        {visibleTabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              title={t.label}
              onClick={() => setTab(t.id)}
              className={active ? "kpi-tabs__btn is-active" : "kpi-tabs__btn"}
            >
              <span className="kpi-tabs__label kpi-tabs__label--full">{t.label}</span>
              <span className="kpi-tabs__label kpi-tabs__label--short">{t.shortLabel}</span>
            </button>
          );
        })}
      </div>

      {tab === "plan" && isOwner ? (
        <section className="mo-section space-y-3 p-3 sm:space-y-4 sm:p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[var(--mo-text)] sm:text-lg">План на месяц</h2>
              <p className="mt-1 hidden text-sm lux-caption sm:block">
                Один план на всех менеджеров. Сохранили один раз — в следующем месяце подтянется
                автоматически (продукты, веса, эксперты, фонд). Для услуг из онлайн-записи привяжите экспертов — запись к
                ним пойдёт в факт этой услуги (при 100% оплате). Один эксперт = одна услуга KPI.
              </p>
            </div>
            <button
              type="button"
              onClick={() => savePlanMutation.mutate()}
              disabled={savePlanMutation.isPending}
              className="hidden btn-primary text-sm disabled:opacity-50 sm:inline-flex"
            >
              Сохранить план
            </button>
          </div>

          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs mo-muted sm:max-w-xs sm:text-sm">
              <span className="sm:hidden">Фонд бонуса (TJS)</span>
              <span className="hidden sm:inline">Фонд бонуса на менеджера (TJS)</span>
              <input
                type="number"
                min={0}
                inputMode="decimal"
                value={bonusFund}
                onChange={(e) => setBonusFund(e.target.value)}
                className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
              />
            </label>
            <button
              type="button"
              className="btn-secondary min-h-11 shrink-0 px-3 text-sm sm:hidden"
              onClick={addPlanIndicator}
            >
              + Продукт
            </button>
          </div>

          <div className="space-y-2 sm:hidden">
            {planItems.map((row) => {
              const takenElsewhere = new Set(
                planItems
                  .filter((x) => x.key !== row.key && x.source_type === "direction")
                  .flatMap((x) => x.specialist_ids),
              );
              return (
                <article
                  key={row.key}
                  className="space-y-1.5 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)]/40 p-2.5"
                >
                  <label className="block text-[11px] mo-muted">
                    Продукт
                    <input
                      className="mo-input mt-1 w-full !min-h-11 text-base"
                      value={row.name}
                      onChange={(e) =>
                        setPlanItems((prev) =>
                          prev.map((x) => (x.key === row.key ? { ...x, name: e.target.value } : x)),
                        )
                      }
                      placeholder="Логопед / Курс 15"
                    />
                  </label>
                  <label className="block text-[11px] mo-muted">
                    Источник
                    {salesSpace ? (
                      <div className="mo-input mt-1 flex !min-h-11 items-center text-base mo-muted">
                        Окно продаж / курс
                      </div>
                    ) : (
                      <select
                        className="mo-input mt-1 w-full !min-h-11 text-base"
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
                        <option value="manual">Курс / протокол</option>
                        <option value="direction">Онлайн-запись</option>
                      </select>
                    )}
                  </label>
                  {!salesSpace && row.source_type === "direction" ? (
                    <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-[var(--mo-border)] p-2">
                      {(planQuery.data?.specialists ?? []).filter((s) => s.is_active).length === 0 ? (
                        <span className="text-xs mo-muted">Нет экспертов</span>
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
                                          direction_id: on ? String(s.direction_id) : x.direction_id,
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
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px] mo-muted">
                      План (шт)
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className="mo-input mt-1 w-full !min-h-11 text-base"
                        value={row.plan_qty}
                        onChange={(e) =>
                          setPlanItems((prev) =>
                            prev.map((x) => (x.key === row.key ? { ...x, plan_qty: e.target.value } : x)),
                          )
                        }
                      />
                    </label>
                    <label className="block text-[11px] mo-muted">
                      Вес (%)
                      <input
                        type="number"
                        min={0}
                        max={100}
                        inputMode="numeric"
                        className="mo-input mt-1 w-full !min-h-11 text-base"
                        value={row.weight_percent}
                        onChange={(e) =>
                          setPlanItems((prev) =>
                            prev.map((x) =>
                              x.key === row.key ? { ...x, weight_percent: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-rose-500"
                    onClick={() => setPlanItems((prev) => prev.filter((x) => x.key !== row.key))}
                  >
                    Удалить продукт
                  </button>
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto sm:block">
            <table className="kpi-data-table min-w-[900px] text-sm">
              <thead>
                <tr>
                  <th className="py-2 pr-3">Продукт</th>
                  <th className="py-2 pr-3">Источник</th>
                  {!salesSpace ? <th className="py-2 pr-3">Эксперты онлайн-записи</th> : null}
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
                  <tr key={row.key}>
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
                      {salesSpace ? (
                        <span className="text-sm mo-muted">Окно продаж / курс</span>
                      ) : (
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
                      )}
                    </td>
                    {!salesSpace ? (
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
                                              direction_id: on ? String(s.direction_id) : x.direction_id,
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
                        <span className="text-xs mo-muted">—</span>
                      )}
                    </td>
                    ) : null}
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
            className="btn-secondary hidden min-h-0 w-auto text-sm sm:inline-flex"
            onClick={addPlanIndicator}
          >
            + Продукт
          </button>

          {!salesSpace && (planQuery.data?.directions.length ?? 0) > 0 ? (
            <div className="space-y-2 pt-2 sm:pt-4">
              <h3 className="text-sm font-medium text-[var(--mo-text)]">Цены услуг записи</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(planQuery.data?.directions ?? []).map((d) => (
                  <label key={d.direction_id} className="flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                    <span className="truncate">{d.direction_name}</span>
                    <input
                      type="number"
                      min={0}
                      inputMode="decimal"
                      className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
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

          <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-40 border-t border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]/95 px-3 py-2 backdrop-blur sm:hidden">
            <button
              type="button"
              onClick={() => savePlanMutation.mutate()}
              disabled={savePlanMutation.isPending}
              className="min-h-11 w-full rounded-xl bg-[var(--mo-accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savePlanMutation.isPending ? "Сохранение…" : "Сохранить план"}
            </button>
          </div>
        </section>
      ) : null}

      {tab === "sales" ? (
        <SalesReportSection data={salesQuery.data} loading={salesQuery.isLoading} error={salesQuery.error as Error | null} />
      ) : null}

      {tab === "company" && (isOwner || isAccountant) ? (
        <CompanyReportSection
          data={companyQuery.data}
          loading={companyQuery.isLoading}
          error={companyQuery.error as Error | null}
          hideBookingExperts={salesSpace}
        />
      ) : null}

      {tab === "manual" && isAdminOrOwner ? (
        <section className="mo-section space-y-3 p-3 sm:space-y-4 sm:p-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--mo-text)] sm:text-lg">Продажа курса / протокола</h2>
            <p className="mt-1 text-[11px] leading-snug text-[var(--mo-text-muted)] sm:text-sm">
              {salesSpace
                ? "Без онлайн-записи. В бонус/KPI идёт только первый платёж (≥25%). Доплаты уменьшают долг и пишутся в журнал."
                : "Без онлайн-записи. В бонус/KPI идёт только первый платёж (≥25%). Доплаты уменьшают долг и пишутся в журнал."}
            </p>
          </div>

          {manualPlanItems.length === 0 ? (
            <p className="text-sm text-amber-200/90">
              {salesSpace
                ? "Сначала владелец должен добавить продукты во вкладке «План»."
                : "Сначала владелец должен добавить продукты с источником «Курс / протокол» во вкладке «План»."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
              <label className="col-span-2 flex flex-col gap-1 text-[11px] mo-muted sm:col-span-1 sm:text-sm">
                Продукт
                <select
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
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
              <label className="col-span-2 flex flex-col gap-1 text-[11px] mo-muted sm:col-span-1 sm:text-sm">
                Менеджер
                <select
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
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
              <label className="flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                Группа
                <select
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  value={saleForm.group_no}
                  onChange={(e) => setSaleForm((s) => ({ ...s, group_no: e.target.value }))}
                  title="Группа — время образования"
                >
                  <option value="">—</option>
                  {KPI_GROUP_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      Группа {n}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] leading-snug text-[var(--mo-text-muted)]">время образования</span>
              </label>
              <label className="flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                Поток
                <select
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  value={saleForm.stream_no}
                  onChange={(e) => setSaleForm((s) => ({ ...s, stream_no: e.target.value }))}
                  title="Поток — номер платежа"
                >
                  <option value="">—</option>
                  {KPI_STREAM_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      Поток {n}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] leading-snug text-[var(--mo-text-muted)]">номер платежа</span>
              </label>
              <label className="flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                Клиент
                <input
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  value={saleForm.client_name}
                  onChange={(e) => setSaleForm((s) => ({ ...s, client_name: e.target.value }))}
                />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-[11px] mo-muted sm:col-span-1 sm:text-sm">
                Телефон
                <input
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  inputMode="tel"
                  value={saleForm.client_phone}
                  onChange={(e) => setSaleForm((s) => ({ ...s, client_phone: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                Стоимость
                <input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  value={saleForm.service_amount}
                  onChange={(e) => setSaleForm((s) => ({ ...s, service_amount: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] mo-muted sm:text-sm">
                Первый платёж
                <input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  value={saleForm.paid_amount}
                  onChange={(e) => setSaleForm((s) => ({ ...s, paid_amount: e.target.value }))}
                />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-[11px] mo-muted sm:text-sm lg:col-span-4">
                Комментарий
                <input
                  className="mo-input !min-h-11 text-base sm:!min-h-0 sm:text-sm"
                  value={saleForm.note}
                  onChange={(e) => setSaleForm((s) => ({ ...s, note: e.target.value }))}
                />
              </label>
            </div>
          )}

          <button
            type="button"
            className="btn-primary min-h-12 w-full text-base disabled:opacity-50 sm:min-h-0 sm:w-auto sm:text-sm"
            disabled={createSaleMutation.isPending || manualPlanItems.length === 0}
            onClick={() => createSaleMutation.mutate()}
          >
            Добавить продажу
          </button>

          <ul className="space-y-2 pt-1 sm:hidden">
            {(manualQuery.data ?? []).map((s) => (
              <li key={s.id} className="kpi-sale-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--mo-text)]">{s.client_name}</p>
                    <p className="truncate text-[11px] text-[var(--mo-text-muted)]">
                      {s.plan_item_name} · {groupLabel(s.group_no)} · {streamLabel(s.stream_no)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--mo-text-muted)]">
                    {s.sold_at
                      ? new Date(s.sold_at).toLocaleDateString("ru-RU", {
                          day: "2-digit",
                          month: "2-digit",
                        })
                      : "—"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--mo-text-muted)]">{s.manager_name}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--mo-text)]">
                  <span className="tabular-nums">
                    {formatMoney(num(s.paid_amount))} / {formatMoney(num(s.service_amount))}
                  </span>
                  {s.status === "returned" ? (
                    <span className="kpi-chip kpi-chip--return">возврат</span>
                  ) : s.status === "refused" ? (
                    <span className="kpi-chip kpi-chip--refuse">отказ</span>
                  ) : s.status === "completed" ? (
                    <span className="kpi-chip kpi-chip--done">завершён</span>
                  ) : s.counts_in_kpi ? (
                    <span className="kpi-chip kpi-chip--fact">в факте</span>
                  ) : (
                    <span className="kpi-chip kpi-chip--low">&lt;25%</span>
                  )}
                </div>
                {s.status === "active" && num(s.debt_amount) > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      inputMode="decimal"
                      className="kpi-cell-input !min-h-10 flex-1 text-base"
                      placeholder="Доплата"
                      value={payDraft[s.id] ?? ""}
                      onChange={(e) => setPayDraft((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="kpi-action kpi-action--ok shrink-0"
                      disabled={!(Number(payDraft[s.id] || 0) > 0)}
                      onClick={() =>
                        payMutation.mutate({
                          id: s.id,
                          add: Number(payDraft[s.id] || 0),
                        })
                      }
                    >
                      OK
                    </button>
                    <SaleRowActionsMenu
                      onReturn={() => {
                        if (window.confirm("Отметить возврат и снять с KPI?")) {
                          returnMutation.mutate(s.id);
                        }
                      }}
                      onRefuse={() => askCloseSale(s.id, "refused")}
                      onComplete={() => askCloseSale(s.id, "completed")}
                    />
                  </div>
                ) : s.status === "active" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-[var(--mo-text-muted)]">оплачено полностью</span>
                    <SaleRowActionsMenu
                      onReturn={() => {
                        if (window.confirm("Отметить возврат и снять с KPI?")) {
                          returnMutation.mutate(s.id);
                        }
                      }}
                      onRefuse={() => askCloseSale(s.id, "refused")}
                      onComplete={() => askCloseSale(s.id, "completed")}
                    />
                  </div>
                ) : s.status_reason ? (
                  <p className="mt-1 text-[11px] text-[var(--mo-text-muted)]">Причина: {s.status_reason}</p>
                ) : null}
              </li>
            ))}
            {manualQuery.isLoading ? <p className="text-sm lux-caption">Загрузка…</p> : null}
          </ul>

          <div className="hidden overflow-x-auto pt-2 sm:block">
            <table className="kpi-data-table min-w-[1100px] text-sm">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Продукт</th>
                  <th>Группа</th>
                  <th>Поток</th>
                  <th>Менеджер</th>
                  <th>Клиент</th>
                  <th>Телефон</th>
                  <th>Сумма</th>
                  <th>Оплачено</th>
                  <th>Долг</th>
                  <th>KPI</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {(manualQuery.data ?? []).map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap tabular-nums">
                      {s.sold_at ? formatSaleDt(s.sold_at) : "—"}
                    </td>
                    <td>{s.plan_item_name}</td>
                    <td className="whitespace-nowrap">{groupLabel(s.group_no)}</td>
                    <td className="whitespace-nowrap">{streamLabel(s.stream_no)}</td>
                    <td>{s.manager_name}</td>
                    <td className="font-medium">{s.client_name}</td>
                    <td className="tabular-nums">{s.client_phone}</td>
                    <td className="tabular-nums whitespace-nowrap">{formatMoney(num(s.service_amount))}</td>
                    <td>
                      {s.status === "returned" ? (
                        <span className="tabular-nums">{formatMoney(num(s.paid_amount))}</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <span className="tabular-nums text-[11px] text-[var(--mo-text-muted)]">
                            уже {formatMoney(num(s.paid_amount))}
                            {num(s.first_paid_amount) > 0
                              ? ` · 1-й ${formatMoney(num(s.first_paid_amount))}`
                              : ""}
                          </span>
                          {num(s.debt_amount) > 0 ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={0}
                                className="kpi-cell-input w-24"
                                placeholder="Доплата"
                                value={payDraft[s.id] ?? ""}
                                onChange={(e) => setPayDraft((prev) => ({ ...prev, [s.id]: e.target.value }))}
                              />
                              <button
                                type="button"
                                className="kpi-action kpi-action--ok"
                                disabled={!(Number(payDraft[s.id] || 0) > 0)}
                                onClick={() =>
                                  payMutation.mutate({
                                    id: s.id,
                                    add: Number(payDraft[s.id] || 0),
                                  })
                                }
                              >
                                OK
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-[var(--mo-text-muted)]">оплачено полностью</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={["kpi-debt", num(s.debt_amount) <= 0 ? "is-zero" : ""].filter(Boolean).join(" ")}>
                        {formatMoney(num(s.debt_amount))}
                      </span>
                    </td>
                    <td>
                      {s.status === "returned" ? (
                        <span className="kpi-chip kpi-chip--return">возврат</span>
                      ) : s.status === "refused" ? (
                        <span className="kpi-chip kpi-chip--refuse">отказ</span>
                      ) : s.status === "completed" ? (
                        <span className="kpi-chip kpi-chip--done">завершён</span>
                      ) : s.counts_in_kpi ? (
                        <span className="kpi-chip kpi-chip--fact">в факте</span>
                      ) : (
                        <span className="kpi-chip kpi-chip--low">&lt;25%</span>
                      )}
                      {s.status_reason ? (
                        <div className="mt-0.5 max-w-[10rem] truncate text-[10px] text-[var(--mo-text-muted)]" title={s.status_reason}>
                          {s.status_reason}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {s.status === "active" ? (
                        <SaleRowActionsMenu
                          onReturn={() => {
                            if (window.confirm("Отметить возврат и снять с KPI?")) {
                              returnMutation.mutate(s.id);
                            }
                          }}
                          onRefuse={() => askCloseSale(s.id, "refused")}
                          onComplete={() => askCloseSale(s.id, "completed")}
                        />
                      ) : (
                        <span className="text-[var(--mo-text-muted)]">—</span>
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

      {tab === "debtors" && (isAdminOrOwner || isCurator) ? (
        <section className="mo-section space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[var(--mo-text)] sm:text-lg">Дебиторка</h2>
              <p className="mt-1 hidden text-sm lux-caption sm:block">
                Открытые долги на конец выбранного месяца: тянутся из прошлых месяцев, пока клиент не
                закроет долг (или курс/протокол не закрыт статусом отказ/завершён).
              </p>
            </div>
            <p className="text-xs mo-muted sm:text-sm">
              Итого:{" "}
              <span className="font-semibold text-[var(--mo-text)]">
                {formatMoney(num(debtorsQuery.data?.total_debt))}
              </span>
            </p>
          </div>

          <ul className="space-y-2 sm:hidden">
            {(debtorsQuery.data?.rows ?? []).map((r) => (
              <li
                key={`${r.source}-${r.source_id}`}
                className="rounded-xl border border-[var(--mo-border)] px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--mo-text)]">{r.client_name}</p>
                    <p className="truncate text-[11px] mo-muted">
                      {r.source === "booking" ? "Запись" : "Курс"} · {r.indicator_name}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums kpi-actual-value">
                    {formatMoney(num(r.debt_amount))}
                  </span>
                </div>
                <div className="mt-1 flex justify-between gap-2 text-[11px] mo-muted">
                  <span className="truncate">{r.manager_name ?? "—"}</span>
                  <span className="tabular-nums">
                    {formatMoney(num(r.paid_amount))} / {formatMoney(num(r.service_amount))}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto sm:block">
            <table className="kpi-data-table min-w-[1000px] text-sm">
              <thead>
                <tr>
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
                  <tr key={`${r.source}-${r.source_id}`}>
                    <td className="py-2 pr-3">{r.source === "booking" ? "Запись" : "Курс/протокол"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.sold_at ? formatSaleDt(r.sold_at) : "—"}
                    </td>
                    <td className="py-2 pr-3">{r.client_name}</td>
                    <td className="py-2 pr-3">{r.client_phone}</td>
                    <td className="py-2 pr-3">{r.indicator_name}</td>
                    <td className="py-2 pr-3">{r.manager_name ?? "—"}</td>
                    <td className="py-2 pr-3">{formatMoney(num(r.service_amount))}</td>
                    <td className="py-2 pr-3">{formatMoney(num(r.paid_amount))}</td>
                    <td className="py-2 pr-3 kpi-actual-value">{formatMoney(num(r.debt_amount))}</td>
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
  if (loading) return <p className="text-sm lux-caption">Загрузка отчёта «Продажи»…</p>;
  if (error) return <p className="text-sm text-red-300">{error.message}</p>;
  if (!data) return null;

  if (!data.items.length) {
    return (
      <section className="mo-section p-4">
        <h2 className="lux-subheading">Продажи</h2>
        <p className="mt-2 text-sm lux-caption">План на этот месяц ещё не задан. Владелец заполняет вкладку «План».</p>
      </section>
    );
  }

  if (!data.managers.length) {
    return (
      <section className="mo-section p-4">
        <h2 className="lux-subheading">Продажи</h2>
        <p className="mt-2 text-sm lux-caption">
          Нет активных менеджеров на воронке. Назначьте менеджеров — блоки появятся автоматически.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-6">
      <section className="mo-section px-3 py-2.5 sm:p-4">
        <h2 className="text-[15px] font-semibold text-[var(--mo-text)] sm:text-lg">Продажи · {data.year_month}</h2>
        <p className="mt-0.5 text-[11px] lux-caption sm:mt-1 sm:text-sm">
          Фонд: {formatMoney(num(data.bonus_fund))} на менеджера
        </p>
      </section>

      {data.managers.map((m) => (
        <section key={m.manager_id} className="mo-section p-2.5 sm:p-4">
          <h3 className="mb-1.5 text-[15px] font-semibold text-[var(--mo-text)] sm:mb-3 sm:text-lg">
            {m.manager_name}
          </h3>

          <ul className="divide-y divide-[var(--mo-border)] overflow-hidden rounded-xl border border-[var(--mo-border)] sm:hidden">
            {m.lines.map((line) => (
              <li key={line.plan_item_id} className="px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-[13px] font-semibold leading-tight text-[var(--mo-text)]">
                    {line.name}
                  </p>
                  <span className="shrink-0 text-[12px] font-semibold tabular-nums text-[var(--mo-text)]">
                    {contribLabel(line.contribution)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-tight tabular-nums mo-muted">
                  {line.fact_qty}/{line.plan_qty} · {pctLabel(line.completion)} · вес {num(line.weight_percent)}%
                </p>
              </li>
            ))}
            <li className="bg-[var(--mo-surface)]/55 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2 text-[13px] font-semibold text-[var(--mo-text)]">
                <span>Итого вклад</span>
                <span className="tabular-nums">{contribLabel(m.total_contribution)}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2 text-[13px] font-semibold text-[var(--mo-text)]">
                <span>Бонус</span>
                <span className="tabular-nums kpi-actual-value">{formatMoney(num(m.bonus))}</span>
              </div>
            </li>
          </ul>

          <div className="hidden overflow-x-auto sm:block">
            <table className="kpi-data-table min-w-[900px] text-sm">
              <thead>
                <tr>
                  <th className="py-2 pr-3">Продукт</th>
                  <th className="py-2 pr-3">План</th>
                  <th className="py-2 pr-3">Вес %</th>
                  <th className="py-2 pr-3">Факт</th>
                  <th className="py-2 pr-3">Выполн.</th>
                  <th className="py-2 pr-3">Вклад %</th>
                </tr>
              </thead>
              <tbody>
                {m.lines.map((line) => (
                  <tr key={line.plan_item_id}>
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
                  <td className="py-2 pr-3 font-semibold kpi-actual-value" colSpan={5}>
                    Бонус
                  </td>
                  <td className="py-2 pr-3 font-semibold kpi-actual-value">
                    {formatMoney(num(m.bonus))}
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

function CompanyReportSection({
  data,
  loading,
  error,
  hideBookingExperts = false,
}: {
  data: SalesKpiCompanyReport | undefined;
  loading: boolean;
  error: Error | null;
  hideBookingExperts?: boolean;
}) {
  if (loading) {
    return (
      <p className="text-sm lux-caption">
        Загрузка отчёта компании… Считаем записи и продажи за месяц — обычно 5–20 сек.
      </p>
    );
  }
  if (error) return <p className="text-sm text-red-300">{error.message}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4 sm:space-y-6">
      <section className="mo-section p-3 sm:p-4">
        <h2 className="text-base font-semibold text-[var(--mo-text)] sm:text-lg">
          Отчёт компании · {data.year_month}
        </h2>
        <p className="mt-1 hidden text-sm lux-caption sm:block">
          {hideBookingExperts
            ? "Сводка для владельца: ход плана, выручка и долги. Выручка = оплаты по продажам месяца (не кассовый ОСВ по дате проводки). Дебиторка — открытый остаток на конец месяца с переносом."
            : "Сводка для владельца. Выручка = сумма оплат по визитам и курсам месяца (нал/Алиф/DC), без неявок; это не ОСВ по дате кассовой проводки. Дебиторка — кто ещё должен на конец месяца (долги прошлых месяцев тоже)."}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--mo-border)] p-2.5 sm:p-3">
            <div className="text-[11px] mo-muted sm:text-xs">Выполнение плана</div>
            <div className="mt-1 text-xl font-semibold text-[var(--mo-text)] sm:text-2xl">
              {num(data.plan_completion_percent).toFixed(1)}%
            </div>
            {data.days_in_month ? (
              <div className="mt-1 text-[10px] mo-muted sm:text-xs">
                день {data.days_elapsed ?? 0} из {data.days_in_month} (
                {num(data.month_progress_percent).toFixed(0)}% месяца)
              </div>
            ) : null}
          </div>
          <div className="rounded-xl border border-[var(--mo-border)] p-2.5 sm:p-3">
            <div className="text-[11px] mo-muted sm:text-xs">Выручка (TJS)</div>
            <div className="mt-1 text-xl font-semibold kpi-actual-value sm:text-2xl">
              {formatMoney(data.revenue_total)}
            </div>
            <div className="mt-1 text-[10px] mo-muted sm:text-xs">
              запись {formatMoney(data.revenue_booking)} · курсы {formatMoney(data.revenue_manual)}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--mo-border)] p-2.5 sm:p-3">
            <div className="text-[11px] mo-muted sm:text-xs">Дебиторка (остаток)</div>
            <div className="mt-1 text-xl font-semibold text-amber-600 sm:text-2xl dark:text-amber-200">
              {formatMoney(data.debtor_total)}
            </div>
            <div className="mt-1 text-[10px] mo-muted sm:text-xs">
              запись {formatMoney(data.debtor_booking)} · курсы {formatMoney(data.debtor_manual)}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--mo-border)] p-2.5 sm:p-3">
            <div className="text-[11px] mo-muted sm:text-xs">Кредиторка</div>
            <div className="mt-1 text-xl font-semibold text-[var(--mo-text)] sm:text-2xl">
              {formatMoney(data.creditor_total)}
            </div>
            <div className="mt-1 hidden text-xs mo-muted sm:block">оплачено, срок визита ещё не наступил</div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)]/50 p-4">
          <h3 className="text-sm font-semibold text-[var(--mo-text)]">Выручка при 100% плана</h3>
          <p className="mt-1 text-xs mo-muted">
            Оценка целевой выручки: текущая выручка ÷ текущий % плана × 100%. Рядом — факт и промежуточные
            ориентиры 25% / 50%.
          </p>
          {data.revenue_at_plan_100_percent == null ? (
            <p className="mt-3 text-sm lux-caption">
              Недостаточно данных (нужны выручка и выполнение плана &gt; 0).
            </p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 sm:col-span-2 lg:col-span-1">
                <div className="text-[11px] font-medium text-emerald-200">При 100% плана</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--mo-text)]">
                  {formatMoney(data.revenue_at_plan_100_percent)}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--mo-border)] p-3">
                <div className="text-[11px] mo-muted">Сейчас факт</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--mo-text)]">
                  {num(data.plan_completion_percent).toFixed(1)}% · {formatMoney(data.revenue_total)}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--mo-border)] p-3">
                <div className="text-[11px] mo-muted">При 25%</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--mo-text)]">
                  {formatMoney(data.revenue_at_plan_25_percent)}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--mo-border)] p-3">
                <div className="text-[11px] mo-muted">При 50%</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--mo-text)]">
                  {formatMoney(data.revenue_at_plan_50_percent)}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-[var(--mo-border)] p-4">
          <h3 className="text-sm font-semibold text-[var(--mo-text)]">Прогноз на конец месяца</h3>
          <p className="mt-1 text-xs mo-muted">{data.forecast_note || "—"}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs mo-muted">Прогноз выполнения плана</div>
              <div className="mt-1 text-2xl font-semibold text-[var(--mo-text)]">
                {data.forecast_plan_completion_percent == null
                  ? "—"
                  : `${num(data.forecast_plan_completion_percent).toFixed(1)}%`}
              </div>
            </div>
            <div>
              <div className="text-xs mo-muted">Прогноз выручки</div>
              <div className="mt-1 text-2xl font-semibold kpi-actual-value">
                {data.forecast_revenue == null ? "—" : formatMoney(data.forecast_revenue)}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-3 text-sm mo-muted">
          Сумма бонусов менеджеров (из «Продажи»):{" "}
          <span className="font-medium text-[var(--mo-text)]">
            {formatMoney(data.managers_sales_bonus_total)}
          </span>
        </p>
      </section>

      <section className="mo-section p-4">
        <h3 className="mb-1 text-lg font-semibold text-[var(--mo-text)]">План компании по продуктам</h3>
        <p className="mb-3 text-xs mo-muted">
          Колонка «План» — сумма планов всех менеджеров по продукту (как во вкладке «Продажи»).
        </p>
        {data.plan_lines.length === 0 ? (
          <p className="text-sm lux-caption">План на месяц не задан.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="kpi-data-table min-w-[800px] text-sm">
              <thead>
                <tr>
                  <th className="py-2 pr-3">Продукт</th>
                  <th className="py-2 pr-3">План</th>
                  <th className="py-2 pr-3">Вес %</th>
                  <th className="py-2 pr-3">Факт</th>
                  <th className="py-2 pr-3">Выполн.</th>
                  <th className="py-2 pr-3">Вклад %</th>
                </tr>
              </thead>
              <tbody>
                {data.plan_lines.map((line) => (
                  <tr key={line.plan_item_id}>
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
                    ИТОГО вклад / % плана
                  </td>
                  <td className="py-2 pr-3 font-semibold">
                    {contribLabel(data.total_contribution)} · {num(data.plan_completion_percent).toFixed(1)}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!hideBookingExperts ? (
      <>
      <section className="mo-section p-4">
        <h3 className="mb-3 text-lg font-semibold text-[var(--mo-text)]">По услугам</h3>
        <p className="mb-3 text-sm lux-caption">
          Отдельно: Курс, Курс 15, Протокол, Массаж и т.д. — итог по всей клинике за месяц.
        </p>
        <div className="overflow-x-auto">
          <table className="kpi-data-table min-w-[1100px] text-sm">
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
              {(data.service_stats ?? []).map((s) => (
                <tr key={s.direction_id ?? s.direction_name}>
                  <td className="py-2 pr-3 font-medium">{s.direction_name}</td>
                  <td className="py-2 pr-3">{s.appointments_total}</td>
                  <td className="py-2 pr-3">{s.appeared_count}</td>
                  <td className="py-2 pr-3">{s.no_show_count}</td>
                  <td className="py-2 pr-3">{s.booked_count ?? 0}</td>
                  <td className="py-2 pr-3">{formatMoney(s.paid_full_amount ?? 0)}</td>
                  <td className="py-2 pr-3">{formatMoney(s.paid_no_show_amount ?? 0)}</td>
                  <td className="py-2 pr-3">{formatMoney(s.revenue_paid)}</td>
                  <td className="py-2 pr-3">{formatMoney(s.debtor_amount ?? 0)}</td>
                </tr>
              ))}
              {(data.service_stats ?? []).length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-3 mo-muted">
                    Нет записей за месяц
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mo-section p-4">
        <h3 className="mb-3 text-lg font-semibold text-[var(--mo-text)]">По экспертам</h3>
        <p className="mb-3 text-sm lux-caption">
          Сводка по специалисту (все его услуги вместе). Детализация по услугам — в таблице выше.
        </p>
        <div className="overflow-x-auto">
          <table className="kpi-data-table min-w-[1000px] text-sm">
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
                <th className="py-2 pr-3">Кредиторка</th>
              </tr>
            </thead>
            <tbody>
              {data.expert_stats.map((e) => (
                <tr key={e.specialist_id}>
                  <td className="py-2 pr-3">
                    <div>{e.specialist_name}</div>
                    {e.kpi_service_name ? (
                      <div className="text-xs mo-muted">KPI: {e.kpi_service_name}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">{e.appointments_total}</td>
                  <td className="py-2 pr-3">{e.appeared_count}</td>
                  <td className="py-2 pr-3">{e.no_show_count}</td>
                  <td className="py-2 pr-3">{formatMoney(e.paid_full_amount ?? 0)}</td>
                  <td className="py-2 pr-3">{formatMoney(e.paid_no_show_amount ?? 0)}</td>
                  <td className="py-2 pr-3">{formatMoney(e.revenue_paid)}</td>
                  <td className="py-2 pr-3">{formatMoney(e.debtor_amount)}</td>
                  <td className="py-2 pr-3">{formatMoney(e.creditor_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </>
      ) : null}
    </div>
  );
}
