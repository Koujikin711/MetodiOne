import { useEffect } from "react";

/**
 * Только DEV: логика «Заработок» KPI vs CRM.
 * Источник: sales_kpi_weighted — course_stage_* (мин. 3к/5к), protocol_brought_waits_for_full_price
 */

type Ex = {
  title: string;
  rows: { label: string; value: string }[];
  note?: string;
};

const EXAMPLES: Ex[] = [
  {
    title: "Курс 15 — после полной оплаты",
    rows: [
      { label: "Цена", value: "1 300" },
      { label: "Залог 500", value: "Новых +1 · Привёл 0" },
      { label: "Доплата до 1 300", value: "Привёл: платежи месяца после закрытия цены" },
      { label: "Как протокол", value: "paid ≥ цена → платежи в «Привёл»" },
    ],
    note: "«Новых» с первой оплаты > 0. «Привёл» — только когда цена закрыта.",
  },
  {
    title: "Курс — мин. 5 000 / 3 000, макс нет",
    rows: [
      { label: "Курс 15–17 000", value: "мин. 5 000" },
      { label: "Курс ~10 000", value: "мин. 3 000" },
      { label: "Оплата 4 999 на 17 000", value: "НЕ в Привёл (ниже мин.)" },
      { label: "Оплата 2 999 на 10 000", value: "НЕ в Привёл (ниже мин.)" },
      { label: "Оплата 5 600", value: "Привёл 5 600 (как есть)" },
      { label: "Оплата 17 000 / 15 000", value: "Привёл вся сумма как есть" },
    ],
    note: "Неполная сумма ниже минимума в «Привёл» не идёт. 3000/5000 — только мин., макс нет.",
  },
  {
    title: "Протокол — только полная оплата",
    rows: [
      { label: "Цена", value: "3 000" },
      { label: "Оплата 2 400", value: "НЕ в Привёл (не полная)" },
      { label: "Залог 1 000", value: "Новых +1 · Привёл 0" },
      { label: "Доплата до 3 000+", value: "Привёл = платежи месяца (как есть)" },
    ],
    note: "Пока цена не закрыта — в «Привёл» ничего не добавляем.",
  },
  {
    title: "Запись (онлайн)",
    rows: [
      { label: "Основной курс на визите", value: "Привёл = оплата после мин. 5к/3к" },
      { label: "Курс 15 / прочее", value: "Привёл только при полной оплате визита" },
      { label: "Новых (визит)", value: "не отмена + есть оплата" },
    ],
  },
];

export function DevKpiEarningsLogicPreview() {
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
        Локально · KPI «Привёл»: курс мин. 5к/3к как есть · Курс 15 / протокол после полной
      </p>
      <h1 className="lux-heading-page text-[1.35rem]">KPI — как считается «Привёл»</h1>
      <p className="mo-muted mt-2 max-w-3xl text-sm leading-relaxed">
        Заработок = <b className="text-[var(--mo-text)]">Привёл × %</b>. «Новых» — только счётчик открытий
        (первая оплата &gt; 0), на сумму не влияет.
      </p>

      <section className="mo-section mt-4 space-y-3 p-4">
        <h2 className="text-sm font-bold tracking-tight">Правила</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[var(--mo-border)] p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-sky-300">Новых</p>
            <ul className="mt-2 space-y-1.5 text-sm leading-snug">
              <li>Продажа открыта в этом месяце</li>
              <li>Любая оплата &gt; 0</li>
              <li>Доплата старой продажи не даёт +1</li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--mo-border)] p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-300">Привёл</p>
            <ul className="mt-2 space-y-1.5 text-sm leading-snug">
              <li>
                <b>Курс:</b> после мин. 5 000 / 3 000 — сколько оплатил (макс нет)
              </li>
              <li>
                <b>Курс 15 / Протокол:</b> только после полной оплаты
              </li>
              <li>Заработок = Привёл × %</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-3 lg:grid-cols-2">
        {EXAMPLES.map((ex) => (
          <article key={ex.title} className="mo-section p-4">
            <h3 className="text-sm font-bold tracking-tight">{ex.title}</h3>
            <dl className="mt-3 space-y-2">
              {ex.rows.map((r) => (
                <div
                  key={r.label}
                  className="flex flex-col gap-0.5 border-b border-[var(--mo-border)] pb-2 last:border-0 sm:flex-row sm:justify-between sm:gap-3"
                >
                  <dt className="text-xs mo-muted">{r.label}</dt>
                  <dd className="text-sm font-semibold tabular-nums sm:text-right">{r.value}</dd>
                </div>
              ))}
            </dl>
            {ex.note ? <p className="mo-muted mt-3 text-xs leading-relaxed">{ex.note}</p> : null}
          </article>
        ))}
      </section>
    </div>
  );
}
