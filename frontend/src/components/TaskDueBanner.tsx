import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import {
  enableTaskNotifications,
  syncTaskWebNotifications,
  taskNotifyPermission,
} from "@/lib/taskWebNotify";
import type { Task, TaskListResponse } from "@/lib/types";

function clock(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function stageLabel(stage: Task["warn_stage"]) {
  if (stage === "30") return "Через 30 минут";
  if (stage === "15") return "Через 15 минут";
  return "Пора выполнить задачу";
}

export function TaskDueBanner() {
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const watch = role === "manager" || role === "expert";
  const [perm, setPerm] = useState(taskNotifyPermission);
  const [fresh, setFresh] = useState<Task[]>([]);

  const warnings = useQuery({
    queryKey: ["task-warnings"],
    queryFn: () => apiFetch<Task[]>("/api/tasks/warnings"),
    enabled: Boolean(token),
    refetchInterval: 20_000,
  });
  const mine = useQuery({
    queryKey: ["task-mine-active"],
    queryFn: () =>
      apiFetch<TaskListResponse>("/api/tasks?scope=my&journal=false&include_total=false&limit=100"),
    enabled: Boolean(token) && watch,
    refetchInterval: 20_000,
  });

  const due = warnings.data ?? [];
  const active = mine.data?.items ?? [];

  const dueKey = due.map((task) => `${task.id}:${task.deadline ?? ""}:${task.warn_stage ?? ""}`).join("|");
  const activeKey = active.map((task) => task.id).join("|");

  useEffect(() => {
    if (!watch || !mine.isSuccess) return;
    setFresh(syncTaskWebNotifications(active, due));
  }, [watch, perm, mine.isSuccess, dueKey, activeKey]);

  if (!token) return null;

  const ask =
    watch && perm === "default" ? (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 print:hidden">
        <p className="text-sm text-[var(--mo-text)]">Включить уведомления о задачах в браузере</p>
        <button
          type="button"
          className="btn-primary px-3 py-1.5 text-xs"
          onClick={() => {
            void enableTaskNotifications().then((next) => setPerm(next));
          }}
        >
          Включить
        </button>
      </div>
    ) : null;

  const freshOnly = fresh.filter((task) => !due.some((item) => item.id === task.id));
  const freshBlock =
    freshOnly.length > 0 ? (
      <div className="mb-3 rounded-2xl border border-[var(--mo-accent)]/40 bg-[var(--mo-accent-soft)] px-4 py-3 print:hidden">
        <p className="text-sm font-semibold text-[var(--mo-text)]">Вам поставили задачу</p>
        <ul className="mt-1 space-y-1">
          {freshOnly.map((task) => (
            <li key={task.id} className="text-sm text-[var(--mo-text)]">
              <Link to="/tasks" className="font-medium underline underline-offset-2">
                {task.title}
              </Link>
              {clock(task.deadline) ? <span className="mo-muted"> · {clock(task.deadline)}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  if (due.length === 0 && !ask && !freshBlock) return null;

  return (
    <>
      {ask}
      {freshBlock}
      {due.length > 0 ? (
        <div className="mb-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 print:hidden">
          <p className="text-sm font-semibold text-[var(--mo-text)]">
            {new Set(due.map((task) => task.warn_stage ?? "due")).size === 1
              ? stageLabel(due[0]?.warn_stage)
              : "Предупреждение о задаче"}
          </p>
          <ul className="mt-1 space-y-1">
            {due.map((task) => (
              <li key={task.id} className="text-sm text-[var(--mo-text)]">
                <Link to="/tasks" className="font-medium underline underline-offset-2">
                  {task.title}
                </Link>
                {clock(task.deadline) ? <span className="mo-muted"> · {clock(task.deadline)}</span> : null}
                {task.client_name || task.client_phone ? (
                  <span className="mo-muted">
                    {" · "}
                    {task.client_name ?? "Клиент"}
                    {task.client_phone ? ` · ${task.client_phone}` : ""}
                  </span>
                ) : null}
                {task.repeats_daily ? <span className="mo-muted"> · каждый день</span> : null}
                {new Set(due.map((item) => item.warn_stage ?? "due")).size > 1 ? (
                  <span className="mo-muted"> · {stageLabel(task.warn_stage).toLowerCase()}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
