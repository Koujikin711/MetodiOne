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
  cancelled: "border-slate-600 bg-slate-800/80 text-slate-400",
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

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("scope", canTeamScope ? scope : "my");
    if (statusFilter) p.set("status", statusFilter);
    if (deadlineFrom) p.set("deadline_from", `${deadlineFrom}T00:00:00`);
    if (deadlineTo) p.set("deadline_to", `${deadlineTo}T23:59:59`);
    if (search.trim()) p.set("q", search.trim());
    return p.toString();
  }, [canTeamScope, scope, statusFilter, deadlineFrom, deadlineTo, search]);

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

  return (
    <div className="relative mx-auto max-w-3xl space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Задачи</h1>
        <p className="text-base text-slate-400">Персональные и командные задачи по ролям</p>
      </header>

      <section className="grid gap-3 rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4 md:grid-cols-5">
        <label className="text-xs text-slate-400">
          Область
          <select
            value={canTeamScope ? scope : "my"}
            onChange={(e) => setScope(e.target.value as "my" | "team")}
            disabled={!canTeamScope}
            className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            <option value="my">Мои</option>
            <option value="team">Командные</option>
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Статус
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
          >
            <option value="">Все</option>
            {Object.entries(statusLabel).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Дедлайн от
          <input
            type="date"
            value={deadlineFrom}
            onChange={(e) => setDeadlineFrom(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="text-xs text-slate-400">
          Дедлайн до
          <input
            type="date"
            value={deadlineTo}
            onChange={(e) => setDeadlineTo(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="text-xs text-slate-400">
          Поиск
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Название / описание"
            className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
          />
        </label>
      </section>

      {canCreate && (
        <section className="grid gap-3 rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4 md:grid-cols-2">
          <h2 className="md:col-span-2 text-sm font-semibold text-slate-200">Новая задача</h2>
          <label className="text-xs text-slate-400">
            Название
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-400">
            Исполнитель
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : "")}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
            >
              <option value="">Выберите</option>
              {(assigneesQuery.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.full_name || u.email)} ({u.role})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Дедлайн
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-400">
            ID лида (необязательно)
            <input
              type="number"
              min={1}
              value={relatedLeadId}
              onChange={(e) => setRelatedLeadId(e.target.value ? Number(e.target.value) : "")}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="md:col-span-2 text-xs text-slate-400">
            Описание
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
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
            className="md:col-span-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {createMutation.isPending ? "Создание..." : "Создать задачу"}
          </button>
        </section>
      )}

      {tasksQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
      {tasksQuery.isError && (
        <p className="text-sm text-red-300">{(tasksQuery.error as Error).message}</p>
      )}
      {tasksQuery.data && tasksQuery.data.items.length === 0 && (
        <div className="glass-card px-8 py-12 text-center text-sm text-slate-400">
          Задач пока нет.
        </div>
      )}
      {tasksQuery.data && tasksQuery.data.items.length > 0 && (
        <ul className="space-y-4">
          {tasksQuery.data.items.map((t) => (
            <li
              key={t.id}
              className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-6 shadow-xl backdrop-blur-md transition-all duration-500 hover:border-slate-600/60 hover:shadow-2xl"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-lg font-medium text-white">{t.title}</p>
                <div className="flex items-center gap-2">
                  {editingTaskId === t.id ? (
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={editingStatus}
                        onChange={(e) => setEditingStatus(e.target.value as TaskStatus)}
                        className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-1.5 text-xs text-white"
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
                          className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-1.5 text-xs text-white"
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
              <p className="mt-2 text-xs text-slate-500">
                От: {t.created_by_name || "Система"} ({t.created_by_role || "—"}) {"→"} Кому:{" "}
                {t.assigned_to_name || "—"} (
                {t.assigned_to_role || "—"})
              </p>
              {t.deadline && (
                <p className="mt-3 text-xs font-medium text-slate-500">
                  Дедлайн:{" "}
                  <span className="text-slate-300">
                    {new Date(t.deadline).toLocaleString("ru-RU")}
                  </span>
                </p>
              )}
              {editingTaskId === t.id && !isLimitedEditor ? (
                <div className="mt-3 grid gap-2">
                  <input
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    className="rounded-lg border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
                  />
                  <input
                    type="datetime-local"
                    value={editingDeadline}
                    onChange={(e) => setEditingDeadline(e.target.value)}
                    className="rounded-lg border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
                  />
                  <textarea
                    rows={3}
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                    className="rounded-lg border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-sm text-white"
                  />
                </div>
              ) : t.description ? (
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{t.description}</p>
              ) : null}
              {t.related_lead_id ? (
                <p className="mt-3 text-sm text-slate-300">
                  Лид:{" "}
                  <Link className="text-purple-300 underline-offset-4 hover:underline" to={`/leads/${t.related_lead_id}`}>
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
                      className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-300"
                    >
                      Отмена
                    </button>
                  </>
                ) : (
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
                    className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-300"
                  >
                    {isLimitedEditor ? "Закрыть/обновить статус" : "Изменить статус"}
                  </button>
                )}
                {(role === "owner" || (role === "admin" && currentUserId != null && t.created_by_user_id === currentUserId)) && (
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
