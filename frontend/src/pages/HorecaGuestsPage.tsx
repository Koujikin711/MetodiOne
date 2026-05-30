import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import type { BookingPatientHistoryItem } from "@/lib/types";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export function HorecaGuestsPage() {
  const [query, setQuery] = useState("");
  const search = query.trim();
  const canSearch = search.length >= 2;
  const queryKey = useMemo(() => ["horeca-guests", search], [search]);

  const guestsQuery = useQuery({
    queryKey,
    queryFn: () =>
      apiFetch<BookingPatientHistoryItem[]>(`/api/booking/patient-history?q=${encodeURIComponent(search)}&limit=30`),
    enabled: canSearch,
  });

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / База гостей</p>
        <h1 className="lux-heading-page">База гостей</h1>
        <p className="text-sm lux-caption">История визитов, повторные заказы и сервис по предпочтениям гостей.</p>
      </header>

      <section className="rounded-2xl mo-section p-4">
        <label className="text-xs lux-caption">
          Имя или телефон
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Например: Анна или +992..."
            className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white px-3 py-2 text-sm text-white"
          />
        </label>
      </section>

      {!canSearch ? <p className="text-sm mo-muted">Введите минимум 2 символа для поиска.</p> : null}
      {guestsQuery.isLoading ? <p className="text-sm lux-caption">Загрузка гостей…</p> : null}
      {guestsQuery.isError ? <p className="text-sm text-[#6b1d2f]">{(guestsQuery.error as Error).message}</p> : null}

      {(guestsQuery.data ?? []).map((g) => (
        <section key={`${g.patient_name}-${g.patient_phone}`} className="rounded-2xl border border-[var(--mo-border)] bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="lux-subheading">{g.patient_name}</h2>
            <span className="rounded-full border border-[var(--mo-border-strong)] px-2 py-0.5 text-xs mo-muted">{g.total_visits} визитов</span>
          </div>
          <p className="mt-1 text-xs lux-caption">
            {g.patient_phone} · Первый визит: {fmtDate(g.first_visit_at)} · Последний визит: {fmtDate(g.last_visit_at)}
          </p>
          <div className="mt-3 space-y-2">
            {g.visits.slice(0, 5).map((v) => (
              <div key={v.appointment_id} className="rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-2 text-sm mo-muted">
                {fmtDate(v.start_at)} · {v.service_title || "Без позиции"} · оплачено {v.paid_amount}
              </div>
            ))}
          </div>
        </section>
      ))}

      {(guestsQuery.data ?? []).length === 0 && canSearch && !guestsQuery.isLoading ? (
        <p className="text-sm mo-muted">Совпадений не найдено.</p>
      ) : null}
      <Link to="/horeca" className="inline-block text-xs text-teal-200 underline hover:text-white">
        Назад в центр HoReCa
      </Link>
    </div>
  );
}
