import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { SystemAuditEvent } from "@/lib/types";

export function AuditPage() {
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");

  const queryKey = useMemo(
    () => ["system-audit", entityType.trim(), entityId.trim()],
    [entityType, entityId],
  );

  const query = useQuery({
    queryKey,
    queryFn: () => {
      const qs = new URLSearchParams();
      if (entityType.trim()) qs.set("entity_type", entityType.trim());
      if (entityId.trim()) qs.set("entity_id", String(Number(entityId)));
      qs.set("limit", "300");
      return apiFetch<SystemAuditEvent[]>(`/api/audit?${qs.toString()}`);
    },
  });

  return (
    <div className="relative mx-auto max-w-[1400px] space-y-4 pb-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Системный аудит</h1>
        <p className="mt-1 text-sm text-slate-400">
          Кто открывал, редактировал, удалял и перемещал записи в MetodiOne.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4 backdrop-blur-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <input
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="Фильтр по entity_type (lead, booking_appointment, specialist...)"
            className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
          />
          <input
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="entity_id"
            className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
          />
          <button
            type="button"
            onClick={() => query.refetch()}
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Обновить
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4 backdrop-blur-sm">
        {query.isLoading && <p className="text-sm text-slate-400">Загрузка аудита...</p>}
        {query.isError && <p className="text-sm text-red-300">{(query.error as Error).message}</p>}
        {!query.isLoading && (query.data ?? []).length === 0 && (
          <p className="text-sm text-slate-500">Событий не найдено.</p>
        )}
        <ul className="space-y-2">
          {(query.data ?? []).map((e) => (
            <li key={e.id} className="rounded-xl border border-slate-700/60 bg-slate-900/35 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-purple-500/20 px-2 py-0.5 text-purple-200">
                  {e.entity_type}:{e.entity_id ?? "-"}
                </span>
                <span className="rounded bg-slate-700/60 px-2 py-0.5 text-slate-200">{e.action}</span>
                <span className="text-slate-300">{e.user_name ?? `user#${e.user_id ?? "-"}`}</span>
                <span className="text-slate-500">{new Date(e.created_at).toLocaleString("ru-RU")}</span>
              </div>
              {e.details && <p className="mt-1 text-sm text-slate-200">{e.details}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
