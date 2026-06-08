import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import type { ReceivablesSummaryRead } from "@/lib/types";

export function FinanceReceivablesPanel() {
  const q = useQuery({
    queryKey: ["receivables"],
    queryFn: () => apiFetch<ReceivablesSummaryRead>("/api/services/receivables"),
  });
  const data = q.data;

  return (
    <div className="space-y-4">
      <p className="text-sm lux-caption">
        Этапы оплат по услугам из конструктора. Напоминания уходят в WhatsApp (Green API).{" "}
        <Link to="/services" className="text-[var(--mo-accent-hover)] underline">
          Каталог услуг
        </Link>
      </p>
      {q.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
      {data && (
        <div className="flex flex-wrap gap-4 text-sm">
          <span>Ожидают: <b>{data.pending_count}</b></span>
          <span className="text-red-700">
            Просрочено: <b>{data.overdue_count}</b> ({data.overdue_amount})
          </span>
          <span className="text-emerald-800">
            Оплачено за месяц: <b>{data.paid_month_amount}</b>
          </span>
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
                <td className="py-2">
                  {row.lead_id ? (
                    <Link to={`/leads/${row.lead_id}`} className="text-[var(--mo-accent-hover)] hover:underline">
                      {row.lead_name}
                    </Link>
                  ) : (
                    row.lead_name
                  )}
                </td>
                <td className="py-2">{row.template_name}</td>
                <td className="py-2">{row.label}</td>
                <td className="py-2 text-right tabular-nums">{row.amount}</td>
                <td className="py-2">{new Date(row.due_date).toLocaleDateString("ru-RU")}</td>
                <td className="py-2">
                  {row.status}
                  {row.days_overdue > 0 ? ` (${row.days_overdue} д.)` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!q.isLoading && (data?.items ?? []).length === 0 && (
          <p className="py-6 text-center text-sm mo-muted">Задолженностей нет</p>
        )}
      </section>
    </div>
  );
}
