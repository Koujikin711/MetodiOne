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

function stageShort(name: string | null | undefined): string | null {
  const raw = (name || "").trim();
  if (!raw) return null;
  if (raw === "В обработке" || raw === "В работе") return "В работе";
  if (raw === "Новый лид" || raw === "Новый") return "Новый";
  if (raw === "В ожидании") return "Ожидание";
  return raw;
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
    <div className="box-border w-full max-w-none overflow-x-hidden pb-8 sm:mx-auto sm:max-w-[720px] sm:space-y-4">
      <header className="flex items-baseline justify-between gap-2 px-3 pt-1 sm:px-0">
        <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-[var(--mo-text)] sm:text-3xl">
          Мои лиды
        </h1>
        {!leadsQuery.isLoading ? (
          <p className="shrink-0 text-[11px] tabular-nums mo-muted sm:text-sm">
            {leads.length}
            {q.trim() ? ` / ${(leadsQuery.data ?? []).length}` : ""}
          </p>
        ) : null}
      </header>

      <label className="mt-2 block px-3 sm:mt-0 sm:px-0">
        <span className="sr-only">Поиск</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Имя, телефон…"
          className="mo-input box-border w-full min-w-0 rounded-xl px-3 py-2 text-sm"
          autoComplete="off"
          inputMode="search"
        />
      </label>

      {leadsQuery.isLoading && <p className="px-3 text-sm lux-caption sm:px-0">Загрузка…</p>}
      {leadsQuery.isError && (
        <p className="px-3 text-sm text-[var(--mo-danger)] sm:px-0">{(leadsQuery.error as Error).message}</p>
      )}

      {!leadsQuery.isLoading && leads.length === 0 ? (
        <p className="mx-3 mt-3 rounded-2xl border border-dashed border-[var(--mo-border)] px-4 py-8 text-center text-sm mo-muted sm:mx-0">
          {q.trim() ? "Никого не нашли" : "Пока нет лидов"}
        </p>
      ) : null}

      {/* Мобилка: на всю ширину экрана, имя слева целиком видно */}
      <section className="mt-2 w-full min-w-0 border-y border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] sm:hidden">
        <ul className="w-full min-w-0 divide-y divide-[var(--mo-border)]">
          {leads.map((lead) => {
            const stage = stageShort(lead.stage_name);
            return (
              <li key={lead.id} className="w-full min-w-0">
                <Link
                  to={`/leads/${lead.id}`}
                  className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2 transition active:bg-[var(--mo-accent-soft)]"
                >
                  <p className="min-w-0 truncate text-left text-[14px] font-semibold leading-tight text-[var(--mo-text)]">
                    {lead.name}
                  </p>
                  <time className="shrink-0 text-right text-[10px] font-medium tabular-nums leading-tight mo-muted">
                    {leadDateBadge(lead.created_at)}
                  </time>
                  <p className="min-w-0 truncate text-left text-[12px] font-medium tabular-nums tracking-wide text-[var(--mo-text-muted)]">
                    <PatientPhone value={lead} />
                  </p>
                  {stage ? (
                    <span className="max-w-[7.5rem] shrink-0 justify-self-end truncate rounded-md bg-[var(--mo-accent-soft)] px-1.5 py-0.5 text-right text-[10px] font-medium leading-tight text-[var(--mo-accent-hover)]">
                      {stage}
                    </span>
                  ) : (
                    <span />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Планшет/десктоп */}
      <div className="mt-3 hidden gap-2.5 sm:grid sm:grid-cols-2">
        {leads.map((lead) => {
          const stage = stageShort(lead.stage_name);
          return (
            <Link
              key={lead.id}
              to={`/leads/${lead.id}`}
              className="mo-section flex min-w-0 items-start gap-3 p-3.5 transition hover:border-[var(--mo-border-strong)] hover:bg-[var(--mo-accent-soft)]"
            >
              <span
                aria-hidden
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--mo-accent-soft)] text-xs font-semibold text-[var(--mo-accent-hover)]"
              >
                {leadInitial(lead.name)}
              </span>
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold leading-snug text-[var(--mo-text)]">
                    {lead.name}
                  </p>
                  <span className="shrink-0 text-[10px] font-medium tabular-nums mo-muted">
                    {leadDateBadge(lead.created_at)}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm font-medium tabular-nums tracking-wide text-[var(--mo-text-muted)]">
                  <PatientPhone value={lead} />
                </p>
                {stage ? (
                  <span className="mt-2 inline-block max-w-full truncate rounded-lg bg-[var(--mo-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--mo-accent-hover)]">
                    {stage}
                  </span>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
