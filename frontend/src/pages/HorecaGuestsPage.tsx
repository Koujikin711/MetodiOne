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
        <h1 className="text-3xl font-semibold text-white">База гостей</h1>
        <p className="text-sm text-slate-400">История визитов, повторные заказы и сервис по предпочтениям гостей.</p>
      </header>

      <section className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
        <label className="text-xs text-slate-400">
          Имя или телефон
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Например: Анна или +992..."
            className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/70 px-3 py-2 text-sm text-white"
          />
        </label>
      </section>

      {!canSearch ? <p className="text-sm text-slate-500">Введите минимум 2 символа для поиска.</p> : null}
      {guestsQuery.isLoading ? <p className="text-sm text-slate-400">Загрузка гостей…</p> : null}
      {guestsQuery.isError ? <p className="text-sm text-rose-300">{(guestsQuery.error as Error).message}</p> : null}

      {(guestsQuery.data ?? []).map((g) => (
        <section key={`${g.patient_name}-${g.patient_phone}`} className="rounded-2xl border border-slate-700/50 bg-slate-900/45 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">{g.patient_name}</h2>
            <span className="rounded-full border border-slate-600 px-2 py-0.5 text-xs text-slate-300">{g.total_visits} визитов</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {g.patient_phone} · Первый визит: {fmtDate(g.first_visit_at)} · Последний визит: {fmtDate(g.last_visit_at)}
          </p>
          <div className="mt-3 space-y-2">
            {g.visits.slice(0, 5).map((v) => (
              <div key={v.appointment_id} className="rounded-xl border border-slate-700/40 bg-slate-950/40 p-2 text-sm text-slate-300">
                {fmtDate(v.start_at)} · {v.service_title || "Без позиции"} · оплачено {v.paid_amount}
              </div>
            ))}
          </div>
        </section>
      ))}

      {(guestsQuery.data ?? []).length === 0 && canSearch && !guestsQuery.isLoading ? (
        <p className="text-sm text-slate-500">Совпадений не найдено.</p>
      ) : null}
      <Link to="/horeca" className="inline-block text-xs text-teal-200 underline hover:text-white">
        Назад в центр HoReCa
      </Link>
    </div>
  );
}
