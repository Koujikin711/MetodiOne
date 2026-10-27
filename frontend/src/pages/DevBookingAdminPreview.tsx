import { useEffect, useMemo, useState } from "react";

import { Search } from "@/components/icons";

/** Только DEV: визуал шапки Онлайн-записи у админа. */
const SPECIALISTS = [
  { name: "Замири Ганчина", type: "Невролог", counts: [7, 5, 3, 0, 0, 0] },
  { name: "Шокирова Мунира", type: "Невролог", counts: [1, 0, 0, 0, 0, 0] },
  { name: "Курбонализода Азиз", type: "Невролог", counts: [8, 4, 4, 0, 0, 0] },
  { name: "Исматов Шохрух", type: "Невролог", counts: [5, 3, 5, 0, 0, 0] },
];

const DAYS = ["Пн 26.10", "Вт 27.10", "Ср 28.10", "Чт 29.10", "Пт 30.10", "Сб 31.10"];

const STATUS_LABEL: Record<string, string> = {
  booked: "Запись",
  completed: "Пришёл",
  no_show: "Неявка",
  cancelled: "Отмена",
};

type DemoVisit = {
  id: number;
  when: string;
  specialist: string;
  service: string;
  status: keyof typeof STATUS_LABEL;
};

type DemoHit = {
  name: string;
  phone: string;
  visits: DemoVisit[];
};

const DEMO_HITS: DemoHit[] = [
  {
    name: "Ахмадзода Амира",
    phone: "992 98 707 63 70",
    visits: [
      { id: 1, when: "24.10.2026 11:00", specialist: "Замири Ганчина", service: "Консультация", status: "completed" },
      { id: 2, when: "18.10.2026 10:30", specialist: "Шокирова Мунира", service: "Повтор", status: "no_show" },
      { id: 3, when: "10.10.2026 15:00", specialist: "Замири Ганчина", service: "Консультация", status: "completed" },
    ],
  },
  {
    name: "Хакимзода Ахмад",
    phone: "992 93 111 66 11",
    visits: [
      { id: 4, when: "22.10.2026 16:30", specialist: "Исматов Шохрух", service: "Неврология", status: "booked" },
      { id: 5, when: "12.10.2026 12:00", specialist: "Курбонализода Азиз", service: "Консультация", status: "completed" },
      { id: 6, when: "05.10.2026 09:00", specialist: "Замири Ганчина", service: "Повтор", status: "cancelled" },
      { id: 7, when: "28.09.2026 14:00", specialist: "Шокирова Мунира", service: "Консультация", status: "no_show" },
      { id: 8, when: "20.09.2026 11:15", specialist: "Исматов Шохрух", service: "Консультация", status: "completed" },
    ],
  },
  {
    name: "Амонов Ахмад",
    phone: "989 09 09 90",
    visits: [
      { id: 9, when: "20.10.2026 09:15", specialist: "Курбонализода Азиз", service: "Консультация", status: "completed" },
    ],
  },
];

