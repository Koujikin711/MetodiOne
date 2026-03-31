import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type {
  Integration,
  Lead,
  LeadSource,
  LeadStatusPatchResponse,
  Pipeline,
  PipelineStage,
  Task,
  UserRole,
} from "@/lib/types";

function stageDroppableId(stageId: number) {
  return `stage-${stageId}`;
}

function leadDraggableId(leadId: number) {
  return `lead-${leadId}`;
}

/** Стабильная короткая «дата» для бейджа без поля created_at в API */
function leadDateBadge(leadId: number): string {
  const d = new Date(Date.UTC(2025, (leadId % 12) + 0, (leadId % 28) + 1));
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function resolveTargetStageId(
  overId: string | number,
  leads: Lead[],
): number | null {
  const s = String(overId);
  if (s.startsWith("stage-")) return Number(s.slice(6));
  if (s.startsWith("lead-")) {
    const lid = Number(s.slice(5));
    return leads.find((l) => l.id === lid)?.status_id ?? null;
  }
  return null;
}

function LeadCardBody({ lead }: { lead: Lead }) {
  const paidNum =
    lead.paid_extras_amount == null ? 0 : typeof lead.paid_extras_amount === "number" ? lead.paid_extras_amount : Number(lead.paid_extras_amount);

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-snug text-white">{lead.name}</p>
        <span className="shrink-0 rounded-full bg-slate-700/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          {leadDateBadge(lead.id)}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-400">{lead.phone ?? "—"}</p>
      <div className="mt-2 flex items-center gap-2">
        {lead.protocol_file_attached && <span title="Протокол прикреплён">📄</span>}
        {paidNum > 0 && <span title="Есть оплата по доп. услугам">💰</span>}
        {lead.refusal_reason && <span title="Есть отказ">❌</span>}
      </div>
    </>
  );
}

