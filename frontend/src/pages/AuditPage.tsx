import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/ui/PageHeader";
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
    <div className="mo-fill-page relative">
      <div className="mo-admin-page-head">
        <PageHeader
          className="mb-0"
          title="Системный аудит"
          description="Кто куда заходил и что нажал: клиенты, онлайн-запись, сотрудники, воронки."
        />
      </div>

      <div className="mo-fill-page-scroll space-y-4 pt-4">
        <section className="mo-section p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-[1fr_160px_auto]">
            <label className="block">
              <span className="mo-admin-toolbar-label">Раздел</span>
              <select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                className="mo-input w-full"
              >
                {AUDIT_SECTIONS.map((s) => (
                  <option key={s.value || "all"} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              {selectedSection.hint ? (
                <span className="mt-1 block text-[11px] lux-caption">{selectedSection.hint}</span>
              ) : null}
            </label>
            <label className="block">
              <span className="mo-admin-toolbar-label">№ записи</span>
              <input
                value={entityId}
                onChange={(e) => setEntityId(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="необязательно"
                className="mo-input w-full"
              />
            </label>
            <div className="flex items-end">
              <button type="button" onClick={() => void query.refetch()} className="btn-primary w-full md:w-auto">
                Обновить
              </button>
            </div>
          </div>
        </section>

        <section className="mo-section p-4 sm:p-5">
          <h2 className="lux-heading mb-3">События</h2>
          {query.isLoading && <p className="text-sm lux-caption">Загрузка аудита…</p>}
          {query.isError && (
            <p className="text-sm text-[var(--mo-danger)]">{(query.error as Error).message}</p>
          )}
          {!query.isLoading && (query.data ?? []).length === 0 && (
            <p className="text-sm mo-muted">Событий не найдено.</p>
          )}
          <ul className="space-y-2.5">
            {(query.data ?? []).map((e) => {
              const details = auditDetailsLabel(e.details);
              const actor = (e.user_name || "").trim() || (e.user_id != null ? `Пользователь №${e.user_id}` : "Система");
              return (
                <li key={`${e.source ?? "system"}-${e.id}`} className="audit-event-row">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="audit-entity-tag">{auditPlaceLabel(e.entity_type, e.entity_id)}</span>
                    <span className="audit-action-tag">{auditActionLabel(e.action)}</span>
                    <span className="audit-actor" title={e.user_email || actor}>
                      {actor}
                    </span>
                    <span className="lux-caption">{new Date(e.created_at).toLocaleString("ru-RU")}</span>
                  </div>
                  {details ? <p className="mt-1.5 text-sm text-[var(--mo-text)]">{details}</p> : null}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
