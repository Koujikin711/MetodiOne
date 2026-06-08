import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { ReceivablesSummaryRead } from "@/lib/types";

export function ReceivablesPage() {
  const q = useQuery({
    queryKey: ["receivables"],
    queryFn: () => apiFetch<ReceivablesSummaryRead>("/api/services/receivables"),
  });
  const data = q.data;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <header>
        <h1 className="text-2xl font-semibold">Дебиторка</h1>
        <p className="text-sm lux-caption">Этапы оплат по курсам и услугам</p>
      </header>
      {data && (
        <div className="flex flex-wrap gap-4 text-sm">
          <span>Ожидают: {data.pending_count}</span>
          <span className="text-red-700">Просрочено: {data.overdue_count} ({data.overdue_amount})</span>
          <span className="text-emerald-800">Оплачено за месяц: {data.paid_month_amount}</span>
        </div>
      )}
      <section className="mo-section overflow-x-auto p-4">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="lux-caption border-b border-[var(--mo-border)]">
              <th className="py-2 text-left">Пациент</th>
              <th className="py-2 text-left">Услуга</th>
              <th className="py-2 text-left">Этап</th>
              <th className="py-2 text-right">Сумма</th>
              <th className="py-2 text-left">Срок</th>
              <th className="py-2 text-left">Статус</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((row) => (
              <tr key={row.installment_id} className="border-b border-[var(--mo-border)]/60">
                <td className="py-2">{row.lead_name}</td>
                <td className="py-2">{row.template_name}</td>
                <td className="py-2">{row.label}</td>
                <td className="py-2 text-right tabular-nums">{row.amount}</td>
                <td className="py-2">{new Date(row.due_date).toLocaleDateString("ru-RU")}</td>
                <td className="py-2">{row.status}{row.days_overdue > 0 ? ` (${row.days_overdue} д.)` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
