import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import {
  AUDIT_SECTIONS,
  auditActionLabel,
  auditDetailsLabel,
  auditPlaceLabel,
} from "@/lib/auditLabels";
import type { SystemAuditEvent } from "@/lib/types";

export function AuditPage() {
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");

  const selectedSection = AUDIT_SECTIONS.find((s) => s.value === entityType) ?? AUDIT_SECTIONS[0];

  const queryKey = useMemo(
    () => ["system-audit", entityType.trim(), entityId.trim()],
    [entityType, entityId],
  );

  const query = useQuery({
    queryKey,
    queryFn: () => {
      const qs = new URLSearchParams();
      if (entityType.trim()) qs.set("entity_type", entityType.trim());
      if (entityId.trim()) {
        const n = Number(entityId);
        if (Number.isFinite(n) && n > 0) qs.set("entity_id", String(n));
      }
      qs.set("limit", "300");
      return apiFetch<SystemAuditEvent[]>(`/api/audit?${qs.toString()}`);
    },
  });

  return (
    <div className="relative mx-auto max-w-[1400px] space-y-4 pb-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--mo-text)]">Системный аудит</h1>
        <p className="mt-1 text-sm lux-caption">
          Кто куда заходил и что нажал: клиенты, онлайн-запись, сотрудники, воронки.
        </p>
      </header>

      <section className="mo-section p-4 backdrop-blur-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_160px_auto]">
          <label className="block text-xs mo-muted">
            Раздел
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="mo-input mt-1 w-full"
            >
              {AUDIT_SECTIONS.map((s) => (
                <option key={s.value || "all"} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {selectedSection.hint ? (
              <span className="mt-1 block text-[11px] mo-muted">{selectedSection.hint}</span>
            ) : null}
          </label>
          <label className="block text-xs mo-muted">
            № записи
            <input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="необязательно"
              className="mo-input mt-1 w-full"
            />
          </label>
          <div className="flex items-end">
            <button type="button" onClick={() => void query.refetch()} className="btn-primary w-full md:w-auto">
              Обновить
            </button>
          </div>
        </div>
      </section>

      <section className="mo-section p-4 backdrop-blur-sm">
        {query.isLoading && <p className="text-sm lux-caption">Загрузка аудита…</p>}
        {query.isError && <p className="text-sm text-red-300">{(query.error as Error).message}</p>}
        {!query.isLoading && (query.data ?? []).length === 0 && (
          <p className="text-sm mo-muted">Событий не найдено.</p>
        )}
        <ul className="space-y-2">
          {(query.data ?? []).map((e) => {
            const details = auditDetailsLabel(e.details);
            return (
              <li key={e.id} className="audit-event-row">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="audit-entity-tag">{auditPlaceLabel(e.entity_type, e.entity_id)}</span>
                  <span className="audit-action-tag">{auditActionLabel(e.action)}</span>
                  <span className="mo-muted">{e.user_name ?? `пользователь №${e.user_id ?? "—"}`}</span>
                  <span className="mo-muted">{new Date(e.created_at).toLocaleString("ru-RU")}</span>
                </div>
                {details ? <p className="mt-1 text-sm text-[var(--mo-text)]">{details}</p> : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
