import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { PatientPhone } from "@/components/PatientPhone";
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
    <div className="relative mx-auto max-w-lg space-y-4 pb-10 sm:max-w-[720px] sm:space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--mo-text)] sm:text-3xl">Мои лиды</h1>
      </header>

      {leadsQuery.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
      {leadsQuery.isError && (
        <p className="text-sm text-red-300">{(leadsQuery.error as Error).message}</p>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {(leadsQuery.data ?? []).map((lead) => (
          <Link
            key={lead.id}
            to={`/leads/${lead.id}`}
            className="mo-section p-3 shadow-inner backdrop-blur-sm transition hover:border-[var(--mo-border-strong)] hover:bg-[var(--mo-accent-soft)] sm:p-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-semibold leading-snug text-[var(--mo-text)]">
                {lead.name}
              </p>
              <span className="shrink-0 rounded-lg border border-[var(--mo-border)] bg-[var(--mo-surface)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide tabular-nums mo-muted">
                {leadDateBadge(lead.created_at)}
              </span>
            </div>
            <p className="mt-1.5 text-sm font-medium tabular-nums tracking-wide text-[var(--mo-text)]">
              <PatientPhone value={lead} />
            </p>
            {lead.stage_name ? (
              <p className="mt-1.5 text-xs text-[var(--mo-accent-hover)]">{lead.stage_name}</p>
            ) : null}
          </Link>
        ))}
      </div>

      {!leadsQuery.isLoading && (leadsQuery.data ?? []).length === 0 && (
        <p className="text-sm mo-muted">Пока нет лидов</p>
      )}
    </div>
  );
}