export function DevBookingAdminPreview() {
  const [q, setQ] = useState("Ахмад");
  const [card, setCard] = useState<DemoHit | null>(null);
  const needle = q.trim().toLowerCase();
  const hits = useMemo(
    () =>
      needle.length < 2
        ? []
        : DEMO_HITS.filter(
            (h) =>
              h.name.toLowerCase().includes(needle) ||
              h.phone.replace(/\s/g, "").includes(needle.replace(/\s/g, "")),
          ),
    [needle],
  );

  useEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.theme;
    root.dataset.theme = "dark";
    return () => {
      if (prev) root.dataset.theme = prev;
      else delete root.dataset.theme;
    };
  }, []);

  useEffect(() => {
    setCard(null);
  }, [needle]);

  return (
    <div className="app-shell-bg relative min-h-[100dvh] px-4 py-5 text-[var(--mo-text)] sm:px-6">
      <p className="mo-muted mb-4 text-[11px] tracking-wide">
        Локальное превью · клик по пациенту → модалка с днями визитов
      </p>

      <header className="booking-page-header mb-4">
        <div className="booking-page-brand">
          <div className="booking-page-title-row">
            <h1 className="booking-page-title">Онлайн-записи</h1>
            <div className="booking-page-legend" aria-label="Статусы записей">
              <span className="booking-legend-item booking-legend-item--booked">Запись</span>
              <span className="booking-legend-item booking-legend-item--notify">Смс отправлено</span>
              <span className="booking-legend-item booking-legend-item--completed">Пришёл</span>
              <span className="booking-legend-item booking-legend-item--no_show">Неявка</span>
              <span className="booking-legend-item booking-legend-item--cancelled">Отмена</span>
            </div>
          </div>
        </div>
      </header>

      <div className="booking-admin-bar mb-3">
        <div className="booking-page-date-nav" aria-label="Неделя записи">
          <button type="button" className="booking-page-date-nav-btn">
            ‹
          </button>
          <span className="booking-page-date-label">26 Окт. — 31 Окт.</span>
          <button type="button" className="booking-page-date-nav-btn">
            ›
          </button>
        </div>
        <label className="booking-schedule-search">
          <Search className="booking-schedule-search__icon" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Найти пациента — ФИО или телефон"
            className="booking-schedule-search__input"
          />
        </label>
      </div>

      {needle.length >= 2 ? (
        <div className="booking-patient-find mb-4">
          <div className="booking-patient-find__head">
            <h3 className="booking-patient-find__title">Найденные пациенты</h3>
            <span className="booking-patient-find__hint">
              по запросу «{q.trim()}» · нажмите — открыть карточку
            </span>
          </div>
          {hits.length === 0 ? (
            <p className="booking-patient-find__empty">Никого не нашли. Проверьте ФИО или номер.</p>
          ) : (
            <ul className="booking-patient-find__list">
              {hits.map((h) => {
                const came = h.visits.filter((v) => v.status === "completed").length;
                const missed = h.visits.filter((v) => v.status === "no_show").length;
                return (
                  <li key={h.name} className="booking-patient-find__card">
                    <button
                      type="button"
                      className="booking-patient-find__toggle"
                      onClick={() => setCard(h)}
                    >
                      <div className="booking-patient-find__main">
                        <p className="booking-patient-find__name">{h.name}</p>
                        <p className="booking-patient-find__phone">{h.phone}</p>
                      </div>
                      <div className="booking-patient-find__meta">
                        <span>
                          Записей <b>{h.visits.length}</b>
                          {" · "}
                          <span className="booking-patient-find__stat is-ok">пришёл {came}</span>
                          {" / "}
                          <span className="booking-patient-find__stat is-miss">неявка {missed}</span>
                        </span>
                        <span className="booking-patient-find__chevron" aria-hidden>
                          Открыть ▸
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <div className="mo-section overflow-x-auto p-3">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide mo-muted">
              <th className="px-2 py-2.5 font-semibold">Специалисты</th>
              {DAYS.map((d) => (
                <th key={d} className="px-2 py-2.5 text-center font-semibold">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SPECIALISTS.map((s) => (
              <tr key={s.name} className="border-t border-[var(--mo-border)]">
                <td className="px-2 py-2.5">
                  <div className="font-semibold tracking-tight">{s.name}</div>
                  <div className="text-xs mo-muted">{s.type}</div>
                </td>
                {s.counts.map((n, i) => (
                  <td
                    key={`${s.name}-${i}`}
                    className={[
                      "px-2 py-2.5 text-center tabular-nums",
                      n > 0 ? "font-semibold text-[var(--mo-text)]" : "mo-muted",
                    ].join(" ")}
                  >
                    {n}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {card ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--mo-text)]/40 p-3 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          onClick={() => setCard(null)}
        >
          <div
            className="booking-appt-detail-modal booking-patient-card-modal mo-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="booking-appt-detail-modal__body">
              <p className="booking-appt-detail-modal__eyebrow">Карточка пациента</p>
              <p className="booking-appt-detail-modal__name">{card.name}</p>
              <div className="booking-appt-detail-modal__meta-row">
                <span>{card.phone}</span>
                <span>
                  Записей: <b>{card.visits.length}</b>
                </span>
              </div>
              <div className="booking-patient-card-modal__summary">
                <span className="booking-patient-find__stat is-ok">
                  Пришёл {card.visits.filter((v) => v.status === "completed").length}
                </span>
                <span className="booking-patient-find__stat is-miss">
                  Неявка {card.visits.filter((v) => v.status === "no_show").length}
                </span>
                <span className="mo-muted text-xs">
                  Запись {card.visits.filter((v) => v.status === "booked").length}
                </span>
                <span className="mo-muted text-xs">
                  Отмена {card.visits.filter((v) => v.status === "cancelled").length}
                </span>
              </div>
              <h4 className="booking-patient-card-modal__visits-title">Визиты</h4>
              <ul className="booking-patient-find__visits booking-patient-card-modal__visits">
                {card.visits.map((v) => (
                  <li key={v.id}>
                    <div className={`booking-patient-find__visit is-${v.status}`}>
                      <div className="booking-patient-find__visit-when">
                        <span className="booking-patient-find__visit-date">{v.when}</span>
                        <span className="booking-patient-find__visit-spec">{v.specialist}</span>
                      </div>
                      <span className={`booking-patient-find__badge is-${v.status}`}>
                        {STATUS_LABEL[v.status]}
                      </span>
                      <span className="booking-patient-find__visit-svc">{v.service}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <footer className="booking-appt-detail-modal__foot">
              <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => setCard(null)}>
                Закрыть
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
