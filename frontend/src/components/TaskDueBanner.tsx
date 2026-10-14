import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Bell } from "@/components/icons";
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
  return d.toLocaleTimeString("ru-RU", {
    timeZone: "Asia/Dushanbe",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  if (!token || !watch) return null;

  const freshOnly = fresh.filter((task) => !due.some((item) => item.id === task.id));
  const count = due.length + freshOnly.length;

  return (
    <div ref={rootRef} className="pointer-events-none fixed right-14 top-3 z-40 print:hidden sm:right-4 sm:top-4">
      <button
        type="button"
        className="pointer-events-auto relative flex h-10 w-10 items-center justify-center rounded-full border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] text-[var(--mo-text)] shadow-sm"
        aria-label={count > 0 ? `Уведомления: ${count}` : "Уведомления"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell className="h-5 w-5" />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="pointer-events-auto absolute right-0 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--mo-border)] px-3 py-2">
            <p className="text-sm font-semibold text-[var(--mo-text)]">Уведомления</p>
            {perm === "default" ? (
              <button
                type="button"
                className="text-xs underline underline-offset-2"
                onClick={() => {
                  void enableTaskNotifications().then((next) => setPerm(next));
                }}
              >
                Включить
              </button>
            ) : null}
          </div>
          {count === 0 ? (
            <p className="px-3 py-3 text-sm mo-muted">Нет задач на этот час</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {due.map((task) => (
                <li key={`due-${task.id}`}>
                  <Link
                    to="/tasks"
                    className="block px-3 py-2 text-sm text-[var(--mo-text)] hover:bg-[var(--mo-surface)]"
                    onClick={() => setOpen(false)}
                  >
                    <span className="font-medium">{stageLabel(task.warn_stage)}</span>
                    <span className="mt-0.5 block truncate">
                      {task.title}
                      {clock(task.deadline) ? ` · ${clock(task.deadline)}` : ""}
                      {task.client_name || task.client_phone
                        ? ` · ${task.client_name ?? "Клиент"}${task.client_phone ? ` · ${task.client_phone}` : ""}`
                        : ""}
                    </span>
                  </Link>
                </li>
              ))}
              {freshOnly.map((task) => (
                <li key={`new-${task.id}`}>
                  <Link
                    to="/tasks"
                    className="block px-3 py-2 text-sm text-[var(--mo-text)] hover:bg-[var(--mo-surface)]"
                    onClick={() => setOpen(false)}
                  >
                    <span className="font-medium">Вам поставили задачу</span>
                    <span className="mt-0.5 block truncate">
                      {task.title}
                      {clock(task.deadline) ? ` · ${clock(task.deadline)}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
