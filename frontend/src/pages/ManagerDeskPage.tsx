import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { useChatRealtime } from "@/hooks/useChatRealtime";
import { apiFetch } from "@/lib/api";
import { theme } from "@/lib/theme";
import type { ChatThread, ChatThreadBucketCounts, TaskListResponse } from "@/lib/types";

export function ManagerDeskPage() {
  const navigate = useNavigate();
  useChatRealtime(true);

  const bucketCountsQuery = useQuery({
    queryKey: ["chat-thread-bucket-counts"],
    queryFn: () => apiFetch<ChatThreadBucketCounts>("/api/chat/threads/bucket-counts"),
  });

  const awaitingThreadsQuery = useQuery({
    queryKey: ["desk-awaiting-threads"],
    queryFn: () => apiFetch<ChatThread[]>("/api/chat/threads?bucket=awaiting_reply&limit=15&offset=0"),
  });

  const tasksQuery = useQuery({
    queryKey: ["desk-my-tasks"],
    queryFn: () =>
      apiFetch<TaskListResponse>(
        "/api/tasks?scope=my&journal=false&limit=8&offset=0&include_total=true",
      ),
  });

  const counts = bucketCountsQuery.data;
  const pendingTasks =
    tasksQuery.data?.items?.filter((t) => t.status === "pending" || t.status === "in_progress") ?? [];

  return (
    <div className="relative mx-auto max-w-[1400px] space-y-6 pb-10">
      <PageHeader
        title="Рабочий стол"
        description="Сводка, чат и задачи в одном экране."
        actions={
          <Link to="/chat" className={theme.btnPrimary}>
            Полный чат
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Ждут ответа"
          value={counts?.awaiting_reply ?? "—"}
          tone="chat"
          onClick={() => navigate("/chat")}
        />
        <StatTile
          label="Переданные"
          value={counts?.transferred ?? "—"}
          tone="warning"
          onClick={() => navigate("/chat")}
        />
        <StatTile
          label="Мои диалоги"
          value={counts?.own ?? "—"}
          tone="sales"
          onClick={() => navigate("/chat")}
        />
        <StatTile
          label="Задачи"
          value={tasksQuery.data?.total ?? pendingTasks.length}
          tone="service"
          onClick={() => navigate("/tasks")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="space-y-4">
          <Card title="Задачи" subtitle="Активные поручения">
            {pendingTasks.length === 0 ? (
              <EmptyState title="Нет активных задач" />
            ) : (
              <ul className="space-y-2">
                {pendingTasks.map((task) => (
                  <li key={task.id}>
                    <Link
                      to="/tasks"
                      className="block rounded-xl border border-[#d8d2c6] bg-white px-3 py-2 hover:border-[#2f5f85]/40"
                    >
                      <div className="text-sm font-medium text-[#1e3348]">{task.title}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-3 sm:grid-cols-3">
            <Link to="/crm" className={`${theme.surfaceElevated} block p-4 hover:border-[#2f5f85]/40`}>
              <div className="text-sm font-semibold">Воронка CRM</div>
            </Link>
            <Link to="/my-leads" className={`${theme.surfaceElevated} block p-4 hover:border-[#2f5f85]/40`}>
              <div className="text-sm font-semibold">Мои лиды</div>
            </Link>
            <Link to="/booking" className={`${theme.surfaceElevated} block p-4 hover:border-[#2f5f85]/40`}>
              <div className="text-sm font-semibold">Онлайн-запись</div>
            </Link>
          </div>
        </div>

        <Card title="Чат — ждут ответа" subtitle="Быстрый доступ к диалогам (обновление по WebSocket)">
          <div className="max-h-[min(62vh,520px)] space-y-2 overflow-y-auto pr-1">
            {awaitingThreadsQuery.isLoading && <p className="text-sm text-[#5c6b7a]">Загрузка…</p>}
            {(awaitingThreadsQuery.data ?? []).map((t) => (
              <Link
                key={t.id}
                to={`/chat?lead_id=${t.lead_id ?? ""}`}
                className="flex items-center justify-between gap-2 rounded-xl border border-[#d8d2c6] bg-[#faf8f4] px-3 py-2 hover:border-[#2f5f85]/40"
              >
                <span className="truncate text-sm font-medium text-[#1e3348]">
                  {t.lead_name || t.title || `#${t.id}`}
                </span>
                {(t.unread_count ?? 0) > 0 ? (
                  <span className="shrink-0 rounded-full bg-[#2d6a5a] px-2 py-0.5 text-[11px] font-bold text-white">
                    {t.unread_count}
                  </span>
                ) : null}
              </Link>
            ))}
            {!awaitingThreadsQuery.isLoading && (awaitingThreadsQuery.data?.length ?? 0) === 0 && (
              <EmptyState title="Нет срочных диалогов" />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
