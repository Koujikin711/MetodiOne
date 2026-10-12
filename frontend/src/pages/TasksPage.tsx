import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { DateTimeField } from "@/components/DateTimeField";
import { PageHeader } from "@/components/ui/PageHeader";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken, decodeUserIdFromToken } from "@/lib/auth";
import type { Task, TaskAssignee, TaskListResponse, TaskStatus } from "@/lib/types";

const STATUS: { key: TaskStatus; label: string }[] = [
  { key: "pending", label: "Ожидает" },
  { key: "in_progress", label: "В работе" },
  { key: "done", label: "Готово" },
  { key: "missed", label: "Не провёл" },
  { key: "cancelled", label: "Отменено" },
];

function statusChip(status: string) {
  if (status === "done") return "task-status task-status--done";
  if (status === "in_progress") return "task-status task-status--in_progress";
  if (status === "missed") return "task-status task-status--missed";
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
  const myId = decodeUserIdFromToken(getStoredToken());
  const canTeam = role === "owner" || role === "admin" || role === "expert";
  const canCreate = role !== "super_owner";
  const canReturn = role === "owner" || role === "admin";

  const [view, setView] = useState<"active" | "done" | "missed">("active");
  const [scope, setScope] = useState<"my" | "team">("my");
  const [search, setSearch] = useState("");

  const [title, setTitle] = useState("");
  const [assignedTo, setAssignedTo] = useState<number | "">("");
  const [deadline, setDeadline] = useState("");
  const [repeatsDaily, setRepeatsDaily] = useState(false);
  const [doneNoteFor, setDoneNoteFor] = useState<number | null>(null);
  const [doneNote, setDoneNote] = useState("");

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("scope", canTeam ? scope : "my");
    p.set("journal", view === "done" ? "true" : "false");
    if (view === "missed") p.set("status", "missed");
    if (search.trim()) p.set("q", search.trim());
    return p.toString();
  }, [canTeam, scope, view, search]);

  const assigneesQ = useQuery({
    queryKey: ["tasks-assignees"],
    queryFn: () => apiFetch<TaskAssignee[]>("/api/tasks/assignees"),
    enabled: canCreate,
  });

  const tasksQ = useQuery({
    queryKey: ["tasks", queryString],
    queryFn: () => apiFetch<TaskListResponse>(`/api/tasks?${queryString}`),
  });

  const selectedAssignee = (assigneesQ.data ?? []).find((u) => u.id === assignedTo);
  const expertSelected = selectedAssignee?.role === "expert";

  const createM = useMutation({
    mutationFn: () =>
      apiFetch<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          assigned_to: assignedTo || null,
          deadline: deadline || null,
          repeats_daily: expertSelected && repeatsDaily,
        }),
      }),
    onSuccess: () => {
      toast.success("Задача создана");
      setTitle("");
      setAssignedTo("");
      setDeadline("");
      setRepeatsDaily(false);
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["task-warnings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchM = useMutation({
    mutationFn: ({ id, status, completion_note }: { id: number; status: TaskStatus; completion_note?: string | null }) =>
      apiFetch<Task>(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(status === "done" ? { status, completion_note: completion_note ?? null } : { status }),
      }),
    onSuccess: (_task, vars) => {
      if (vars.status === "done") toast.success(vars.completion_note ? `Готово: ${vars.completion_note}` : "Задача выполнена");
      if (vars.status === "pending") toast.success("Задача возвращена — её снова нужно выполнить");
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["task-warnings"] });
    },
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
              <button type="button" data-active={view === "active"} onClick={() => setView("active")}>
                Активные
              </button>
              <button type="button" data-active={view === "done"} onClick={() => setView("done")}>
                Выполненные
              </button>
              <button type="button" data-active={view === "missed"} onClick={() => setView("missed")}>
                Не выполнены
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

        {canCreate && view === "active" ? (
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
              if (expertSelected && repeatsDaily && !deadline) {
                toast.error("Укажите час повтора");
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
                onChange={(e) => {
                  const next = e.target.value ? Number(e.target.value) : "";
                  setAssignedTo(next);
                  const person = (assigneesQ.data ?? []).find((u) => u.id === next);
                  if (person?.role !== "expert") setRepeatsDaily(false);
                }}
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
              <DateTimeField
                value={deadline}
                onChange={setDeadline}
                className="mt-1"
                aria-label="Срок задачи"
              />
            </label>
            <button type="submit" disabled={createM.isPending} className="btn-primary w-full sm:w-auto">
              {createM.isPending ? "…" : "Добавить"}
            </button>
            {expertSelected ? (
              <label className="flex items-center gap-2 text-sm sm:col-span-full">
                <input
                  type="checkbox"
                  checked={repeatsDaily}
                  onChange={(e) => setRepeatsDaily(e.target.checked)}
                />
                <span>Каждый день в этот час. Предупреждение придёт тому, кому поставлена задача.</span>
              </label>
            ) : null}
          </form>
        ) : null}

        <section className="mo-section min-h-[12rem] p-4 sm:p-5">
          <h2 className="lux-heading mb-3">
            {view === "done" ? "Журнал" : view === "missed" ? "Не выполнены" : "Список задач"}
          </h2>
          {tasksQ.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
          {tasksQ.isError && (
            <p className="text-sm text-[var(--mo-danger)]">{(tasksQ.error as Error).message}</p>
          )}
          {!tasksQ.isLoading && items.length === 0 ? (
            <div className="mo-empty">
              {view === "missed"
                ? "Таких задач нет. Здесь видно, кто отметил «не провёл»."
                : view === "done"
                  ? "Выполненных задач пока нет"
                  : "Нет активных задач"}
            </div>
          ) : null}

          <ul className="space-y-2.5">
            {items.map((t) => {
              const dl = formatDeadline(t.deadline);
              const closed = t.status === "done" || t.status === "cancelled" || t.status === "missed";
              const mine = myId != null && t.assigned_to === myId;
              const canMiss = !closed && (canReturn || mine);
              return (
                <li
                  key={t.id}
                  className={
                    t.status === "missed"
                      ? "task-card border border-rose-400/50"
                      : !closed && t.deadline && new Date(t.deadline).getTime() <= Date.now()
                        ? "task-card border border-amber-400/50"
                        : "task-card"
                  }
                >
                  {view === "active" && t.status !== "cancelled" ? (
                    <button
                      type="button"
                      title="Отметить выполненной"
                      onClick={() => {
                        setDoneNoteFor(t.id);
                        setDoneNote("");
                      }}
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-[var(--mo-accent)]/50 text-[var(--mo-accent-hover)] transition hover:bg-[var(--mo-accent-soft)]"
                    />
                  ) : (
                    <span
                      className={
                        t.status === "missed"
                          ? "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-xs text-rose-300"
                          : "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs text-[var(--mo-success)]"
                      }
                    >
                      {t.status === "missed" ? "!" : "✓"}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        t.status === "done" || t.status === "cancelled"
                          ? "text-sm lux-caption line-through"
                          : "text-sm font-semibold text-[var(--mo-text)] sm:text-base"
                      }
                    >
                      {t.title}
                    </p>
                    <p className="mt-0.5 text-xs lux-caption">
                      {t.assigned_to_name ?? "—"}
                      {dl ? ` · до ${dl}` : ""}
                      {t.repeats_daily ? " · каждый день в этот час" : ""}
                      {t.status === "missed" ? " · не провёл" : ""}
                      {t.completion_note ? ` · ${t.completion_note}` : ""}
                    </p>
                    {t.client_name || t.client_phone ? (
                      <p className="mt-0.5 text-xs font-medium text-[var(--mo-text)]">
                        {t.client_name ?? "Клиент"}
                        {t.client_phone ? ` · ${t.client_phone}` : ""}
                      </p>
                    ) : null}
                    {doneNoteFor === t.id ? (
                      <div className="mt-2 flex w-full flex-wrap items-center gap-2">
                        {["Сделано", "Проведено"].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => {
                              patchM.mutate({ id: t.id, status: "done", completion_note: preset });
                              setDoneNoteFor(null);
                            }}
                            className="rounded-full border border-[var(--mo-border)] px-2.5 py-1 text-xs text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]"
                          >
                            {preset}
                          </button>
                        ))}
                        <input
                          value={doneNote}
                          onChange={(e) => setDoneNote(e.target.value)}
                          placeholder="Или напишите своё"
                          maxLength={200}
                          className="mo-input min-w-[10rem] flex-1 py-1.5 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            patchM.mutate({
                              id: t.id,
                              status: "done",
                              completion_note: doneNote.trim() || null,
                            });
                            setDoneNoteFor(null);
                          }}
                          className="btn-primary px-3 py-1.5 text-xs"
                        >
                          Готово
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {closed ? (
                      <span className={statusChip(t.status)}>
                        {STATUS.find((s) => s.key === t.status)?.label ?? t.status}
                      </span>
                    ) : (
                      <select
                        value={t.status}
                        onChange={(e) => {
                          const next = e.target.value as TaskStatus;
                          if (next === "done") {
                            setDoneNoteFor(t.id);
                            setDoneNote("");
                            return;
                          }
                          setDoneNoteFor((current) => (current === t.id ? null : current));
                          patchM.mutate({ id: t.id, status: next });
                        }}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${statusChip(t.status)}`}
                      >
                        {STATUS.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {canMiss ? (
                      <button
                        type="button"
                        onClick={() => patchM.mutate({ id: t.id, status: "missed" })}
                        className="text-xs font-medium text-rose-300/90 transition hover:text-rose-200"
                      >
                        Не провёл
                      </button>
                    ) : null}
                    {canReturn && (t.status === "done" || t.status === "missed") ? (
                      <button
                        type="button"
                        onClick={() => patchM.mutate({ id: t.id, status: "pending" })}
                        className="text-xs font-medium text-[var(--mo-accent-hover)] transition hover:underline"
                      >
                        Вернуть
                      </button>
                    ) : null}
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
