import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import { useRopContext } from "@/pages/rop/RopLayout";

type Manager = {
  user_id: number;
  full_name: string;
  email: string;
  is_online: boolean;
  accepts_new_leads: boolean;
  active_leads: number;
  new_leads_today: number;
  bookings_today: number;
  revenue_today: number | string;
};

type Dashboard = {
  date: string;
  online_count: number;
  managers: Manager[];
};

type DayCloseManager = {
  user_id: number;
  full_name: string;
  replied_leads: number;
  unreplied_active: number;
  bookings_today: number;
  revenue_today: number | string;
  stages: { stage_id: number; stage_name: string; count: number }[];
};

type DayClose = {
  date: string;
  managers: DayCloseManager[];
};

function money(v: number | string) {
  return Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

export function RopDashboardPage() {
  const { pipelineId } = useRopContext();
  const qc = useQueryClient();
  const [dayClose, setDayClose] = useState<DayClose | null>(null);

  const dashQuery = useQuery({
    queryKey: ["rop-dashboard", pipelineId],
    enabled: pipelineId != null,
    refetchInterval: 30_000,
    queryFn: () =>
      apiFetch<Dashboard>(`/api/rop/dashboard?pipeline_id=${pipelineId}`),
  });

  const dayCloseMutation = useMutation({
    mutationFn: () =>
      apiFetch<DayClose>(`/api/rop/dashboard/day-close?pipeline_id=${pipelineId}`),
    onSuccess: (data) => {
      setDayClose(data);
      toast.success("Итоги дня загружены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (pipelineId == null) {
    return <p className="text-sm mo-muted">Выберите воронку</p>;
  }

  const managers = dashQuery.data?.managers ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm mo-muted">
          В сети: <strong className="text-[var(--mo-text)]">{dashQuery.data?.online_count ?? 0}</strong>
          {" · "}
          {dashQuery.data?.date}
        </p>
        <button
          type="button"
          className="mo-btn-primary text-sm"
          disabled={dayCloseMutation.isPending}
          onClick={() => dayCloseMutation.mutate()}
        >
          Итоги дня
        </button>
      </div>

      {dashQuery.isLoading ? (
        <p className="text-sm mo-muted">Загрузка…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--mo-border)]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-[var(--mo-surface)] text-xs mo-muted">
              <tr>
                <th className="px-3 py-2">Менеджер</th>
                <th className="px-3 py-2">Статус</th>
                <th className="px-3 py-2">Активные</th>
                <th className="px-3 py-2">Новые</th>
                <th className="px-3 py-2">Записи</th>
                <th className="px-3 py-2">Принёс</th>
              </tr>
            </thead>
            <tbody>
              {managers.map((m) => (
                <tr key={m.user_id} className="border-t border-[var(--mo-border)]">
                  <td className="px-3 py-2 font-medium">{m.full_name}</td>
                  <td className="px-3 py-2">
                    <span className={m.is_online ? "text-emerald-600" : "mo-muted"}>
                      {m.is_online ? "В сети" : "Не в сети"}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{m.active_leads}</td>
                  <td className="px-3 py-2 tabular-nums">{m.new_leads_today}</td>
                  <td className="px-3 py-2 tabular-nums">{m.bookings_today}</td>
                  <td className="px-3 py-2 tabular-nums">{money(m.revenue_today)}</td>
                </tr>
              ))}
              {!managers.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center mo-muted">
                    Нет менеджеров на воронке
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {dayClose && (
        <div className="rounded-xl border border-[var(--mo-border)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Итоги {dayClose.date}</h2>
            <button type="button" className="text-sm mo-muted" onClick={() => setDayClose(null)}>
              Скрыть
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {dayClose.managers.map((m) => (
              <div key={m.user_id} className="rounded-lg bg-[var(--mo-surface)] p-3 text-sm">
                <div className="font-medium">{m.full_name}</div>
                <div className="mt-1 mo-muted">
                  Ответил: {m.replied_leads} · ещё без ответа: {m.unreplied_active} · записи:{" "}
                  {m.bookings_today} · выручка: {money(m.revenue_today)}
                </div>
                {m.stages.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.stages.map((s) => (
                      <span
                        key={s.stage_id}
                        className="rounded-md border border-[var(--mo-border)] px-2 py-0.5 text-xs"
                      >
                        {s.stage_name}: {s.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        className="self-start text-sm mo-muted underline"
        onClick={() => qc.invalidateQueries({ queryKey: ["rop-dashboard", pipelineId] })}
      >
        Обновить
      </button>
    </div>
  );
}
