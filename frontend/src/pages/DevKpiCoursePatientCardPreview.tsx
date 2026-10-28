import { useEffect, useState } from "react";

import { DebtorPatientCard } from "@/components/DebtorPatientCard";
import { formatMoney } from "@/lib/money";
import type { SalesKpiDebtorRow, SalesKpiManualSale } from "@/lib/types";

/**
 * DEV: клик по пациенту в «Курсы / протоколы» → история оплат.
 */

const MOCK_SALE: SalesKpiManualSale = {
  id: 101,
  pipeline_id: 2,
  plan_item_id: 18,
  plan_item_name: "Курс",
  manager_user_id: 12,
  manager_name: "Хайдарзода Мулкия",
  client_name: "Химатов Холид",
  client_phone: "927000111",
  lead_id: null,
  service_amount: 17000,
  paid_amount: 11200,
  debt_amount: 5800,
  sold_at: "2026-10-26T10:00:00+05:00",
  status: "active",
  returned_at: null,
  note: null,
  counts_in_kpi: true,
  payments: [
    { id: 1, amount: 5600, is_first: true, note: "первый", paid_at: "2026-09-20T12:00:00+05:00", confirmation: "confirmed" },
    { id: 2, amount: 5600, is_first: false, note: "доплата", paid_at: "2026-10-26T11:00:00+05:00", confirmation: "confirmed" },
  ],
};

function saleToCard(sale: SalesKpiManualSale): SalesKpiDebtorRow {
  return {
    source: "manual",
    source_id: sale.id,
    lead_id: sale.lead_id ?? null,
    sold_at: sale.sold_at,
    client_name: sale.client_name,
    client_phone: sale.client_phone,
    indicator_name: sale.plan_item_name,
    manager_id: sale.manager_user_id,
    manager_name: sale.manager_name,
    service_amount: sale.service_amount,
    paid_amount: sale.paid_amount,
    debt_amount: sale.debt_amount,
    status: sale.status,
    payments: (sale.payments ?? []).map((p) => ({
      paid_at: p.paid_at,
      amount: p.amount,
      kind: p.is_first ? "first" : "topup",
    })),
  };
}

export function DevKpiCoursePatientCardPreview() {
  const [card, setCard] = useState<SalesKpiDebtorRow | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.theme;
    root.dataset.theme = "dark";
    return () => {
      if (prev) root.dataset.theme = prev;
      else delete root.dataset.theme;
    };
  }, []);

  return (
    <div className="app-shell-bg min-h-[100dvh] px-4 py-5 text-[var(--mo-text)] sm:px-6">
      <p className="mo-muted mb-2 text-[11px] tracking-wide">
        Локально · клик по пациенту → полная история оплат
      </p>
      <h1 className="lux-heading-page text-[1.35rem]">Курсы — карточка пациента</h1>
      <p className="mo-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Как на вкладке «Курсы / протоколы»: нажмите имя пациента — откроется история платежей по этой продаже.
      </p>

      <div className="mo-section mt-4 overflow-x-auto p-0">
        <table className="sold-course-sheet w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--mo-border)] text-[11px] uppercase tracking-wide mo-muted">
              <th className="px-3 py-2">Дата</th>
              <th className="px-3 py-2">Тип</th>
              <th className="px-3 py-2">Менеджер</th>
              <th className="px-3 py-2">Пациент</th>
              <th className="px-3 py-2">Сумма</th>
              <th className="px-3 py-2">Оплачено</th>
              <th className="px-3 py-2">Долг</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--mo-border)]">
              <td className="px-3 py-2 tabular-nums">26.10.26</td>
              <td className="px-3 py-2">{MOCK_SALE.plan_item_name}</td>
              <td className="px-3 py-2">{MOCK_SALE.manager_name}</td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  className="font-medium underline-offset-2 hover:underline"
                  onClick={() => setCard(saleToCard(MOCK_SALE))}
                >
                  {MOCK_SALE.client_name}
                </button>
              </td>
              <td className="px-3 py-2 tabular-nums">{formatMoney(17000)}</td>
              <td className="px-3 py-2 tabular-nums">{formatMoney(11200)}</td>
              <td className="px-3 py-2 tabular-nums font-semibold">{formatMoney(5800)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {card ? <DebtorPatientCard row={card} onClose={() => setCard(null)} /> : null}
    </div>
  );
}
