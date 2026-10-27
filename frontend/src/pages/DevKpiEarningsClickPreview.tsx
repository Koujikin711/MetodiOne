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
  status: "full" | "partial";
  day: string;
  inBrought: boolean;
  source: "kpi" | "booking";
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
    id: 20,
    name: "Алибекзода Мавлуда",
    lines: [
      {
        key: "c15",
        name: "Курс 15",
        sales: 21,
        brought: 26000,
        percent: 10,
        earning: 2600,
        rows: [
          { client: "Файзуллозода Сумая", price: 1300, paid: 1300, status: "full", day: "2026-10-07", inBrought: true, source: "booking" },
          { client: "Манонзода Абдурахмон", price: 1300, paid: 1300, status: "full", day: "2026-10-08", inBrought: true, source: "booking" },
          { client: "Абдурашидзода Мусо", price: 1300, paid: 200, status: "partial", day: "2026-10-29", inBrought: false, source: "booking" },
        ],
      },
      {
        key: "proto",
        name: "Протокол",
        sales: 3,
        brought: 3000,
        percent: 4,
        earning: 120,
        rows: [
          { client: "Мачидзода Усмон", price: 3000, paid: 3000, status: "full", day: "2026-10-19", inBrought: true, source: "kpi" },
          { client: "Умарзода Алия", price: 3000, paid: 300, status: "partial", day: "2026-10-19", inBrought: false, source: "kpi" },
          { client: "Дживонзода Закия", price: 3000, paid: 1900, status: "partial", day: "2026-10-02", inBrought: false, source: "kpi" },
        ],
      },
      {
        key: "course",
        name: "Курс",
        sales: 5,
        brought: 5666.67,
        percent: 4,
        earning: 226.67,
        rows: [
          { client: "Химатов Холид", price: 17000, paid: 5600, status: "partial", day: "2026-10-26", inBrought: true, source: "kpi" },
          { client: "Хикматов Холид", price: 17000, paid: 11200, status: "partial", day: "2026-10-26", inBrought: true, source: "kpi" },
          { client: "Шарипова Назокат", price: 17000, paid: 300, status: "partial", day: "2026-10-24", inBrought: false, source: "kpi" },
        ],
      },
    ],
  },
];

function payLabel(s: Row["status"]) {
  return s === "full" ? "полная" : "неполная";
}

export function DevKpiEarningsClickPreview() {
  const [open, setOpen] = useState<{ mgr: string; line: Line } | null>(null);
  const totalEarning = useMemo(
    () => MOCK.reduce((s, m) => s + m.lines.reduce((a, l) => a + l.earning, 0), 0),
    [],
  );

  return (
    <div className="app-shell-bg min-h-[100dvh] px-4 py-5 text-[var(--mo-text)] sm:px-6">
      <p className="mo-muted mb-2 text-[11px] tracking-wide">Локально · клик по цифрам «Новых» / «Привёл»</p>
      <h1 className="lux-heading-page text-[1.35rem]">KPI — короткий отчёт по клику</h1>
      <p className="mo-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Нажмите на число в колонке «Новых» или «Привёл» — откроется список: кто, цена, оплачено.
        На проде данные с API; здесь мок по Мавлуде.
      </p>

      <div className="kpi-sales-board mt-4">
        <section className="mo-section px-4 py-3">
          <h2 className="text-[15px] font-semibold">Заработок · 2026-10</h2>
          <p className="mt-0.5 text-[11px] lux-caption">
            Нажмите на «Новых» или «Привёл». Итого {formatMoney(totalEarning)}
          </p>
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
                        <td className="tabular-nums">
                          <button
                            type="button"
                            className="kpi-earn-num-btn"
                            onClick={() => setOpen({ mgr: m.name, line })}
                          >
                            {line.sales}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="kpi-earn-num-btn"
                            onClick={() => setOpen({ mgr: m.name, line })}
                          >
                            {formatMoney(line.brought)}
                          </button>
                        </td>
                        <td>{line.percent}</td>
                        <td>{formatMoney(line.earning)}</td>
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
                      <button type="button" className="kpi-earn-num-btn" onClick={() => setOpen({ mgr: m.name, line })}>
                        новых {line.sales}
                      </button>
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
                      мок · новых {open.line.sales} · привёл {formatMoney(open.line.brought)} · в списке{" "}
                      {open.line.rows.length} (фрагмент)
                    </p>
                  </div>
                  <button type="button" className="btn-secondary min-h-10 px-3 text-sm" onClick={() => setOpen(null)}>
                    Закрыть
                  </button>
                </header>
                <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                  <table className="kpi-data-table w-full text-sm">
                    <thead>
                      <tr>
                        <th>Клиент</th>
                        <th>Цена</th>
                        <th>Оплачено</th>
                        <th>Статус</th>
                        <th>Дата</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {open.line.rows.map((r) => (
                        <tr key={r.client + r.day}>
                          <td>{r.client}</td>
                          <td className="tabular-nums">{formatMoney(r.price)}</td>
                          <td className="tabular-nums">{formatMoney(r.paid)}</td>
                          <td>{payLabel(r.status)}</td>
                          <td className="tabular-nums">{r.day}</td>
                          <td className="text-[11px] mo-muted">
                            {r.inBrought ? "Привёл" : ""}
                            {r.source === "booking" ? " · запись" : " · KPI"}
                          </td>
                        </tr>
                      ))}
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
