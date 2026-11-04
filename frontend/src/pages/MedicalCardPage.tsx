/**
 * Электронная мед. карта (UI-макет). Без API / БД / финансов / миграций.
 * Маршрут: /medical-card
 */

import { useState, type ReactNode } from "react";

type TabId = "overview" | "history" | "dynamics" | "diagnostics" | "treatment" | "documents";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Обзор" },
  { id: "history", label: "История" },
  { id: "dynamics", label: "Динамика" },
  { id: "diagnostics", label: "Диагностика" },
  { id: "treatment", label: "Лечение" },
  { id: "documents", label: "Документы" },
];

const SERVICE_CHIPS = [
  { label: "Консультации", count: 4 },
  { label: "ЭЭГ / Q-ЭЭГ", count: 2 },
  { label: "Массаж", count: 5 },
  { label: "ТМС", count: 3 },
  { label: "Остеопатия", count: 2 },
  { label: "Другие", count: 1 },
];

const HISTORY = [
  {
    at: "04.11.2026 10:30",
    title: "Повторный приём невролога",
    specialist: "д-р Каримова",
    status: "Выполнено",
    note: "Разбор ЭЭГ, уточнение тактики",
    kind: "visit",
  },
  {
    at: "02.11.2026 15:00",
    title: "ЭЭГ",
    specialist: "лаб. Диагностика",
    status: "Выполнено",
    note: "Результат прикреплён",
    kind: "diag",
  },
  {
    at: "01.11.2026 09:00",
    title: "Массаж · сеанс 5/5",
    specialist: "Рахимов А.",
    status: "Выполнено",
    note: "Параллельно Курсу 15, отдельное назначение",
    kind: "proc",
  },
  {
    at: "28.10.2026",
    title: "Курс 15 · день 8",
    specialist: "куратор Дилшод",
    status: "Наблюдение",
    note: "Сон стабильнее, речь — без изменений",
    kind: "course",
  },
  {
    at: "20.10.2026 11:00",
    title: "Первичный приём",
    specialist: "д-р Каримова",
    status: "Выполнено",
    note: "Жалобы, анамнез, направления",
    kind: "visit",
  },
];

const DYNAMICS = [
  { name: "Речь (экспрессивная)", scale: "0–5", was: "1", now: "2", delta: "+1", source: "врач" },
  { name: "Понимание речи", scale: "0–5", was: "2", now: "3", delta: "+1", source: "врач" },
  { name: "Сон (качество)", scale: "0–5", was: "2", now: "3", delta: "+1", source: "куратор" },
  { name: "Внимание", scale: "0–5", was: "2", now: "2", delta: "0", source: "врач" },
];

export default function MedicalCardPage() {
  const [tab, setTab] = useState<TabId>("overview");

  return (
    <div className="emr2">
      <div className="emr2__shell">
        <p className="emr2__dev">
          Макет ЭМК · ключ пациента <strong>lead_id</strong>. API и оплаты пока не подключены.
        </p>

        <header className="emr2-head">
          <div className="emr2-head__main">
            <div>
              <h1 className="emr2-head__name">Рахимова Зарина</h1>
              <p className="emr2-head__meta">
                Карта <strong>МК-1842</strong>
                <span>·</span>
                12.03.2021 · 5 лет 7 мес
                <span>·</span>
                первое обращение 20.10.2026
              </p>
            </div>
            <span className="emr2-badge">Наблюдение</span>
          </div>
          <div className="emr2-head__grid">
            <Info label="Основной диагноз" value="F80.1 (предварительный)" />
            <Info label="Лечащий врач" value="д-р Каримова Н." />
            <Info label="Текущая программа" value="Курс 15 · день 8/15" />
            <Info label="Предупреждения" value="Эпилепсия в семейном анамнезе" warn />
          </div>
          <div className="emr2-chips" aria-label="Фактически полученные услуги">
            {SERVICE_CHIPS.map((c) => (
              <div key={c.label} className="emr2-chip">
                <span>{c.label}</span>
                <strong>{c.count}</strong>
              </div>
            ))}
          </div>
        </header>

        <nav className="emr2-tabs" aria-label="Разделы карты">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={["emr2-tab", tab === t.id ? "is-active" : ""].filter(Boolean).join(" ")}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <main className="emr2-body">{renderTab(tab)}</main>
      </div>
    </div>
  );
}

