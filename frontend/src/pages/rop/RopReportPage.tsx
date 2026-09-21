import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch } from "@/lib/api";
import { DateField } from "@/components/DateField";
import { useRopContext } from "@/pages/rop/RopLayout";

type Report = {
  rows: {
    manager_id: number;
    manager_name: string;
    service_name: string;
    amount: number | string;
  }[];
  total: number | string;
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function money(v: number | string) {
  return Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

export function RopReportPage() {
  const { pipelineId } = useRopContext();
  const [from, setFrom] = useState(monthStartYmd);
  const [to, setTo] = useState(todayYmd);

  const query = useQuery({
    queryKey: ["rop-report", pipelineId, from, to],
    enabled: pipelineId != null,
    queryFn: () =>
      apiFetch<Report>(
        `/api/rop/report?pipeline_id=${pipelineId}&from=${from}&to=${to}`,
      ),
  });

  if (pipelineId == null) return <p className="text-sm mo-muted">Выберите воронку</p>;

  const rows = query.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <label className="text-sm mo-muted">
          С
          <DateField value={from} onChange={setFrom} className="mo-input mt-1" />
        </label>
        <label className="text-sm mo-muted">
          По
          <DateField value={to} onChange={setTo} className="mo-input mt-1" />
        </label>
      </div>

      <div className="rounded-xl border border-[var(--mo-border)] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-medium">Выручка отдела продаж</h3>
          <span className="text-lg tabular-nums font-semibold">
            {money(query.data?.total ?? 0)}
          </span>
        </div>
        {query.isLoading ? (
          <p className="mt-3 text-sm mo-muted">Загрузка…</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-xs mo-muted">
                <tr>
                  <th className="py-1 text-left">Менеджер</th>
                  <th className="py-1 text-left">Услуга</th>
                  <th className="py-1 text-right">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.manager_id}-${r.service_name}-${i}`} className="border-t border-[var(--mo-border)]">
                    <td className="py-1">{r.manager_name}</td>
                    <td className="py-1">{r.service_name}</td>
                    <td className="py-1 text-right tabular-nums">{money(r.amount)}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center mo-muted">
                      Нет оплат за период
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