function LeadCard({
  lead,
  currentRole,
  onRefresh,
}: {
  lead: Lead;
  currentRole: UserRole | null;
  onRefresh: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: leadDraggableId(lead.id),
    data: { lead },
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  const stage = lead.stage_name;

  const [managerExtraType, setManagerExtraType] = useState<"Протокол" | "Прочее">("Протокол");
  const [managerAmount, setManagerAmount] = useState<number>(0);
  const [managerPaidAmount, setManagerPaidAmount] = useState<number>(0);

  const [protocolUploading, setProtocolUploading] = useState(false);
  const [protocolFile, setProtocolFile] = useState<File | null>(null);

  useEffect(() => {
    setProtocolFile(null);
    setProtocolUploading(false);
  }, [lead.id, lead.protocol_requested, lead.protocol_confirmed, lead.protocol_deal_id]);

  async function refreshAfterMutation() {
    onRefresh();
  }

  async function handleArrival() {
    try {
      await apiFetch(`/api/leads/${lead.id}/arrival`, { method: "POST" });
      await refreshAfterMutation();
      toast.success("Явка оформлена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось оформить явку");
    }
  }

  async function handleNoShow() {
    try {
      const mode = window.prompt(
        "Введите: 'перенести' для переноса или 'отказать' для отказа",
        "перенести",
      );
      if (mode == null) return;
      const action = mode.trim().toLowerCase().includes("отказ") ? "refuse" : "reschedule";
      if (action === "reschedule") {
        await apiFetch(`/api/leads/${lead.id}/no-show`, {
          method: "POST",
          body: JSON.stringify({ action }),
        });
        await refreshAfterMutation();
        toast.success("Запись перенесена (квалифицирован)");
        return;
      }
      const reason = window.prompt("Причина отказа (обязательно)");
      if (!reason || !reason.trim()) {
        toast.error("Причина обязательна");
        return;
      }
      await apiFetch(`/api/leads/${lead.id}/no-show`, {
        method: "POST",
        body: JSON.stringify({ action, reason: reason.trim() }),
      });
      await refreshAfterMutation();
      toast.success("Отказ оформлен");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось оформить неявку");
    }
  }

  async function handleServiceDone() {
    try {
      await apiFetch(`/api/leads/${lead.id}/service-done`, { method: "POST" });
      await refreshAfterMutation();
      toast.success("Услуга оказана");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось подтвердить услугу");
    }
  }

  async function handleServiceReject() {
    try {
      const reason = window.prompt("Причина отказа (обязательно)");
      if (!reason || !reason.trim()) {
        toast.error("Причина обязательна");
        return;
      }
      await apiFetch(`/api/leads/${lead.id}/service-reject`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await refreshAfterMutation();
      toast.success("Отказ оформлен");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось оформить отказ");
    }
  }

  async function handleAddExtraService() {
    try {
      if (managerAmount < 0 || managerPaidAmount < 0) return;
      await apiFetch(`/api/leads/${lead.id}/cart/extra-services/add`, {
        method: "POST",
        body: JSON.stringify({
          type: managerExtraType,
          amount: managerAmount,
          paid_amount: managerPaidAmount,
        }),
      });
      await refreshAfterMutation();
      toast.success("Доп. услуга добавлена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось добавить доп. услугу");
    }
  }

  const showProtocolQuestion =
    currentRole === "expert" &&
    stage === "Доп. услуги" &&
    lead.protocol_requested &&
    !lead.protocol_confirmed &&
    lead.protocol_deal_id != null;

  const showProtocolUpload =
    currentRole === "expert" &&
    stage === "Доп. услуги" &&
    lead.protocol_requested &&
    lead.protocol_confirmed &&
    lead.protocol_deal_id != null;

  async function handleProtocolConfirm(confirmed: boolean) {
    try {
      if (lead.protocol_deal_id == null) return;
      await apiFetch(`/api/deals/${lead.protocol_deal_id}/protocol/confirm`, {
        method: "POST",
        body: JSON.stringify({ confirmed }),
      });
      await refreshAfterMutation();
      toast.success(confirmed ? "Протокол подтверждён" : "Протокол отклонён");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось обновить протокол");
    }
  }

  async function handleProtocolFinish() {
    if (lead.protocol_deal_id == null || !protocolFile) return;
    setProtocolUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", protocolFile);
      await apiFetch(`/api/deals/${lead.protocol_deal_id}/protocol/upload`, {
        method: "POST",
        body: fd,
      });
      await apiFetch(`/api/leads/${lead.id}/protocol/finish`, { method: "POST" });
      await refreshAfterMutation();
      toast.success("Протокол завершён");
      setProtocolFile(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось завершить протокол");
    } finally {
      setProtocolUploading(false);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={[
        "cursor-grab touch-none rounded-xl border border-slate-600/50 bg-slate-800/70 p-4 shadow-lg backdrop-blur-sm transition-shadow duration-200 active:cursor-grabbing",
        isDragging ? "opacity-50" : "hover:border-slate-500/60 hover:shadow-xl",
      ].join(" ")}
    >
      <LeadCardBody lead={lead} />

      {currentRole === "admin" && stage === "Запись" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleArrival()}
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95"
          >
            Явка
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleNoShow()}
            className="rounded-xl border border-slate-700 bg-slate-900/30 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-900/50"
          >
            Неявка
          </button>
        </div>
      )}

      {currentRole === "expert" &&
        (stage === "У эксперта" || stage === "Оказание услуги") && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void handleServiceDone()}
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95"
            >
              Услуга оказана
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void handleServiceReject()}
              className="rounded-xl border border-red-500/40 bg-red-500/10 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/15"
            >
              Нет
            </button>
          </div>
        )}

      {currentRole === "manager" && stage === "Доп. услуги" && (
        <div className="mt-3 rounded-xl border border-slate-700/50 bg-slate-900/20 p-3 shadow-inner backdrop-blur-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Продуктовая корзина
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[11px] text-slate-400">
              Тип
              <select
                value={managerExtraType}
                onChange={(e) => setManagerExtraType(e.target.value as "Протокол" | "Прочее")}
                className="mt-1 w-full rounded-lg border border-slate-600/50 bg-slate-900/50 px-2 py-1.5 text-sm text-white"
              >
                <option value="Протокол">Протокол</option>
                <option value="Прочее">Прочее</option>
              </select>
            </label>
            <label className="text-[11px] text-slate-400">
              Оплачено (₽)
              <input
                type="number"
                value={managerPaidAmount}
                min={0}
                onChange={(e) => setManagerPaidAmount(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-600/50 bg-slate-900/50 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <label className="col-span-2 text-[11px] text-slate-400">
              Сумма (₽)
              <input
                type="number"
                value={managerAmount}
                min={0}
                onChange={(e) => setManagerAmount(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-600/50 bg-slate-900/50 px-2 py-1.5 text-sm text-white"
              />
            </label>
          </div>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleAddExtraService()}
            className="mt-3 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95"
          >
            + Доп. услуга
          </button>
        </div>
      )}

      {showProtocolQuestion && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleProtocolConfirm(true)}
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95"
          >
            Да
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleProtocolConfirm(false)}
            className="rounded-xl border border-red-500/40 bg-red-500/10 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/15"
          >
            Нет
          </button>
        </div>
      )}

      {showProtocolUpload && (
        <div className="mt-3 rounded-xl border border-slate-700/50 bg-slate-900/20 p-3 shadow-inner backdrop-blur-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Загрузите протокол
          </div>
          <input
            type="file"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setProtocolFile(f);
            }}
            className="mt-2 w-full text-sm text-slate-300"
          />
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!protocolFile || protocolUploading}
            onClick={() => void handleProtocolFinish()}
            className={[
              "mt-3 w-full rounded-xl py-2 text-sm font-semibold transition",
              protocolUploading || !protocolFile
                ? "cursor-not-allowed bg-slate-700/40 text-slate-400"
                : "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-purple-500/20 hover:opacity-95",
            ].join(" ")}
          >
            Завершить
          </button>
        </div>
      )}
    </div>
  );
}

function LeadCardDragOverlay({ lead }: { lead: Lead }) {
  return (
    <div className="rotate-2 scale-[1.02] cursor-grabbing rounded-xl border border-purple-500/40 bg-slate-800/95 p-4 shadow-2xl shadow-purple-500/25 ring-2 ring-purple-500/30 backdrop-blur-md">
      <LeadCardBody lead={lead} />
    </div>
  );
}

