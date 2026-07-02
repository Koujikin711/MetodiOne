import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { AccessDenied } from "@/components/AccessDenied";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type {
  SalesKpiDirectionMeta,
  SalesKpiManagerMatrix,
  SalesKpiOwnerMatrix,
  SalesKpiPipelineMeta,
} from "@/lib/types";

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

function defaultYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function KpiPage() {
  const queryClient = useQueryClient();
  const role = decodeRoleFromToken(getStoredToken());
  const isOwner = role === "owner" || role === "super_owner";
  const isManagerLike = role === "manager" || role === "admin";

  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  const [pipelineId, setPipelineId] = useState<number | null>(null);
  const [priceDraft, setPriceDraft] = useState<Record<number, string>>({});
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});

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

  const ownerQuery = useQuery({
    queryKey: ["sales-kpi-owner-matrix", qs],
    queryFn: () => apiFetch<SalesKpiOwnerMatrix>(`/api/sales-kpi/owner-matrix?${qs}`),
    enabled: Boolean(isOwner && pipelineId),
  });

  const managerQuery = useQuery({
    queryKey: ["sales-kpi-manager-matrix", qs],
    queryFn: () => apiFetch<SalesKpiManagerMatrix>(`/api/sales-kpi/manager-matrix?${qs}`),
    enabled: Boolean(isManagerLike && pipelineId),
  });

  useEffect(() => {
    if (!ownerQuery.data) return;
    const p: Record<number, string> = {};
    ownerQuery.data.directions.forEach((d) => {
      p[d.direction_id] = String(Number(d.unit_price || 0) || "");
    });
    setPriceDraft(p);
    const q: Record<string, string> = {};
    ownerQuery.data.managers.forEach((m) => {
      m.cells.forEach((c) => {
        q[`${m.manager_id}:${c.direction_id}`] = String(c.plan_qty || "");
      });
    });
    setQtyDraft(q);
  }, [ownerQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!pipelineId || !ownerQuery.data) throw new Error("Нет данных для сохранения");
      const directions = ownerQuery.data.directions;
      const managers = ownerQuery.data.managers;
      await apiFetch<void>("/api/sales-kpi/matrix", {
        method: "PUT",
        body: JSON.stringify({
          pipeline_id: pipelineId,
          year_month: yearMonth,
          prices: directions.map((d) => ({
            direction_id: d.direction_id,
            unit_price: Number(priceDraft[d.direction_id] || 0),
          })),
          managers: managers.map((m) => ({
            manager_user_id: m.manager_id,
            cells: directions.map((d) => ({
              direction_id: d.direction_id,
              plan_qty: Number(qtyDraft[`${m.manager_id}:${d.direction_id}`] || 0),
            })),
          })),
        }),
      });
    },
    onSuccess: () => {
      toast.success("KPI-матрица сохранена");
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-owner-matrix"] });
      void queryClient.invalidateQueries({ queryKey: ["sales-kpi-manager-matrix"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (role === "expert") {
    return <AccessDenied message="Раздел KPI недоступен для вашей роли." />;
  }

  return (
    <div className="relative mx-auto max-w-[1500px] space-y-6 pb-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--mo-text)]">KPI продаж</h1>
        <p className="text-sm lux-caption">
          Месячная матрица по выбранной воронке: сверху услуги (специальности), справа менеджеры, план задаётся в
          количестве, цена задаётся отдельно, факт-сумма считается как факт-количество × цена услуги.
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

      {isOwner && ownerQuery.data ? (
        <section className="mo-section p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="lux-subheading">Матрица владельца</h2>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="btn-primary text-sm disabled:opacity-50"
            >
              Сохранить
            </button>
          </div>
          <OwnerMatrixTable
            data={ownerQuery.data}
            priceDraft={priceDraft}
            qtyDraft={qtyDraft}
            onPriceChange={setPriceDraft}
            onQtyChange={setQtyDraft}
          />
        </section>
      ) : null}

      {isManagerLike && managerQuery.data ? (
        <section className="mo-section p-4">
          <h2 className="mb-3 lux-subheading">Мой KPI</h2>
          <ManagerMatrixTable data={managerQuery.data} />
        </section>
      ) : null}

      {(ownerQuery.isLoading || managerQuery.isLoading || pipelinesQuery.isLoading) && (
        <p className="text-sm lux-caption">Загрузка KPI…</p>
      )}
      {(ownerQuery.isError || managerQuery.isError || pipelinesQuery.isError) && (
        <p className="text-sm text-red-300">
          {(ownerQuery.error as Error)?.message ||
            (managerQuery.error as Error)?.message ||
            (pipelinesQuery.error as Error)?.message}
        </p>
      )}
    </div>
  );
}

function OwnerMatrixTable({
  data,
  priceDraft,
  qtyDraft,
  onPriceChange,
  onQtyChange,
}: {
  data: SalesKpiOwnerMatrix;
  priceDraft: Record<number, string>;
  qtyDraft: Record<string, string>;
  onPriceChange: (next: Record<number, string>) => void;
  onQtyChange: (next: Record<string, string>) => void;
}) {
  const directions = data.directions;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1200px] border-collapse text-left text-sm text-[var(--mo-text)]">
        <thead>
          <tr className="border-b border-[var(--mo-border)] lux-caption">
            <th className="py-2 pr-3">Менеджер</th>
            {directions.map((d) => (
              <th key={d.direction_id} className="py-2 pr-3">
                {d.direction_name}
              </th>
            ))}
            <th className="py-2 pr-3">Итого план</th>
            <th className="py-2 pr-3">Итого факт</th>
            <th className="py-2 pr-3">% итог</th>
          </tr>
        </thead>
        <tbody>
          <tr className="kpi-matrix-row-highlight border-b border-[var(--mo-border)]">
            <td className="py-2 pr-3 font-medium mo-muted">Цена услуги</td>
            {directions.map((d) => (
              <td key={d.direction_id} className="py-2 pr-3">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={priceDraft[d.direction_id] ?? ""}
                  onChange={(e) =>
                    onPriceChange({
                      ...priceDraft,
                      [d.direction_id]: e.target.value,
                    })
                  }
                  className="kpi-cell-input w-24"
                />
              </td>
            ))}
            <td colSpan={3} />
          </tr>
          {data.managers.map((m) => (
            <tr key={m.manager_id} className="border-b border-[var(--mo-border)]/70">
              <td className="py-2 pr-3 font-medium">{m.manager_name}</td>
              {directions.map((d) => {
                const cell = m.cells.find((x) => x.direction_id === d.direction_id);
                const key = `${m.manager_id}:${d.direction_id}`;
                return (
                  <td key={d.direction_id} className="py-2 pr-3">
                    <div className="space-y-1">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={qtyDraft[key] ?? ""}
                        onChange={(e) => onQtyChange({ ...qtyDraft, [key]: e.target.value })}
                        className="kpi-cell-input w-20"
                        title="Плановое количество"
                      />
                      <div className="text-xs mo-muted">
                        факт {cell?.actual_count ?? 0} шт · {moneyFmt.format(Number(cell?.actual_paid ?? 0))} /{" "}
                        {moneyFmt.format(Number(cell?.plan_amount ?? 0))}
                      </div>
                      <div className="text-xs text-[var(--mo-accent-hover)]">
                        {cell?.progress_percent != null ? `${cell.progress_percent.toFixed(1)}%` : "—"}
                      </div>
                    </div>
                  </td>
                );
              })}
              <td className="py-2 pr-3">{moneyFmt.format(Number(m.total_plan_amount))}</td>
              <td className="py-2 pr-3 kpi-actual-value">{moneyFmt.format(Number(m.total_actual_paid))}</td>
              <td className="py-2 pr-3">{m.total_progress_percent != null ? `${m.total_progress_percent.toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManagerMatrixTable({ data }: { data: SalesKpiManagerMatrix }) {
  const byDirection: Record<number, SalesKpiDirectionMeta> = {};
  data.directions.forEach((d) => {
    byDirection[d.direction_id] = d;
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-left text-sm text-[var(--mo-text)]">
        <thead>
          <tr className="border-b border-[var(--mo-border)] lux-caption">
            <th className="py-2 pr-3">Услуга</th>
            <th className="py-2 pr-3">Цена</th>
            <th className="py-2 pr-3">План (шт)</th>
            <th className="py-2 pr-3">Факт (шт)</th>
            <th className="py-2 pr-3">План (сумма)</th>
            <th className="py-2 pr-3">Факт (сумма)</th>
            <th className="py-2 pr-3">Выполнение</th>
          </tr>
        </thead>
        <tbody>
          {data.manager.cells.map((c) => (
            <tr key={c.direction_id} className="border-b border-[var(--mo-border)]/70">
              <td className="py-2 pr-3">{byDirection[c.direction_id]?.direction_name ?? c.direction_id}</td>
              <td className="py-2 pr-3">{moneyFmt.format(Number(byDirection[c.direction_id]?.unit_price ?? 0))}</td>
              <td className="py-2 pr-3">{c.plan_qty}</td>
              <td className="py-2 pr-3">{c.actual_count}</td>
              <td className="py-2 pr-3">{moneyFmt.format(Number(c.plan_amount))}</td>
              <td className="py-2 pr-3 kpi-actual-value">{moneyFmt.format(Number(c.actual_paid))}</td>
              <td className="py-2 pr-3">{c.progress_percent != null ? `${c.progress_percent.toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
          <tr className="kpi-matrix-row-highlight">
            <td className="py-2 pr-3 font-semibold">Итого</td>
            <td />
            <td />
            <td />
            <td className="py-2 pr-3 font-semibold">{moneyFmt.format(Number(data.manager.total_plan_amount))}</td>
            <td className="py-2 pr-3 font-semibold kpi-actual-value">
              {moneyFmt.format(Number(data.manager.total_actual_paid))}
            </td>
            <td className="py-2 pr-3 font-semibold">
              {data.manager.total_progress_percent != null ? `${data.manager.total_progress_percent.toFixed(1)}%` : "—"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
