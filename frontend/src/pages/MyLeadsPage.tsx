import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import type { Lead } from "@/lib/types";

function leadDateBadge(createdAt?: string | null): string {
  if (!createdAt) return "—";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function MyLeadsPage() {
  const leadsQuery = useQuery({
    queryKey: ["leads"],
    queryFn: () => apiFetch<Lead[]>("/api/leads"),
  });

  return (
    <div className="relative mx-auto max-w-[1200px] space-y-6 pb-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Мои лиды</h1>
        <p className="mt-1 text-sm lux-caption">Лиды, закреплённые за вами</p>
      </header>

      {leadsQuery.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
      {leadsQuery.isError && (
        <p className="text-sm text-red-300">{(leadsQuery.error as Error).message}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(leadsQuery.data ?? []).map((lead) => (
          <Link
            key={lead.id}
            to={`/leads/${lead.id}`}
            className="mo-section p-4 shadow-inner backdrop-blur-sm transition hover:border-purple-500/30 hover:bg-[var(--mo-accent-soft)]"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium leading-snug text-white">{lead.name}</p>
              <span className="shrink-0 rounded-full bg-slate-700/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide lux-caption">
                {leadDateBadge(lead.created_at)}
              </span>
            </div>
            <p className="mt-2 text-sm lux-caption">{lead.phone ?? "—"}</p>
            {lead.stage_name && (
              <p className="mt-2 text-xs text-purple-300/90">{lead.stage_name}</p>
            )}
          </Link>
        ))}
      </div>

      {!leadsQuery.isLoading && (leadsQuery.data ?? []).length === 0 && (
        <p className="text-sm mo-muted">Пока нет лидов</p>
      )}
    </div>
  );
}
