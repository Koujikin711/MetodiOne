import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { GradientIconBox } from "@/components/GradientIconBox";
import { BarChart3, CheckSquare, TrendingUp } from "@/components/icons";
import { apiFetch } from "@/lib/api";
import type { AnalyticsSummary, Task } from "@/lib/types";

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

function StatWidget({
  title,
  value,
  subtitle,
  icon,
  glowClass,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: ReactNode;
  glowClass: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-800/50 p-8 shadow-xl backdrop-blur-md transition-all duration-500 hover:border-slate-600/50 ${glowClass}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{title}</p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-white">{value}</p>
          <p className="mt-2 text-sm text-slate-400">{subtitle}</p>
        </div>
        {icon}
      </div>
    </div>
  );
}

export function AnalyticsPage() {
  const summaryQuery = useQuery({
    queryKey: ["analytics"],
    queryFn: () => apiFetch<AnalyticsSummary>("/api/analytics/summary"),
    refetchInterval: 4_000,
    refetchOnWindowFocus: true,
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiFetch<Task[]>("/api/tasks"),
    refetchInterval: 8_000,
    refetchOnWindowFocus: true,
  });

  const totalLeads = summaryQuery.data?.total_leads;
  const dealsSum = summaryQuery.data?.deals_total_amount;
  const conversion = summaryQuery.data?.conversion_percent;

  const tasksOpen =
    tasksQuery.data?.filter((t) => t.status !== "done" && t.status !== "cancelled").length ?? "—";

  const dealsDisplay =
    dealsSum !== undefined ? moneyFmt.format(Number(dealsSum)) : summaryQuery.isLoading ? "…" : "—";
  const conversionDisplay =
    conversion !== undefined ? `${conversion} %` : summaryQuery.isLoading ? "…" : "—";

  return (
    <div className="relative mx-auto max-w-5xl space-y-12">
      <div
        className="pointer-events-none absolute -right-10 top-0 h-64 w-64 rounded-full bg-purple-600/20 blur-[80px]"
        style={{ animation: "blob-float 24s ease-in-out infinite" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 rounded-full bg-indigo-600/15 blur-[90px]"
        aria-hidden
      />

      <header className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-5">
          <GradientIconBox variant="purple" className="h-14 w-14 [&_svg]:h-7 [&_svg]:w-7">
            <TrendingUp className="h-7 w-7" />
          </GradientIconBox>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Аналитика</h1>
            <p className="mt-1 max-w-xl text-slate-400">
              Счётчики обновляются каждые несколько секунд. Сумма сделок — по полю{" "}
              <span className="text-slate-300">amount</span> в модели Deal.
            </p>
          </div>
        </div>
      </header>

      {summaryQuery.isError && (
        <p className="text-sm text-red-300">{(summaryQuery.error as Error).message}</p>
      )}

      <div className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <StatWidget
          title="Всего лидов"
          value={summaryQuery.isLoading ? "…" : (totalLeads ?? "—")}
          subtitle="В воронке сейчас"
          glowClass="shadow-[0_0_40px_-10px_rgba(168,85,247,0.45)]"
          icon={
            <GradientIconBox variant="purple" className="h-12 w-12 [&_svg]:h-6 [&_svg]:w-6">
              <TrendingUp className="h-6 w-6" />
            </GradientIconBox>
          }
        />
        <StatWidget
          title="Сумма сделок"
          value={dealsDisplay}
          subtitle="Σ amount по всем сделкам"
          glowClass="shadow-[0_0_40px_-10px_rgba(59,130,246,0.4)]"
          icon={
            <GradientIconBox variant="blue" className="h-12 w-12 [&_svg]:h-6 [&_svg]:w-6">
              <BarChart3 className="h-6 w-6" />
            </GradientIconBox>
          }
        />
        <StatWidget
          title="Конверсия"
          value={conversionDisplay}
          subtitle="Лиды в успешных этапах (Успешно реализован / Оплачено)"
          glowClass="shadow-[0_0_40px_-10px_rgba(52,211,153,0.35)]"
          icon={
            <GradientIconBox variant="teal" className="h-12 w-12 [&_svg]:h-6 [&_svg]:w-6">
              <BarChart3 className="h-6 w-6" />
            </GradientIconBox>
          }
        />
      </div>

      <div className="relative grid gap-6 sm:grid-cols-1 lg:grid-cols-2">
        <StatWidget
          title="Активные задачи"
          value={tasksQuery.isLoading ? "…" : tasksOpen}
          subtitle="Не завершены и не отменены"
          glowClass="shadow-[0_0_40px_-10px_rgba(20,184,166,0.35)]"
          icon={
            <GradientIconBox variant="teal" className="h-12 w-12 [&_svg]:h-6 [&_svg]:w-6">
              <CheckSquare className="h-6 w-6" />
            </GradientIconBox>
          }
        />
      </div>

      <div className="relative glass-card px-10 py-14 text-center">
        <p className="text-sm leading-relaxed text-slate-400">
          Перетащите лид в «Успешно реализован» — сработает робот и появится задача; счётчики и список
          задач подтянутся автоматически.
        </p>
      </div>
    </div>
  );
}
