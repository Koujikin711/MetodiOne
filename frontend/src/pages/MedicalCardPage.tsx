/**
 * Электронная мед. карта — live по lead_id.
 * Маршруты: /medical-card , /medical-card/:leadId
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

type TabId = "overview" | "history" | "dynamics" | "diagnostics" | "treatment" | "documents";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Обзор" },
  { id: "history", label: "История" },
  { id: "dynamics", label: "Динамика" },
  { id: "diagnostics", label: "Диагностика" },
  { id: "treatment", label: "Лечение" },
  { id: "documents", label: "Документы" },
];

type EmrSearchItem = {
  lead_id: number;
  name: string;
  phone: string | null;
  birth_date: string | null;
  manager_name: string | null;
};

type EmrVisit = {
  appointment_id: number;
  start_at: string;
  status: string;
  status_code: string;
  service_title: string;
  direction_name: string | null;
  specialist_name: string | null;
  comment: string | null;
  kind: string;
};

type EmrChart = {
  lead_id: number;
  name: string;
  phone: string | null;
  birth_date: string | null;
  age_label: string | null;
  stage_name: string | null;
  manager_name: string | null;
  first_visit_at: string | null;
  attending_doctor: string | null;
  diagnosis: string | null;
  warning: string | null;
  service_chips: { key: string; label: string; count: number }[];
  visits: EmrVisit[];
  journey: {
    course_15_status: string;
    course_15_started_at: string | null;
    course_15_completed_at: string | null;
    branch: string;
    membership_flow: string | null;
    membership_joined_on: string | null;
  };
  dynamics: { at: string; category: string; label: string; value: string | null }[];
  todos: { text: string; at: string | null }[];
  stages: string[];
  current_stage: string | null;
};

function fmtDt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU");
}

export default function MedicalCardPage() {
  const { leadId: leadIdParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const leadIdRaw = leadIdParam || searchParams.get("leadId") || "";
  const leadId = Number(leadIdRaw) || null;

  const [tab, setTab] = useState<TabId>("overview");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 280);
    return () => window.clearTimeout(t);
  }, [q]);

  const searchQuery = useQuery({
    queryKey: ["emr-search", debounced],
    enabled: debounced.length >= 2 && !leadId,
    queryFn: () => apiFetch<EmrSearchItem[]>(`/api/emr/search?q=${encodeURIComponent(debounced)}`),
  });

  const chartQuery = useQuery({
    queryKey: ["emr-chart", leadId],
    enabled: leadId != null && leadId > 0,
    queryFn: () => apiFetch<EmrChart>(`/api/emr/${leadId}`),
  });

  function openLead(id: number) {
    navigate(`/medical-card/${id}`);
    setQ("");
  }

  function clearLead() {
    navigate("/medical-card");
    setSearchParams({});
    setTab("overview");
  }

  return (
    <div className="emr2">
      <div className="emr2__shell">
        <div className="emr2-search">
          <label className="emr2-search__label" htmlFor="emr-q">
            Поиск пациента
          </label>
          <div className="emr2-search__row">
            <input
              id="emr-q"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ФИО или телефон"
              autoComplete="off"
            />
            {leadId ? (
              <button type="button" className="emr2-search__clear" onClick={clearLead}>
                Сменить
              </button>
            ) : null}
          </div>
          {!leadId && debounced.length >= 2 ? (
            <ul className="emr2-search__list" role="listbox">
              {searchQuery.isLoading ? <li className="emr2-muted">Ищем…</li> : null}
              {searchQuery.data?.length === 0 ? <li className="emr2-muted">Никого не нашли</li> : null}
              {searchQuery.data?.map((item) => (
                <li key={item.lead_id}>
                  <button type="button" onClick={() => openLead(item.lead_id)}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.phone || "—"}
                      {item.birth_date ? ` · ${fmtDate(item.birth_date)}` : ""}
                      {item.manager_name ? ` · ${item.manager_name}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {!leadId ? (
          <p className="emr2__dev">
            Найдите пациента по ФИО или телефону. Ключ карты — <strong>lead_id</strong>. Оплаты в ЭМК не
            показываем.
          </p>
        ) : null}

        {leadId && chartQuery.isLoading ? <p className="emr2-muted">Загружаем карту…</p> : null}
        {leadId && chartQuery.isError ? (
          <p className="emr2-muted">Не удалось открыть карту. Проверьте доступ и lead_id.</p>
        ) : null}

        {chartQuery.data ? <ChartView data={chartQuery.data} tab={tab} setTab={setTab} /> : null}
      </div>
    </div>
  );
}

function ChartView({
  data,
  tab,
  setTab,
}: {
  data: EmrChart;
  tab: TabId;
  setTab: (t: TabId) => void;
}) {
  const badge =
    data.journey.course_15_status === "active"
      ? "Курс 15"
      : data.journey.course_15_status === "completed"
        ? "Курс завершён"
        : data.stage_name || "Карта";

  return (
    <>
      <header className="emr2-head">
        <div className="emr2-head__main">
          <div>
            <h1 className="emr2-head__name">{data.name}</h1>
            <p className="emr2-head__meta">
              Карта <strong>#{data.lead_id}</strong>
              {data.birth_date ? (
                <>
                  <span>·</span>
                  {fmtDate(data.birth_date)}
                  {data.age_label ? ` · ${data.age_label}` : ""}
                </>
              ) : null}
              {data.first_visit_at ? (
                <>
                  <span>·</span>
                  первое обращение {fmtDate(data.first_visit_at)}
                </>
              ) : null}
              {data.phone ? (
                <>
                  <span>·</span>
                  {data.phone}
                </>
              ) : null}
            </p>
          </div>
          <span className="emr2-badge">{badge}</span>
        </div>
        <div className="emr2-head__grid">
          <Info label="Основной диагноз" value={data.diagnosis || "не указан в CRM"} />
          <Info label="Лечащий врач" value={data.attending_doctor || "—"} />
          <Info
            label="Текущая программа"
            value={
              data.journey.membership_flow ||
              (data.journey.course_15_status === "active"
                ? "Курс 15 · активен"
                : data.journey.course_15_status === "completed"
                  ? "Курс 15 · завершён"
                  : data.journey.branch !== "none"
                    ? data.journey.branch
                    : "нет активной программы")
            }
          />
          <Info
            label="Предупреждения"
            value={data.warning || "нет отметок"}
            warn={Boolean(data.warning)}
          />
        </div>
        <div className="emr2-chips" aria-label="Фактически полученные услуги">
          {data.service_chips.map((c) => (
            <div key={c.key} className="emr2-chip">
              <span>{c.label}</span>
              <strong>{c.count}</strong>
            </div>
          ))}
        </div>
        <p className="emr2-note" style={{ marginTop: "0.55rem" }}>
          Счётчики — только визиты со статусом «Пришёл».{" "}
          <Link to={`/leads/${data.lead_id}`}>Карточка лида</Link>
          {" · "}
          <Link to={`/booking?lead_id=${data.lead_id}`}>Запись</Link>
        </p>
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

      <main className="emr2-body">{renderTab(tab, data)}</main>
    </>
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

function renderTab(tab: TabId, data: EmrChart) {
  const completed = data.visits.filter((v) => v.status_code === "completed");
  const diagVisits = data.visits.filter((v) => v.kind === "diag");

  switch (tab) {
    case "overview":
      return (
        <div className="emr2-grid">
          <Card title="Текущий этап">
            <ol className="emr2-stages">
              {data.stages.map((s) => {
                const curIdx = data.current_stage ? data.stages.indexOf(data.current_stage) : -1;
                const idx = data.stages.indexOf(s);
                const cls = idx < curIdx ? "is-done" : idx === curIdx ? "is-now" : "";
                return (
                  <li key={s} className={cls}>
                    {s}
                  </li>
                );
              })}
            </ol>
            {data.journey.membership_flow ? (
              <p className="emr2-note">Поток: {data.journey.membership_flow}</p>
            ) : (
              <p className="emr2-note">Нет активного потока в журнале куратора.</p>
            )}
          </Card>
          <Card title="Последние события">
            {completed.length === 0 ? (
              <p className="emr2-muted">Пока нет выполненных визитов.</p>
            ) : (
              <ul className="emr2-feed">
                {completed.slice(0, 5).map((e) => (
                  <li key={e.appointment_id}>
                    <time>{fmtDt(e.start_at)}</time>
                    <strong>{e.service_title}</strong>
                    <span>
                      {[e.specialist_name, e.status].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Краткая динамика">
            {data.dynamics.length === 0 ? (
              <p className="emr2-muted">Жалоб куратора по этому lead пока нет.</p>
            ) : (
              <div className="emr2-dyn-mini">
                {data.dynamics.slice(0, 6).map((d, i) => (
                  <div key={`${d.at}-${d.category}-${i}`}>
                    <span>
                      {d.label} · {fmtDate(d.at)}
                    </span>
                    <em>{d.value || "отметка"}</em>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Ближайшие действия">
            {data.todos.length === 0 ? (
              <p className="emr2-muted">Нет запланированных визитов.</p>
            ) : (
              <ul className="emr2-todo">
                {data.todos.map((t, i) => (
                  <li key={`${t.text}-${i}`}>
                    {t.at ? `${fmtDate(t.at)} · ` : ""}
                    {t.text}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      );
    case "history":
      return (
        <Card title="Хронология">
          {data.visits.length === 0 ? (
            <p className="emr2-muted">Визитов по записи нет.</p>
          ) : (
            <ul className="emr2-timeline">
              {data.visits.map((e) => (
                <li key={e.appointment_id} data-kind={e.kind}>
                  <time>{fmtDt(e.start_at)}</time>
                  <div>
                    <strong>{e.service_title}</strong>
                    <p>
                      {[e.specialist_name, e.status].filter(Boolean).join(" · ")}
                    </p>
                    {e.comment ? <p className="emr2-muted">{e.comment}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    case "dynamics":
      return (
        <Card title="Наблюдения куратора">
          <p className="emr2-muted emr2-lead">
            Шкалы врача пока не ведутся в CRM. Здесь — жалобы из журнала куратора по этому lead_id.
          </p>
          {data.dynamics.length === 0 ? (
            <p className="emr2-muted">Нет данных.</p>
          ) : (
            <table className="emr2-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Категория</th>
                  <th>Значение</th>
                </tr>
              </thead>
              <tbody>
                {data.dynamics.map((d, i) => (
                  <tr key={`${d.at}-${d.category}-${i}`}>
                    <td>{fmtDate(d.at)}</td>
                    <td>{d.label}</td>
                    <td>{d.value || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      );
    case "diagnostics":
      return (
        <Card title="Исследования (из записи)">
          {diagVisits.length === 0 ? (
            <p className="emr2-muted">Визитов с типом диагностики (ЭЭГ и т.п.) нет.</p>
          ) : (
            <table className="emr2-table">
              <thead>
                <tr>
                  <th>Исследование</th>
                  <th>Дата</th>
                  <th>Статус</th>
                  <th>Специалист</th>
                </tr>
              </thead>
              <tbody>
                {diagVisits.map((v) => (
                  <tr key={v.appointment_id}>
                    <td>{v.service_title}</td>
                    <td>{fmtDt(v.start_at)}</td>
                    <td>
                      <em className={v.status_code === "completed" ? "emr2-st emr2-st--ok" : "emr2-st"}>
                        {v.status}
                      </em>
                    </td>
                    <td>{v.specialist_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      );
    case "treatment":
      return (
        <div className="emr2-grid">
          <Card title="А. Курсы">
            <div className="emr2-course">
              <strong>Курс 15</strong>
              <span>
                статус: {data.journey.course_15_status}
                {data.journey.course_15_started_at
                  ? ` · с ${fmtDate(data.journey.course_15_started_at)}`
                  : ""}
              </span>
            </div>
            {data.journey.membership_flow ? (
              <p className="emr2-muted">Журнал: {data.journey.membership_flow}</p>
            ) : (
              <p className="emr2-muted">Участник потока не найден.</p>
            )}
          </Card>
          <Card title="Б. Процедуры (факт)">
            <table className="emr2-table">
              <thead>
                <tr>
                  <th>Услуга</th>
                  <th>Дата</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {data.visits
                  .filter((v) => v.kind === "proc")
                  .slice(0, 20)
                  .map((v) => (
                    <tr key={v.appointment_id}>
                      <td>{v.service_title}</td>
                      <td>{fmtDate(v.start_at)}</td>
                      <td>{v.status}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {data.visits.filter((v) => v.kind === "proc").length === 0 ? (
              <p className="emr2-muted">Процедур в записи нет.</p>
            ) : null}
          </Card>
        </div>
      );
    case "documents":
      return (
        <Card title="Документы">
          <p className="emr2-muted">
            Хранилище медфайлов ещё не подключено. PDF ЭЭГ и согласия появятся после отдельного шага.
          </p>
        </Card>
      );
  }
}
