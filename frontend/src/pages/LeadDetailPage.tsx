import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import type { Lead } from "@/lib/types";

export function LeadDetailPage() {
  const { id } = useParams();
  const leadId = Number(id);

  const query = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => apiFetch<Lead>(`/api/leads/${leadId}`),
    enabled: Number.isFinite(leadId) && leadId > 0,
  });

  if (!Number.isFinite(leadId) || leadId <= 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-slate-400">
        Некорректный идентификатор лида.
        <Link to="/booking" className="mt-4 block text-purple-300 hover:underline">
          ← К онлайн-записи
        </Link>
      </div>
    );
  }

  return (
    <div className="relative mx-auto max-w-2xl space-y-8 pb-10">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Link
          to="/booking"
          className="font-medium text-purple-300 underline-offset-4 hover:text-purple-200 hover:underline"
        >
          ← Онлайн запись
        </Link>
        <Link to="/" className="text-slate-400 hover:text-slate-200">
          Канбан
        </Link>
      </div>

      {query.isLoading && <p className="text-slate-400">Загрузка карточки…</p>}
      {query.isError && (
        <p className="text-red-300">{(query.error as Error).message ?? "Ошибка загрузки"}</p>
      )}

      {query.data && (
        <article className="rounded-3xl border border-slate-700/40 bg-slate-800/40 p-8 shadow-2xl backdrop-blur-xl">
          <header className="mb-6 border-b border-slate-700/50 pb-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Клиент / лид</p>
            <h1 className="mt-1 text-3xl font-semibold text-white">{query.data.name}</h1>
            {query.data.stage_name && (
              <p className="mt-2 inline-flex rounded-full bg-purple-500/15 px-3 py-1 text-sm text-purple-200 ring-1 ring-purple-500/30">
                {query.data.stage_name}
              </p>
            )}
          </header>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Телефон</dt>
              <dd className="mt-1 text-lg text-slate-100">{query.data.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Email</dt>
              <dd className="mt-1 text-lg text-slate-100">{query.data.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Источник</dt>
              <dd className="mt-1 text-slate-200">{query.data.source ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Менеджер (id)</dt>
              <dd className="mt-1 text-slate-200">{query.data.manager_id ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">ID в CRM</dt>
              <dd className="mt-1 font-mono text-slate-300">#{query.data.id}</dd>
            </div>
          </dl>
        </article>
      )}
    </div>
  );
}
