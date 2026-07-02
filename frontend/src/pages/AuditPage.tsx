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
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--mo-text)]">Системный аудит</h1>
        <p className="mt-1 text-sm lux-caption">
          Кто открывал, редактировал, удалял и перемещал записи в MetodiOne.
        </p>
      </header>

      <section className="mo-section p-4 backdrop-blur-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <input
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="Фильтр по entity_type (lead, booking_appointment, specialist...)"
            className="mo-input"
          />
          <input
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="entity_id"
            className="mo-input"
          />
          <button
            type="button"
            onClick={() => query.refetch()}
            className="btn-primary"
          >
            Обновить
          </button>
        </div>
      </section>

      <section className="mo-section p-4 backdrop-blur-sm">
        {query.isLoading && <p className="text-sm lux-caption">Загрузка аудита...</p>}
        {query.isError && <p className="text-sm text-red-300">{(query.error as Error).message}</p>}
        {!query.isLoading && (query.data ?? []).length === 0 && (
          <p className="text-sm mo-muted">Событий не найдено.</p>
        )}
        <ul className="space-y-2">
          {(query.data ?? []).map((e) => (
            <li key={e.id} className="audit-event-row">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="audit-entity-tag">
                  {e.entity_type}:{e.entity_id ?? "-"}
                </span>
                <span className="audit-action-tag">{e.action}</span>
                <span className="mo-muted">{e.user_name ?? `user#${e.user_id ?? "-"}`}</span>
                <span className="mo-muted">{new Date(e.created_at).toLocaleString("ru-RU")}</span>
              </div>
              {e.details && <p className="mt-1 text-sm text-[var(--mo-text)]">{e.details}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
