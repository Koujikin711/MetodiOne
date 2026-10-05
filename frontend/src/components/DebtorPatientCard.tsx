import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";

import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import type { LeadCard, SalesKpiDebtorRow } from "@/lib/types";

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function money(value: string | number): string {
  const n = typeof value === "number" ? value : Number(value);
  return formatMoney(Number.isFinite(n) ? n : 0);
}

export function DebtorPatientCard({
  row,
  onClose,
}: {
  row: SalesKpiDebtorRow;
  onClose: () => void;
}) {
  const leadId = row.lead_id ?? null;
  const cardQuery = useQuery({
    queryKey: ["lead-card", leadId],
    enabled: leadId != null,
    queryFn: () => apiFetch<LeadCard>(`/api/leads/${leadId}/card`),
  });
  const card = cardQuery.data;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-3 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="debtor-card-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-bg)] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="debtor-card-title" className="truncate text-lg font-semibold text-[var(--mo-text)]">
              {card?.name || row.client_name}
            </h2>
            <p className="text-sm mo-muted">{card?.phone || row.client_phone || "телефон не указан"}</p>
          </div>
          <button type="button" className="shrink-0 rounded-lg border border-[var(--mo-border)] px-3 py-1.5 text-sm text-[var(--mo-text)]" onClick={onClose}>
            Закрыть
          </button>
        </div>

        {leadId == null ? (
          <p className="mt-3 rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] px-3 py-2.5 text-sm leading-relaxed text-[var(--mo-text)]">
            Продажа ещё не связана с карточкой пациента. Приёмов и смены менеджера здесь нет. Они появятся, когда продажу свяжут с человеком в CRM.
          </p>
        ) : cardQuery.isLoading ? (
          <p className="mt-3 text-sm mo-muted">Загрузка карточки…</p>
        ) : cardQuery.isError ? (
          <p className="mt-3 text-sm text-red-300">{(cardQuery.error as Error).message}</p>
        ) : card ? (
          <div className="mt-4 space-y-4 text-sm">
            <section>
              <h3 className="mb-1 font-semibold text-[var(--mo-text)]">Первое обращение</h3>
              <p className="text-[var(--mo-text)]">
                {when(card.created_at)}
                {card.source ? ` · ${card.source}` : ""}
                {card.stage_name ? ` · ${card.stage_name}` : ""}
              </p>
              <p className="mo-muted">Сейчас ведёт: {card.manager_name || "не назначен"}</p>
            </section>

            <section>
              <h3 className="mb-1 font-semibold text-[var(--mo-text)]">Менеджеры</h3>
              {card.managers.length === 0 ? (
                <p className="mo-muted">Менеджер не менялся.</p>
              ) : (
                <ul className="space-y-1">
                  {card.managers.map((m, i) => (
                    <li key={`${m.manager_name}-${i}`} className="text-[var(--mo-text)]">
                      {when(m.at)} · {m.manager_name} · {m.note}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-1 font-semibold text-[var(--mo-text)]">Приёмы</h3>
              {card.visits.length === 0 ? (
                <p className="mo-muted">Записей пока нет.</p>
              ) : (
                <ul className="space-y-1.5">
                  {card.visits.map((v, i) => (
                    <li key={`${v.start_at}-${i}`} className="text-[var(--mo-text)]">
                      <span className="font-medium">{when(v.start_at)}</span>
                      {" · "}
                      {v.service}
                      {v.specialist_name ? ` · ${v.specialist_name}` : ""}
                      {" · "}
                      {v.status}
                      {" · "}
                      {money(v.paid_amount)} из {money(v.service_amount)}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-1 font-semibold text-[var(--mo-text)]">Курс и протокол</h3>
              {card.sales.length === 0 ? (
                <p className="mo-muted">Курса и протокола в карточке пока нет.</p>
              ) : (
                <ul className="space-y-1.5">
                  {card.sales.map((s, i) => (
                    <li key={`${s.sold_at}-${i}`} className="text-[var(--mo-text)]">
                      <span className="font-medium">{when(s.sold_at)}</span>
                      {" · "}
                      {s.name}
                      {s.manager_name ? ` · ${s.manager_name}` : ""}
                      {" · "}
                      {s.status}
                      {" · "}
                      оплачено {money(s.paid_amount)} из {money(s.service_amount)}
                      {Number(s.debt_amount) > 0 ? ` · долг ${money(s.debt_amount)}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        <section className="mt-4 rounded-xl border border-[var(--mo-border)] p-3 text-sm">
          <h3 className="font-semibold text-[var(--mo-text)]">Остаток по этой продаже</h3>
          <p className="mt-1 font-medium text-[var(--mo-text)]">{row.indicator_name}</p>
          <dl className="mt-2 grid grid-cols-3 gap-2">
            <div>
              <dt className="text-xs mo-muted">Стоимость</dt>
              <dd className="mt-0.5 tabular-nums text-[var(--mo-text)]">{money(row.service_amount)}</dd>
            </div>
            <div>
              <dt className="text-xs mo-muted">Оплачено</dt>
              <dd className="mt-0.5 tabular-nums text-[var(--mo-text)]">{money(row.paid_amount)}</dd>
            </div>
            <div>
              <dt className="text-xs mo-muted">Осталось</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-[var(--mo-text)]">{money(row.debt_amount)}</dd>
            </div>
          </dl>
          <p className="mt-2 mo-muted">Продажу вёл: {row.manager_name || "не указан"}</p>
          {(row.payments ?? []).length > 0 ? (
            <ul className="mt-2 space-y-1 border-t border-[var(--mo-border)] pt-2">
              {(row.payments ?? []).map((p, i) => (
                <li key={`${p.paid_at}-${i}`} className="flex justify-between gap-3 text-[var(--mo-text)]">
                  <span>{when(p.paid_at)}</span>
                  <span className="tabular-nums">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 mo-muted">Оплат по этой продаже пока нет.</p>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
}
