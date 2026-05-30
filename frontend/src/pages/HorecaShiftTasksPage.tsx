import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import type { Task, TaskAssignee, TaskListResponse } from "@/lib/types";

export function HorecaShiftTasksPage() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [assignedTo, setAssignedTo] = useState<number | "">("");

  const tasks = useQuery({
    queryKey: ["horeca-shift-tasks"],
    queryFn: () => apiFetch<TaskListResponse>("/api/tasks?scope=team&journal=false&limit=80&offset=0&include_total=false"),
  });
  const assignees = useQuery({
    queryKey: ["horeca-shift-assignees"],
    queryFn: () => apiFetch<TaskAssignee[]>("/api/tasks/assignees"),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          assigned_to: assignedTo || null,
          description: "Задача смены HoReCa",
        }),
      }),
    onSuccess: () => {
      setTitle("");
      setAssignedTo("");
      toast.success("Задача смены создана");
      void qc.invalidateQueries({ queryKey: ["horeca-shift-tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / Задачи смены</p>
        <h1 className="lux-heading-page">Задачи смены</h1>
      </header>

      <section className="grid gap-3 rounded-2xl mo-section p-4 md:grid-cols-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что сделать в смене" className="rounded-xl border border-[var(--mo-border-strong)]/50 bg-white px-3 py-2 text-sm text-[var(--mo-text)]" />
        <select
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : "")}
          className="rounded-xl border border-[var(--mo-border-strong)]/50 bg-white px-3 py-2 text-sm text-[var(--mo-text)]"
        >
          <option value="">Исполнитель</option>
          {(assignees.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name || u.email}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            if (!title.trim()) return toast.error("Введите задачу");
            create.mutate();
          }}
          className="rounded-xl bg-indigo-600 px-3 py-2 lux-subheading text-sm"
        >
          Добавить
        </button>
      </section>

      {tasks.isLoading ? <p className="text-sm lux-caption">Загрузка задач…</p> : null}
      {tasks.isError ? <p className="text-sm text-[#6b1d2f]">{(tasks.error as Error).message}</p> : null}
      <section className="space-y-2">
        {(tasks.data?.items ?? []).map((t) => (
          <div key={t.id} className="rounded-xl border border-[var(--mo-border)] bg-white p-3 text-sm text-[var(--mo-text)]">
            {t.title} · <span className="lux-caption">{t.status}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
