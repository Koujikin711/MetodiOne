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
        <h1 className="text-3xl font-semibold text-white">Задачи смены</h1>
      </header>

      <section className="grid gap-3 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4 md:grid-cols-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что сделать в смене" className="rounded-xl border border-slate-600/50 bg-slate-900/70 px-3 py-2 text-sm text-white" />
        <select
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : "")}
          className="rounded-xl border border-slate-600/50 bg-slate-900/70 px-3 py-2 text-sm text-white"
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
          className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"
        >
          Добавить
        </button>
      </section>

      {tasks.isLoading ? <p className="text-sm text-slate-400">Загрузка задач…</p> : null}
      {tasks.isError ? <p className="text-sm text-rose-300">{(tasks.error as Error).message}</p> : null}
      <section className="space-y-2">
        {(tasks.data?.items ?? []).map((t) => (
          <div key={t.id} className="rounded-xl border border-slate-700/50 bg-slate-900/45 p-3 text-sm text-slate-200">
            {t.title} · <span className="text-slate-400">{t.status}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
