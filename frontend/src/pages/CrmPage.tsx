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
import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";

import { apiFetch, getStoredToken, resolveApiUrl } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type {
  Integration,
  Lead,
  LeadImportResponse,
  LeadSource,
  LeadStatusPatchResponse,
  LeadTablePage,
  Pipeline,
  PipelineStage,
  Task,
  TaskListResponse,
  UserRole,
} from "@/lib/types";

function stageDroppableId(stageId: number) {
  return `stage-${stageId}`;
}

function leadDraggableId(leadId: number) {
  return `lead-${leadId}`;
}

/** Совпадает с бэкендом `default_pipeline_stages` (имена для онлайн-записи задаются в .env API). */
const DEFAULT_AUTO_PIPELINE_STAGES: Array<{ name: string; color: string }> = [
  { name: "Новый", color: "#64748b" },
  { name: "Квалифицирован", color: "#6366f1" },
  { name: "Запись", color: "#8b5cf6" },
  { name: "Успешно реализован", color: "#22c55e" },
  { name: "Потерян", color: "#ef4444" },
];

function cloneDefaultStages() {
  return DEFAULT_AUTO_PIPELINE_STAGES.map((s) => ({ name: s.name, color: s.color }));
}

/** Короткая дата создания лида для бейджа. */
function leadDateBadge(createdAt?: string | null): string {
  if (!createdAt) return "—";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "—";
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
          {leadDateBadge(lead.created_at)}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-400">{lead.phone ?? "—"}</p>
      <div className="mt-3 flex items-end justify-between gap-2">
        <p className="truncate text-xs text-slate-500" title={lead.manager_name || "Не назначен"}>
          Ответственный: {lead.manager_name || "—"}
        </p>
        <div className="flex items-center gap-2">
          {lead.protocol_file_attached && <span title="Протокол прикреплён">📄</span>}
          {paidNum > 0 && <span title="Есть оплата по доп. услугам">💰</span>}
          {lead.refusal_reason && <span title="Есть отказ">❌</span>}
        </div>
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
  const navigate = useNavigate();
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
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => navigate(`/leads/${lead.id}`)}
        className="mb-2 rounded-lg border border-slate-700 bg-slate-900/40 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
      >
        Открыть карточку
      </button>
      <LeadCardBody lead={lead} />

      {currentRole === "owner" && stage === "Запись" && (
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

      {(currentRole === "manager" || currentRole === "admin") && stage === "Доп. услуги" && (
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
  registerScrollContainer,
}: {
  stage: PipelineStage;
  leads: Lead[];
  currentRole: UserRole | null;
  onRefresh: () => void;
  registerScrollContainer: (stageId: number, el: HTMLDivElement | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stageDroppableId(stage.id),
    data: { stageId: stage.id },
  });

  return (
    <div
      ref={setNodeRef}
      data-kanban-column="true"
      className={[
        "flex h-[min(70vh,520px)] w-[min(100%,280px)] shrink-0 flex-col rounded-2xl border border-slate-700/40 bg-slate-800/30 p-3 shadow-inner backdrop-blur-sm transition-colors duration-300",
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
      <div
        ref={(el) => registerScrollContainer(stage.id, el)}
        data-kanban-scroll="true"
        className="flex flex-1 flex-col gap-3 overflow-y-auto pr-0.5"
      >
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
  const isCompanyAdmin = currentRole === "owner" || currentRole === "admin";

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["leads"] });
    void queryClient.invalidateQueries({ queryKey: ["leads-table"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["analytics"] });
  }, [queryClient]);

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiFetch<Task[] | TaskListResponse>("/api/tasks"),
    refetchInterval: 4000,
  });
  const tasks = useMemo(() => {
    const d = tasksQuery.data;
    if (!d) return [];
    if (Array.isArray(d)) return d;
    const items = (d as TaskListResponse).items;
    return Array.isArray(items) ? items : [];
  }, [tasksQuery.data]);
  const [seenTaskIds, setSeenTaskIds] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    if (tasks.length === 0) return;
    const pendingNew = tasks.filter((t) => t.status === "pending" && !seenTaskIds.has(t.id));
    if (pendingNew.length === 0) return;
    pendingNew.forEach((t) => toast.success(t.title));
    setSeenTaskIds((prev) => {
      const next = new Set(prev);
      pendingNew.forEach((t) => next.add(t.id));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

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
    enabled: currentRole === "owner",
  });

  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [editingIntegrationId, setEditingIntegrationId] = useState<number | null>(null);
  const [integrationName, setIntegrationName] = useState("");
  const [integrationProvider, setIntegrationProvider] = useState<"green_api" | "telegram" | "google_sheets">("green_api");
  const [integrationSecret, setIntegrationSecret] = useState("");
  const [integrationConfigText, setIntegrationConfigText] = useState("{}");
  const [greenInstanceId, setGreenInstanceId] = useState("");
  const [greenApiToken, setGreenApiToken] = useState("");
  /** Как в кабинете Green API, напр. https://7103.api.greenapi.com — если пусто, сервер попробует api.green-api.com */
  const [greenApiBaseUrl, setGreenApiBaseUrl] = useState("");
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [sheetsTabName, setSheetsTabName] = useState("");
  const [sheetsNameColumn, setSheetsNameColumn] = useState("full_name");
  const [sheetsPhoneColumn, setSheetsPhoneColumn] = useState("phone_number");
  const [sheetsEmailColumn, setSheetsEmailColumn] = useState("email");
  const [sheetsHeaderRow, setSheetsHeaderRow] = useState("1");
  const [sheetsStartRow, setSheetsStartRow] = useState("2");
  const [integrationPipelineId, setIntegrationPipelineId] = useState<number | null>(null);
  const [integrationStageId, setIntegrationStageId] = useState<number | null>(null);
  const [integrationCloseDealEnabled, setIntegrationCloseDealEnabled] = useState(false);
  const [tplGreeting, setTplGreeting] = useState("");
  const [tplConfirm, setTplConfirm] = useState("");
  const [tplReminder24h, setTplReminder24h] = useState("");
  const [tplReminder2h, setTplReminder2h] = useState("");
  const [tplReactivation, setTplReactivation] = useState("");

  function resetIntegrationForm() {
    setEditingIntegrationId(null);
    setIntegrationName("");
    setIntegrationProvider("green_api");
    setIntegrationSecret("");
    setIntegrationConfigText("{}");
    setGreenInstanceId("");
    setGreenApiToken("");
    setGreenApiBaseUrl("");
    setSheetsUrl("");
    setSheetsTabName("");
    setSheetsNameColumn("full_name");
    setSheetsPhoneColumn("phone_number");
    setSheetsEmailColumn("email");
    setSheetsHeaderRow("1");
    setSheetsStartRow("2");
    setIntegrationPipelineId(null);
    setIntegrationStageId(null);
    setTplGreeting("");
    setTplConfirm("");
    setTplReminder24h("");
    setTplReminder2h("");
    setTplReactivation("");
    setIntegrationCloseDealEnabled(false);
  }

  function beginEditIntegration(it: Integration) {
    setIntegrationsOpen(true);
    setEditingIntegrationId(it.id);
    setIntegrationName(it.name);
    setIntegrationProvider(it.provider === "telegram" ? "telegram" : it.provider === "google_sheets" ? "google_sheets" : "green_api");
    setIntegrationPipelineId(it.pipeline_id);
    setIntegrationStageId(it.stage_id);
    setIntegrationCloseDealEnabled(Boolean(it.manager_close_deal_enabled));
    setIntegrationSecret("");
    if (it.provider === "telegram") {
      setIntegrationConfigText(JSON.stringify(it.config ?? {}, null, 2));
      setGreenInstanceId("");
      setGreenApiToken("");
      setGreenApiBaseUrl("");
      setSheetsUrl("");
      setSheetsTabName("");
      setSheetsNameColumn("full_name");
      setSheetsPhoneColumn("phone_number");
      setSheetsEmailColumn("email");
      setSheetsHeaderRow("1");
      setSheetsStartRow("2");
    } else if (it.provider === "google_sheets") {
      const c = it.config as Record<string, unknown> | null;
      setSheetsUrl(String(c?.sheet_url ?? c?.spreadsheet_id ?? ""));
      setSheetsTabName(typeof c?.sheet_name === "string" ? c.sheet_name : "");
      setSheetsNameColumn(typeof c?.full_name_column === "string" ? c.full_name_column : "full_name");
      setSheetsPhoneColumn(typeof c?.phone_column === "string" ? c.phone_column : "phone_number");
      setSheetsEmailColumn(typeof c?.email_column === "string" ? c.email_column : "email");
      setSheetsHeaderRow(String(c?.header_row ?? 1));
      setSheetsStartRow(String(c?.start_row ?? 2));
      setIntegrationConfigText("{}");
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
      setSheetsUrl("");
      setSheetsTabName("");
      setSheetsNameColumn("full_name");
      setSheetsPhoneColumn("phone_number");
      setSheetsEmailColumn("email");
      setSheetsHeaderRow("1");
      setSheetsStartRow("2");
    }
    const c = (it.config ?? {}) as Record<string, unknown>;
    const templates =
      c.templates && typeof c.templates === "object" ? (c.templates as Record<string, unknown>) : {};
    const pick = (k: string) => (typeof templates[k] === "string" ? String(templates[k]) : "");
    setTplGreeting(pick("greeting"));
    setTplConfirm(pick("confirm"));
    setTplReminder24h(pick("reminder_24h"));
    setTplReminder2h(pick("reminder_2h"));
    setTplReactivation(pick("reactivation"));
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

  async function syncSheetsNow(integrationId: number) {
    try {
      const stats = await apiFetch<{ created: number; processed: number; skipped: number }>(
        `/api/integrations/${integrationId}/sync`,
        { method: "POST" },
      );
      toast.success(`Синхронизация: обработано ${stats.processed}, пропущено ${stats.skipped}`);
      refreshAll();
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось синхронизировать таблицу");
    }
  }

  async function submitCreateIntegration() {
    if (!integrationName.trim()) return toast.error("Название обязательно");
    if (!integrationPipelineId || !integrationStageId) return toast.error("Выберите воронку и стадию");

    const templates = {
      greeting: tplGreeting.trim(),
      confirm: tplConfirm.trim(),
      reminder_24h: tplReminder24h.trim(),
      reminder_2h: tplReminder2h.trim(),
      reactivation: tplReactivation.trim(),
    };

    if (editingIntegrationId != null) {
      const body: Record<string, unknown> = {
        name: integrationName.trim(),
        pipeline_id: integrationPipelineId,
        stage_id: integrationStageId,
        manager_close_deal_enabled: integrationCloseDealEnabled,
      };
      if (integrationProvider === "telegram" && integrationSecret.trim()) {
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
          templates,
        };
      } else {
        if (integrationProvider === "google_sheets") {
          if (!sheetsUrl.trim()) {
            toast.error("Укажите URL Google таблицы");
            return;
          }
          body.config = {
            sheet_url: sheetsUrl.trim(),
            ...(sheetsTabName.trim() ? { sheet_name: sheetsTabName.trim() } : {}),
            full_name_column: sheetsNameColumn.trim() || "full_name",
            phone_column: sheetsPhoneColumn.trim() || "phone_number",
            ...(sheetsEmailColumn.trim() ? { email_column: sheetsEmailColumn.trim() } : {}),
            header_row: Number(sheetsHeaderRow) || 1,
            start_row: Number(sheetsStartRow) || 2,
            templates,
          };
        } else {
          try {
            const parsed = integrationConfigText.trim()
              ? (JSON.parse(integrationConfigText) as Record<string, unknown>)
              : {};
            body.config = { ...parsed, templates };
          } catch {
            toast.error("Config должен быть валидным JSON");
            return;
          }
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
        templates,
      };
    } else if (integrationProvider === "google_sheets") {
      if (!sheetsUrl.trim()) return toast.error("Укажите URL Google таблицы");
      cfg = {
        sheet_url: sheetsUrl.trim(),
        ...(sheetsTabName.trim() ? { sheet_name: sheetsTabName.trim() } : {}),
        full_name_column: sheetsNameColumn.trim() || "full_name",
        phone_column: sheetsPhoneColumn.trim() || "phone_number",
        ...(sheetsEmailColumn.trim() ? { email_column: sheetsEmailColumn.trim() } : {}),
        header_row: Number(sheetsHeaderRow) || 1,
        start_row: Number(sheetsStartRow) || 2,
        templates,
      };
    } else {
      if (!integrationSecret.trim()) return toast.error("Для Telegram укажите webhook-секрет (или нажмите «Сгенерировать»)");
      try {
        const parsed = integrationConfigText.trim() ? (JSON.parse(integrationConfigText) as Record<string, unknown>) : {};
        cfg = { ...parsed, templates };
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
      manager_close_deal_enabled: integrationCloseDealEnabled,
      config: cfg,
    };
    if (integrationProvider === "telegram") {
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
      void queryClient.invalidateQueries({ queryKey: ["leads-table"] });
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
  const [pipeExpertUserId, setPipeExpertUserId] = useState<number | "">("");
  const [useCustomPipelineStages, setUseCustomPipelineStages] = useState(false);
  const [pipeStages, setPipeStages] = useState<Array<{ name: string; color: string }>>(() => cloneDefaultStages());

  async function submitCreatePipeline() {
    if (!pipeName.trim()) {
      toast.error("Название воронки обязательно");
      return;
    }
    if (
      useCustomPipelineStages &&
      (pipeStages.length === 0 || pipeStages.some((s) => !s.name.trim()))
    ) {
      toast.error("Добавьте хотя бы одну стадию и заполните названия");
      return;
    }
    try {
      await apiFetch<Pipeline>("/api/pipelines", {
        method: "POST",
        body: JSON.stringify({
          name: pipeName.trim(),
          type: pipeType.trim(),
          expert_user_id: typeof pipeExpertUserId === "number" ? pipeExpertUserId : null,
          stages: useCustomPipelineStages
            ? pipeStages.map((s, idx) => ({
                name: s.name.trim(),
                order: idx,
                color: s.color || "#6366f1",
              }))
            : [],
        }),
      });
      toast.success("Воронка создана");
      setCreatePipelineOpen(false);
      setPipeName("");
      setPipeType("sales");
      setPipeExpertUserId("");
      setUseCustomPipelineStages(false);
      setPipeStages(cloneDefaultStages());
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

  const [distributeOpen, setDistributeOpen] = useState(false);
  const [distributeStageId, setDistributeStageId] = useState<number | "">("");
  const [distributeForce, setDistributeForce] = useState(false);
  const distributeMutation = useMutation({
    mutationFn: async () => {
      if (!pipelineId) throw new Error("Сначала выберите воронку");
      if (distributeStageId === "") throw new Error("Выберите стадию");
      return apiFetch<{ total: number; assigned: number; skipped: number }>(
        `/api/pipelines/${pipelineId}/distribute-leads`,
        {
          method: "POST",
          body: JSON.stringify({ stage_id: distributeStageId, force_reassign: distributeForce }),
        },
      );
    },
    onSuccess: (r) => {
      toast.success(`Распределено: ${r.assigned}. Пропущено: ${r.skipped}. Всего на стадии: ${r.total}.`);
      setDistributeOpen(false);
      setDistributeStageId("");
      setDistributeForce(false);
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["leads-table"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [pipelineId, setPipelineId] = useState<number | null>(null);
  useEffect(() => {
    if (pipelineId != null) return;
    const first = pipelinesQuery.data?.[0];
    if (first) setPipelineId(first.id);
  }, [pipelinesQuery.data, pipelineId]);

  const [crmView, setCrmView] = useState<"board" | "list">("board");
  const [listPage, setListPage] = useState(1);
  const [listSearchInput, setListSearchInput] = useState("");
  const [listSearchDebounced, setListSearchDebounced] = useState("");
  const [listStatusFilter, setListStatusFilter] = useState<number | "">("");

  useEffect(() => {
    const t = window.setTimeout(() => setListSearchDebounced(listSearchInput.trim()), 400);
    return () => window.clearTimeout(t);
  }, [listSearchInput]);

  useEffect(() => {
    setListPage(1);
  }, [pipelineId, listSearchDebounced, listStatusFilter]);

  const stagesQuery = useQuery({
    queryKey: ["stages", pipelineId],
    queryFn: () =>
      pipelineId
        ? apiFetch<PipelineStage[]>(`/api/stages?pipeline_id=${pipelineId}`)
        : apiFetch<PipelineStage[]>("/api/stages"),
  });

  const patchPipelineMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
      apiFetch<Pipeline>(`/api/pipelines/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pipelines"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteStageMutation = useMutation({
    mutationFn: (stageId: number) => apiFetch<void>(`/api/stages/${stageId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Стадия удалена");
      void queryClient.invalidateQueries({ queryKey: ["stages"] });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["leads-table"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePipelineMutation = useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/api/pipelines/${id}`, { method: "DELETE" }),
    onSuccess: (_, deletedId) => {
      toast.success("Воронка удалена");
      if (pipelineId === deletedId) setPipelineId(null);
      void queryClient.invalidateQueries({ queryKey: ["pipelines"] });
      void queryClient.invalidateQueries({ queryKey: ["stages"] });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["leads-table"] });
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedPipelineForSettings = useMemo(
    () => (pipelineId != null ? pipelinesQuery.data?.find((p) => p.id === pipelineId) : undefined),
    [pipelinesQuery.data, pipelineId],
  );

  const expertsQuery = useQuery({
    queryKey: ["employees", "experts"],
    queryFn: () => apiFetch<Array<{ id: number; email: string; full_name: string | null }>>("/api/employees/experts"),
    enabled: isCompanyAdmin,
  });

  type CompanyEmployee = {
    id: number;
    email: string;
    full_name: string | null;
    role: UserRole;
  };

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiFetch<CompanyEmployee[]>("/api/employees"),
    enabled: isCompanyAdmin,
  });

  const patchPipelineExpertMutation = useMutation({
    mutationFn: async ({ id, expert_user_id }: { id: number; expert_user_id: number | null }) =>
      apiFetch<Pipeline>(`/api/pipelines/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ expert_user_id }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pipelines"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [importOpen, setImportOpen] = useState(false);
  const [importPipelineId, setImportPipelineId] = useState<number | null>(null);
  const [importStageId, setImportStageId] = useState<number | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importLastResult, setImportLastResult] = useState<LeadImportResponse | null>(null);

  useEffect(() => {
    if (!importOpen) return;
    setImportLastResult(null);
    const pid = pipelineId ?? pipelinesQuery.data?.[0]?.id ?? null;
    if (pid != null) setImportPipelineId(pid);
  }, [importOpen, pipelineId, pipelinesQuery.data]);

  const importStagesQuery = useQuery({
    queryKey: ["stages", "import", importPipelineId],
    queryFn: () =>
      importPipelineId
        ? apiFetch<PipelineStage[]>(`/api/stages?pipeline_id=${importPipelineId}`)
        : apiFetch<PipelineStage[]>("/api/stages"),
    enabled: importOpen && importPipelineId != null,
  });

  useEffect(() => {
    if (!importOpen) return;
    const st = importStagesQuery.data;
    if (!st || st.length === 0) return;
    if (importStageId != null && st.some((x) => x.id === importStageId)) return;
    setImportStageId(st[0].id);
  }, [importOpen, importStagesQuery.data, importStageId]);

  async function downloadImportTemplate() {
    const token = getStoredToken();
    try {
      const res = await fetch(resolveApiUrl("/api/leads/import/template"), {
        headers: token ? { Authorization: `Bearer ${token}`, Accept: "text/csv" } : {},
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text;
        try {
          const j = JSON.parse(text) as { detail?: unknown };
          const d = j.detail;
          msg = typeof d === "string" ? d : msg;
        } catch {
          /* not json */
        }
        throw new Error(msg || "Ошибка");
      }
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "metodione_leads_import.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось скачать шаблон");
    }
  }

  async function submitImportLeads() {
    const inp = importFileRef.current?.files?.[0];
    if (!inp) {
      toast.error("Выберите CSV-файл");
      return;
    }
    if (!importStageId) {
      toast.error("Выберите стадию");
      return;
    }
    const fd = new FormData();
    fd.append("file", inp);
    fd.append("default_stage_id", String(importStageId));
    const token = getStoredToken();
    const controller = new AbortController();
    const to = window.setTimeout(() => controller.abort(), 900_000);
    try {
      const res = await fetch(resolveApiUrl("/api/leads/import"), {
        method: "POST",
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text) as unknown;
        } catch {
          throw new Error(text.slice(0, 200) || "Ответ не JSON");
        }
      }
      if (!res.ok) {
        const d = (data as { detail?: unknown } | null)?.detail;
        const msg =
          typeof d === "string"
            ? d
            : Array.isArray(d)
              ? d.map((x: { msg?: string }) => x.msg).filter(Boolean).join(", ")
              : `Ошибка (${res.status})`;
        throw new Error(msg);
      }
      const result = data as LeadImportResponse;
      setImportLastResult(result);
      toast.success(`Импортировано лидов: ${result.created}`);
      if (result.errors.length) {
        toast.error(`Не удалось разобрать или сохранить строк: ${result.errors.length}`);
      } else {
        setImportOpen(false);
        if (importFileRef.current) importFileRef.current.value = "";
      }
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["leads-table"] });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        toast.error("Импорт прерван по таймауту. Разбейте файл на части.");
        return;
      }
      toast.error(e instanceof Error ? e.message : "Не удалось импортировать");
    } finally {
      window.clearTimeout(to);
    }
  }

  const kanbanPerStage = 50;
  const listPageSize = 50;
  const boardContainerRef = useRef<HTMLDivElement | null>(null);
  const stageScrollRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const leadsQuery = useQuery({
    queryKey: ["leads", pipelineId, "kanban", kanbanPerStage],
    queryFn: () =>
      apiFetch<Lead[]>(
        `/api/leads?pipeline_id=${pipelineId}&per_stage_limit=${kanbanPerStage}`,
      ),
    enabled: pipelineId != null && crmView === "board",
  });

  const leadsTableQuery = useQuery({
    queryKey: ["leads-table", pipelineId, listPage, listSearchDebounced, listStatusFilter, listPageSize],
    queryFn: () => {
      const params = new URLSearchParams({
        pipeline_id: String(pipelineId),
        page: String(listPage),
        page_size: String(listPageSize),
      });
      if (listSearchDebounced) params.set("q", listSearchDebounced);
      if (listStatusFilter !== "") params.set("status_id", String(listStatusFilter));
      return apiFetch<LeadTablePage>(`/api/leads/table?${params.toString()}`);
    },
    enabled: pipelineId != null && crmView === "list",
  });

  const [leads, setLeads] = useState<Lead[]>([]);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [kanbanError, setKanbanError] = useState<string | null>(null);

  useEffect(() => {
    setLeads([]);
  }, [pipelineId]);

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

  const listTotalPages = useMemo(() => {
    const d = leadsTableQuery.data;
    if (!d) return 1;
    return Math.max(1, Math.ceil(d.total / d.page_size));
  }, [leadsTableQuery.data]);

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
        void queryClient.invalidateQueries({ queryKey: ["leads"] });
        void queryClient.invalidateQueries({ queryKey: ["leads-table"] });
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
    [leads, queryClient, sortedStages, pipelineId],
  );

  const onDragCancel = useCallback(() => {
    setActiveLead(null);
  }, []);

  const registerScrollContainer = useCallback((stageId: number, el: HTMLDivElement | null) => {
    if (el) {
      stageScrollRefs.current.set(stageId, el);
    } else {
      stageScrollRefs.current.delete(stageId);
    }
  }, []);

  const onBoardWheelCapture = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) return;
    const boardEl = boardContainerRef.current;
    if (!boardEl) return;

    const pointEl = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    let scroller = pointEl?.closest?.("[data-kanban-scroll='true']") as HTMLDivElement | null;
    if (!scroller || !boardEl.contains(scroller)) {
      // Если курсор в зазоре между колонками — берём ближайшую колонку по X.
      let nearest: HTMLDivElement | null = null;
      let nearestDx = Number.POSITIVE_INFINITY;
      for (const el of stageScrollRefs.current.values()) {
        const rect = el.getBoundingClientRect();
        if (event.clientY < rect.top || event.clientY > rect.bottom) continue;
        const cx = rect.left + rect.width / 2;
        const dx = Math.abs(event.clientX - cx);
        if (dx < nearestDx) {
          nearestDx = dx;
          nearest = el;
        }
      }
      scroller = nearest;
    }
    if (!scroller) return;

    const before = scroller.scrollTop;
    scroller.scrollTop += event.deltaY;
    if (scroller.scrollTop !== before) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  return (
    <div className="relative mx-auto max-w-[1600px] space-y-8 pb-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white">MetodiOne</h1>
        <p className="text-base text-slate-400">
          Доска: перетаскивание между стадиями, до {kanbanPerStage} карточек в колонке. Вкладка «Список» —
          поиск по имени/телефону/email и просмотр всех лидов воронки постранично.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {isCompanyAdmin && (
            <button
              type="button"
              onClick={() => {
                setUseCustomPipelineStages(false);
                setPipeStages(cloneDefaultStages());
                setCreatePipelineOpen(true);
              }}
              className="rounded-full border border-slate-700/50 bg-slate-800/30 px-3 py-1 text-sm text-slate-200 transition hover:bg-slate-800/50"
            >
              + Создать воронку
            </button>
          )}
          {isCompanyAdmin && (
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
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="rounded-full border border-slate-700/50 bg-slate-800/30 px-3 py-1 text-sm text-slate-200 transition hover:bg-slate-800/50"
          >
            Импорт CSV
          </button>
          {currentRole === "owner" && (
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
        {pipelinesQuery.data && pipelinesQuery.data.length > 0 && pipelineId != null && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-400">Вид:</span>
            <button
              type="button"
              onClick={() => setCrmView("board")}
              className={[
                "rounded-full border px-3 py-1 text-sm transition-colors",
                crmView === "board"
                  ? "border-purple-500/40 bg-white/10 text-white"
                  : "border-slate-700/50 bg-slate-800/30 text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
              ].join(" ")}
            >
              Доска
            </button>
            <button
              type="button"
              onClick={() => setCrmView("list")}
              className={[
                "rounded-full border px-3 py-1 text-sm transition-colors",
                crmView === "list"
                  ? "border-purple-500/40 bg-white/10 text-white"
                  : "border-slate-700/50 bg-slate-800/30 text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
              ].join(" ")}
            >
              Список (все лиды)
            </button>
          </div>
        )}
        {isCompanyAdmin && pipelineId != null && selectedPipelineForSettings && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-400">Распределение новых лидов (интеграции, очередь записи):</span>
            <select
              value={selectedPipelineForSettings.lead_assignment_mode ?? "none"}
              onChange={(e) => {
                patchPipelineMutation.mutate({ id: pipelineId, patch: { lead_assignment_mode: e.target.value } });
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
        {isCompanyAdmin && pipelineId != null && selectedPipelineForSettings && (
          <div className="mt-2 flex flex-wrap flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-sm text-slate-400">Менеджер приёма (создаёт лиды в этой воронке):</span>
            <select
              value={selectedPipelineForSettings.intake_manager_user_id ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                patchPipelineMutation.mutate({
                  id: pipelineId,
                  patch: { intake_manager_user_id: v ? Number(v) : null },
                });
              }}
              disabled={patchPipelineMutation.isPending}
              className="min-w-[240px] rounded-full border border-slate-700 bg-slate-950/40 px-3 py-1 text-sm text-white"
            >
              <option value="">— не назначен —</option>
              {(employeesQuery.data ?? [])
                .filter((u) => u.role === "manager")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {(u.full_name || u.email).trim()}
                  </option>
                ))}
            </select>
            <p className="text-xs text-slate-500">
              Если выбран и включено распределение, лиды, которые он создаёт/импортирует, уйдут другим менеджерам этой
              воронки (сам «приём» в очередь не попадает).
            </p>
          </div>
        )}
        {isCompanyAdmin && pipelineId != null && selectedPipelineForSettings && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-400">Эксперт этой воронки:</span>
            <select
              value={selectedPipelineForSettings.expert_user_id ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                patchPipelineExpertMutation.mutate({
                  id: pipelineId,
                  expert_user_id: v ? Number(v) : null,
                });
              }}
              disabled={patchPipelineExpertMutation.isPending}
              className="rounded-full border border-slate-700 bg-slate-950/40 px-3 py-1 text-sm text-white"
            >
              <option value="">— не назначен —</option>
              {(expertsQuery.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.full_name || u.email).trim()}
                </option>
              ))}
            </select>
          </div>
        )}
        {isCompanyAdmin && pipelineId != null && sortedStages.length > 0 && (
          <div className="mt-3 rounded-xl border border-slate-700/40 bg-slate-950/20 p-4">
            <div className="text-sm font-semibold text-slate-200">Стадии этой воронки</div>
            <p className="mt-1 text-xs text-slate-500">
              Удаление возможно, только если на стадии нет лидов, сделок и интеграций, которые на неё ссылаются.
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setDistributeOpen(true);
                  if (sortedStages.length > 0) setDistributeStageId(sortedStages[0].id);
                }}
                className="rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800/40"
              >
                Распределить лиды
              </button>
              <p className="text-xs text-slate-500">
                Назначит ответственных менеджеров всем лидам на выбранной стадии (только если менеджер ещё не назначен).
              </p>
            </div>
            <ul className="mt-2 divide-y divide-slate-700/40">
              {sortedStages.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-slate-300">
                    <span className="font-mono text-xs text-slate-500">{s.id}</span> · {s.name}
                  </span>
                  <button
                    type="button"
                    disabled={deleteStageMutation.isPending}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Удалить стадию «${s.name}»? Убедитесь, что на ней нет лидов и что ни одна интеграция не создаёт лиды в эту стадию.`,
                        )
                      )
                        return;
                      deleteStageMutation.mutate(s.id);
                    }}
                    className="rounded-lg border border-red-500/40 px-2 py-1 text-xs text-red-200 transition hover:bg-red-500/10 disabled:opacity-50"
                  >
                    Удалить
                  </button>
                </li>
              ))}
            </ul>
            {pipelinesQuery.data && pipelinesQuery.data.length > 1 && selectedPipelineForSettings && (
              <div className="mt-4 border-t border-slate-700/50 pt-3">
                <button
                  type="button"
                  disabled={deletePipelineMutation.isPending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Удалить воронку «${selectedPipelineForSettings.name}» и все её стадии? Стадии должны быть пустыми, интеграций на эту воронку быть не должно. Последнюю воронку удалить нельзя.`,
                      )
                    )
                      return;
                    deletePipelineMutation.mutate(pipelineId);
                  }}
                  className="rounded-lg border border-red-600/50 bg-red-950/30 px-3 py-1.5 text-sm text-red-200 transition hover:bg-red-950/50 disabled:opacity-50"
                >
                  Удалить воронку целиком
                </button>
              </div>
            )}
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
              {currentRole === "owner" && (
                <label className="text-sm text-slate-300">
                  Эксперт этой воронки
                  <select
                    value={pipeExpertUserId === "" ? "" : String(pipeExpertUserId)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPipeExpertUserId(v ? Number(v) : "");
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                  >
                    <option value="">— не назначен —</option>
                    {(expertsQuery.data ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {(u.full_name || u.email).trim()}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="mt-2 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
                <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-slate-600"
                    checked={useCustomPipelineStages}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setUseCustomPipelineStages(on);
                      if (on) setPipeStages(cloneDefaultStages());
                    }}
                  />
                  <span>
                    <span className="font-medium">Задать стадии вручную</span>
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      По умолчанию сервер создаёт стандартный набор из {DEFAULT_AUTO_PIPELINE_STAGES.length}{" "}
                      стадий (совместим с онлайн-записью).
                    </span>
                  </span>
                </label>
                {!useCustomPipelineStages && (
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    {DEFAULT_AUTO_PIPELINE_STAGES.map((s) => s.name).join(" → ")}
                  </p>
                )}
              </div>

              {useCustomPipelineStages && (
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
              )}

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

      {distributeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Распределить лиды по менеджерам</h2>
              <button
                type="button"
                onClick={() => setDistributeOpen(false)}
                className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800/40"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-sm text-slate-300">
                Стадия
                <select
                  value={distributeStageId === "" ? "" : String(distributeStageId)}
                  onChange={(e) => setDistributeStageId(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                >
                  {sortedStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                Это действие назначит ответственных менеджеров всем лидам на выбранной стадии, у которых ещё нет
                менеджера. Распределение идёт по настройке воронки (round_robin / least_loaded).
              </div>
              <label className="flex items-start gap-3 rounded-xl border border-slate-700/60 bg-slate-950/20 px-4 py-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={distributeForce}
                  onChange={(e) => setDistributeForce(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold">Перераспределить всех</span>
                  <span className="block text-xs text-slate-500">
                    Включите, чтобы перезаписать ответственного менеджера у всех лидов на этой стадии.
                  </span>
                </span>
              </label>

              <button
                type="button"
                disabled={distributeMutation.isPending}
                onClick={() => {
                  const msg = distributeForce
                    ? "Перераспределить ВСЕХ лидов на этой стадии (включая уже назначенных)?"
                    : "Распределить лиды на выбранной стадии?";
                  if (!window.confirm(msg)) return;
                  distributeMutation.mutate();
                }}
                className="mt-1 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95 disabled:opacity-60"
              >
                {distributeMutation.isPending ? "Распределение…" : "Распределить"}
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

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Импорт лидов (CSV)</h2>
              <button
                type="button"
                onClick={() => {
                  setImportOpen(false);
                  setImportLastResult(null);
                  if (importFileRef.current) importFileRef.current.value = "";
                }}
                className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800/40"
              >
                Закрыть
              </button>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Из Битрикс24: CRM → Лиды → выделите нужные → <span className="text-slate-300">Экспорт</span> в Excel.
              Сохраните файл как CSV (кодировка UTF-8). Подойдут колонки вроде «Название», «Имя», «Фамилия»,
              «Телефон», «E-mail», «Источник». Все импортируемые лиды попадут в выбранную стадию. За один раз
              можно загрузить до ~25&nbsp;000 строк; при большом файле импорт может занять несколько минут.
            </p>

            <div className="mt-4 grid gap-3">
              <button
                type="button"
                onClick={() => void downloadImportTemplate()}
                className="w-full rounded-xl border border-slate-600 py-2 text-sm text-slate-200 transition hover:bg-slate-800/50"
              >
                Скачать шаблон CSV для MetodiOne
              </button>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-sm text-slate-300">
                  Воронка
                  <select
                    value={importPipelineId ?? ""}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      setImportPipelineId(Number.isFinite(id) ? id : null);
                      setImportStageId(null);
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
                  Стадия (все строки файла)
                  <select
                    value={importStageId ?? ""}
                    onChange={(e) => setImportStageId(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                  >
                    {(importStagesQuery.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="text-sm text-slate-300">
                Файл .csv
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".csv,text/csv,.txt"
                  className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border file:border-slate-600 file:bg-slate-800 file:px-3 file:py-1.5 file:text-slate-200"
                />
              </label>

              <button
                type="button"
                onClick={() => void submitImportLeads()}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:opacity-95"
              >
                Загрузить и импортировать
              </button>

              {importLastResult && importLastResult.errors.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-sm font-medium text-amber-100">Строки с ошибками:</p>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-xs text-amber-200/90">
                    {importLastResult.errors.map((err, i) => (
                      <li key={`${err.row}-${i}`}>
                        Строка {err.row}: {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {integrationsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4">
          <div
            className="flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            style={{ maxHeight: "min(92dvh, 880px)" }}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700/60 px-4 py-3 sm:px-5 sm:py-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Интеграции</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">Форма и список ниже — прокручивайте внутри окна</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  resetIntegrationForm();
                  setIntegrationsOpen(false);
                }}
                className="shrink-0 rounded-full border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800/40"
              >
                Закрыть
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5 [scrollbar-gutter:stable]">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
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
                      onChange={(e) => setIntegrationProvider(e.target.value as "green_api" | "telegram" | "google_sheets")}
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="green_api">GREEN API (WhatsApp)</option>
                      <option value="telegram">Telegram Bot</option>
                      <option value="google_sheets">Google Sheets</option>
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

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={integrationCloseDealEnabled}
                      onChange={(e) => setIntegrationCloseDealEnabled(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-600"
                    />
                    <span>
                      <span className="font-medium text-white">Кнопка «Закрыть сделку» для менеджеров</span>
                      <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">
                        Менеджер закроет сделку с суммами на карточке лида (не путать с оплатой в журнале записи — там
                        только админ). Лид уйдёт на стадию успеха из настроек сервера.
                      </span>
                    </span>
                  </label>

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
                        <span className="text-slate-300">apiTokenInstance</span>. При сохранении MetodiOne автоматически
                        настроит приём сообщений — вручную вставлять webhook в Green API не нужно.
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
                  ) : integrationProvider === "google_sheets" ? (
                    <div className="grid gap-3">
                      <p className="text-[11px] leading-relaxed text-slate-400">
                        Вставьте ссылку Google Sheets. Таблица должна быть открыта для сервисного аккаунта CRM (email даст админ
                        сервера). Поля по умолчанию: <span className="text-slate-300">full_name</span> и{" "}
                        <span className="text-slate-300">phone_number</span>.
                      </p>
                      <label className="text-sm text-slate-300">
                        URL таблицы
                        <input
                          value={sheetsUrl}
                          onChange={(e) => setSheetsUrl(e.target.value)}
                          placeholder="https://docs.google.com/spreadsheets/d/..."
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                        />
                      </label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-sm text-slate-300">
                          Лист (необязательно)
                          <input
                            value={sheetsTabName}
                            onChange={(e) => setSheetsTabName(e.target.value)}
                            placeholder="Напр. Sheet1"
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                          />
                        </label>
                        <label className="text-sm text-slate-300">
                          Строка заголовков
                          <input
                            value={sheetsHeaderRow}
                            onChange={(e) => setSheetsHeaderRow(e.target.value)}
                            placeholder="1"
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                          />
                        </label>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="text-sm text-slate-300">
                          Колонка имени
                          <input
                            value={sheetsNameColumn}
                            onChange={(e) => setSheetsNameColumn(e.target.value)}
                            placeholder="full_name"
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                          />
                        </label>
                        <label className="text-sm text-slate-300">
                          Колонка телефона
                          <input
                            value={sheetsPhoneColumn}
                            onChange={(e) => setSheetsPhoneColumn(e.target.value)}
                            placeholder="phone_number"
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                          />
                        </label>
                        <label className="text-sm text-slate-300">
                          Колонка email
                          <input
                            value={sheetsEmailColumn}
                            onChange={(e) => setSheetsEmailColumn(e.target.value)}
                            placeholder="email"
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                          />
                        </label>
                      </div>
                      <label className="text-sm text-slate-300">
                        Стартовая строка данных
                        <input
                          value={sheetsStartRow}
                          onChange={(e) => setSheetsStartRow(e.target.value)}
                          placeholder="2"
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
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

                  <div className="rounded-xl border border-slate-700/60 bg-slate-950/20 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Шаблоны сообщений
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Доступны переменные: {"{name}"}, {"{date}"}, {"{time}"}, {"{manager}"}
                    </p>
                    <div className="mt-2 grid gap-2">
                      <label className="text-sm text-slate-300">
                        Приветствие
                        <textarea
                          value={tplGreeting}
                          onChange={(e) => setTplGreeting(e.target.value)}
                          rows={2}
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                        />
                      </label>
                      <label className="text-sm text-slate-300">
                        Подтверждение записи
                        <textarea
                          value={tplConfirm}
                          onChange={(e) => setTplConfirm(e.target.value)}
                          rows={2}
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                        />
                      </label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-sm text-slate-300">
                          Напоминание за 24ч
                          <textarea
                            value={tplReminder24h}
                            onChange={(e) => setTplReminder24h(e.target.value)}
                            rows={2}
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                          />
                        </label>
                        <label className="text-sm text-slate-300">
                          Напоминание за 2ч
                          <textarea
                            value={tplReminder2h}
                            onChange={(e) => setTplReminder2h(e.target.value)}
                            rows={2}
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                          />
                        </label>
                      </div>
                      <label className="text-sm text-slate-300">
                        Реактивация
                        <textarea
                          value={tplReactivation}
                          onChange={(e) => setTplReactivation(e.target.value)}
                          rows={2}
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-white"
                        />
                      </label>
                    </div>
                  </div>

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
                  ) : integrationProvider === "google_sheets" ? (
                    <p className="text-[11px] text-slate-500">
                      После сохранения нажмите «Синхронизировать» в списке справа для первой загрузки, далее CRM будет
                      подтягивать новые строки автоматически.
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      Для Telegram скопируйте webhook URL из списка справа и укажите секрет в настройках бота.
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-700/50 bg-slate-950/40 p-4 lg:sticky lg:top-0 lg:self-start">
                <div className="text-sm font-semibold text-white">Список интеграций</div>
                <p className="mt-1 text-[11px] text-slate-500">Webhook и краткая информация</p>
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
                            WhatsApp: при сохранении MetodiOne автоматически настроила приём в Green API. Новые
                            сообщения клиентов появляются как лиды в выбранной воронке (и в разделе «Чат»). Первое
                            сообщение может задержаться до нескольких минут. После обновления в Green API откройте в
                            MetodiOne «Изменить» и снова нажмите «Сохранить», чтобы переподключить вебхук.
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
                        {it.provider === "google_sheets" && (
                          <div className="mt-2 space-y-2">
                            <div className="text-[11px] text-slate-300">
                              Таблица: {String((it.config as Record<string, unknown> | null)?.sheet_url ?? "не указана")}
                            </div>
                            <button
                              type="button"
                              onClick={() => void syncSheetsNow(it.id)}
                              className="rounded-lg border border-slate-600 px-2 py-1 text-[11px] text-slate-100 transition hover:bg-slate-800/50"
                            >
                              Синхронизировать сейчас
                            </button>
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
        </div>
      )}

      {crmView === "list" && pipelineId != null && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[200px] flex-1 text-sm text-slate-300">
              Поиск
              <input
                value={listSearchInput}
                onChange={(e) => setListSearchInput(e.target.value)}
                placeholder="Имя, телефон, email…"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
              />
            </label>
            <label className="text-sm text-slate-300">
              Стадия
              <select
                value={listStatusFilter === "" ? "" : String(listStatusFilter)}
                onChange={(e) => {
                  const v = e.target.value;
                  setListStatusFilter(v === "" ? "" : Number(v));
                }}
                className="mt-1 min-w-[180px] rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
              >
                <option value="">Все стадии</option>
                {sortedStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {leadsTableQuery.isError && (
            <p className="text-sm text-red-300">{(leadsTableQuery.error as Error).message}</p>
          )}
          {leadsTableQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
          {leadsTableQuery.data && !leadsTableQuery.isLoading && (
            <>
              <p className="text-sm text-slate-500">
                Найдено: {leadsTableQuery.data.total} · страница {leadsTableQuery.data.page} из {listTotalPages}
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-700/50 bg-slate-800/20">
                <table className="w-full min-w-[720px] text-left text-sm text-slate-200">
                  <thead>
                    <tr className="border-b border-slate-700/60 text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">ID</th>
                      <th className="px-3 py-2">Имя</th>
                      <th className="px-3 py-2">Телефон</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Стадия</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {leadsTableQuery.data.items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                          Нет лидов по условиям
                        </td>
                      </tr>
                    ) : (
                      leadsTableQuery.data.items.map((lead) => (
                        <tr key={lead.id} className="border-b border-slate-700/40 hover:bg-slate-800/40">
                          <td className="px-3 py-2 text-slate-400">{lead.id}</td>
                          <td className="px-3 py-2 font-medium text-white">{lead.name}</td>
                          <td className="px-3 py-2">{lead.phone ?? "—"}</td>
                          <td className="px-3 py-2">{lead.email ?? "—"}</td>
                          <td className="px-3 py-2 text-purple-200/90">{lead.stage_name ?? "—"}</td>
                          <td className="px-3 py-2">
                            <Link
                              to={`/leads/${lead.id}`}
                              className="text-indigo-300 underline-offset-2 hover:text-indigo-200 hover:underline"
                            >
                              Открыть
                            </Link>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {listTotalPages > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={listPage <= 1 || leadsTableQuery.isFetching}
                    onClick={() => setListPage((p) => Math.max(1, p - 1))}
                    className="rounded-full border border-slate-600 px-3 py-1 text-sm text-slate-200 disabled:opacity-40"
                  >
                    Назад
                  </button>
                  <span className="text-sm text-slate-400">
                    {listPage} / {listTotalPages}
                  </span>
                  <button
                    type="button"
                    disabled={listPage >= listTotalPages || leadsTableQuery.isFetching}
                    onClick={() => setListPage((p) => p + 1)}
                    className="rounded-full border border-slate-600 px-3 py-1 text-sm text-slate-200 disabled:opacity-40"
                  >
                    Вперёд
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {crmView === "board" && (stagesQuery.isLoading || leadsQuery.isLoading) && (
        <p className="text-sm text-slate-400">Загрузка…</p>
      )}
      {crmView === "board" && (stagesQuery.isError || leadsQuery.isError) && (
        <p className="text-sm text-red-300">
          {(stagesQuery.error as Error)?.message ?? (leadsQuery.error as Error)?.message}
        </p>
      )}

      {kanbanError && crmView === "board" && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
          {kanbanError}
        </p>
      )}

      {crmView === "board" && sortedStages.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div
            ref={boardContainerRef}
            onWheelCapture={onBoardWheelCapture}
            className="flex gap-4 overflow-x-auto pb-4"
          >
            {sortedStages.map((stage) => (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                leads={leadsByStage.get(stage.id) ?? []}
                currentRole={currentRole}
                onRefresh={refreshAll}
                registerScrollContainer={registerScrollContainer}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeLead ? <LeadCardDragOverlay lead={activeLead} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {crmView === "board" && sortedStages.length === 0 && !stagesQuery.isLoading && !stagesQuery.isError && (
        <p className="text-sm text-slate-500">Этапы воронки не загружены.</p>
      )}
    </div>
  );
}
