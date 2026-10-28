import { useEffect } from "react";

import { formatMoney } from "@/lib/money";

/**
 * DEV: протокол как Курс 15 — при закрытии цены в «Привёл» вся сумма; Халиловой нет.
 */

export function DevKpiDuplicateNamePreview() {
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
      <p className="mo-muted mb-2 text-[11px] tracking-wide">Локально · протокол после полной = вся сумма</p>
      <h1 className="lux-heading-page text-[1.35rem]">Протокол · Хайдарзода Мулкия</h1>
      <p className="mo-muted mt-1 text-sm">2026-10 · новых 0 · привёл {formatMoney(3000)}</p>
      <p className="mo-muted mt-2 max-w-3xl text-sm leading-relaxed">
        Курбонзода: 400 + 2 000 в сентябре не считались (цена не закрыта). 17.10 доплата 600 закрыла
        цену → в «Привёл» октября <b className="text-[var(--mo-text)]">3 000</b>, % от 3 000. Халиловой нет.
      </p>

      <section className="mo-section mt-4 space-y-3 p-4">
        <h2 className="text-sm font-bold">Что у Мулкии</h2>
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
            <tr className="bg-[var(--mo-surface-elevated)]/40">
              <td className="font-semibold">Курбонзода Хусейн</td>
              <td className="tabular-nums">{formatMoney(3000)}</td>
              <td className="tabular-nums">{formatMoney(3000)}</td>
              <td className="tabular-nums font-semibold">{formatMoney(3000)}</td>
              <td className="tabular-nums text-xs">2026-10-17</td>
              <td className="text-[11px] mo-muted">закрытие цены · вся сумма</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}