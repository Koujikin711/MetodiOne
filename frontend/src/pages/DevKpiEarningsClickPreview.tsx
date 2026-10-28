import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { formatMoney } from "@/lib/money";

/**
 * DEV: клик по «Новых» / «Привёл» → короткий отчёт (мок, без API).
 * Прод: тот же UX на /kpi вкладка «Продажи» через /api/sales-kpi/service-earnings/detail
 */

type Row = {
  client: string;
  price: number;
  paid: number;
  /** Зачтено в оплату менеджеру */
  brought: number;
  /** Платёж месяца (для показа, даже если brought=0) */
  monthPaid: number;
  day: string;
  kind: "new" | "topup";
  note?: string;
};

type Line = {
  key: string;
  name: string;
  sales: number;
  brought: number;
  percent: number;
  earning: number;
  rows: Row[];
};

type Mgr = { id: number; name: string; lines: Line[] };

const MOCK: Mgr[] = [
  {
    id: 12,
    name: "Хайдарзода Мулкия",
    lines: [
      {
        key: "course",
        name: "Курс",
        sales: 6,
        // Только зачтённые: 5600+5000+5600+5519+5600 = 27319
        brought: 27319,
        percent: 4,
        earning: 1092.76,
        rows: [
          {
            client: "Закияи Алишер",
            price: 17000,
            paid: 500,
            brought: 0,
            monthPaid: 500,
            day: "2026-10-24",
            kind: "new",
            note: "ниже мин. — показано, не в оплату",
          },
          {
            client: "Мухаммади Абдурахим",
            price: 17000,
            paid: 5600,
            brought: 5600,
            monthPaid: 5600,
            day: "2026-10-19",
            kind: "new",
          },
          {
            client: "Гулмахмадова Ниссо",
            price: 15000,
            paid: 5000,
            brought: 5000,
            monthPaid: 5000,
            day: "2026-10-17",
            kind: "new",
          },
          {
            client: "Махмадов Мавлончон",
            price: 17000,
            paid: 8400,
            brought: 0,
            monthPaid: 3000,
            day: "2026-09-14",
            kind: "topup",
            note: "показано, не в оплату менеджеру",
          },
          {
            client: "Хуршедзода Абдулло",
            price: 17000,
            paid: 11200,
            brought: 5600,
            monthPaid: 5600,
            day: "2026-08-31",
            kind: "topup",
          },
        ],
      },
    ],
  },
];

export function DevKpiEarningsClickPreview() {
  const [open, setOpen] = useState<{ mgr: string; line: Line } | null>(null);
  const totalEarning = useMemo(
    () => MOCK.reduce((s, m) => s + m.lines.reduce((a, l) => a + l.earning, 0), 0),
    [],
  );

  return (
    <div className="app-shell-bg min-h-[100dvh] px-4 py-5 text-[var(--mo-text)] sm:px-6">
      <p className="mo-muted mb-2 text-[11px] tracking-wide">
        Локально · Привёл: показать сумму, в % менеджеру — только зачтённое
      </p>
      <h1 className="lux-heading-page text-[1.35rem]">KPI — короткий отчёт по клику</h1>
      <p className="mo-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Серым «не в оплату» — сумма видна в колонке Привёл, но в итог шапки и заработок не входит.
        Итого {formatMoney(totalEarning)}.
      </p>

      <div className="kpi-sales-board mt-4">
        <section className="mo-section px-4 py-3">
          <h2 className="text-[15px] font-semibold">Заработок · 2026-10</h2>
          <p className="mt-0.5 text-[11px] lux-caption">Нажмите на «Привёл» у Курса · Мулкия</p>
        </section>
        <div className="kpi-sales-grid">
          {MOCK.map((m) => (
            <section key={m.id} className="kpi-sales-card mo-section">
              <h3 className="kpi-sales-card__name">{m.name}</h3>
              <div className="hidden lg:block">
                <table className="kpi-data-table w-full text-sm">
                  <thead>
                    <tr>
                      <th>Услуга</th>
                      <th>Новых</th>
                      <th>Привёл</th>
                      <th>%</th>
                      <th>Заработок</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.lines.map((line) => (
                      <tr key={line.key}>
                        <td>{line.name}</td>
                        <td className="tabular-nums">{line.sales}</td>
                        <td>
                          <button type="button" className="kpi-earn-num-btn tabular-nums" onClick={() => setOpen({ mgr: m.name, line })}>
                            {formatMoney(line.brought)}
                          </button>
                        </td>
                        <td className="tabular-nums">{line.percent}%</td>
                        <td className="tabular-nums font-semibold">{formatMoney(line.earning)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="kpi-sales-compact lg:hidden">
                {m.lines.map((line) => (
                  <li key={line.key}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[13px] font-semibold">{line.name}</p>
                      <span className="text-[12px] font-semibold tabular-nums">{formatMoney(line.earning)}</span>
                    </div>
                    <p className="text-[11px] tabular-nums mo-muted">
                      новых {line.sales}
                      {" · "}
                      <button type="button" className="kpi-earn-num-btn" onClick={() => setOpen({ mgr: m.name, line })}>
                        привёл {formatMoney(line.brought)}
                      </button>
                      {" · "}
                      {line.percent}%
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
              onClick={() => setOpen(null)}
            >
              <div
                className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] shadow-2xl sm:rounded-2xl"
                role="dialog"
                aria-modal
                onClick={(e) => e.stopPropagation()}
              >
                <header className="flex items-start justify-between gap-3 border-b border-[var(--mo-border)] px-4 py-3">
                  <div>
                    <h2 className="text-base font-semibold">
                      {open.line.name} · {open.mgr}
                    </h2>
                    <p className="mt-0.5 text-xs mo-muted">
                      мок · новых {open.line.sales} · привёл (в оплату) {formatMoney(open.line.brought)}
                    </p>
                  </div>
                  <button type="button" className="btn-secondary min-h-10 px-3 text-sm" onClick={() => setOpen(null)}>
                    Закрыть
                  </button>
                </header>
                <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                  <p className="mb-2 text-[11px] mo-muted">
                    Привёл — платёж месяца. Серым «не в оплату» — видно, в % менеджеру не входит. Шапка — только зачтённое.
                  </p>
                  <table className="kpi-data-table w-full text-sm">
                    <thead>
                      <tr>
                        <th>Клиент</th>
                        <th>Цена</th>
                        <th>Оплачено</th>
                        <th>Привёл</th>
                        <th>Дата</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {open.line.rows.map((r) => {
                        const notPaid = r.brought <= 0 && r.monthPaid > 0;
                        const show = r.brought > 0 ? r.brought : r.monthPaid;
                        return (
                          <tr key={r.client + r.day}>
                            <td>{r.client}</td>
                            <td className="tabular-nums">{formatMoney(r.price)}</td>
                            <td className="tabular-nums">{formatMoney(r.paid)}</td>
                            <td className={`tabular-nums ${notPaid ? "mo-muted" : "font-semibold"}`}>
                              {show > 0 ? formatMoney(show) : "—"}
                              {notPaid ? (
                                <span className="mt-0.5 block text-[10px] font-normal mo-muted">не в оплату</span>
                              ) : null}
                            </td>
                            <td className="tabular-nums">{r.day}</td>
                            <td className="text-[11px] mo-muted">
                              {notPaid && r.note ? r.note : r.kind === "new" ? "новый · KPI" : "доплата · KPI"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
