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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import type { Lead, LeadStatusPatchResponse, PipelineStage } from "@/lib/types";

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
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-snug text-white">{lead.name}</p>
        <span className="shrink-0 rounded-full bg-slate-700/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          {leadDateBadge(lead.id)}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-400">{lead.phone ?? "—"}</p>
    </>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: leadDraggableId(lead.id),
    data: { lead },
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

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
}: {
  stage: PipelineStage;
  leads: Lead[];
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
          leads.map((lead) => <LeadCard key={lead.id} lead={lead} />)
        )}
      </div>
    </div>
  );
}

export function CrmPage() {
  const queryClient = useQueryClient();
  const stagesQuery = useQuery({
    queryKey: ["stages"],
    queryFn: () => apiFetch<PipelineStage[]>("/api/stages"),
  });
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
      </header>

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
