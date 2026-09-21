/** Общая оболочка кабинета РОП: табы + выбор воронки. */

import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useOutletContext } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 sm:px-6">
      <div className="mo-admin-page-head flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--mo-text)]">Кабинет РОП</h1>
          <p className="mt-0.5 text-sm mo-muted">Отдел продаж: менеджеры, лиды, выручка</p>
        </div>
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

      <nav className="flex flex-wrap gap-1 border-b border-[var(--mo-border)] pb-1">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={"end" in t ? t.end : false}
            className={({ isActive }) =>
              [
                "rounded-lg px-3 py-1.5 text-sm transition",
                isActive
                  ? "bg-[var(--mo-accent)]/15 font-medium text-[var(--mo-text)]"
                  : "mo-muted hover:bg-[var(--mo-surface)] hover:text-[var(--mo-text)]",
              ].join(" ")
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={ctx} />
    </div>
  );
}
