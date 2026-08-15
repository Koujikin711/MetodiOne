import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { PatientPhone, displayPatientPhone } from "@/components/PatientPhone";
import { apiFetch } from "@/lib/api";
import type { Lead } from "@/lib/types";

function leadDateBadge(createdAt?: string | null): string {
  if (!createdAt) return "—";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function leadInitial(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

export function MyLeadsPage() {
  const [q, setQ] = useState("");
  const leadsQuery = useQuery({
    queryKey: ["leads"],
    queryFn: () => apiFetch<Lead[]>("/api/leads"),
  });

  const leads = useMemo(() => {
    const list = leadsQuery.data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((lead) => {
      const phone = displayPatientPhone(lead).toLowerCase();
      return (
        lead.name.toLowerCase().includes(needle) ||
        phone.includes(needle) ||
        (lead.stage_name || "").toLowerCase().includes(needle)
      );
    });
  }, [leadsQuery.data, q]);

  return (
    <div className="relative mx-auto max-w-lg space-y-3 pb-10 sm:max-w-[720px] sm:space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--mo-text)] sm:text-3xl">Мои лиды</h1>
          {!leadsQuery.isLoading ? (
            <p className="mt-0.5 text-[11px] tabular-nums mo-muted sm:text-sm">
              {leads.length}
              {q.trim() ? ` из ${(leadsQuery.data ?? []).length}` : ""}
            </p>
          ) : null}
        </div>
      </header>

      <label className="block">
        <span className="sr-only">Поиск</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Имя, телефон или стадия…"
          className="mo-input w-full rounded-xl px-3 py-2.5 text-sm"
          autoComplete="off"
          inputMode="search"
        />
      </label>

      {leadsQuery.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
      {leadsQuery.isError && (
        <p className="text-sm text-[var(--mo-danger)]">{(leadsQuery.error as Error).message}</p>
      )}

      {!leadsQuery.isLoading && leads.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--mo-border)] px-4 py-8 text-center text-sm mo-muted">
          {q.trim() ? "Никого не нашли" : "Пока нет лидов"}
        </p>
      ) : null}

      {/* Телефон: один блок, плотные строки */}
      <section className="overflow-hidden rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] shadow-sm sm:hidden">
        <ul className="divide-y divide-[var(--mo-border)]">
          {leads.map((lead) => (
            <li key={lead.id}>
              <Link
                to={`/leads/${lead.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition active:bg-[var(--mo-accent-soft)]"
              >
                <span
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mo-accent-soft)] text-[11px] font-semibold tracking-wide text-[var(--mo-accent-hover)]"
                >
                  {leadInitial(lead.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 truncate text-[15px] font-semibold leading-tight text-[var(--mo-text)]">
                      {lead.name}
                    </p>
                    <time className="shrink-0 text-[10px] font-medium tabular-nums tracking-wide mo-muted">
                      {leadDateBadge(lead.created_at)}
                    </time>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-[13px] font-medium tabular-nums tracking-wide text-[var(--mo-text-muted)]">
                      <PatientPhone value={lead} />
                    </p>
                    {lead.stage_name ? (
                      <span className="max-w-[42%] shrink-0 truncate rounded-md bg-[var(--mo-accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--mo-accent-hover)]">
                        {lead.stage_name}
                      </span>
                    ) : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Планшет/десктоп: сетка карточек */}
      <div className="hidden gap-2.5 sm:grid sm:grid-cols-2">
        {leads.map((lead) => (
          <Link
            key={lead.id}
            to={`/leads/${lead.id}`}
            className="mo-section flex items-start gap-3 p-3.5 transition hover:border-[var(--mo-border-strong)] hover:bg-[var(--mo-accent-soft)]"
          >
            <span
              aria-hidden
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--mo-accent-soft)] text-xs font-semibold text-[var(--mo-accent-hover)]"
            >
              {leadInitial(lead.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold leading-snug text-[var(--mo-text)]">
                  {lead.name}
                </p>
                <span className="shrink-0 text-[10px] font-medium tabular-nums mo-muted">
                  {leadDateBadge(lead.created_at)}
                </span>
              </div>
              <p className="mt-1 text-sm font-medium tabular-nums tracking-wide text-[var(--mo-text-muted)]">
                <PatientPhone value={lead} />
              </p>
              {lead.stage_name ? (
                <span className="mt-2 inline-block max-w-full truncate rounded-lg bg-[var(--mo-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--mo-accent-hover)]">
                  {lead.stage_name}
                </span>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