function KanbanColumn({
  stage,
  leads,
  currentRole,
  onRefresh,
}: {
  stage: PipelineStage;
  leads: Lead[];
  currentRole: UserRole | null;
  onRefresh: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stageDroppableId(stage.id),
    data: { stageId: stage.id },
  });

  return (
    <div
      ref={setNodeRef}
      className={[
        "flex min-h-[min(70vh,520px)] w-[min(100%,280px)] shrink-0 flex-col rounded-2xl border border-slate-700/40 bg-slate-800/30 p-3 shadow-inner backdrop-blur-sm transition-colors duration-300",
        isOver ? "border-purple-500/40 bg-slate-800/45 ring-1 ring-purple-500/20" : "",
      ].join(" ")}
    >
      <div className="mb-3 flex items-center gap-2 px-1">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{
            backgroundColor: stage.color,
            boxShadow: `0 0 12px ${stage.color}`,
          }}
        />
        <h3 className="text-sm font-semibold text-slate-200">{stage.name}</h3>
        <span className="ml-auto text-xs text-slate-500">{leads.length}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
        {leads.length === 0 ? (
          <p className="flex flex-1 items-center justify-center px-2 py-8 text-center text-sm text-slate-500">
            Нет лидов
          </p>
        ) : (
          leads.map((lead) => <LeadCard key={lead.id} lead={lead} currentRole={currentRole} onRefresh={onRefresh} />)
        )}
      </div>
    </div>
  );
}

