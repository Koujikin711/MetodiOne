import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { PageHeader } from "@/components/ui/PageHeader";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type { Task, TaskAssignee, TaskListResponse, TaskStatus } from "@/lib/types";

const STATUS: { key: TaskStatus; label: string }[] = [
  { key: "pending", label: "Ожидает" },
  { key: "in_progress", label: "В работе" },
  { key: "done", label: "Готово" },
  { key: "cancelled", label: "Отменено" },
];

function statusChip(status: string) {
  if (status === "done") return "task-status task-status--done";
  if (status === "in_progress") return "task-status task-status--in_progress";
  if (status === "cancelled") return "task-status task-status--cancelled";
  return "task-status task-status--pending";
}

function formatDeadline(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function TasksPage() {
  const queryClient = useQueryClient();
  const role = decodeRoleFromToken(getStoredToken());
  const canTeam = role === "owner" || role === "admin" || role === "expert";
  const canCreate = role !== "super_owner";

  const [doneTab, setDoneTab] = useState(false);
  const [scope, setScope] = useState<"my" | "team">("my");
  const [search, setSearch] = useState("");

  const [title, setTitle] = useState("");
  const [assignedTo, setAssignedTo] = useState<number | "">("");
  const [deadline, setDeadline] = useState("");

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("scope", canTeam ? scope : "my");
    p.set("journal", doneTab ? "true" : "false");
    if (search.trim()) p.set("q", search.trim());
    return p.toString();
  }, [canTeam, scope, doneTab, search]);

  const assigneesQ = useQuery({
    queryKey: ["tasks-assignees"],
    queryFn: () => apiFetch<TaskAssignee[]>("/api/tasks/assignees"),
    enabled: canCreate,
  });

  const tasksQ = useQuery({
    queryKey: ["tasks", queryString],
    queryFn: () => apiFetch<TaskListResponse>(`/api/tasks?${queryString}`),
  });

  const createM = useMutation({
    mutationFn: () =>
      apiFetch<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          assigned_to: assignedTo || null,
          deadline: deadline ? new Date(deadline).toISOString() : null,
        }),
      }),
    onSuccess: () => {
      toast.success("Задача создана");
      setTitle("");
      setAssignedTo("");
      setDeadline("");
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchM = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TaskStatus }) =>
      apiFetch<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/api/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Удалено");
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = tasksQ.data?.items ?? [];

  return (
    <div className="mo-fill-page">
      <div className="mo-admin-page-head">
        <PageHeader
          className="mb-0"
          title="Задачи"
          description="Быстро создавайте и отмечайте выполненные"
        />
      </div>

      <div className="mo-fill-page-scroll space-y-5 pt-4">
        <section className="mo-section p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mo-tabs">
              <button type="button" data-active={!doneTab} onClick={() => setDoneTab(false)}>
                Активные
              </button>
              <button type="button" data-active={doneTab} onClick={() => setDoneTab(true)}>
                Выполненные
              </button>
            </div>
            {canTeam ? (
              <div className="mo-tabs">
                <button type="button" data-active={scope === "my"} onClick={() => setScope("my")}>
                  Мои
                </button>
                <button type="button" data-active={scope === "team"} onClick={() => setScope("team")}>
                  Команда
                </button>
              </div>
            ) : null}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск…"
              className="mo-input ml-auto min-w-[10rem] flex-1 py-2 text-sm sm:max-w-[16rem]"
            />
          </div>
        </section>

        {canCreate && !doneTab ? (
          <form
            className="mo-section grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_12rem_14rem_auto] sm:items-end sm:p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!title.trim()) {
                toast.error("Введите название");
                return;
              }
              if (!assignedTo) {
                toast.error("Выберите исполнителя");
                return;
              }
              createM.mutate();
            }}
          >
            <label className="block">
              <span className="mo-admin-toolbar-label">Задача</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Что нужно сделать"
                className="mo-input"
              />
            </label>
            <label className="block">
              <span className="mo-admin-toolbar-label">Кому</span>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : "")}
                className="mo-input"
              >
                <option value="">—</option>
                {(assigneesQ.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mo-admin-toolbar-label">Срок</span>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="mo-input"
              />
            </label>
            <button type="submit" disabled={createM.isPending} className="btn-primary w-full sm:w-auto">
              {createM.isPending ? "…" : "Добавить"}
            </button>
          </form>
        ) : null}

        <section className="mo-section min-h-[12rem] p-4 sm:p-5">
          <h2 className="lux-heading mb-3">{doneTab ? "Журнал" : "Список задач"}</h2>
          {tasksQ.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
          {tasksQ.isError && (
            <p className="text-sm text-[var(--mo-danger)]">{(tasksQ.error as Error).message}</p>
          )}
          {!tasksQ.isLoading && items.length === 0 ? (
            <div className="mo-empty">
              {doneTab ? "Выполненных задач пока нет" : "Нет активных задач"}
            </div>
          ) : null}

          <ul className="space-y-2.5">
            {items.map((t) => {
              const dl = formatDeadline(t.deadline);
              const isDone = t.status === "done" || t.status === "cancelled";
              return (
                <li key={t.id} className="task-card">
                  {!doneTab && t.status !== "cancelled" ? (
                    <button
                      type="button"
                      title="Отметить выполненной"
                      onClick={() => patchM.mutate({ id: t.id, status: "done" })}
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-[var(--mo-accent)]/50 text-[var(--mo-accent-hover)] transition hover:bg-[var(--mo-accent-soft)]"
                    >
                      {t.status === "done" ? "✓" : ""}
                    </button>
                  ) : (
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs text-[var(--mo-success)]">
                      ✓
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        isDone
                          ? "text-sm lux-caption line-through"
                          : "text-sm font-semibold text-[var(--mo-text)] sm:text-base"
                      }
                    >
                      {t.title}
                    </p>
                    <p className="mt-0.5 text-xs lux-caption">
                      {t.assigned_to_name ?? "—"}
                      {dl ? ` · до ${dl}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={t.status}
                      onChange={(e) => patchM.mutate({ id: t.id, status: e.target.value as TaskStatus })}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${statusChip(t.status)}`}
                    >
                      {STATUS.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    {(role === "owner" || role === "admin") && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm("Удалить задачу?")) deleteM.mutate(t.id);
                        }}
                        className="text-xs font-medium text-[var(--mo-danger)]/80 transition hover:text-[var(--mo-danger)]"
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
