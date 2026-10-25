/** Общая оболочка кабинета РОП: табы + выбор воронки. */

import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

import { PrintButton } from "@/components/PrintButton";
import { apiFetch } from "@/lib/api";
import type { Pipeline } from "@/lib/types";

const TABS = [
  { to: "/rop", end: true, label: "Дашборд" },
  { to: "/rop/stats", label: "Статистика" },
  { to: "/rop/distribute", label: "Распределение" },
  { to: "/rop/analytics", label: "Аналитика" },
  { to: "/rop/report", label: "Отчёт" },
  { to: "/rop/search", label: "Поиск" },
] as const;

export type RopOutletContext = {
  pipelineId: number | null;
  setPipelineId: (id: number) => void;
  pipelines: Pipeline[];
};

export function useRopContext() {
  return useOutletContext<RopOutletContext>();
}

export function RopLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<Pipeline[]>("/api/pipelines"),
  });
  const pipelines = pipelinesQuery.data ?? [];
  const [pipelineId, setPipelineId] = useState<number | null>(null);

  useEffect(() => {
    if (pipelineId != null || pipelines.length === 0) return;
    const medicine = pipelines.find((p) => /медицин/i.test(p.name || ""));
    setPipelineId(medicine?.id ?? pipelines[0]!.id);
  }, [pipelines, pipelineId]);

  const ctx = useMemo(
    () => ({ pipelineId, setPipelineId, pipelines }),
    [pipelineId, pipelines],
  );

  return (
    <div className="mo-page">
      <div className="mo-admin-page-head print-screen-only flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mo-page-title">Кабинет РОП</h1>
          <p className="mo-page-sub">Отдел продаж: менеджеры, лиды, выручка</p>
        </div>
        <div className="flex items-end gap-2">
          <PrintButton />
          <label className="text-sm mo-muted">
            Воронка
            <select
              className="mo-input mt-1 min-w-[12rem]"
              value={pipelineId ?? ""}
              onChange={(e) => setPipelineId(Number(e.target.value))}
              disabled={!pipelines.length}
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <nav className="print-screen-only flex flex-wrap gap-1 border-b border-[var(--mo-border)] pb-1">
        {TABS.map((t) => {
          const exact = "end" in t ? t.end : false;
          const active = exact ? pathname === t.to : pathname === t.to || pathname.startsWith(`${t.to}/`);
          return (
            <button
              key={t.to}
              type="button"
              onClick={() => navigate(t.to)}
              className={[
                "cursor-pointer rounded-lg border-0 bg-transparent px-3 py-1.5 font-[inherit] text-sm transition",
                active
                  ? "bg-[var(--mo-accent)]/15 font-medium text-[var(--mo-text)]"
                  : "mo-muted hover:bg-[var(--mo-surface)] hover:text-[var(--mo-text)]",
              ].join(" ")}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <Outlet context={ctx} />
    </div>
  );
}
