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
    staleTime: 0,
    refetchInterval: 30_000,
    queryFn: () =>
      apiFetch<Stats>(
        `/api/rop/stats?pipeline_id=${pipelineId}&from=${from}&to=${to}`,
      ),
  });

  const managers = useMemo(() => query.data?.managers ?? [], [query.data]);

  if (pipelineId == null) return <p className="text-sm mo-muted">Выберите воронку</p>;

  return (
    <div className="rop-dense flex flex-col gap-3">
      <RopPageIntro
        title="Статистика"
        hint="Воронка менеджера за период (с / по в шапке): пришло и стадии. Архив сюда не входит."
      />
      {query.isLoading ? (
        <p className="text-sm mo-muted">Загрузка…</p>
      ) : (
        <div className="rop-stats-grid">
          {managers.map((m) => (
            <article key={m.user_id} className="rop-panel">
              <div className="rop-panel__head">
                <h3 className="rop-panel__title">{m.full_name}</h3>
                <span className="rop-panel__meta">
                  {m.leads_in} → {m.processed}
                  <em>{m.conversion_percent}%</em>
                </span>
              </div>
              {m.stages.length > 0 ? (
                <table className="rop-dense-table">
                  <thead>
                    <tr>
                      <th>Стадия</th>
                      <th className="text-right">Лидов</th>
                      <th className="text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.stages.map((s) => (
                      <tr key={s.stage_id} className={s.count === 0 ? "is-zero" : undefined}>
                        <td>{s.stage_name}</td>
                        <td className="text-right tabular-nums">{s.count}</td>
                        <td className="text-right tabular-nums">{s.percent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </article>
          ))}
          {!managers.length && <p className="text-sm mo-muted">Нет данных за период</p>}
        </div>
      )}
    </div>
  );
}
