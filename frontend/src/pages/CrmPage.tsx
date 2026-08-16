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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";

import { CrmToolbar } from "@/components/crm/CrmToolbar";
import { PatientPhone } from "@/components/PatientPhone";
import { apiDownloadBlob, apiFetch, getStoredToken, resolveApiUrl } from "@/lib/api";
import { formatCompactCount } from "@/lib/money";
import { theme } from "@/lib/theme";
import { decodeRoleFromToken } from "@/lib/auth";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import { isOnboardingDone } from "@/lib/onboarding";
import type {
  Lead,
  LeadImportResponse,
  LeadSource,
  LeadStatusPatchResponse,
  LeadTablePage,
  Pipeline,
  PipelineStage,
  UserRole,
} from "@/lib/types";

function stageDroppableId(stageId: number) {
  return `stage-${stageId}`;
}

function leadDraggableId(leadId: number) {
  return `lead-${leadId}`;
}

/** Совпадает с бэкендом `default_pipeline_stages` (клиника). Sales — 6 чат-стадий. */
const DEFAULT_CLINIC_PIPELINE_STAGES: Array<{ name: string; color: string }> = [
  { name: "Новый", color: "#64748b" },
  { name: "Квалифицирован", color: "#6366f1" },
  { name: "Запись", color: "#8b5cf6" },
  { name: "У эксперта", color: "#0ea5e9" },
  { name: "Оказание услуги", color: "#14b8a6" },
  { name: "Доп. услуги", color: "#f59e0b" },
  { name: "Оплачено", color: "#22c55e" },
  { name: "Успешно реализован", color: "#16a34a" },
  { name: "Потерян", color: "#ef4444" },
];

const DEFAULT_SALES_PIPELINE_STAGES: Array<{ name: string; color: string }> = [
  { name: "Новый лид", color: "#64748b" },
  { name: "В обработке", color: "#0ea5e9" },
  { name: "В ожидании", color: "#f59e0b" },
  { name: "Удачно", color: "#22c55e" },
  { name: "Отказ", color: "#ef4444" },
  { name: "Архив", color: "#78716c" },
];

const DEFAULT_AUTO_PIPELINE_STAGES = DEFAULT_CLINIC_PIPELINE_STAGES;

function cloneDefaultStages(sales = false) {
  const src = sales ? DEFAULT_SALES_PIPELINE_STAGES : DEFAULT_CLINIC_PIPELINE_STAGES;
  return src.map((s) => ({ name: s.name, color: s.color }));
}

/** Возраст лида в днях (для подписи на карточке). */
function leadAgeLabel(createdAt?: string | null): string {
  if (!createdAt) return "—";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "—";
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
  if (days === 0) return "сегодня";
  const mod10 = days % 10;
  const mod100 = days % 100;
  let word = "дней";
  if (mod10 === 1 && mod100 !== 11) word = "день";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) word = "дня";
  return `${days} ${word}`;
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

function LeadCardBody({ lead, stageColor }: { lead: Lead; stageColor?: string }) {
  const paidNum =
    lead.paid_extras_amount == null ? 0 : typeof lead.paid_extras_amount === "number" ? lead.paid_extras_amount : Number(lead.paid_extras_amount);
  const dotColor = stageColor ?? "#6366f1";

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-[15px] font-semibold leading-snug text-[var(--mo-text)]">{lead.name}</p>
        {lead.source ? (
          <span className="crm-lead-source shrink-0" title="Источник">
            {lead.source}
          </span>
        ) : null}
      </div>
      {lead.manager_name ? (
        <p className="mt-1 truncate text-xs text-[var(--mo-text-muted)]">{lead.manager_name}</p>
      ) : (
        <p className="mt-1 text-xs italic text-[var(--mo-text-muted)]">Без ответственного</p>
      )}
      <p className="mt-2 break-all text-sm font-medium text-[var(--mo-text)]">
        <PatientPhone value={lead} />
      </p>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--mo-border)] pt-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="crm-stage-gem shrink-0" style={{ backgroundColor: dotColor }} />
          <span className="truncate text-xs font-semibold text-[var(--mo-text-muted)]">{leadAgeLabel(lead.created_at)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {lead.protocol_file_attached && <span className="crm-lead-badge" title="Протокол">📄</span>}
          {paidNum > 0 && <span className="crm-lead-badge" title="Оплата">💰</span>}
          {lead.refusal_reason && <span className="crm-lead-badge" title="Отказ">✕</span>}
        </div>
      </div>
    </>
  );
}

function LeadCard({
  lead,
  stageColor,
  currentRole,
  onRefresh,
}: {
  lead: Lead;
  stageColor?: string;
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
      className={["crm-lead-card min-w-0 max-w-full", isDragging ? "is-dragging" : ""].join(" ")}
    >
      <div className="crm-lead-card-accent" aria-hidden />
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => navigate(`/leads/${lead.id}`)}
        className="relative z-[1] mb-2 text-[11px] font-semibold text-[var(--mo-accent-hover)] underline-offset-2 hover:text-[var(--mo-accent)] hover:underline"
      >
        Открыть карточку
      </button>
      <LeadCardBody lead={lead} stageColor={stageColor} />

      {currentRole === "owner" && stage === "Запись" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleArrival()}
            className={`${theme.btnPrimary} py-2`}
          >
            Явка
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleNoShow()}
            className={`${theme.btnSecondary} py-2`}
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
              className={`${theme.btnPrimary} py-2`}
            >
              Услуга оказана
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void handleServiceReject()}
              className={`${theme.btnDanger} py-2`}
            >
              Нет
            </button>
          </div>
        )}

      {(currentRole === "manager" || currentRole === "admin") && stage === "Доп. услуги" && (
        <div className="mt-3 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-3">
          <div className="text-xs font-semibold uppercase tracking-wider mo-muted">
            Продуктовая корзина
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[11px] lux-caption">
              Тип
              <select
                value={managerExtraType}
                onChange={(e) => setManagerExtraType(e.target.value as "Протокол" | "Прочее")}
                className="mo-input mt-1 w-full text-sm"
              >
                <option value="Протокол">Протокол</option>
                <option value="Прочее">Прочее</option>
              </select>
            </label>
            <label className="text-[11px] lux-caption">
              Оплачено (TJS)
              <input
                type="number"
                value={managerPaidAmount}
                min={0}
                onChange={(e) => setManagerPaidAmount(Number(e.target.value))}
                className="mo-input mt-1 w-full text-sm"
              />
            </label>
            <label className="col-span-2 text-[11px] lux-caption">
              Сумма (TJS)
              <input
                type="number"
                value={managerAmount}
                min={0}
                onChange={(e) => setManagerAmount(Number(e.target.value))}
                className="mo-input mt-1 w-full text-sm"
              />
            </label>
          </div>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void handleAddExtraService()}
            className={`${theme.btnPrimary} mt-3 w-full py-2`}
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
            className="btn-primary w-full"
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
        <div className="mt-3 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-3 shadow-inner">
          <div className="text-xs font-semibold uppercase tracking-wider mo-muted">
            Загрузите протокол
          </div>
          <input
            type="file"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setProtocolFile(f);
            }}
            className="mt-2 w-full text-sm mo-muted"
          />
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!protocolFile || protocolUploading}
            onClick={() => void handleProtocolFinish()}
            className={[
              "mt-3 w-full rounded-xl py-2 text-sm font-semibold transition",
              protocolUploading || !protocolFile
                ? "cursor-not-allowed bg-slate-700/40 lux-caption"
                : "btn-primary",
            ].join(" ")}
          >
            Завершить
          </button>
        </div>
      )}
    </div>
  );
}