function Info({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={warn ? "emr2-info emr2-info--warn" : "emr2-info"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="emr2-card">
      <div className="emr2-card__head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function renderTab(tab: TabId) {
  switch (tab) {
    case "overview":
      return (
        <div className="emr2-grid">
          <Card title="Текущий этап">
            <ol className="emr2-stages">
              <li className="is-done">1-й приём</li>
              <li className="is-done">Обследования</li>
              <li className="is-done">2-й приём</li>
              <li className="is-now">Курс 15</li>
              <li>Заключение</li>
            </ol>
            <p className="emr2-note">
              Параллельно: массаж 5/5 выполнен · ТМС 3/3 в плане (отдельные назначения, не в составе Курса
              15).
            </p>
          </Card>
          <Card title="Последние события">
            <ul className="emr2-feed">
              {HISTORY.slice(0, 3).map((e) => (
                <li key={e.at + e.title}>
                  <time>{e.at}</time>
                  <strong>{e.title}</strong>
                  <span>
                    {e.specialist} · {e.status}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Краткая динамика">
            <div className="emr2-dyn-mini">
              {DYNAMICS.slice(0, 3).map((d) => (
                <div key={d.name}>
                  <span>{d.name}</span>
                  <em>
                    {d.was} → {d.now} <b className={d.delta.startsWith("+") ? "up" : ""}>{d.delta}</b>
                  </em>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Ближайшие действия">
            <ul className="emr2-todo">
              <li>06.11 · Q-ЭЭГ · ожидает результат</li>
              <li>08.11 · промежуточная оценка врача (Курс 15)</li>
              <li>Контроль сна куратором ежедневно</li>
            </ul>
          </Card>
        </div>
      );
    case "history":
      return (
        <Card
          title="Хронология"
          action={
            <div className="emr2-filters">
              <select defaultValue="all" aria-label="Вид">
                <option value="all">Все события</option>
                <option value="visit">Приёмы</option>
                <option value="diag">Диагностика</option>
                <option value="proc">Процедуры</option>
                <option value="course">Курс</option>
              </select>
            </div>
          }
        >
          <ul className="emr2-timeline">
            {HISTORY.map((e) => (
              <li key={e.at + e.title} data-kind={e.kind}>
                <time>{e.at}</time>
                <div>
                  <strong>{e.title}</strong>
                  <p>
                    {e.specialist} · {e.status}
                  </p>
                  {e.note ? <p className="emr2-muted">{e.note}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      );
    case "dynamics":
      return (
        <div className="emr2-grid emr2-grid--1">
          <Card title="Показатели (было / стало)">
            <p className="emr2-muted emr2-lead">
              Шкалы задаёт врач. Куратор фиксирует наблюдения; клиническую оценку подтверждает врач. Без
              автовыводов об эффективности процедур.
            </p>
            <table className="emr2-table">
              <thead>
                <tr>
                  <th>Показатель</th>
                  <th>Шкала</th>
                  <th>Было</th>
                  <th>Стало</th>
                  <th>Δ</th>
                  <th>Источник</th>
                </tr>
              </thead>
              <tbody>
                {DYNAMICS.map((d) => (
                  <tr key={d.name}>
                    <td>{d.name}</td>
                    <td>{d.scale}</td>
                    <td>{d.was}</td>
                    <td>{d.now}</td>
                    <td className={d.delta.startsWith("+") ? "up" : d.delta === "0" ? "" : "down"}>
                      {d.delta}
                    </td>
                    <td>{d.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="emr2-chart-mock" aria-hidden>
              <span>Речь</span>
              <span>Понимание</span>
              <span>Сон</span>
              <div className="emr2-bars">
                <i style={{ height: "28%" }} title="было" />
                <i className="now" style={{ height: "48%" }} title="стало" />
                <i style={{ height: "40%" }} />
                <i className="now" style={{ height: "60%" }} />
                <i style={{ height: "40%" }} />
                <i className="now" style={{ height: "58%" }} />
              </div>
              <p>Макет графика контрольных точек: первичный → Курс 15 → далее</p>
            </div>
          </Card>
        </div>
      );
    case "diagnostics":
      return (
        <Card title="Исследования">
          <table className="emr2-table">
            <thead>
              <tr>
                <th>Исследование</th>
                <th>Назначено</th>
                <th>Проведено</th>
                <th>Статус</th>
                <th>Врач видел</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>ЭЭГ</td>
                <td>20.10.2026</td>
                <td>02.11.2026</td>
                <td>
                  <em className="emr2-st emr2-st--ok">Готово</em>
                </td>
                <td>Да</td>
              </tr>
              <tr>
                <td>УЗИ</td>
                <td>20.10.2026</td>
                <td>—</td>
                <td>
                  <em className="emr2-st">В работе</em>
                </td>
                <td>—</td>
              </tr>
              <tr>
                <td>Q-ЭЭГ</td>
                <td>04.11.2026</td>
                <td>—</td>
                <td>
                  <em className="emr2-st">Ожидает</em>
                </td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
          <p className="emr2-muted">Файлы PDF/изображений — после интеграции хранилища.</p>
        </Card>
      );
    case "treatment":
      return (
        <div className="emr2-grid">
          <Card title="А. Курсы">
            <div className="emr2-course">
              <strong>Курс 15</strong>
              <span>20.10–04.11.2026 · день 8/15 · куратор Дилшод</span>
              <div className="emr2-progress">
                <i style={{ width: "53%" }} />
              </div>
            </div>
            <p className="emr2-muted">Курс 90 — не начат. Выбор только по показаниям врача.</p>
          </Card>
          <Card title="Б. Назначения врача">
            <ul className="emr2-todo">
              <li>Режим сна · контроль куратором</li>
              <li>Повторный осмотр по завершении Курса 15</li>
              <li>Без автоназначения препаратов в макете</li>
            </ul>
          </Card>
          <Card title="В. Самостоятельные процедуры">
            <p className="emr2-muted emr2-lead">Не входят в стоимость / состав Курса 15.</p>
            <table className="emr2-table">
              <thead>
                <tr>
                  <th>Процедура</th>
                  <th>План</th>
                  <th>Факт</th>
                  <th>Исполнитель</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Массаж</td>
                  <td>5</td>
                  <td>5</td>
                  <td>Рахимов А.</td>
                </tr>
                <tr>
                  <td>ТМС</td>
                  <td>3</td>
                  <td>0</td>
                  <td>—</td>
                </tr>
                <tr>
                  <td>Остеопатия</td>
                  <td>2</td>
                  <td>2</td>
                  <td>Исматов Ш.</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>
      );
    case "documents":
      return (
        <Card
          title="Документы"
          action={
            <button type="button" className="emr2-btn" disabled title="После интеграции">
              PDF карты
            </button>
          }
        >
          <ul className="emr2-docs">
            <li>
              <strong>Первичный осмотр</strong>
              <span>20.10.2026 · д-р Каримова</span>
            </li>
            <li>
              <strong>ЭЭГ · результат</strong>
              <span>02.11.2026 · файл.pdf</span>
            </li>
            <li>
              <strong>Информированное согласие (ТМС)</strong>
              <span>ожидает подписи</span>
            </li>
            <li>
              <strong>Итог Курса 15</strong>
              <span>ещё не сформирован</span>
            </li>
          </ul>
          <p className="emr2-muted">В PDF — дата формирования и источники записей (без финансов).</p>
        </Card>
      );
  }
}
