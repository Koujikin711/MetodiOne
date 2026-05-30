import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken, decodeUserIdFromToken } from "@/lib/auth";
import type { Task, TaskAssignee, TaskListResponse, TaskStatus } from "@/lib/types";

const statusLabel: Record<string, string> = {
  pending: "Ожидает",
  in_progress: "В работе",
  done: "Готово",
  cancelled: "Отменено",
};

const statusStyle: Record<string, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.15)]",
  in_progress: "border-indigo-500/35 bg-indigo-500/10 text-indigo-200 shadow-[0_0_12px_rgba(99,102,241,0.2)]",
  done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 shadow-[0_0_12px_rgba(52,211,153,0.15)]",
  cancelled: "border-[var(--mo-border-strong)] bg-[var(--mo-accent-soft)]/80 lux-caption",
};

export function TasksPage() {
  const queryClient = useQueryClient();
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const currentUserId = decodeUserIdFromToken(token);
  const canTeamScope = role === "owner" || role === "admin" || role === "expert";
  const canCreate = role !== "super_owner";
  const isLimitedEditor = role === "manager" || role === "expert";

  const [scope, setScope] = useState<"my" | "team">("my");
  const [bucket, setBucket] = useState<"active" | "journal">("active");
  const [statusFilter, setStatusFilter] = useState("");
  const [deadlineFrom, setDeadlineFrom] = useState("");
  const [deadlineTo, setDeadlineTo] = useState("");
  const [search, setSearch] = useState("");

  const [title, setTitle] = useState("");
  const [assignedTo, setAssignedTo] = useState<number | "">("");
  const [deadline, setDeadline] = useState("");
  const [description, setDescription] = useState("");
  const [relatedLeadId, setRelatedLeadId] = useState<number | "">("");

  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingStatus, setEditingStatus] = useState<TaskStatus>("pending");
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDeadline, setEditingDeadline] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingAssignedTo, setEditingAssignedTo] = useState<number | "">("");
  const [reviewByTaskId, setReviewByTaskId] = useState<Record<number, { score: number; comment: string }>>({});

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("scope", canTeamScope ? scope : "my");
    p.set("journal", bucket === "journal" ? "true" : "false");
    if (statusFilter) p.set("status", statusFilter);
    if (deadlineFrom) p.set("deadline_from", `${deadlineFrom}T00:00:00`);
    if (deadlineTo) p.set("deadline_to", `${deadlineTo}T23:59:59`);
    if (search.trim()) p.set("q", search.trim());
    return p.toString();
  }, [canTeamScope, scope, bucket, statusFilter, deadlineFrom, deadlineTo, search]);

  const assigneesQuery = useQuery({
    queryKey: ["tasks-assignees"],
    queryFn: () => apiFetch<TaskAssignee[]>("/api/tasks/assignees"),
    enabled: canCreate,
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks", queryString],
    queryFn: () => apiFetch<TaskListResponse>(`/api/tasks?${queryString}`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          assigned_to: assignedTo || null,
          deadline: deadline ? new Date(deadline).toISOString() : null,
          description: description.trim() || null,
          related_lead_id: relatedLeadId || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Задача создана");
      setTitle("");
      setAssignedTo("");
      setDeadline("");
      setDescription("");
      setRelatedLeadId("");
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiFetch<Task>(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Задача обновлена");
      setEditingTaskId(null);
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/api/tasks/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Задача удалена");
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, score, comment }: { id: number; score: number; comment: string }) =>
      apiFetch<Task>(`/api/tasks/${id}/review`, {
        method: "PATCH",
        body: JSON.stringify({ score, comment: comment.trim() || null }),
      }),
    onSuccess: () => {
      toast.success("Оценка сохранена");
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="relative mx-auto max-w-3xl space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--mo-text)]">Задачи</h1>
        <p className="text-base lux-caption">Персональные и командные задачи по ролям</p>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setBucket("active")}
            className={[
              "rounded-xl px-3 py-1.5 text-xs font-semibold",
              bucket === "active"
                ? "bg-indigo-500/25 text-indigo-100 ring-1 ring-indigo-400/45"
                : "crm-modal-panel border/40 mo-muted",
            ].join(" ")}
          >
            Активные
          </button>
          <button
            type="button"
            onClick={() => setBucket("journal")}
            className={[
              "rounded-xl px-3 py-1.5 text-xs font-semibold",
              bucket === "journal"
                ? "bg-indigo-500/25 text-indigo-100 ring-1 ring-indigo-400/45"
                : "crm-modal-panel border/40 mo-muted",
            ].join(" ")}
          >
            Журнал задач
          </button>
        </div>
      </header>

      <section className="grid gap-3 mo-section p-4 md:grid-cols-5">
        <label className="text-xs lux-caption">
          Область
          <select
            value={canTeamScope ? scope : "my"}
            onChange={(e) => setScope(e.target.value as "my" | "team")}
            disabled={!canTeamScope}
            className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-2 text-sm text-[var(--mo-text)] disabled:opacity-50"
          >
            <option value="my">Мои</option>
            <option value="team">Командные</option>
          </select>
        </label>
        <label className="text-xs lux-caption">
          Статус
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-2 text-sm text-[var(--mo-text)]"
          >
            <option value="">Все</option>
            {Object.entries(statusLabel).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs lux-caption">
          Дедлайн от
          <input
            type="date"
            value={deadlineFrom}
            onChange={(e) => setDeadlineFrom(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-2 text-sm text-[var(--mo-text)]"
          />
        </label>
        <label className="text-xs lux-caption">
          Дедлайн до
          <input
            type="date"
            value={deadlineTo}
            onChange={(e) => setDeadlineTo(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-2 text-sm text-[var(--mo-text)]"
          />
        </label>
        <label className="text-xs lux-caption">
          Поиск
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Название / описание"
            className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-2 text-sm text-[var(--mo-text)]"
          />
        </label>
      </section>

      {canCreate && bucket === "active" && (
        <section className="grid gap-3 mo-section p-4 md:grid-cols-2">
          <h2 className="md:col-span-2 text-sm font-semibold text-[var(--mo-text)]">Новая задача</h2>
          <label className="text-xs lux-caption">
            Название
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-2 text-sm text-[var(--mo-text)]"
            />
          </label>
          <label className="text-xs lux-caption">
            Исполнитель
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : "")}
              className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-2 text-sm text-[var(--mo-text)]"
            >
              <option value="">Выберите</option>
              {(assigneesQuery.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.full_name || u.email)} ({u.role})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs lux-caption">
            Дедлайн
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-2 text-sm text-[var(--mo-text)]"
            />
          </label>
          <label className="text-xs lux-caption">
            ID лида (необязательно)
            <input
              type="number"
              min={1}
              value={relatedLeadId}
              onChange={(e) => setRelatedLeadId(e.target.value ? Number(e.target.value) : "")}
              className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-2 text-sm text-[var(--mo-text)]"
            />
          </label>
          <label className="md:col-span-2 text-xs lux-caption">
            Описание
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-2 text-sm text-[var(--mo-text)]"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (!title.trim() || !assignedTo) {
                toast.error("Заполните название и исполнителя");
                return;
              }
              createMutation.mutate();
            }}
            disabled={createMutation.isPending}
            className="md:col-span-2 btn-primary"
          >
            {createMutation.isPending ? "Создание..." : "Создать задачу"}
          </button>
        </section>
      )}

      {tasksQuery.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
      {tasksQuery.isError && (
        <p className="text-sm text-red-300">{(tasksQuery.error as Error).message}</p>
      )}
      {tasksQuery.data && tasksQuery.data.items.length === 0 && (
        <div className="glass-card px-8 py-12 text-center text-sm lux-caption">
          Задач пока нет.
        </div>
      )}
      {tasksQuery.data && tasksQuery.data.items.length > 0 && (
        <ul className="space-y-4">
          {tasksQuery.data.items.map((t) => (
            <li
              key={t.id}
              className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-accent-soft)] p-6 shadow-xl backdrop-blur-md transition-all duration-500 hover:border-[var(--mo-border-strong)]/60 hover:shadow-2xl"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="lux-subheading">{t.title}</p>
                <div className="flex items-center gap-2">
                  {editingTaskId === t.id ? (
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={editingStatus}
                        onChange={(e) => setEditingStatus(e.target.value as TaskStatus)}
                        className="rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-1.5 text-xs text-[var(--mo-text)]"
                      >
                        {Object.entries(statusLabel).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      {!isLimitedEditor ? (
                        <select
                          value={editingAssignedTo}
                          onChange={(e) => setEditingAssignedTo(e.target.value ? Number(e.target.value) : "")}
                          className="rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-1.5 text-xs text-[var(--mo-text)]"
                        >
                          <option value="">Без изменения исполнителя</option>
                          {(assigneesQuery.data ?? []).map((u) => (
                            <option key={u.id} value={u.id}>
                              {(u.full_name || u.email)} ({u.role})
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  ) : (
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-all duration-500 ${statusStyle[t.status] ?? statusStyle.pending}`}
                    >
                      {statusLabel[t.status] ?? t.status}
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-2 text-xs mo-muted">
                От: {t.created_by_name || "Система"} ({t.created_by_role || "—"}) {"→"} Кому:{" "}
                {t.assigned_to_name || "—"} (
                {t.assigned_to_role || "—"})
              </p>
              {t.deadline && (
                <p className="mt-3 text-xs font-medium mo-muted">
                  Дедлайн:{" "}
                  <span className="mo-muted">
                    {new Date(t.deadline).toLocaleString("ru-RU")}
                  </span>
                </p>
              )}
              {editingTaskId === t.id && !isLimitedEditor ? (
                <div className="mt-3 grid gap-2">
                  <input
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    className="rounded-lg border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-2 text-sm text-[var(--mo-text)]"
                  />
                  <input
                    type="datetime-local"
                    value={editingDeadline}
                    onChange={(e) => setEditingDeadline(e.target.value)}
                    className="rounded-lg border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-2 text-sm text-[var(--mo-text)]"
                  />
                  <textarea
                    rows={3}
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                    className="rounded-lg border border-[var(--mo-border-strong)]/50 bg-white/50 px-3 py-2 text-sm text-[var(--mo-text)]"
                  />
                </div>
              ) : t.description ? (
                <p className="mt-3 text-sm leading-relaxed lux-caption">{t.description}</p>
              ) : null}
              {t.related_lead_id ? (
                <p className="mt-3 text-sm mo-muted">
                  Лид:{" "}
                  <Link className="text-[var(--mo-accent-hover)] underline-offset-4 hover:underline" to={`/leads/${t.related_lead_id}`}>
                    #{t.related_lead_id} открыть карточку
                  </Link>
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {editingTaskId === t.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        patchMutation.mutate({
                          id: t.id,
                          body: isLimitedEditor
                            ? { status: editingStatus }
                            : {
                                title: editingTitle.trim() || t.title,
                                status: editingStatus,
                                deadline: editingDeadline ? new Date(editingDeadline).toISOString() : null,
                                description: editingDescription.trim() || null,
                                assigned_to: editingAssignedTo || t.assigned_to || null,
                              },
                        })
                      }
                      disabled={patchMutation.isPending}
                      className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-200"
                    >
                      Сохранить
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTaskId(null);
                        setEditingAssignedTo("");
                      }}
                      className="rounded-lg border border-[var(--mo-border-strong)] bg-[var(--mo-accent-soft)] px-3 py-1.5 text-xs mo-muted"
                    >
                      Отмена
                    </button>
                  </>
                ) : (
                  !t.is_locked && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTaskId(t.id);
                        setEditingStatus(t.status);
                        setEditingTitle(t.title);
                        setEditingDeadline(t.deadline ? new Date(t.deadline).toISOString().slice(0, 16) : "");
                        setEditingDescription(t.description || "");
                        setEditingAssignedTo(t.assigned_to || "");
                      }}
                      className="rounded-lg border border-[var(--mo-border-strong)] bg-[var(--mo-accent-soft)] px-3 py-1.5 text-xs mo-muted"
                    >
                      {isLimitedEditor ? "Закрыть/обновить статус" : "Изменить статус"}
                    </button>
                  )
                )}
                {!t.is_locked &&
                  (role === "owner" || (role === "admin" && currentUserId != null && t.created_by_user_id === currentUserId)) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm("Удалить задачу?")) return;
                      deleteMutation.mutate(t.id);
                    }}
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300"
                  >
                    Удалить
                  </button>
                )}
              </div>
              {t.is_locked ? (
                <div className="mt-3 rounded-lg border border-[var(--mo-border)] bg-white/35 p-3 text-xs lux-caption">
                  <p>Задача в журнале: редактирование отключено.</p>
                  {t.review_score ? (
                    <p className="mt-1 text-[#0f4c3a]">
                      Оценка постановщика: {t.review_score}/10
                      {t.review_comment ? ` · ${t.review_comment}` : ""}
                    </p>
                  ) : null}
                  {currentUserId != null && t.created_by_user_id === currentUserId ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value={reviewByTaskId[t.id]?.score ?? t.review_score ?? 10}
                        onChange={(e) =>
                          setReviewByTaskId((prev) => ({
                            ...prev,
                            [t.id]: { score: Number(e.target.value), comment: prev[t.id]?.comment ?? t.review_comment ?? "" },
                          }))
                        }
                        className="rounded-lg border border-[var(--mo-border-strong)]/50 bg-white/60 px-2 py-1 text-xs text-[var(--mo-text)]"
                      >
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {n}/10
                          </option>
                        ))}
                      </select>
                      <input
                        value={reviewByTaskId[t.id]?.comment ?? t.review_comment ?? ""}
                        onChange={(e) =>
                          setReviewByTaskId((prev) => ({
                            ...prev,
                            [t.id]: { score: prev[t.id]?.score ?? t.review_score ?? 10, comment: e.target.value },
                          }))
                        }
                        placeholder="Комментарий к оценке"
                        className="min-w-[220px] flex-1 rounded-lg border border-[var(--mo-border-strong)]/50 bg-white/60 px-2 py-1 text-xs text-[var(--mo-text)]"
                      />
                      <button
                        type="button"
                        disabled={reviewMutation.isPending}
                        onClick={() => {
                          const score = reviewByTaskId[t.id]?.score ?? t.review_score ?? 10;
                          const comment = reviewByTaskId[t.id]?.comment ?? t.review_comment ?? "";
                          reviewMutation.mutate({ id: t.id, score, comment });
                        }}
                        className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs text-emerald-200 disabled:opacity-50"
                      >
                        {t.review_score ? "Обновить оценку" : "Оценить"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
