/**
 * Электронная мед. карта — live по lead_id.
 * Маршруты: /medical-card , /medical-card/:leadId
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch, getActiveCompanyId, getStoredToken, resolveApiUrl } from "@/lib/api";

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
  birth_from_booking?: boolean;
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
  documents?: { title: string; source: string; at: string | null; href: string | null }[];
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

function courseStatusLabel(status: string): string {
  if (status === "completed") return "завершён";
  if (status === "active") return "идёт";
  if (status === "none" || !status) return "не начат";
  return status;
}

function programBadge(data: EmrChart): string {
  const flow = data.journey.membership_flow || "";
  if (/основн/i.test(flow)) return "Основной курс";
  if (flow) return flow.split("·")[0]?.trim() || flow;
  if (data.journey.course_15_status === "active") return "Курс 15";
  if (data.journey.course_15_status === "completed") return "Курс 15 завершён";
  return data.stage_name || "Наблюдение";
}

function programValue(data: EmrChart): string {
  if (data.journey.membership_flow) return data.journey.membership_flow;
  if (data.journey.course_15_status === "active") return "Курс 15 · идёт";
  if (data.journey.course_15_status === "completed") return "Курс 15 · завершён";
  if (data.journey.branch && data.journey.branch !== "none") return data.journey.branch;
  return "нет активной программы";
}

function displayStages(data: EmrChart): { stages: string[]; current: string | null } {
  const flow = data.journey.membership_flow || "";
  const c15 = data.journey.course_15_status;
  if (/основн/i.test(flow)) {
    return {
      stages: ["1-й приём", "Обследования", "Курс 15", "Основной курс"],
      current: "Основной курс",
    };
  }
  if (c15 === "active") {
    return { stages: ["1-й приём", "Обследования", "Курс 15", "Заключение"], current: "Курс 15" };
  }
  if (c15 === "completed") {
    return { stages: ["1-й приём", "Обследования", "Курс 15", "Заключение"], current: "Заключение" };
  }
  return { stages: data.stages.length ? data.stages : ["1-й приём", "Обследования", "Курс 15", "Заключение"], current: data.current_stage };
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
          <p className="emr2__dev">Найдите пациента по имени или телефону. Оплаты в карте не показываем.</p>
        ) : null}

        {leadId && chartQuery.isLoading ? <p className="emr2-muted">Загружаем карту…</p> : null}
        {leadId && chartQuery.isError ? (
          <p className="emr2-muted">Не удалось открыть карту. Проверьте, что пациент есть в вашей клинике.</p>
        ) : null}

        {chartQuery.data ? <ChartView data={chartQuery.data} tab={tab} setTab={setTab} /> : null}
      </div>
    </div>
  );
}

export function ChartView({
  data,
  tab,
  setTab,
  preview = false,
}: {
  data: EmrChart;
  tab: TabId;
  setTab: (t: TabId) => void;
  preview?: boolean;
}) {
  const badge = programBadge(data);

  return (
    <>
      <header className="emr2-head">
        <div className="emr2-head__main">
          <div>
            <h1 className="emr2-head__name">{data.name}</h1>
            <p className="emr2-head__meta">
              Карта <strong>#{data.lead_id}</strong>
              <span>·</span>
              <BirthField data={data} preview={preview} />
              {data.first_visit_at ? (
                <>
                  <span>·</span>
                  первое обращение {fmtDate(data.first_visit_at)}
                </>
              ) : null}
            </p>
            {data.phone ? <p className="emr2-head__phone">{data.phone}</p> : null}
          </div>
          <span className="emr2-badge">{badge}</span>
        </div>
        <DiagnosisField leadId={data.lead_id} diagnosis={data.diagnosis} preview={preview} />
        <div className="emr2-head__grid emr2-head__grid--3">
          <Info label="Лечащий врач" value={data.attending_doctor || "не указан"} />
          <Info label="Текущая программа" value={programValue(data)} />
          <Info label="Предупреждения" value={data.warning || "нет"} warn={Boolean(data.warning)} />
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
  const stages = displayStages(data);

  switch (tab) {
    case "overview":
      return (
        <div className="emr2-grid">
          <Card title="Текущий этап">
            <ol className="emr2-stages">
              {stages.stages.map((s) => {
                const curIdx = stages.current ? stages.stages.indexOf(stages.current) : -1;
                const idx = stages.stages.indexOf(s);
                const cls = idx < curIdx ? "is-done" : idx === curIdx ? "is-now" : "";
                return (
                  <li key={s} className={cls}>
                    {s}
                  </li>
                );
              })}
            </ol>
            {data.journey.membership_flow ? (
              <p className="emr2-note">Сейчас в журнале: {data.journey.membership_flow}</p>
            ) : (
              <p className="emr2-note">В журнале куратора активного потока нет.</p>
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
              <p className="emr2-muted">Жалоб в журнале куратора пока нет.</p>
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
      return <HistoryTab visits={data.visits} />;
    case "dynamics":
      return (
        <Card title="Наблюдения куратора">
          <p className="emr2-muted emr2-lead">
            Здесь жалобы из журнала куратора: сон, вес, боль и другие отметки. Шкалы врача появятся позже.
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
        <Card title="Исследования">
          {diagVisits.length === 0 ? (
            <p className="emr2-muted">ЭЭГ и других исследований в записи пока нет.</p>
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
      return <TreatmentTab data={data} />;
    case "documents":
      return <DocumentsTab leadId={data.lead_id} documents={data.documents ?? []} />;
  }
}

function BirthField({ data, preview }: { data: EmrChart; preview: boolean }) {
  const qc = useQueryClient();
  const fromBooking = data.birth_from_booking === true;
  const [value, setValue] = useState(data.birth_date ?? "");
  const [localBirth, setLocalBirth] = useState<string | null>(null);
  const [editing, setEditing] = useState(!data.birth_date);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  useEffect(() => {
    setValue(data.birth_date ?? "");
    setLocalBirth(null);
    setEditing(!data.birth_date);
    setState("idle");
  }, [data.birth_date, data.lead_id, fromBooking]);

  const shown = fromBooking ? data.birth_date : localBirth ?? data.birth_date;

  async function save() {
    if (!value) return;
    if (preview) {
      setLocalBirth(value);
      setEditing(false);
      setState("idle");
      return;
    }
    setState("saving");
    try {
      await apiFetch(`/api/emr/${data.lead_id}/birth-date`, {
        method: "PATCH",
        body: JSON.stringify({ birth_date: value }),
      });
      await qc.invalidateQueries({ queryKey: ["emr-chart", data.lead_id] });
      setEditing(false);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  if (fromBooking && shown) {
    return (
      <>
        {fmtDate(shown)}
        {data.age_label ? ` · ${data.age_label}` : ""}
      </>
    );
  }

  if (shown && !editing) {
    return (
      <span className="emr2-born">
        {fmtDate(shown)}
        {data.age_label && !localBirth ? ` · ${data.age_label}` : ""}
        <button type="button" onClick={() => setEditing(true)}>
          изменить
        </button>
      </span>
    );
  }

  return (
    <span className="emr2-born">
      <input
        type="date"
        aria-label="Дата рождения"
        value={value}
        max="9999-12-31"
        onChange={(e) => {
          setValue(e.target.value);
          setState("idle");
        }}
      />
      <button type="button" onClick={() => void save()} disabled={state === "saving" || !value}>
        {state === "saving" ? "…" : "Сохранить"}
      </button>
      {state === "error" ? <em>Не сохранилось</em> : <em>В записи даты нет — впишите здесь</em>}
    </span>
  );
}

function DiagnosisField({
  leadId,
  diagnosis,
  preview,
}: {
  leadId: number;
  diagnosis: string | null;
  preview: boolean;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(diagnosis ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    setValue(diagnosis ?? "");
    setState("idle");
  }, [diagnosis, leadId]);

  async function save() {
    const next = value.trim();
    if (preview) {
      setState("saved");
      return;
    }
    setState("saving");
    try {
      await apiFetch(`/api/emr/${leadId}/diagnosis`, {
        method: "PATCH",
        body: JSON.stringify({ diagnosis: next || null }),
      });
      await qc.invalidateQueries({ queryKey: ["emr-chart", leadId] });
      setState("saved");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="emr2-dx">
      <label>
        <span>Основной диагноз</span>
        <textarea
          value={value}
          rows={2}
          maxLength={2000}
          placeholder="Например: F80.1 — задержка экспрессивной речи"
          onChange={(e) => {
            setValue(e.target.value);
            setState("idle");
          }}
        />
      </label>
      <div className="emr2-dx__row">
        <button type="button" className="emr2-dx__save" onClick={() => void save()} disabled={state === "saving"}>
          {state === "saving" ? "Сохраняем…" : "Сохранить в карту"}
        </button>
        <p>
          {state === "saved"
            ? "Записано в эту медкарту."
            : state === "error"
              ? "Не сохранилось. Попробуйте ещё раз."
              : "Пишется только здесь. Другого поля диагноза в CRM нет."}
        </p>
      </div>
    </div>
  );
}

function DocumentsTab({
  leadId,
  documents,
}: {
  leadId: number;
  documents: { title: string; source: string; at: string | null; href: string | null }[];
}) {
  async function openMedia(href: string) {
    const headers = new Headers();
    const token = getStoredToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const companyId = getActiveCompanyId();
    if (companyId != null) headers.set("X-Company-Id", String(companyId));
    const res = await fetch(resolveApiUrl(href), { headers });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <Card title="Документы">
      <p className="emr2-muted">
        Сюда сами файлы не загружаются. Карта показывает то, что уже есть у этого пациента.
      </p>
      <ul className="emr2-todo">
        <li>
          <strong>Чат.</strong> Отправьте фото, PDF или результат исследования в переписку — файл появится в этом списке.
          {" "}
          <Link to={`/chat?lead_id=${leadId}`}>Открыть чат</Link>
        </li>
        <li>
          <strong>Протокол.</strong> Эксперт прикрепляет файл к сделке-протоколу в карточке лида.
          {" "}
          <Link to={`/leads/${leadId}`}>Карточка лида</Link>
        </li>
      </ul>
      {documents.length === 0 ? (
        <p className="emr2-muted">Пока пусто: в чате нет файлов и к протоколу ничего не прикреплено.</p>
      ) : (
        <ul className="emr2-docs">
          {documents.map((doc) => (
            <li key={`${doc.source}-${doc.href}-${doc.title}`}>
              <strong>{doc.title}</strong>
              <span>
                {doc.source}
                {doc.at ? ` · ${fmtDt(doc.at)}` : ""}
              </span>
              {doc.href?.startsWith("/api/") ? (
                <button type="button" className="emr2-dx__save" onClick={() => void openMedia(doc.href!)}>
                  Открыть файл
                </button>
              ) : doc.href ? (
                <Link to={doc.href}>Открыть</Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const HISTORY_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "completed", label: "Пришёл" },
  { id: "booked", label: "Запись" },
  { id: "no_show", label: "Неявка" },
];

function HistoryTab({ visits }: { visits: EmrVisit[] }) {
  const [filter, setFilter] = useState("all");
  const shown = filter === "all" ? visits : visits.filter((v) => v.status_code === filter);
  return (
    <Card
      title="Хронология"
      action={
        <div className="emr2-pills" role="tablist" aria-label="Фильтр визитов">
          {HISTORY_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={filter === f.id ? "is-on" : ""}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      {visits.length === 0 ? (
        <p className="emr2-muted">Записей пока нет.</p>
      ) : shown.length === 0 ? (
        <p className="emr2-muted">В этом фильтре пусто.</p>
      ) : (
        <ul className="emr2-timeline">
          {shown.map((e) => (
            <li key={e.appointment_id} data-kind={e.kind} data-status={e.status_code}>
              <time>{fmtDt(e.start_at)}</time>
              <div>
                <strong>{e.service_title}</strong>
                {e.specialist_name ? <p>{e.specialist_name}</p> : null}
                {e.comment ? <p className="emr2-muted">{e.comment}</p> : null}
              </div>
              <em>{e.status}</em>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TreatmentTab({ data }: { data: EmrChart }) {
  const procs = data.visits.filter((v) => v.kind === "proc");
  const [open, setOpen] = useState(false);
  const visible = open ? procs : procs.slice(0, 6);
  const came = procs.filter((v) => v.status_code === "completed").length;
  const missed = procs.filter((v) => v.status_code === "no_show").length;
  const planned = procs.filter((v) => v.status_code === "booked").length;
  return (
    <div className="emr2-grid">
      <Card title="Курсы">
        <div className="emr2-course">
          <strong>Курс 15</strong>
          <span>
            {courseStatusLabel(data.journey.course_15_status)}
            {data.journey.course_15_started_at ? ` · с ${fmtDate(data.journey.course_15_started_at)}` : ""}
          </span>
        </div>
        {data.journey.membership_flow ? (
          <p className="emr2-muted">Журнал куратора: {data.journey.membership_flow}</p>
        ) : (
          <p className="emr2-muted">В журнале куратора потока нет.</p>
        )}
      </Card>
      <Card title="Процедуры">
        {procs.length === 0 ? (
          <p className="emr2-muted">Процедур в записи нет.</p>
        ) : (
          <>
            <div className="emr2-pills emr2-pills--static" aria-label="Сводка процедур">
              <span>Пришёл {came}</span>
              <span>Неявка {missed}</span>
              <span>Запись {planned}</span>
            </div>
            <table className="emr2-table">
              <thead>
                <tr>
                  <th>Услуга</th>
                  <th>Дата</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((v) => (
                  <tr key={v.appointment_id}>
                    <td>{v.service_title}</td>
                    <td>{fmtDate(v.start_at)}</td>
                    <td>{v.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {procs.length > 6 ? (
              <button type="button" className="emr2-more" onClick={() => setOpen((v) => !v)}>
                {open ? "Свернуть" : `Показать все ${procs.length}`}
              </button>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