export function CrmPage() {
  const queryClient = useQueryClient();

  const currentRole = useMemo(() => decodeRoleFromToken(getStoredToken()), []);

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["leads"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["analytics"] });
  }, [queryClient]);

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiFetch<Task[]>("/api/tasks"),
    refetchInterval: 4000,
  });
  const [seenTaskIds, setSeenTaskIds] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    const tasks = tasksQuery.data;
    if (!tasks || tasks.length === 0) return;
    const pendingNew = tasks.filter((t) => t.status === "pending" && !seenTaskIds.has(t.id));
    if (pendingNew.length === 0) return;
    pendingNew.forEach((t) => toast.success(t.title));
    setSeenTaskIds((prev) => {
      const next = new Set(prev);
      pendingNew.forEach((t) => next.add(t.id));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksQuery.data]);

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<Pipeline[]>("/api/pipelines"),
  });

  const sourcesQuery = useQuery({
    queryKey: ["lead-sources"],
    queryFn: () => apiFetch<LeadSource[]>("/api/sources"),
  });

  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: () => apiFetch<Integration[]>("/api/integrations"),
    enabled: currentRole === "admin",
  });

  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [editingIntegrationId, setEditingIntegrationId] = useState<number | null>(null);
  const [integrationName, setIntegrationName] = useState("");
  const [integrationProvider, setIntegrationProvider] = useState<"green_api" | "telegram">("green_api");
  const [integrationSecret, setIntegrationSecret] = useState("");
  const [integrationConfigText, setIntegrationConfigText] = useState("{}");
  const [greenInstanceId, setGreenInstanceId] = useState("");
  const [greenApiToken, setGreenApiToken] = useState("");
  /** Как в кабинете Green API, напр. https://7103.api.greenapi.com — если пусто, сервер попробует api.green-api.com */
  const [greenApiBaseUrl, setGreenApiBaseUrl] = useState("");
  const [integrationPipelineId, setIntegrationPipelineId] = useState<number | null>(null);
  const [integrationStageId, setIntegrationStageId] = useState<number | null>(null);

  function resetIntegrationForm() {
    setEditingIntegrationId(null);
    setIntegrationName("");
    setIntegrationProvider("green_api");
    setIntegrationSecret("");
    setIntegrationConfigText("{}");
    setGreenInstanceId("");
    setGreenApiToken("");
    setGreenApiBaseUrl("");
    setIntegrationPipelineId(null);
    setIntegrationStageId(null);
  }

  function beginEditIntegration(it: Integration) {
    setIntegrationsOpen(true);
    setEditingIntegrationId(it.id);
    setIntegrationName(it.name);
    setIntegrationProvider(it.provider === "telegram" ? "telegram" : "green_api");
    setIntegrationPipelineId(it.pipeline_id);
    setIntegrationStageId(it.stage_id);
    setIntegrationSecret("");
    if (it.provider === "telegram") {
      setIntegrationConfigText(JSON.stringify(it.config ?? {}, null, 2));
      setGreenInstanceId("");
      setGreenApiToken("");
      setGreenApiBaseUrl("");
    } else {
      const c = it.config as Record<string, unknown> | null;
      const rawId = c?.instance_id ?? c?.instanceId;
      const iid = rawId != null && rawId !== "" ? String(rawId) : "";
      setGreenInstanceId(iid);
      setGreenApiToken("");
      const ab =
        typeof c?.api_base_url === "string"
          ? c.api_base_url
          : typeof c?.apiUrl === "string"
            ? c.apiUrl
            : "";
      setGreenApiBaseUrl(ab);
    }
  }

  const integrationStagesQuery = useQuery({
    queryKey: ["stages", "integrations", integrationPipelineId],
    queryFn: () =>
      integrationPipelineId
        ? apiFetch<PipelineStage[]>(`/api/stages?pipeline_id=${integrationPipelineId}`)
        : apiFetch<PipelineStage[]>("/api/stages"),
    enabled: integrationsOpen,
  });

  useEffect(() => {
    if (!integrationsOpen) return;
    if (integrationPipelineId != null) return;
    const first = pipelinesQuery.data?.[0];
    if (first) setIntegrationPipelineId(first.id);
  }, [integrationsOpen, integrationPipelineId, pipelinesQuery.data]);

  useEffect(() => {
    if (!integrationsOpen) return;
    const st = integrationStagesQuery.data;
    if (!st || st.length === 0) return;
    if (integrationStageId != null && st.some((x) => x.id === integrationStageId)) return;
    setIntegrationStageId(st[0].id);
  }, [integrationsOpen, integrationStagesQuery.data, integrationStageId]);

  async function generateIntegrationSecret() {
    try {
      const r = await apiFetch<{ secret: string }>("/api/integrations/generate-secret", { method: "POST" });
      setIntegrationSecret(r.secret);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сгенерировать секрет");
    }
  }

  async function submitCreateIntegration() {
    if (!integrationName.trim()) return toast.error("Название обязательно");
    if (!integrationPipelineId || !integrationStageId) return toast.error("Выберите воронку и стадию");

    if (editingIntegrationId != null) {
      const body: Record<string, unknown> = {
        name: integrationName.trim(),
        pipeline_id: integrationPipelineId,
        stage_id: integrationStageId,
      };
      if (integrationProvider !== "green_api" && integrationSecret.trim()) {
        body.secret = integrationSecret.trim();
      }
      if (integrationProvider === "green_api") {
        if (!greenInstanceId.trim()) {
          toast.error("Укажите idInstance из кабинета Green API");
          return;
        }
        body.config = {
          instance_id: greenInstanceId.trim(),
          ...(greenApiToken.trim() ? { api_token: greenApiToken.trim() } : {}),
          ...(greenApiBaseUrl.trim() ? { api_base_url: greenApiBaseUrl.trim() } : {}),
        };
      } else {
        try {
          if (integrationConfigText.trim()) {
            body.config = JSON.parse(integrationConfigText) as Record<string, unknown>;
          }
        } catch {
          toast.error("Config должен быть валидным JSON");
          return;
        }
      }
      try {
        const saved = await apiFetch<Integration>(`/api/integrations/${editingIntegrationId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast.success(saved.setup_note ?? "Интеграция обновлена");
        resetIntegrationForm();
        void queryClient.invalidateQueries({ queryKey: ["integrations"] });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
      }
      return;
    }

    let cfg: Record<string, unknown> | null = null;
    if (integrationProvider === "green_api") {
      if (!greenInstanceId.trim() || !greenApiToken.trim()) {
        toast.error("Скопируйте из кабинета Green API: idInstance и apiTokenInstance");
        return;
      }
      cfg = {
        instance_id: greenInstanceId.trim(),
        api_token: greenApiToken.trim(),
        ...(greenApiBaseUrl.trim() ? { api_base_url: greenApiBaseUrl.trim() } : {}),
      };
    } else {
      if (!integrationSecret.trim()) return toast.error("Для Telegram укажите webhook-секрет (или нажмите «Сгенерировать»)");
      try {
        cfg = integrationConfigText.trim() ? (JSON.parse(integrationConfigText) as Record<string, unknown>) : null;
      } catch {
        toast.error("Config должен быть валидным JSON");
        return;
      }
    }

    const createPayload: Record<string, unknown> = {
      name: integrationName.trim(),
      provider: integrationProvider,
      pipeline_id: integrationPipelineId,
      stage_id: integrationStageId,
      config: cfg,
    };
    if (integrationProvider !== "green_api") {
      createPayload.secret = integrationSecret.trim();
    }

    try {
      const created = await apiFetch<Integration>("/api/integrations", {
        method: "POST",
        body: JSON.stringify(createPayload),
      });
      toast.success(created.setup_note ?? "Интеграция создана");
      resetIntegrationForm();
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать интеграцию");
    }
  }

  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [leadPipelineId, setLeadPipelineId] = useState<number | null>(null);
  const [leadStageId, setLeadStageId] = useState<number | null>(null);

  useEffect(() => {
    if (leadPipelineId != null) return;
    const first = pipelinesQuery.data?.[0];
    if (first) setLeadPipelineId(first.id);
  }, [leadPipelineId, pipelinesQuery.data]);

  const createLeadStagesQuery = useQuery({
    queryKey: ["stages", "create-lead", leadPipelineId],
    queryFn: () =>
      leadPipelineId
        ? apiFetch<PipelineStage[]>(`/api/stages?pipeline_id=${leadPipelineId}`)
        : apiFetch<PipelineStage[]>("/api/stages"),
    enabled: createLeadOpen,
  });

  useEffect(() => {
    if (!createLeadOpen) return;
    const st = createLeadStagesQuery.data;
    if (!st || st.length === 0) return;
    if (leadStageId != null && st.some((x) => x.id === leadStageId)) return;
    setLeadStageId(st[0].id);
  }, [createLeadOpen, createLeadStagesQuery.data, leadStageId]);

  async function submitCreateLead() {
    if (!leadName.trim() || !leadPhone.trim()) {
      toast.error("Введите имя и телефон");
      return;
    }
    if (!leadStageId) {
      toast.error("Выберите стадию");
      return;
    }
    try {
      await apiFetch<Lead>("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          name: leadName.trim(),
          phone: leadPhone.trim(),
          email: leadEmail.trim() || null,
          source: leadSource.trim() || null,
          status_id: leadStageId,
        }),
      });
      toast.success("Лид создан");
      setCreateLeadOpen(false);
      setLeadName("");
      setLeadPhone("");
      setLeadEmail("");
      setLeadSource("");
      setLeadStageId(null);
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать лида");
    }
  }

  const [createPipelineOpen, setCreatePipelineOpen] = useState(false);
  const [createStageOpen, setCreateStageOpen] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("#6366f1");
  const [pipeName, setPipeName] = useState("");
  const [pipeType, setPipeType] = useState("sales");
  const [pipeStages, setPipeStages] = useState<Array<{ name: string; color: string }>>([
    { name: "Новый", color: "#64748b" },
  ]);

  async function submitCreatePipeline() {
    if (!pipeName.trim()) {
      toast.error("Название воронки обязательно");
      return;
    }
    if (pipeStages.length === 0 || pipeStages.some((s) => !s.name.trim())) {
      toast.error("Добавьте хотя бы одну стадию и заполните названия");
      return;
    }
    try {
      await apiFetch<Pipeline>("/api/pipelines", {
        method: "POST",
        body: JSON.stringify({
          name: pipeName.trim(),
          type: pipeType.trim(),
          stages: pipeStages.map((s, idx) => ({
            name: s.name.trim(),
            order: idx,
            color: s.color || "#6366f1",
          })),
        }),
      });
      toast.success("Воронка создана");
      setCreatePipelineOpen(false);
      setPipeName("");
      setPipeType("sales");
      setPipeStages([{ name: "Новый", color: "#64748b" }]);
      void queryClient.invalidateQueries({ queryKey: ["pipelines"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать воронку");
    }
  }

  async function submitCreateStage() {
    if (!pipelineId) {
      toast.error("Сначала выберите воронку");
      return;
    }
    if (!newStageName.trim()) {
      toast.error("Название стадии обязательно");
      return;
    }
    try {
      await apiFetch<PipelineStage>("/api/stages", {
        method: "POST",
        body: JSON.stringify({
          name: newStageName.trim(),
          color: newStageColor,
          pipeline_id: pipelineId,
        }),
      });
      toast.success("Стадия создана");
      setCreateStageOpen(false);
      setNewStageName("");
      setNewStageColor("#6366f1");
      void queryClient.invalidateQueries({ queryKey: ["stages", pipelineId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать стадию");
    }
  }

  const [pipelineId, setPipelineId] = useState<number | null>(null);
  useEffect(() => {
    if (pipelineId != null) return;
    const first = pipelinesQuery.data?.[0];
    if (first) setPipelineId(first.id);
  }, [pipelinesQuery.data, pipelineId]);

  const stagesQuery = useQuery({
    queryKey: ["stages", pipelineId],
    queryFn: () =>
      pipelineId ? apiFetch<PipelineStage[]>(`/api/stages?pipeline_id=${pipelineId}`) : apiFetch("/api/stages"),
  });

  const patchPipelineMutation = useMutation({
    mutationFn: async ({ id, mode }: { id: number; mode: string }) =>
      apiFetch<Pipeline>(`/api/pipelines/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ lead_assignment_mode: mode }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pipelines"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedPipelineForSettings = useMemo(
    () => (pipelineId != null ? pipelinesQuery.data?.find((p) => p.id === pipelineId) : undefined),
    [pipelinesQuery.data, pipelineId],
  );

  const leadsQuery = useQuery({
    queryKey: ["leads"],
    queryFn: () => apiFetch<Lead[]>("/api/leads"),
  });

  const [leads, setLeads] = useState<Lead[]>([]);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [kanbanError, setKanbanError] = useState<string | null>(null);

  useEffect(() => {
    if (leadsQuery.data) setLeads(leadsQuery.data);
  }, [leadsQuery.data]);

  const sortedStages = useMemo(() => {
    if (!stagesQuery.data) return [];
    return [...stagesQuery.data].sort((a, b) => a.order - b.order || a.id - b.id);
  }, [stagesQuery.data]);

  const leadsByStage = useMemo(() => {
    const map = new Map<number, Lead[]>();
    for (const s of sortedStages) map.set(s.id, []);
    for (const lead of leads) {
      const bucket = map.get(lead.status_id);
      if (bucket) bucket.push(lead);
    }
    return map;
  }, [leads, sortedStages]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const onDragStart = useCallback((event: DragStartEvent) => {
    setKanbanError(null);
    const lid = event.active.id;
    const s = String(lid);
    if (!s.startsWith("lead-")) return;
    const id = Number(s.slice(5));
    const lead = leads.find((l) => l.id === id);
    setActiveLead(lead ?? null);
  }, [leads]);

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveLead(null);
      if (!over) return;

      const activeStr = String(active.id);
      if (!activeStr.startsWith("lead-")) return;
      const leadId = Number(activeStr.slice(5));

      const newStageId = resolveTargetStageId(over.id, leads);
      if (newStageId == null || Number.isNaN(newStageId)) return;

      const lead = leads.find((l) => l.id === leadId);
      if (!lead || lead.status_id === newStageId) return;

      const stageName =
        sortedStages.find((s) => s.id === newStageId)?.name ?? lead.stage_name;
      const previous = leads;
      const optimistic = leads.map((l) =>
        l.id === leadId ? { ...l, status_id: newStageId, stage_name: stageName } : l,
      );
      setLeads(optimistic);

      try {
        const data = await apiFetch<LeadStatusPatchResponse>(`/api/leads/${leadId}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status_id: newStageId }),
        });
        queryClient.setQueryData<Lead[]>(["leads"], (old) => {
          if (!old) return optimistic;
          return old.map((l) =>
            l.id === leadId ? { ...l, status_id: newStageId, stage_name: stageName } : l,
          );
        });
        toast.success("Статус обновлен!");
        if (data.automation_task_created) {
          toast.success("🤖 Робот: Создана новая задача для менеджера", {
            duration: 5000,
            style: {
              background: "linear-gradient(135deg, #0f172a 0%, #312e81 45%, #5b21b6 100%)",
              color: "#e2e8f0",
              padding: "14px 18px",
              borderRadius: "14px",
              boxShadow: "0 18px 40px -12px rgba(91, 33, 182, 0.5)",
              border: "1px solid rgba(167, 139, 250, 0.25)",
            },
          });
        }
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        void queryClient.invalidateQueries({ queryKey: ["analytics"] });
      } catch (e) {
        setLeads(previous);
        setKanbanError(e instanceof Error ? e.message : "Не удалось обновить этап");
      }
    },
    [leads, queryClient, sortedStages],
  );

  const onDragCancel = useCallback(() => {
    setActiveLead(null);
  }, []);

  return (
    <div className="relative mx-auto max-w-[1600px] space-y-8 pb-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white">CRM</h1>
        <p className="text-base text-slate-400">
          Канбан воронки — перетаскивайте лиды между этапами
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCreatePipelineOpen(true)}
            className="rounded-full border border-slate-700/50 bg-slate-800/30 px-3 py-1 text-sm text-slate-200 transition hover:bg-slate-800/50"
          >
            + Создать воронку
          </button>
          {currentRole === "admin" && (
            <button
              type="button"
              onClick={() => setCreateStageOpen(true)}
              className="rounded-full border border-slate-700/50 bg-slate-800/30 px-3 py-1 text-sm text-slate-200 transition hover:bg-slate-800/50"
            >
              + Стадия в воронку
            </button>
          )}
          <button
            type="button"
            onClick={() => setCreateLeadOpen(true)}
            className="rounded-full border border-slate-700/50 bg-white/10 px-3 py-1 text-sm text-white transition hover:bg-white/15"
          >
            + Лид
          </button>
          {currentRole === "admin" && (
            <button
              type="button"
              onClick={() => {
              resetIntegrationForm();
              setIntegrationsOpen(true);
            }}
              className="rounded-full border border-slate-700/50 bg-slate-800/30 px-3 py-1 text-sm text-slate-200 transition hover:bg-slate-800/50"
            >
              Интеграции
            </button>
          )}
        </div>
        {pipelinesQuery.data && pipelinesQuery.data.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-400">Воронка:</span>
            {pipelinesQuery.data.map((p) => {
              const active = pipelineId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPipelineId(p.id)}
                  className={[
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    active
                      ? "border-purple-500/40 bg-white/10 text-white"
                      : "border-slate-700/50 bg-slate-800/30 text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
                  ].join(" ")}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
        {currentRole === "admin" && pipelineId != null && selectedPipelineForSettings && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-400">Распределение новых лидов (интеграции, очередь записи):</span>
            <select
              value={selectedPipelineForSettings.lead_assignment_mode ?? "none"}
              onChange={(e) => {
                patchPipelineMutation.mutate({ id: pipelineId, mode: e.target.value });
              }}
              disabled={patchPipelineMutation.isPending}
              className="rounded-full border border-slate-700 bg-slate-950/40 px-3 py-1 text-sm text-white"
            >
              <option value="none">Без автораспределения</option>
              <option value="round_robin">По очереди (равномерно)</option>
              <option value="least_loaded">По минимальной загрузке</option>
            </select>
          </div>
        )}
      </header>

      {createPipelineOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Создать воронку</h2>
              <button
                type="button"
                onClick={() => setCreatePipelineOpen(false)}
                className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800/40"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-sm text-slate-300">
                Название
                <input
                  value={pipeName}
                  onChange={(e) => setPipeName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-slate-300">
                Тип (необязательно)
                <input
                  value={pipeType}
                  onChange={(e) => setPipeType(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>

              <div className="mt-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-200">Стадии</div>
                  <button
                    type="button"
                    onClick={() =>
                      setPipeStages((prev) => [...prev, { name: "", color: "#6366f1" }])
                    }
                    className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800/40"
                  >
                    + Стадия
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {pipeStages.map((st, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        value={st.name}
                        onChange={(e) =>
                          setPipeStages((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, name: e.target.value } : p)),
                          )
                        }
                        placeholder={`Стадия ${idx + 1}`}
                        className="flex-1 rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                      />
                      <input
                        type="color"
                        value={st.color}
                        onChange={(e) =>
                          setPipeStages((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, color: e.target.value } : p)),
                          )
                        }
                        className="h-10 w-12 rounded-lg border border-slate-700 bg-slate-950/40"
                      />
                      <button
                        type="button"
                        disabled={pipeStages.length <= 1}
                        onClick={() => setPipeStages((prev) => prev.filter((_, i) => i !== idx))}
                        className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => void submitCreatePipeline()}
                className="mt-2 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95"
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      {createStageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Создать стадию</h2>
              <button
                type="button"
                onClick={() => setCreateStageOpen(false)}
                className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800/40"
              >
                Закрыть
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <label className="text-sm text-slate-300">
                Воронка
                <select
                  value={pipelineId ?? ""}
                  onChange={(e) => setPipelineId(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                >
                  {(pipelinesQuery.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-300">
                Название стадии
                <input
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-slate-300">
                Цвет
                <input
                  type="color"
                  value={newStageColor}
                  onChange={(e) => setNewStageColor(e.target.value)}
                  className="mt-1 h-10 w-16 rounded-lg border border-slate-700 bg-slate-950/40"
                />
              </label>
              <button
                type="button"
                onClick={() => void submitCreateStage()}
                className="mt-1 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95"
              >
                Создать стадию
              </button>
            </div>
          </div>
        </div>
      )}

      {createLeadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Создать лид</h2>
              <button
                type="button"
                onClick={() => setCreateLeadOpen(false)}
                className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800/40"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-sm text-slate-300">
                Имя
                <input
                  value={leadName}
                  onChange={(e) => setLeadName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-slate-300">
                Телефон
                <input
                  value={leadPhone}
                  onChange={(e) => setLeadPhone(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-slate-300">
                Email (необязательно)
                <input
                  value={leadEmail}
                  onChange={(e) => setLeadEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-slate-300">
                Источник
                <select
                  value={leadSource}
                  onChange={(e) => setLeadSource(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                >
                  <option value="">—</option>
                  {(sourcesQuery.data ?? [])
                    .filter((s) => s.is_active)
                    .map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-sm text-slate-300">
                  Воронка
                  <select
                    value={leadPipelineId ?? ""}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      setLeadPipelineId(Number.isFinite(id) ? id : null);
                      setLeadStageId(null);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                  >
                    {(pipelinesQuery.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Стадия
                  <select
                    value={leadStageId ?? ""}
                    onChange={(e) => setLeadStageId(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                  >
                    {(createLeadStagesQuery.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <button
                type="button"
                onClick={() => void submitCreateLead()}
                className="mt-2 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95"
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      {integrationsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Интеграции</h2>
              <button
                type="button"
                onClick={() => {
                  resetIntegrationForm();
                  setIntegrationsOpen(false);
                }}
                className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800/40"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-700/50 bg-slate-950/30 p-4">
                <div className="text-sm font-semibold text-white">
                  {editingIntegrationId != null ? "Редактировать интеграцию" : "Создать интеграцию"}
                </div>
                <div className="mt-3 grid gap-3">
                  <label className="text-sm text-slate-300">
                    Название
                    <input
                      value={integrationName}
                      onChange={(e) => setIntegrationName(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                    />
                  </label>

                  <label className="text-sm text-slate-300">
                    Провайдер
                    <select
                      value={integrationProvider}
                      disabled={editingIntegrationId != null}
                      onChange={(e) => setIntegrationProvider(e.target.value as "green_api" | "telegram")}
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="green_api">GREEN API (WhatsApp)</option>
                      <option value="telegram">Telegram Bot</option>
                    </select>
                  </label>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-sm text-slate-300">
                      Воронка
                      <select
                        value={integrationPipelineId ?? ""}
                        onChange={(e) => {
                          const id = Number(e.target.value);
                          setIntegrationPipelineId(Number.isFinite(id) ? id : null);
                          setIntegrationStageId(null);
                        }}
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                      >
                        {(pipelinesQuery.data ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm text-slate-300">
                      Стадия
                      <select
                        value={integrationStageId ?? ""}
                        onChange={(e) => setIntegrationStageId(Number(e.target.value))}
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                      >
                        {(integrationStagesQuery.data ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {integrationProvider === "telegram" && (
                    <label className="text-sm text-slate-300">
                      Webhook секрет (token)
                      {editingIntegrationId != null && (
                        <span className="ml-1 text-[11px] font-normal text-slate-500">— оставьте пустым, чтобы не менять</span>
                      )}
                      <div className="mt-1 flex gap-2">
                        <input
                          value={integrationSecret}
                          onChange={(e) => setIntegrationSecret(e.target.value)}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                        />
                        <button
                          type="button"
                          onClick={() => void generateIntegrationSecret()}
                          className="shrink-0 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/40"
                        >
                          Сгенерировать
                        </button>
                      </div>
                    </label>
                  )}

                  {integrationProvider === "green_api" ? (
                    <div className="grid gap-3">
                      <p className="text-[11px] leading-relaxed text-slate-400">
                        Скопируйте три значения из личного кабинета Green API (страница инстанса):{" "}
                        <span className="text-slate-300">idInstance</span>,{" "}
                        <span className="text-slate-300">apiTokenInstance</span>. При сохранении CRM сама настроит
                        приём сообщений — вручную вставлять webhook в Green API не нужно.
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-sm text-slate-300">
                          idInstance
                          <input
                            value={greenInstanceId}
                            onChange={(e) => setGreenInstanceId(e.target.value)}
                            placeholder="Напр. 7103507365"
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                          />
                        </label>
                        <label className="text-sm text-slate-300">
                          apiTokenInstance
                          <input
                            type="password"
                            autoComplete="off"
                            value={greenApiToken}
                            onChange={(e) => setGreenApiToken(e.target.value)}
                            placeholder={
                              editingIntegrationId != null
                                ? "Оставьте пустым, чтобы не менять"
                                : "Токен из кабинета"
                            }
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                          />
                        </label>
                      </div>
                      <label className="text-sm text-slate-300">
                        Адрес API (по желанию)
                        <input
                          value={greenApiBaseUrl}
                          onChange={(e) => setGreenApiBaseUrl(e.target.value)}
                          placeholder="Если в кабинете другой URL — напр. https://7103.api.greenapi.com"
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="text-sm text-slate-300">
                      Config (JSON)
                      <textarea
                        value={integrationConfigText}
                        onChange={(e) => setIntegrationConfigText(e.target.value)}
                        rows={5}
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 font-mono text-xs text-white"
                      />
                    </label>
                  )}

                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => void submitCreateIntegration()}
                      className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95"
                    >
                      {editingIntegrationId != null ? "Сохранить" : "Создать"}
                    </button>
                    {editingIntegrationId != null && (
                      <button
                        type="button"
                        onClick={() => resetIntegrationForm()}
                        className="w-full rounded-xl border border-slate-700 py-2 text-sm text-slate-300 transition hover:bg-slate-800/40"
                      >
                        Отменить редактирование
                      </button>
                    )}
                  </div>
                  {integrationProvider === "green_api" ? (
                    <p className="text-[11px] text-slate-500">
                      Если появится ошибка про адрес API: на сервере задайте{" "}
                      <span className="font-mono text-slate-400">public_api_base_url</span> (см. раздел SMTP на странице
                      «Сотрудники») или сохраняйте интеграцию, будучи залогиненным с того же сайта, где открыт API.
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      Для Telegram скопируйте webhook URL из списка справа и укажите секрет в настройках бота.
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-700/50 bg-slate-950/30 p-4">
                <div className="text-sm font-semibold text-white">Список</div>
                <div className="mt-3 space-y-2">
                  {(integrationsQuery.data ?? []).length === 0 && (
                    <p className="text-sm text-slate-500">Интеграций пока нет</p>
                  )}
                  {(integrationsQuery.data ?? []).map((it) => {
                    const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
                    const base =
                      apiBase && apiBase.endsWith("/") ? apiBase.slice(0, apiBase.length - 1) : apiBase;
                    const hookPath = base
                      ? `${base}/api/integrations/webhook/${it.id}`
                      : `/api/integrations/webhook/${it.id}`;
                    return (
                      <div key={it.id} className="rounded-xl border border-slate-700/60 bg-slate-900/30 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-100">{it.name}</div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-xs text-slate-400">{it.provider}</span>
                            <button
                              type="button"
                              onClick={() => beginEditIntegration(it)}
                              className="rounded-lg border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800/50"
                            >
                              Изменить
                            </button>
                          </div>
                        </div>
                        {it.provider === "green_api" && (
                          <div className="mt-2 text-[11px] leading-relaxed text-emerald-400/90">
                            WhatsApp: при сохранении CRM сама настроила приём в Green API. Новые сообщения клиентов
                            появляются как лиды в выбранной воронке (и в разделе «Чат»). Первое сообщение может
                            задержаться до нескольких минут. После обновления CRM откройте «Изменить» и снова нажмите
                            «Сохранить», чтобы переподключить вебхук.
                          </div>
                        )}
                        {it.provider === "green_api" && it.has_api_token && (
                          <div className="mt-1 text-[11px] text-slate-500">Токен API сохранён на сервере</div>
                        )}
                        <div className="mt-2 text-[11px] text-slate-400">
                          Воронка: pipeline {it.pipeline_id}, стадия {it.stage_id}, активна: {String(it.is_active)}
                        </div>
                        {it.provider === "telegram" && (
                          <div className="mt-2 text-[11px] text-slate-300">
                            Webhook URL:
                            <div className="mt-1 rounded-lg border border-slate-700 bg-slate-950/40 px-2 py-1 font-mono text-[11px] text-slate-200 break-all">
                              {hookPath}?token=
                              <span className="text-amber-200/90">&lt;ваш_секрет_из_формы&gt;</span>
                            </div>
                            {!apiBase && (
                              <div className="mt-1 text-[11px] text-amber-300/90">
                                Задайте `VITE_API_BASE_URL` для полного URL на проде.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {(stagesQuery.isLoading || leadsQuery.isLoading) && (
        <p className="text-sm text-slate-400">Загрузка…</p>
      )}
      {(stagesQuery.isError || leadsQuery.isError) && (
        <p className="text-sm text-red-300">
          {(stagesQuery.error as Error)?.message ?? (leadsQuery.error as Error)?.message}
        </p>
      )}

      {kanbanError && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
          {kanbanError}
        </p>
      )}

      {sortedStages.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div className="flex gap-4 overflow-x-auto pb-4">
            {sortedStages.map((stage) => (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                leads={leadsByStage.get(stage.id) ?? []}
                currentRole={currentRole}
                onRefresh={refreshAll}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeLead ? <LeadCardDragOverlay lead={activeLead} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {sortedStages.length === 0 && !stagesQuery.isLoading && !stagesQuery.isError && (
        <p className="text-sm text-slate-500">Этапы воронки не загружены.</p>
      )}
    </div>
  );
}
