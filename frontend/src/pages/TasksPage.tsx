import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { Task } from "@/lib/types";

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
  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiFetch<Task[]>("/api/tasks"),
  });

  return (
    <div className="relative mx-auto max-w-3xl space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Задачи</h1>
        <p className="text-base text-slate-400">Список из API · CRUD через бэкенд</p>
      </header>

      {tasksQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
      {tasksQuery.isError && (
        <p className="text-sm text-red-300">{(tasksQuery.error as Error).message}</p>
      )}
      {tasksQuery.data && tasksQuery.data.length === 0 && (
        <div className="glass-card px-8 py-12 text-center text-sm text-slate-400">
          Задач пока нет.
        </div>
      )}
      {tasksQuery.data && tasksQuery.data.length > 0 && (
        <ul className="space-y-4">
          {tasksQuery.data.map((t) => (
            <li
              key={t.id}
              className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-6 shadow-xl backdrop-blur-md transition-all duration-500 hover:border-slate-600/60 hover:shadow-2xl"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-lg font-medium text-white">{t.title}</p>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-all duration-500 ${statusStyle[t.status] ?? statusStyle.pending}`}
                >
                  {statusLabel[t.status] ?? t.status}
                </span>
              </div>
              {t.deadline && (
                <p className="mt-3 text-xs font-medium text-slate-500">
                  Дедлайн:{" "}
                  <span className="text-slate-300">
                    {new Date(t.deadline).toLocaleString("ru-RU")}
                  </span>
                </p>
              )}
              {t.description && (
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{t.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
