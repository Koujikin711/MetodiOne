import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

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
  if (status === "done") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-800";
  if (status === "in_progress") return "border-indigo-500/40 bg-indigo-500/10 text-indigo-900";
  if (status === "cancelled") return "border-[var(--mo-border-strong)] bg-[var(--mo-accent-soft)] lux-caption";
  return "border-amber-500/40 bg-amber-500/10 text-amber-900";
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
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-[var(--mo-text)]">Задачи</h1>
        <p className="text-sm lux-caption">Быстро создавайте и отмечайте выполненные</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDoneTab(false)}
          className={!doneTab ? "btn-primary text-xs" : "rounded-xl border px-3 py-1.5 text-xs lux-caption"}
        >
          Активные
        </button>
        <button
          type="button"
          onClick={() => setDoneTab(true)}
          className={doneTab ? "btn-primary text-xs" : "rounded-xl border px-3 py-1.5 text-xs lux-caption"}
        >
          Выполненные
        </button>
        {canTeam ? (
          <>
            <span className="mx-1 text-[var(--mo-border-strong)]">|</span>
            <button
              type="button"
              onClick={() => setScope("my")}
              className={scope === "my" ? "btn-primary text-xs" : "rounded-xl border px-3 py-1.5 text-xs lux-caption"}
            >
              Мои
            </button>
            <button
              type="button"
              onClick={() => setScope("team")}
              className={scope === "team" ? "btn-primary text-xs" : "rounded-xl border px-3 py-1.5 text-xs lux-caption"}
            >
              Команда
            </button>
          </>
        ) : null}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск…"
          className="ml-auto min-w-[8rem] flex-1 rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/60 px-3 py-1.5 text-sm sm:max-w-[12rem]"
        />
      </div>

      {canCreate && !doneTab && (
        <form
          className="mo-section flex flex-col gap-2 rounded-2xl p-4 sm:flex-row sm:items-end"
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
          <label className="flex-1 text-xs lux-caption">
            Задача
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Что нужно сделать"
              className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/70 px-3 py-2 text-sm"
            />
          </label>
          <label className="w-full text-xs lux-caption sm:w-40">
            Кому
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : "")}
              className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/70 px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {(assigneesQ.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.email}
                </option>
              ))}
            </select>
          </label>
          <label className="w-full text-xs lux-caption sm:w-44">
            Срок
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--mo-border-strong)]/50 bg-white/70 px-3 py-2 text-sm"
            />
          </label>
          <button type="submit" disabled={createM.isPending} className="btn-primary shrink-0 sm:mb-0.5">
            Добавить
          </button>
        </form>
      )}

      {tasksQ.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
      {tasksQ.isError && <p className="text-sm text-red-600">{(tasksQ.error as Error).message}</p>}
      {!tasksQ.isLoading && items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-[var(--mo-border)] px-6 py-10 text-center text-sm lux-caption">
          {doneTab ? "Выполненных задач пока нет" : "Нет активных задач"}
        </p>
      )}

      <ul className="space-y-2">
        {items.map((t) => {
          const dl = formatDeadline(t.deadline);
          const isDone = t.status === "done" || t.status === "cancelled";
          return (
            <li
              key={t.id}
              className="flex flex-wrap items-start gap-3 rounded-2xl border border-[var(--mo-border)] bg-white/50 px-4 py-3"
            >
              {!doneTab && t.status !== "cancelled" ? (
                <button
                  type="button"
                  title="Отметить выполненной"
                  onClick={() => patchM.mutate({ id: t.id, status: "done" })}
                  className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-indigo-400/60 text-indigo-600 hover:bg-indigo-500/10"
                >
                  {t.status === "done" ? "✓" : ""}
                </button>
              ) : (
                <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs text-emerald-700">
                  ✓
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className={isDone ? "text-sm lux-caption line-through" : "font-medium text-[var(--mo-text)]"}>
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
                  className={`rounded-lg border px-2 py-1 text-xs font-medium ${statusChip(t.status)}`}
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
                    className="text-xs text-red-600/80 hover:text-red-700"
                  >
                    Удалить
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