function LeadCardDragOverlay({ lead, stageColor }: { lead: Lead; stageColor?: string }) {
  return (
    <div className="crm-lead-card-overlay">
      <div className="crm-lead-card-accent" aria-hidden />
      <LeadCardBody lead={lead} stageColor={stageColor} />
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
  const INITIAL = 4;
  const LOAD_MORE = 8;
  const [visibleCount, setVisibleCount] = useState(INITIAL);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { setNodeRef, isOver } = useDroppable({
    id: stageDroppableId(stage.id),
    data: { stageId: stage.id },
  });

  useEffect(() => {
    setVisibleCount(INITIAL);
  }, [stage.id, leads.length]);

  const visibleLeads = leads.slice(0, visibleCount);
  const hasMore = visibleCount < leads.length;
  const stageLabel = stage.name.trim() === "В обработке" ? "В работе" : stage.name;

  useEffect(() => {
    const root = bodyRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setVisibleCount((n) => Math.min(n + LOAD_MORE, leads.length));
      },
      { root, rootMargin: "120px 0px", threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, leads.length, visibleCount, stage.id]);

  return (
    <div
      ref={setNodeRef}
      data-kanban-column="true"
      data-stage-id={stage.id}
      className={["crm-kanban-col", isOver ? "is-drop-target" : ""].join(" ")}
    >
      <div className="crm-kanban-col-header">
        <span className="crm-stage-gem shrink-0" style={{ backgroundColor: stage.color }} />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-wide text-[var(--mo-text)]">
          {stageLabel}
        </h3>
        <span
          className="rounded-md border border-[var(--mo-border)] bg-[var(--mo-accent-soft)] px-2.5 py-0.5 text-xs font-bold tabular-nums text-[var(--mo-accent-hover)]"
          title={String(leads.length)}
        >
          {formatCompactCount(leads.length)}
        </span>
      </div>
      <div
        ref={(el) => {
          bodyRef.current = el;
          registerScrollContainer(stage.id, el);
        }}
        data-kanban-scroll="true"
        className="crm-kanban-col-body"
      >
        {leads.length === 0 ? (
          <p className="flex flex-1 items-center justify-center px-2 py-8 text-center text-sm mo-muted">
            Нет лидов
          </p>
        ) : (
          <>
            {visibleLeads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                stageColor={stage.color}
                currentRole={currentRole}
                onRefresh={onRefresh}
              />
            ))}
            {hasMore ? (
              <div
                ref={sentinelRef}
                className="flex shrink-0 items-center justify-center py-2 text-[10px] mo-muted"
                aria-hidden
              >
                …
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function CrmPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const currentRole = useMemo(() => decodeRoleFromToken(getStoredToken()), []);
  const meQuery = useCurrentUserMe();
  const chatStages = meQuery.data?.chat_stages_enabled !== false;
  const isCompanyAdmin =
    currentRole === "owner" ||
    currentRole === "admin" ||
    (currentRole === "expert" && Boolean(meQuery.data?.is_chief_expert));

  useEffect(() => {
    if (!chatStages) return;
    if (currentRole === "manager" || currentRole === "admin") {
      navigate("/chat", { replace: true });
    }
  }, [chatStages, currentRole, navigate]);

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["leads"] });
    void queryClient.invalidateQueries({ queryKey: ["leads-table"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["analytics"] });
  }, [queryClient]);

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<Pipeline[]>("/api/pipelines"),
  });

  const sourcesQuery = useQuery({
    queryKey: ["lead-sources"],
    queryFn: () => apiFetch<LeadSource[]>("/api/sources"),
  });

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
  const [newStageAutoMode, setNewStageAutoMode] = useState<"off" | "task">("off");
  const [newStageTaskTitle, setNewStageTaskTitle] = useState("");
  const [stageEditorId, setStageEditorId] = useState<number | null>(null);
  const [pipeName, setPipeName] = useState("");
  const [pipeType, setPipeType] = useState("sales");
  const [pipeExpertUserId, setPipeExpertUserId] = useState<number | "">("");
  const [useCustomPipelineStages, setUseCustomPipelineStages] = useState(false);
  const [pipeStages, setPipeStages] = useState<Array<{ name: string; color: string }>>(() =>
    cloneDefaultStages(false),
  );

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
      setPipeStages(cloneDefaultStages(true));
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
          on_enter_create_task: newStageAutoMode === "task",
          on_enter_task_title: newStageTaskTitle.trim() || null,
        }),
      });
      toast.success("Стадия создана");
      setCreateStageOpen(false);
      setNewStageName("");
      setNewStageColor("#6366f1");
      setNewStageAutoMode("off");
      setNewStageTaskTitle("");
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
  const [boardSearchInput, setBoardSearchInput] = useState("");
  const [boardSearchDebounced, setBoardSearchDebounced] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setListSearchDebounced(listSearchInput.trim()), 400);
    return () => window.clearTimeout(t);
  }, [listSearchInput]);

  useEffect(() => {
    const t = window.setTimeout(() => setBoardSearchDebounced(boardSearchInput.trim()), 250);
    return () => window.clearTimeout(t);
  }, [boardSearchInput]);

  useEffect(() => {
    setListPage(1);
  }, [pipelineId, listSearchDebounced, listStatusFilter]);

  useEffect(() => {
    setBoardSearchInput("");
  }, [pipelineId]);

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

  const patchStageMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
      apiFetch<PipelineStage>(`/api/stages/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderStagesMutation = useMutation({
    mutationFn: async ({ pipeline_id, stage_ids }: { pipeline_id: number; stage_ids: number[] }) =>
      apiFetch<PipelineStage[]>("/api/stages/reorder", {
        method: "POST",
        body: JSON.stringify({ pipeline_id, stage_ids }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stages"] });
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

  type ClosePipelinePreview = {
    pipeline_id: number;
    pipeline_name: string;
    leads_count: number;
    stages_count: number;
    integrations_count: number;
    employees_to_terminate: Array<{ id: number; full_name: string | null; email: string; role: string }>;
    employees_to_unassign: Array<{ id: number; full_name: string | null; email: string; role: string }>;
  };

  const [closePipelineOpen, setClosePipelineOpen] = useState(false);
  const [closeConfirmName, setCloseConfirmName] = useState("");
  const [closePreview, setClosePreview] = useState<ClosePipelinePreview | null>(null);
  const [closePreviewLoading, setClosePreviewLoading] = useState(false);
  const [closePending, setClosePending] = useState(false);

  const selectedPipelineForSettings = useMemo(
    () => (pipelineId != null ? pipelinesQuery.data?.find((p) => p.id === pipelineId) : undefined),
    [pipelinesQuery.data, pipelineId],
  );

  async function openClosePipelineModal() {
    if (pipelineId == null || !selectedPipelineForSettings) return;
    setClosePipelineOpen(true);
    setCloseConfirmName("");
    setClosePreview(null);
    setClosePreviewLoading(true);
    try {
      const preview = await apiFetch<ClosePipelinePreview>(`/api/pipelines/${pipelineId}/close-preview`);
      setClosePreview(preview);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить сводку");
      setClosePipelineOpen(false);
    } finally {
      setClosePreviewLoading(false);
    }
  }

  async function submitClosePipeline() {
    if (pipelineId == null || !selectedPipelineForSettings) return;
    const name = selectedPipelineForSettings.name;
    if (closeConfirmName.trim() !== name.trim()) {
      toast.error("Введите точное название воронки для подтверждения");
      return;
    }
    setClosePending(true);
    try {
      await apiDownloadBlob(`/api/pipelines/${pipelineId}/close`, `voronka_${pipelineId}_leads.csv`, {
        method: "POST",
        body: JSON.stringify({ confirm_name: closeConfirmName.trim() }),
        timeoutMs: 180_000,
      });
      toast.success(
        `Воронка «${name}» закрыта. CSV с контактами скачан` +
          (closePreview
            ? ` (${closePreview.leads_count} лидов, уволено ${closePreview.employees_to_terminate.length})`
            : ""),
      );
      setClosePipelineOpen(false);
      setPipelineId(null);
      void queryClient.invalidateQueries({ queryKey: ["pipelines"] });
      void queryClient.invalidateQueries({ queryKey: ["stages"] });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["leads-table"] });
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
      void queryClient.invalidateQueries({ queryKey: ["booking-specialists"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось закрыть воронку");
    } finally {
      setClosePending(false);
    }
  }

  const [outboundPhonesDraft, setOutboundPhonesDraft] = useState("");

  useEffect(() => {
    const phones = selectedPipelineForSettings?.manager_allowed_outbound_phones ?? [];
    setOutboundPhonesDraft(phones.join("\n"));
  }, [selectedPipelineForSettings?.id, selectedPipelineForSettings?.manager_allowed_outbound_phones]);

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
  const [pipelineSettingsOpen, setPipelineSettingsOpen] = useState(false);
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

  const kanbanPerStage = 5000;
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

  function moveStage(stageId: number, direction: -1 | 1) {
    if (!pipelineId) return;
    const ids = sortedStages.map((s) => s.id);
    const idx = ids.indexOf(stageId);
    const next = idx + direction;
    if (idx < 0 || next < 0 || next >= ids.length) return;
    const reordered = [...ids];
    const tmp = reordered[idx]!;
    reordered[idx] = reordered[next]!;
    reordered[next] = tmp;
    reorderStagesMutation.mutate({ pipeline_id: pipelineId, stage_ids: reordered });
  }

  function stageAutoMode(s: PipelineStage): "legacy" | "off" | "task" {
    if (s.on_enter_create_task === true) return "task";
    if (s.on_enter_create_task === false) return "off";
    return "legacy";
  }

  const leadsForBoard = useMemo(() => {
    const q = boardSearchDebounced.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) => {
      const idStr = String(l.id);
      const hay = [l.name, l.phone ?? "", l.email ?? "", idStr].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [leads, boardSearchDebounced]);

  const leadsByStage = useMemo(() => {
    const map = new Map<number, Lead[]>();
    for (const s of sortedStages) map.set(s.id, []);
    for (const lead of leadsForBoard) {
      const bucket = map.get(lead.status_id);
      if (bucket) bucket.push(lead);
    }
    return map;
  }, [leadsForBoard, sortedStages]);

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
    if (event.deltaY === 0 && event.deltaX === 0) return;
    const boardEl = boardContainerRef.current;
    if (!boardEl) return;

    const pointEl = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    let scroller = pointEl?.closest?.("[data-kanban-scroll='true']") as HTMLDivElement | null;
    if ((!scroller || !boardEl.contains(scroller)) && pointEl) {
      const columnEl = pointEl.closest("[data-kanban-column='true']") as HTMLElement | null;
      const stageIdRaw = columnEl?.getAttribute("data-stage-id");
      const stageId = stageIdRaw ? Number(stageIdRaw) : Number.NaN;
      if (!Number.isNaN(stageId)) {
        scroller = stageScrollRefs.current.get(stageId) ?? null;
      }
    }
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

    // На тачпадах вертикальный жест может приходить как deltaX, поэтому берём доминирующую ось
    // и всегда направляем её в вертикальный скролл колонки.
    const dominantDelta =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    scroller.scrollTop += dominantDelta;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const activeLeadStageColor = useMemo(() => {
    if (!activeLead) return undefined;
    return sortedStages.find((s) => s.id === activeLead.status_id)?.color;
  }, [activeLead, sortedStages]);

  return (
    <div className="crm-page">
      <CrmToolbar
        isCompanyAdmin={isCompanyAdmin}
        pipelineSettingsOpen={pipelineSettingsOpen}
        onTogglePipelineSettings={() => setPipelineSettingsOpen((v) => !v)}
        onCreateLead={() => setCreateLeadOpen(true)}
        onImport={() => setImportOpen(true)}
        pipelines={pipelinesQuery.data}
        pipelineId={pipelineId}
        onSelectPipeline={setPipelineId}
        crmView={crmView}
        onSetView={setCrmView}
        boardSearchInput={boardSearchInput}
        onBoardSearchChange={setBoardSearchInput}
        showBoardSearch={crmView === "board" && sortedStages.length > 0}
        showOnboardingBanner={currentRole === "owner" && !isOnboardingDone()}
      />

      {isCompanyAdmin && pipelineSettingsOpen ? (
        <div className="mo-section space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setUseCustomPipelineStages(false);
                  setPipeStages(cloneDefaultStages(true));
                  setCreatePipelineOpen(true);
                }}
                className="crm-pill-btn"
              >
                + Создать воронку
              </button>
              <button type="button" onClick={() => setCreateStageOpen(true)} className="crm-pill-btn">
                + Стадия в воронку
              </button>
            </div>
            {pipelineId != null && selectedPipelineForSettings && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-sm mo-muted">Распределение новых лидов:</span>
                <select
                  id="crm-pipeline-lead-assignment"
                  name="lead_assignment_mode"
                  value={selectedPipelineForSettings.lead_assignment_mode ?? "none"}
                  onChange={(e) => {
                    patchPipelineMutation.mutate({ id: pipelineId, patch: { lead_assignment_mode: e.target.value } });
                  }}
                  disabled={patchPipelineMutation.isPending}
                  className="mo-input max-w-xs py-1.5 text-sm"
                >
                  <option value="none">Без автораспределения</option>
                  <option value="round_robin">По очереди (равномерно)</option>
                  <option value="least_loaded">По минимальной загрузке</option>
                </select>
              </div>
            )}
            {pipelineId != null && selectedPipelineForSettings && (
              <div className="mt-2 flex flex-wrap flex-col gap-2 sm:flex-row sm:items-center">
                <span className="text-sm mo-muted">Менеджер приёма:</span>
                <select
                  id="crm-pipeline-intake-manager"
                  name="intake_manager_user_id"
                  value={selectedPipelineForSettings.intake_manager_user_id ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    patchPipelineMutation.mutate({
                      id: pipelineId,
                      patch: { intake_manager_user_id: v ? Number(v) : null },
                    });
                  }}
                  disabled={patchPipelineMutation.isPending}
                  className="mo-input min-w-[240px] py-1.5 text-sm"
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
              </div>
            )}
            {pipelineId != null && selectedPipelineForSettings && (
              <div className="mt-3 w-full max-w-xl space-y-2">
                <label className="block text-sm mo-muted" htmlFor="crm-pipeline-outbound-phones">
                  Номера для отправки менеджерами в чате
                </label>
                <p className="text-xs mo-muted">
                  По одному номеру в строке. Менеджеры смогут отправлять только эти номера (клиника, колл-центр и т.д.).
                  Формат может отличаться: +992, без кода страны — система сопоставит варианты одного номера.
                </p>
                <textarea
                  id="crm-pipeline-outbound-phones"
                  value={outboundPhonesDraft}
                  onChange={(e) => setOutboundPhonesDraft(e.target.value)}
                  rows={4}
                  placeholder={"+992901234567\n901234567"}
                  className="w-full mo-input font-mono text-sm"
                />
                <button
                  type="button"
                  disabled={patchPipelineMutation.isPending}
                  onClick={() => {
                    const phones = outboundPhonesDraft
                      .split(/[\n,;]+/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    patchPipelineMutation.mutate(
                      {
                        id: pipelineId,
                        patch: { manager_allowed_outbound_phones: phones },
                      },
                      { onSuccess: () => toast.success("Разрешённые номера сохранены") },
                    );
                  }}
                  className="crm-pill-btn"
                >
                  Сохранить номера
                </button>
              </div>
            )}
            {pipelineId != null && selectedPipelineForSettings && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-sm mo-muted">Эксперт этой воронки:</span>
                <select
                  id="crm-pipeline-expert"
                  name="expert_user_id"
                  value={selectedPipelineForSettings.expert_user_id ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    patchPipelineExpertMutation.mutate({
                      id: pipelineId,
                      expert_user_id: v ? Number(v) : null,
                    });
                  }}
                  disabled={patchPipelineExpertMutation.isPending}
                  className="mo-input max-w-xs py-1.5 text-sm"
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
            {pipelineId != null && sortedStages.length > 0 && (
              <div className="mt-3 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-4">
                <div className="text-sm font-semibold text-[var(--mo-text)]">Стадии этой воронки</div>
                <p className="mt-1 text-xs mo-muted">
                  Переименуйте, поменяйте порядок и настройте задачу при входе лида в стадию.
                  Режим «Авто» — прежнее правило по имени («Оплачено», успешная сделка, последний этап).
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDistributeOpen(true);
                      if (sortedStages.length > 0) setDistributeStageId(sortedStages[0].id);
                    }}
                    className="crm-pill-btn"
                  >
                    Распределить лиды
                  </button>
                </div>
                <ul className="mt-2 divide-y divide-[var(--mo-border)]">
                  {sortedStages.map((s, idx) => {
                    const open = stageEditorId === s.id;
                    const mode = stageAutoMode(s);
                    return (
                      <li key={s.id} className="py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 shrink-0 rounded-full border border-[var(--mo-border)]"
                            style={{ background: s.color }}
                            aria-hidden
                          />
                          <input
                            value={s.name}
                            onChange={(e) => {
                              const name = e.target.value;
                              queryClient.setQueryData<PipelineStage[]>(["stages", pipelineId], (prev) =>
                                (prev ?? []).map((x) => (x.id === s.id ? { ...x, name } : x)),
                              );
                            }}
                            onBlur={(e) => {
                              const name = e.target.value.trim();
                              if (!name) {
                                void queryClient.invalidateQueries({ queryKey: ["stages", pipelineId] });
                                return;
                              }
                              patchStageMutation.mutate({ id: s.id, patch: { name } });
                            }}
                            className="mo-input min-w-[8rem] flex-1 py-1 text-sm"
                            aria-label="Название стадии"
                          />
                          <input
                            type="color"
                            value={s.color}
                            onChange={(e) => {
                              const color = e.target.value;
                              queryClient.setQueryData<PipelineStage[]>(["stages", pipelineId], (prev) =>
                                (prev ?? []).map((x) => (x.id === s.id ? { ...x, color } : x)),
                              );
                              patchStageMutation.mutate({ id: s.id, patch: { color } });
                            }}
                            className="h-8 w-10 rounded border border-[var(--mo-border)] bg-transparent"
                            aria-label="Цвет стадии"
                          />
                          <button
                            type="button"
                            disabled={idx === 0 || reorderStagesMutation.isPending}
                            onClick={() => moveStage(s.id, -1)}
                            className="rounded border border-[var(--mo-border)] px-2 py-1 text-xs disabled:opacity-40"
                            title="Выше"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={idx === sortedStages.length - 1 || reorderStagesMutation.isPending}
                            onClick={() => moveStage(s.id, 1)}
                            className="rounded border border-[var(--mo-border)] px-2 py-1 text-xs disabled:opacity-40"
                            title="Ниже"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => setStageEditorId(open ? null : s.id)}
                            className="rounded border border-[var(--mo-border)] px-2 py-1 text-xs"
                          >
                            {mode === "task" ? "Задача" : mode === "off" ? "Авто выкл" : "Авто"} ·{" "}
                            {open ? "Скрыть" : "Правило"}
                          </button>
                          <button
                            type="button"
                            disabled={deleteStageMutation.isPending}
                            onClick={() => {
                              if (!window.confirm(`Удалить стадию «${s.name}»?`)) return;
                              deleteStageMutation.mutate(s.id);
                            }}
                            className={`${theme.btnDanger} px-2 py-1 text-xs disabled:opacity-50`}
                          >
                            Удалить
                          </button>
                        </div>
                        {open && (
                          <div className="mt-2 grid gap-2 rounded-lg border border-[var(--mo-border)] bg-[var(--mo-surface)] p-3">
                            <label className="text-xs mo-muted">
                              При входе лида в стадию
                              <select
                                value={mode}
                                onChange={(e) => {
                                  const v = e.target.value as "legacy" | "off" | "task";
                                  const on_enter_create_task =
                                    v === "task" ? true : v === "off" ? false : null;
                                  queryClient.setQueryData<PipelineStage[]>(["stages", pipelineId], (prev) =>
                                    (prev ?? []).map((x) =>
                                      x.id === s.id ? { ...x, on_enter_create_task } : x,
                                    ),
                                  );
                                  patchStageMutation.mutate({
                                    id: s.id,
                                    patch: { on_enter_create_task },
                                  });
                                }}
                                className="mo-input mt-1 w-full py-1.5 text-sm"
                              >
                                <option value="legacy">Авто (по имени / последний этап)</option>
                                <option value="task">Создать задачу менеджеру</option>
                                <option value="off">Выключить</option>
                              </select>
                            </label>
                            {mode === "task" && (
                              <>
                                <label className="text-xs mo-muted">
                                  Заголовок задачи
                                  <input
                                    defaultValue={s.on_enter_task_title ?? ""}
                                    placeholder="Подключить услуги и проверить оплату"
                                    onBlur={(e) => {
                                      const title = e.target.value.trim() || null;
                                      if (title === (s.on_enter_task_title || null)) return;
                                      patchStageMutation.mutate({
                                        id: s.id,
                                        patch: { on_enter_task_title: title },
                                      });
                                    }}
                                    className="mo-input mt-1 w-full py-1.5 text-sm"
                                  />
                                </label>
                                <label className="text-xs mo-muted">
                                  Описание
                                  <textarea
                                    defaultValue={s.on_enter_task_description ?? ""}
                                    rows={2}
                                    onBlur={(e) => {
                                      const description = e.target.value.trim() || null;
                                      if (description === (s.on_enter_task_description || null)) return;
                                      patchStageMutation.mutate({
                                        id: s.id,
                                        patch: { on_enter_task_description: description },
                                      });
                                    }}
                                    className="mo-input mt-1 w-full py-1.5 text-sm"
                                  />
                                </label>
                                <label className="text-xs mo-muted">
                                  Дедлайн, часов
                                  <input
                                    type="number"
                                    min={1}
                                    max={720}
                                    defaultValue={s.on_enter_task_deadline_hours ?? 24}
                                    onBlur={(e) => {
                                      const n = Number(e.target.value);
                                      const hours = Number.isFinite(n) ? Math.min(720, Math.max(1, Math.round(n))) : 24;
                                      if (hours === (s.on_enter_task_deadline_hours ?? 24)) return;
                                      patchStageMutation.mutate({
                                        id: s.id,
                                        patch: { on_enter_task_deadline_hours: hours },
                                      });
                                    }}
                                    className="mo-input mt-1 w-28 py-1.5 text-sm"
                                  />
                                </label>
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {pipelinesQuery.data && pipelinesQuery.data.length > 1 && selectedPipelineForSettings && (
                  <div className="mt-4 space-y-3 border-t border-[var(--mo-border)] pt-3">
                    <div>
                      <button
                        type="button"
                        disabled={closePending || closePreviewLoading}
                        onClick={() => void openClosePipelineModal()}
                        className={`${theme.btnDanger} disabled:opacity-50`}
                      >
                        Закрыть воронку
                      </button>
                      <p className="mt-2 text-xs mo-muted">
                        Скачается CSV со всеми контактами (ФИО, телефоны…), затем воронка и связанные данные
                        удалятся. Сотрудники только этой воронки будут уволены.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={deletePipelineMutation.isPending}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Удалить пустую воронку «${selectedPipelineForSettings.name}»? Если есть лиды — используйте «Закрыть воронку».`,
                          )
                        )
                          return;
                        deletePipelineMutation.mutate(pipelineId);
                      }}
                      className="text-xs mo-muted underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      Удалить только пустую воронку
                    </button>
                  </div>
                )}
              </div>
            )}
        </div>
      ) : null}

      {closePipelineOpen && selectedPipelineForSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl crm-modal-panel border p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="lux-subheading">Закрыть воронку</h2>
                <p className="mt-1 text-sm mo-muted">«{selectedPipelineForSettings.name}»</p>
              </div>
              <button
                type="button"
                disabled={closePending}
                onClick={() => setClosePipelineOpen(false)}
                className="rounded-full border border-[var(--mo-border)] px-3 py-1 text-sm mo-muted hover:bg-[var(--mo-accent-soft)] disabled:opacity-50"
              >
                Отмена
              </button>
            </div>

            {closePreviewLoading ? (
              <p className="mt-4 text-sm mo-muted">Считаем лиды и сотрудников…</p>
            ) : closePreview ? (
              <div className="mt-4 space-y-3 text-sm text-[var(--mo-text)]">
                <ul className="list-disc space-y-1 pl-5 mo-muted">
                  <li>
                    Лидов в CSV: <strong className="text-[var(--mo-text)]">{closePreview.leads_count}</strong>
                  </li>
                  <li>Стадий: {closePreview.stages_count}</li>
                  <li>Интеграций будет удалено: {closePreview.integrations_count}</li>
                  <li>
                    Уволить (только эта воронка): {closePreview.employees_to_terminate.length}
                    {closePreview.employees_to_terminate.length > 0
                      ? ` — ${closePreview.employees_to_terminate
                          .map((e) => e.full_name || e.email)
                          .slice(0, 5)
                          .join(", ")}${closePreview.employees_to_terminate.length > 5 ? "…" : ""}`
                      : ""}
                  </li>
                  <li>
                    Снять с воронки (есть другие): {closePreview.employees_to_unassign.length}
                  </li>
                </ul>
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
                  Действие необратимо. Сначала скачается файл контактов, затем воронка и всё связанное
                  удалится из CRM.
                </p>
                <label className="block text-sm mo-muted">
                  Введите название воронки для подтверждения
                  <input
                    value={closeConfirmName}
                    onChange={(e) => setCloseConfirmName(e.target.value)}
                    placeholder={selectedPipelineForSettings.name}
                    className="mt-1 w-full mo-input"
                    disabled={closePending}
                    autoComplete="off"
                  />
                </label>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={closePending || pipelineId == null}
                onClick={() => {
                  if (pipelineId == null) return;
                  void apiDownloadBlob(
                    `/api/pipelines/${pipelineId}/export-leads`,
                    `voronka_${pipelineId}_leads.csv`,
                  )
                    .then(() => toast.success("CSV скачан (воронка не удалена)"))
                    .catch((e: Error) => toast.error(e.message));
                }}
                className="btn-secondary disabled:opacity-50"
              >
                Только скачать CSV
              </button>
              <button
                type="button"
                disabled={
                  closePending ||
                  closePreviewLoading ||
                  !closePreview ||
                  closeConfirmName.trim() !== selectedPipelineForSettings.name.trim()
                }
                onClick={() => void submitClosePipeline()}
                className={`${theme.btnDanger} disabled:opacity-50`}
              >
                {closePending ? "Закрываем…" : "Скачать CSV и закрыть"}
              </button>
            </div>
          </div>
        </div>
      )}

      {createPipelineOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl crm-modal-panel border p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="lux-subheading">Создать воронку</h2>
              <button
                type="button"
                onClick={() => setCreatePipelineOpen(false)}
                className="rounded-full border border-[var(--mo-border)] px-3 py-1 text-sm mo-muted hover:bg-[var(--mo-accent-soft)]"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-sm mo-muted">
                Название
                <input
                  value={pipeName}
                  onChange={(e) => setPipeName(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="text-sm mo-muted">
                Тип (необязательно)
                <input
                  value={pipeType}
                  onChange={(e) => setPipeType(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              {currentRole === "owner" && (
                <label className="text-sm mo-muted">
                  Эксперт этой воронки
                  <select
                    value={pipeExpertUserId === "" ? "" : String(pipeExpertUserId)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPipeExpertUserId(v ? Number(v) : "");
                    }}
                    className="mo-input mt-1 w-full"
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

              <div className="mt-2 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-3">
                <label className="flex cursor-pointer items-start gap-2 text-sm text-[var(--mo-text)]">
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-[var(--mo-border-strong)]"
                    checked={useCustomPipelineStages}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setUseCustomPipelineStages(on);
                      if (on) setPipeStages(cloneDefaultStages(chatStages));
                    }}
                  />
                  <span>
                    <span className="font-medium">Задать стадии вручную</span>
                    <span className="mt-1 block text-xs font-normal mo-muted">
                      По умолчанию сервер создаёт стандартный набор из{" "}
                      {(chatStages ? DEFAULT_SALES_PIPELINE_STAGES : DEFAULT_CLINIC_PIPELINE_STAGES).length}{" "}
                      стадий
                      {chatStages ? " (чат-воронка)." : " (совместим с онлайн-записью)."}
                    </span>
                  </span>
                </label>
                {!useCustomPipelineStages && (
                  <p className="mt-2 text-xs leading-relaxed lux-caption">
                    {(chatStages ? DEFAULT_SALES_PIPELINE_STAGES : DEFAULT_CLINIC_PIPELINE_STAGES)
                      .map((s) => s.name)
                      .join(" → ")}
                  </p>
                )}
              </div>

              {useCustomPipelineStages && (
                <div className="mt-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-[var(--mo-text)]">Стадии</div>
                    <button
                      type="button"
                      onClick={() =>
                        setPipeStages((prev) => [...prev, { name: "", color: "#6366f1" }])
                      }
                      className="rounded-full border border-[var(--mo-border)] px-3 py-1 text-sm text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]"
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
                          className="flex-1 mo-input"
                        />
                        <input
                          type="color"
                          value={st.color}
                          onChange={(e) =>
                            setPipeStages((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, color: e.target.value } : p)),
                            )
                          }
                          className="h-10 w-12 rounded-lg border border-[var(--mo-border)] bg-[var(--mo-surface)]"
                        />
                        <button
                          type="button"
                          disabled={pipeStages.length <= 1}
                          onClick={() => setPipeStages((prev) => prev.filter((_, i) => i !== idx))}
                          className="rounded-xl border border-[var(--mo-border)] px-3 py-2 text-sm mo-muted hover:bg-[var(--mo-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
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
                className="mt-2 w-full btn-primary w-full"
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      {createStageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl crm-modal-panel border p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="lux-subheading">Создать стадию</h2>
              <button
                type="button"
                onClick={() => setCreateStageOpen(false)}
                className="rounded-full border border-[var(--mo-border)] px-3 py-1 text-sm mo-muted hover:bg-[var(--mo-accent-soft)]"
              >
                Закрыть
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <label className="text-sm mo-muted">
                Воронка
                <select
                  value={pipelineId ?? ""}
                  onChange={(e) => setPipelineId(Number(e.target.value))}
                  className="mo-input mt-1 w-full"
                >
                  {(pipelinesQuery.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm mo-muted">
                Название стадии
                <input
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="text-sm mo-muted">
                Цвет
                <input
                  type="color"
                  value={newStageColor}
                  onChange={(e) => setNewStageColor(e.target.value)}
                  className="mt-1 h-10 w-16 rounded-lg border border-[var(--mo-border)] bg-[var(--mo-surface)]"
                />
              </label>
              <label className="text-sm mo-muted">
                При входе лида
                <select
                  value={newStageAutoMode}
                  onChange={(e) => setNewStageAutoMode(e.target.value as "off" | "task")}
                  className="mo-input mt-1 w-full"
                >
                  <option value="off">Без автоматизации</option>
                  <option value="task">Создать задачу менеджеру</option>
                </select>
              </label>
              {newStageAutoMode === "task" && (
                <label className="text-sm mo-muted">
                  Заголовок задачи
                  <input
                    value={newStageTaskTitle}
                    onChange={(e) => setNewStageTaskTitle(e.target.value)}
                    placeholder="Подключить услуги и проверить оплату"
                    className="mo-input mt-1 w-full"
                  />
                </label>
              )}
              <button
                type="button"
                onClick={() => void submitCreateStage()}
                className="mt-1 w-full btn-primary w-full"
              >
                Создать стадию
              </button>
            </div>
          </div>
        </div>
      )}

      {distributeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl crm-modal-panel border p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="lux-subheading">Распределить лиды по менеджерам</h2>
              <button
                type="button"
                onClick={() => setDistributeOpen(false)}
                className="rounded-full border border-[var(--mo-border)] px-3 py-1 text-sm mo-muted hover:bg-[var(--mo-accent-soft)]"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-sm mo-muted">
                Стадия
                <select
                  value={distributeStageId === "" ? "" : String(distributeStageId)}
                  onChange={(e) => setDistributeStageId(Number(e.target.value))}
                  className="mo-input mt-1 w-full"
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
              <label className="flex items-start gap-3 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]/20 px-4 py-3 text-sm text-[var(--mo-text)]">
                <input
                  type="checkbox"
                  checked={distributeForce}
                  onChange={(e) => setDistributeForce(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold">Перераспределить всех</span>
                  <span className="block text-xs mo-muted">
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
                className="mt-1 w-full btn-primary w-full disabled:opacity-60"
              >
                {distributeMutation.isPending ? "Распределение…" : "Распределить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {createLeadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl crm-modal-panel border p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="lux-subheading">Создать лид</h2>
              <button
                type="button"
                onClick={() => setCreateLeadOpen(false)}
                className="rounded-full border border-[var(--mo-border)] px-3 py-1 text-sm mo-muted hover:bg-[var(--mo-accent-soft)]"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-sm mo-muted">
                Имя
                <input
                  value={leadName}
                  onChange={(e) => setLeadName(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="text-sm mo-muted">
                Телефон
                <input
                  value={leadPhone}
                  onChange={(e) => setLeadPhone(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="text-sm mo-muted">
                Email (необязательно)
                <input
                  value={leadEmail}
                  onChange={(e) => setLeadEmail(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="text-sm mo-muted">
                Источник
                <select
                  value={leadSource}
                  onChange={(e) => setLeadSource(e.target.value)}
                  className="mo-input mt-1 w-full"
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
                <label className="text-sm mo-muted">
                  Воронка
                  <select
                    value={leadPipelineId ?? ""}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      setLeadPipelineId(Number.isFinite(id) ? id : null);
                      setLeadStageId(null);
                    }}
                    className="mo-input mt-1 w-full"
                  >
                    {(pipelinesQuery.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm mo-muted">
                  Стадия
                  <select
                    value={leadStageId ?? ""}
                    onChange={(e) => setLeadStageId(Number(e.target.value))}
                    className="mo-input mt-1 w-full"
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
                className="mt-2 w-full btn-primary w-full"
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl crm-modal-panel border p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="lux-subheading">Импорт лидов (CSV)</h2>
              <button
                type="button"
                onClick={() => {
                  setImportOpen(false);
                  setImportLastResult(null);
                  if (importFileRef.current) importFileRef.current.value = "";
                }}
                className="rounded-full border border-[var(--mo-border)] px-3 py-1 text-sm mo-muted hover:bg-[var(--mo-accent-soft)]"
              >
                Закрыть
              </button>
            </div>

            <p className="mt-3 text-sm leading-relaxed lux-caption">
              Из Битрикс24: CRM → Лиды → выделите нужные → <span className="mo-muted">Экспорт</span> в Excel.
              Сохраните файл как CSV (кодировка UTF-8). Подойдут колонки вроде «Название», «Имя», «Фамилия»,
              «Телефон», «E-mail», «Источник». Все импортируемые лиды попадут в выбранную стадию. За один раз
              можно загрузить до ~25&nbsp;000 строк; при большом файле импорт может занять несколько минут.
            </p>

            <div className="mt-4 grid gap-3">
              <button
                type="button"
                onClick={() => void downloadImportTemplate()}
                className="w-full rounded-xl border border-[var(--mo-border-strong)] py-2 text-sm text-[var(--mo-text)] transition hover:bg-[var(--mo-accent-soft)]"
              >
                Скачать шаблон CSV для MetodiOne
              </button>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-sm mo-muted">
                  Воронка
                  <select
                    value={importPipelineId ?? ""}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      setImportPipelineId(Number.isFinite(id) ? id : null);
                      setImportStageId(null);
                    }}
                    className="mo-input mt-1 w-full"
                  >
                    {(pipelinesQuery.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm mo-muted">
                  Стадия (все строки файла)
                  <select
                    value={importStageId ?? ""}
                    onChange={(e) => setImportStageId(Number(e.target.value))}
                    className="mo-input mt-1 w-full"
                  >
                    {(importStagesQuery.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="text-sm mo-muted">
                Файл .csv
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".csv,text/csv,.txt"
                  className="mt-1 block w-full text-sm mo-muted file:mr-3 file:rounded-lg file:border file:border-[var(--mo-border-strong)] file:bg-[var(--mo-accent-soft)] file:px-3 file:py-1.5 file:text-[var(--mo-text)]"
                />
              </label>

              <button
                type="button"
                onClick={() => void submitImportLeads()}
                className="w-full btn-primary w-full"
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

      {crmView === "list" && pipelineId != null && (
        <section className="crm-list-panel">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[200px] flex-1 text-sm lux-caption">
              Поиск
              <input
                value={listSearchInput}
                onChange={(e) => setListSearchInput(e.target.value)}
                placeholder="Имя, телефон, email…"
                className={`${theme.input} mt-1`}
              />
            </label>
            <label className="text-sm lux-caption">
              Стадия
              <select
                value={listStatusFilter === "" ? "" : String(listStatusFilter)}
                onChange={(e) => {
                  const v = e.target.value;
                  setListStatusFilter(v === "" ? "" : Number(v));
                }}
                className={`${theme.input} mt-1 min-w-[180px]`}
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
            <p className="text-sm text-[var(--mo-danger)]">{(leadsTableQuery.error as Error).message}</p>
          )}
          {leadsTableQuery.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
          {leadsTableQuery.data && !leadsTableQuery.isLoading && (
            <>
              <p className="text-sm lux-caption">
                Найдено: {leadsTableQuery.data.total} · страница {leadsTableQuery.data.page} из {listTotalPages}
              </p>
              <div className="crm-list-table-wrap">
                <table className="mo-table min-w-[720px]">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide">
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
                        <td colSpan={6} className="px-3 py-8 text-center lux-caption">
                          Нет лидов по условиям
                        </td>
                      </tr>
                    ) : (
                      leadsTableQuery.data.items.map((lead) => (
                        <tr key={lead.id} className="hover:bg-[var(--mo-nav-hover)]">
                          <td className="px-3 py-2 lux-caption">{lead.id}</td>
                          <td className="px-3 py-2 font-medium text-[var(--mo-text)]">{lead.name}</td>
                          <td className="px-3 py-2">
                            <PatientPhone value={lead} />
                          </td>
                          <td className="px-3 py-2 text-[var(--mo-text-muted)]">{lead.email ?? "—"}</td>
                          <td className="px-3 py-2 text-[var(--mo-accent)]">{lead.stage_name ?? "—"}</td>
                          <td className="px-3 py-2">
                            <Link
                              to={`/leads/${lead.id}`}
                              className="mo-link font-medium"
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
                    className="crm-pill-btn disabled:opacity-40"
                  >
                    Назад
                  </button>
                  <span className="text-sm mo-muted">
                    {listPage} / {listTotalPages}
                  </span>
                  <button
                    type="button"
                    disabled={listPage >= listTotalPages || leadsTableQuery.isFetching}
                    onClick={() => setListPage((p) => p + 1)}
                    className="crm-pill-btn disabled:opacity-40"
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
        <p className="text-sm mo-muted">Загрузка…</p>
      )}
      {crmView === "board" && (stagesQuery.isError || leadsQuery.isError) && (
        <p className="text-sm text-[var(--mo-danger)]">
          {(stagesQuery.error as Error)?.message ?? (leadsQuery.error as Error)?.message}
        </p>
      )}

      {kanbanError && crmView === "board" && (
        <p className="rounded-xl border border-[var(--mo-warning)]/40 bg-[var(--mo-warning)]/10 px-4 py-2 text-sm text-[var(--mo-warning)]">
          {kanbanError}
        </p>
      )}

      {crmView === "board" && sortedStages.length > 0 && (
        <>
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
              className="no-scrollbar flex gap-4 overflow-x-auto pb-4"
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
            <p className="mt-1 text-center text-[10px] mo-muted sm:text-left">
              Листайте колонки вправо — там «Отказ» и «Архив». В колонке скролльте вниз — карточки подгрузятся сами.
            </p>
            <DragOverlay dropAnimation={null}>
              {activeLead ? (
                <LeadCardDragOverlay lead={activeLead} stageColor={activeLeadStageColor} />
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      )}

      {crmView === "board" && sortedStages.length === 0 && !stagesQuery.isLoading && !stagesQuery.isError && (
        <p className="text-sm mo-muted">Этапы воронки не загружены.</p>
      )}
    </div>
  );
}
