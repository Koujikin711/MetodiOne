import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { RopPageIntro } from "@/components/RopPageIntro";
import { apiFetch } from "@/lib/api";
import { useRopContext } from "@/pages/rop/RopLayout";

type Stats = {
  managers: {
    user_id: number;
    full_name: string;
    leads_in: number;
    processed: number;
    conversion_percent: number;
    stages: { stage_id: number; stage_name: string; count: number; percent: number }[];
  }[];
};

export function RopStatsPage() {
  const { pipelineId, from, to } = useRopContext();

  const query = useQuery({
    queryKey: ["rop-stats", pipelineId, from, to],
    enabled: pipelineId != null,
    queryFn: () =>
      apiFetch<Stats>(
        `/api/rop/stats?pipeline_id=${pipelineId}&from=${from}&to=${to}`,
      ),
  });

  const managers = useMemo(() => query.data?.managers ?? [], [query.data]);

  if (pipelineId == null) return <p className="text-sm mo-muted">Выберите воронку</p>;

  return (
    <div className="flex flex-col gap-4">
      <RopPageIntro
        title="Статистика"
        hint="Воронка по каждому менеджеру за период сверху (с / по). Сколько лидов пришло и как они разошлись по стадиям."
      />
      {query.isLoading ? (
        <p className="text-sm mo-muted">Загрузка…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {managers.map((m) => (
            <div key={m.user_id} className="rounded-xl border border-[var(--mo-border)] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium">{m.full_name}</h3>
                <span className="text-sm mo-muted">
                  Получил {m.leads_in} · обработал {m.processed} ({m.conversion_percent}%)
                </span>
              </div>
              {m.stages.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs mo-muted">
                      <tr>
                        <th className="py-1.5 text-left font-normal">Стадия</th>
                        <th className="w-32 py-1.5 text-right font-normal">Лидов</th>
                        <th className="w-28 py-1.5 text-right font-normal">Доля</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.stages.map((s) => (
                        <tr key={s.stage_id} className="border-t border-[var(--mo-border)]">
                          <td className="py-1">{s.stage_name}</td>
                          <td className="py-1 text-right tabular-nums">{s.count}</td>
                          <td className="py-1 text-right tabular-nums">{s.percent}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          {!managers.length && <p className="text-sm mo-muted">Нет данных за период</p>}
        </div>
      )}
    </div>
  );
}
