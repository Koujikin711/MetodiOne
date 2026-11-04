/** Общая оболочка кабинета РОП: табы + выбор воронки. */

import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

import { DateField } from "@/components/DateField";
import { PrintButton } from "@/components/PrintButton";
import { Search } from "@/components/icons";
import { apiFetch } from "@/lib/api";
import type { Pipeline } from "@/lib/types";

/** Порядок: Дашборд → Распределение → Статистика → Аналитика → Отчёт → Прогноз; поиск — иконка у печати. */
const TABS = [
  { to: "/rop", end: true, label: "Дашборд" },
  { to: "/rop/distribute", label: "Распределение" },
  { to: "/rop/stats", label: "Статистика" },
  { to: "/rop/analytics", label: "Аналитика" },
  { to: "/rop/report", label: "Отчёт" },
  { to: "/rop/outlook", label: "Прогноз" },
] as const;

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export type RopOutletContext = {
  pipelineId: number | null;
  setPipelineId: (id: number) => void;
  pipelines: Pipeline[];
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
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
  const [from, setFrom] = useState(monthStartYmd);
  const [to, setTo] = useState(todayYmd);

  const showPeriod =
    pathname.startsWith("/rop/stats") ||
    pathname.startsWith("/rop/analytics") ||
    pathname.startsWith("/rop/report");
  const searchActive = pathname.startsWith("/rop/search");

  useEffect(() => {
    if (pipelineId != null || pipelines.length === 0) return;
    const medicine = pipelines.find((p) => /медицин/i.test(p.name || ""));
    setPipelineId(medicine?.id ?? pipelines[0]!.id);
  }, [pipelines, pipelineId]);

  const ctx = useMemo(
    () => ({ pipelineId, setPipelineId, pipelines, from, to, setFrom, setTo }),
    [pipelineId, pipelines, from, to],
  );

  return (
    <div className="mo-page">
      <div className="mo-admin-page-head print-screen-only flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mo-page-title">Кабинет РОП</h1>
          <p className="mo-page-sub">Отдел продаж: менеджеры, лиды, выручка</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {showPeriod ? (
            <div className="rop-date-row rop-date-row--toolbar" role="group" aria-label="Период">
              <label className="rop-date-field text-sm mo-muted">
                с
                <DateField value={from} onChange={setFrom} className="mt-1" aria-label="Дата с" />
              </label>
              <label className="rop-date-field text-sm mo-muted">
                по
                <DateField value={to} onChange={setTo} className="mt-1" aria-label="Дата по" />
              </label>
            </div>
          ) : null}
          <PrintButton />
          <button
            type="button"
            className={[
              "journal-icon-btn print-hide inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--mo-border-strong)] bg-[var(--mo-surface-elevated)] text-[var(--mo-text)]",
              searchActive ? "border-[var(--mo-accent)] bg-[var(--mo-accent)]/15" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label="Поиск пациента"
            title="Поиск пациента"
            aria-current={searchActive ? "page" : undefined}
            onClick={() => navigate("/rop/search")}
          >
            <Search className="h-5 w-5" />
            <span className="journal-icon-btn__tip" role="tooltip">
              Поиск
            </span>
          </button>
          <label className="rop-pipeline-field text-sm mo-muted">
            <span className="rop-pipeline-field__label">Воронка</span>
            <select
              className="mo-input rop-pipeline-field__select"
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

      <nav className="rop-tabs print-screen-only" aria-label="Разделы кабинета РОП">
        {TABS.map((t) => {
          const exact = "end" in t ? t.end : false;
          const active = exact ? pathname === t.to : pathname === t.to || pathname.startsWith(`${t.to}/`);
          return (
            <button
              key={t.to}
              type="button"
              onClick={() => navigate(t.to)}
              className={["rop-tabs__item", active ? "is-active" : ""].filter(Boolean).join(" ")}
              aria-current={active ? "page" : undefined}
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
