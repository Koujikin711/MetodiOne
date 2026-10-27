import { useEffect } from "react";

/** Только DEV: превью читаемости списка журнала внутри оболочки приложения. */
const DEMO = [
  { name: "Абдуаюбзода Бибимох", day: "День 12/90" },
  { name: "Ашурова Ахдия", day: "День 34/90" },
  { name: "Гулмахмадова Ниссо", day: "День 7/90" },
  { name: "Исматова Фарзона", day: "День 55/90" },
  { name: "Каримова Зарина", day: "День 21/90" },
  { name: "Назарова Малика", day: "Осталось 8 дн." },
  { name: "Рахимова Сабина", day: "Пауза" },
  { name: "Саидова Дилноза", day: "День 3/90" },
];

const NAV = [
  { label: "CRM", tone: "#fbbf24" },
  { label: "KPI", tone: "#22d3ee" },
  { label: "Чаты", tone: "#c084fc" },
  { label: "Журнал", tone: "#60a5fa", active: true },
  { label: "РОП", tone: "#4ade80" },
  { label: "Онлайн", tone: "#34d399" },
  { label: "Расходы", tone: "#a78bfa" },
];

export function DevCuratorListPreview() {
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
    <div className="app-shell-bg flex h-[100dvh] overflow-hidden text-[var(--mo-text)]">
      <aside className="shell-sidebar is-collapsed flex w-[4.5rem] shrink-0 flex-col items-center gap-1 border-r border-[var(--mo-sidebar-border)] py-2">
        {NAV.map((item) => (
          <div
            key={item.label}
            className={[
              "flex w-full flex-col items-center gap-[0.1rem] px-1 py-[0.15rem]",
              item.active ? "rounded-xl bg-[var(--mo-nav-active-bg)]" : "",
            ].join(" ")}
          >
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/20 text-[10px] font-bold"
              style={{ color: item.tone, boxShadow: `0 0 10px ${item.tone}55` }}
            >
              ◆
            </span>
            <span className="text-[0.62rem] font-semibold leading-none text-[var(--mo-sidebar-fg-muted)]">
              {item.label}
            </span>
          </div>
        ))}
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-3 pb-8 pt-3">
        <header className="mb-3">
          <h1 className="lux-heading-page text-[1.25rem]">Журнал куратора</h1>
          <p className="mo-muted mt-0.5 text-xs">Локальное превью · без пуша</p>
        </header>

        <div className="mb-2 text-sm font-bold text-[var(--mo-text)]">ФИО</div>
        <div className="flex flex-col gap-2.5">
          {DEMO.map((row) => (
            <div key={row.name} className="cj-person-card">
              <button type="button" className="cj-person-name">
                {row.name}
              </button>
              <div
                className={[
                  "cj-period-hint tabular-nums",
                  row.day === "Пауза" ? "is-warn" : "",
                  row.day.startsWith("Осталось") ? "is-warn" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {row.day}
              </div>
              <span className="cj-person-actions">
                <button type="button" className="cj-person-action is-accent">
                  {row.day === "Пауза" ? "Продолжить" : "Пауза"}
                </button>
                <button type="button" className="cj-person-action is-muted">
                  Убрать
                </button>
              </span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
