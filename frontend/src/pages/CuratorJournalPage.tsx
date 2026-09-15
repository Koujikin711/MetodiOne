/** Журнал куратора / табель потока — успеваемость (дневник, фото, жалобы). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import toast from "react-hot-toast";
import { Navigate } from "react-router-dom";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { canAccessCuratorJournal } from "@/lib/clinicRoles";
import { DateField } from "@/components/DateField";
import { Pencil, Search, Trash2 } from "@/components/icons";

type DiaryStatus = "pending" | "done" | "missed";
type PhotoStatus = "pending" | "done" | "missed";
type ComplaintStatus = "pending" | "no_complaint" | "complaint";

type ComplaintCategory =
  | "temperature"
  | "vomiting"
  | "stool"
  | "sleep"
  | "nutrition"
  | "medication"
  | "recommendations"
  | "weight"
  | "pain"
  | "rash_or_allergy"
  | "other";

type Complaint = {
  id?: number;
  category: ComplaintCategory;
  comment: string | null;
  numeric_value: number | string | null;
  unit: string | null;
  count_value: number | null;
};

type Membership = {
  id: number;
  flow_id: number;
  lead_id: number | null;
  display_name: string;
  phone: string | null;
  joined_on: string;
  left_on: string | null;
  source: string;
  is_active: boolean;
};

type JournalEntry = {
  id: number;
  membership_id: number;
  entry_date: string;
  diary_status: DiaryStatus;
  photo_status: PhotoStatus;
  complaint_status: ComplaintStatus;
  complaint_general_comment: string | null;
  complaints: Complaint[];
};

type Flow = {
  id: number;
  course_name: string;
  flow_number: number;
  title: string | null;
  starts_on: string;
  ends_on: string;
  curator_user_id: number | null;
  curator_name: string | null;
  kpi_group_no: number | null;
  status: string;
  participants_count: number;
};

type MonthJournal = {
  flow: Flow;
  year: number;
  month: number;
  days: string[];
  participants: Membership[];
  entries: JournalEntry[];
};

type DaySummary = {
  date: string;
  participants_total: number;
  diary_done: number;
  diary_missed: number;
  diary_pending: number;
  photo_done: number;
  photo_missed: number;
  photo_pending: number;
  with_complaints: number;
  not_filled: number;
  diary_percent: number;
  photo_percent: number;
  complaint_counts: Record<string, number>;
};

type CuratorUser = { id: number; full_name: string; role: string };

type MemberHistory = {
  membership: Membership;
  flow_number: number;
  course_name: string;
  diary_done: number;
  diary_total_days: number;
  photo_done: number;
  photo_total_days: number;
  complaint_days: number;
  entries: JournalEntry[];
  recurring: Array<{ category: string; days_count: number }>;
};

type ComplaintsReport = {
  date_from: string;
  date_to: string;
  patients_with_complaints: number;
  category_totals: Record<string, number>;
  items: Array<{
    membership_id: number;
    display_name: string;
    entry_date: string;
    complaints: Complaint[];
    general_comment: string | null;
  }>;
};

const CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  temperature: "Температура",
  vomiting: "Рвота",
  stool: "Стул",
  sleep: "Сон",
  nutrition: "Питание",
  medication: "Лекарства",
  recommendations: "Выполнение рекомендаций",
  weight: "Вес",
  pain: "Боль",
  rash_or_allergy: "Сыпь / аллергия",
  other: "Другое",
};

const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as ComplaintCategory[];

const MONTHS_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

type RowFilter =
  | "all"
  | "has_complaints"
  | "no_diary"
  | "no_photo"
  | "not_filled"
  | ComplaintCategory;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDdMm(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
}

function formatRuDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function statusGlyph(kind: "diary" | "photo" | "complaint", status: string): string {
  if (kind === "complaint") {
    if (status === "complaint") return "!";
    if (status === "no_complaint") return "✓";
    return "○";
  }
  if (status === "done") return "✓";
  if (status === "missed") return "✕";
  return "○";
}

function cycleDiaryPhoto(cur: DiaryStatus | PhotoStatus): DiaryStatus | PhotoStatus {
  if (cur === "pending") return "done";
  if (cur === "done") return "missed";
  return "pending";
}

function complaintLine(c: Complaint): string {
  const label = CATEGORY_LABELS[c.category] || c.category;
  if (c.category === "temperature" && c.numeric_value != null) {
    const extra = c.comment ? ` — ${c.comment}` : "";
    return `${label} — ${c.numeric_value} °C${extra}`;
  }
  if (c.category === "vomiting" && c.count_value != null) {
    const extra = c.comment ? ` — ${c.comment}` : "";
    return `${label} — ${c.count_value} раза${extra}`;
  }
  if (c.category === "weight" && c.numeric_value != null) {
    const extra = c.comment ? ` — ${c.comment}` : "";
    return `${label} — ${c.numeric_value} кг${extra}`;
  }
  if (c.comment) return `${label} — ${c.comment}`;
  return `• ${label}`;
}

function flowTitle(f: Flow) {
  return f.title?.trim() || `Поток №${f.flow_number}`;
}

export function CuratorJournalPage() {
  const role = decodeRoleFromToken(getStoredToken());
  const allowed = canAccessCuratorJournal(role);
  const canManageFlows =
    role === "owner" || role === "admin" || role === "administrator" || role === "super_owner";

  const qc = useQueryClient();
  const [selectedFlowId, setSelectedFlowId] = useState<number | null>(null);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RowFilter>("all");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [complaintEdit, setComplaintEdit] = useState<{
    membershipId: number;
    date: string;
    name: string;
  } | null>(null);
  const [historyMemberId, setHistoryMemberId] = useState<number | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [mobileDay, setMobileDay] = useState(todayIso());
  const scrollRef = useRef<HTMLDivElement>(null);
  const didScrollToday = useRef(false);

  const flowsQuery = useQuery({
    queryKey: ["curator-journal", "flows"],
    enabled: allowed,
    queryFn: () => apiFetch<Flow[]>("/api/curator-journal/flows"),
  });

  useEffect(() => {
    if (!allowed) return;
    if (selectedFlowId == null && flowsQuery.data?.length) {
      setSelectedFlowId(flowsQuery.data[0].id);
    }
  }, [flowsQuery.data, selectedFlowId, allowed]);

  const monthQuery = useQuery({
    queryKey: ["curator-journal", "month", selectedFlowId, year, month, search],
    enabled: allowed && selectedFlowId != null,
    placeholderData: (prev) => prev,
    queryFn: () => {
      const q = search.trim() ? `&q=${encodeURIComponent(search.trim())}` : "";
      return apiFetch<MonthJournal>(
        `/api/curator-journal/flows/${selectedFlowId}/month?year=${year}&month=${month}${q}`,
      );
    },
  });

  const dayForSummary = selectedDay || (monthQuery.data?.days.includes(todayIso()) ? todayIso() : monthQuery.data?.days[0] || null);

  const summaryQuery = useQuery({
    queryKey: ["curator-journal", "day-summary", selectedFlowId, dayForSummary],
    enabled: allowed && selectedFlowId != null && !!dayForSummary,
    placeholderData: (prev) => prev,
    queryFn: () =>
      apiFetch<DaySummary>(
        `/api/curator-journal/flows/${selectedFlowId}/day-summary?date=${dayForSummary}`,
      ),
  });

  const entryMap = useMemo(() => {
    const map = new Map<string, JournalEntry>();
    for (const e of monthQuery.data?.entries || []) {
      map.set(`${e.membership_id}|${e.entry_date}`, e);
    }
    return map;
  }, [monthQuery.data]);

  const filteredParticipants = useMemo(() => {
    const list = monthQuery.data?.participants || [];
    if (filter === "all") return list;
    return list.filter((p) => {
      const days = monthQuery.data?.days || [];
      if (filter === "has_complaints") {
        return days.some((d) => entryMap.get(`${p.id}|${d}`)?.complaint_status === "complaint");
      }
      if (filter === "no_diary") {
        return days.some((d) => {
          const e = entryMap.get(`${p.id}|${d}`);
          return !e || e.diary_status === "missed" || e.diary_status === "pending";
        });
      }
      if (filter === "no_photo") {
        return days.some((d) => {
          const e = entryMap.get(`${p.id}|${d}`);
          return !e || e.photo_status === "missed" || e.photo_status === "pending";
        });
      }
      if (filter === "not_filled") {
        return days.some((d) => {
          const e = entryMap.get(`${p.id}|${d}`);
          return (
            !e ||
            (e.diary_status === "pending" &&
              e.photo_status === "pending" &&
              e.complaint_status === "pending")
          );
        });
      }
      return days.some((d) => {
        const e = entryMap.get(`${p.id}|${d}`);
        return e?.complaints?.some((c) => c.category === filter);
      });
    });
  }, [filter, monthQuery.data, entryMap]);

  useEffect(() => {
    didScrollToday.current = false;
  }, [selectedFlowId, year, month]);

  useEffect(() => {
    if (!monthQuery.data || didScrollToday.current) return;
    const today = todayIso();
    if (!monthQuery.data.days.includes(today)) return;
    const el = scrollRef.current?.querySelector(`[data-day="${today}"]`);
    if (el && scrollRef.current) {
      const parent = scrollRef.current;
      const left = (el as HTMLElement).offsetLeft - 120;
      parent.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
      didScrollToday.current = true;
      setSelectedDay(today);
      setMobileDay(today);
    }
  }, [monthQuery.data]);

  const upsertMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<JournalEntry>(`/api/curator-journal/flows/${selectedFlowId}/entries`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["curator-journal", "month", selectedFlowId] });
      void qc.invalidateQueries({ queryKey: ["curator-journal", "day-summary", selectedFlowId] });
    },
    onError: (err: Error) => toast.error(err.message || "Ошибка сохранения"),
  });

  if (!allowed) {
    return <Navigate to="/app" replace />;
  }

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  }

  const flow = monthQuery.data?.flow || flowsQuery.data?.find((f) => f.id === selectedFlowId);

  return (
    <div className="curator-journal-page mx-auto flex w-full max-w-[1600px] flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mo-page-title">Журнал куратора</h1>
          <p className="mo-page-sub">Успеваемость потока</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageFlows ? (
            <button type="button" className="btn-secondary text-sm" onClick={() => setShowCreate(true)}>
              Новый поток
            </button>
          ) : null}
          {selectedFlowId ? (
            <>
              <button type="button" className="btn-secondary text-sm" onClick={() => setShowImport(true)}>
                Импорт
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={() => setShowReport(true)}>
                Отчёт по жалобам
              </button>
            </>
          ) : null}
        </div>
      </header>

      {/* Flow picker */}
      <div className="flex flex-wrap gap-2">
        {(flowsQuery.data || []).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setSelectedFlowId(f.id)}
            className={[
              "rounded-xl border px-3.5 py-2.5 text-left text-sm transition",
              selectedFlowId === f.id
                ? "border-[var(--mo-accent)] bg-[var(--mo-accent)]/15 shadow-[0_0_0_1px_color-mix(in_srgb,var(--mo-accent)_35%,transparent)]"
                : "border-[var(--mo-border)] bg-[var(--mo-surface)] hover:border-[var(--mo-accent)]/40",
            ].join(" ")}
          >
            <div className="text-base font-semibold tracking-wide">{flowTitle(f)}</div>
            <div className="mt-0.5 text-[11px] text-[var(--mo-muted)]">
              {f.course_name} · {f.participants_count} уч.
            </div>
          </button>
        ))}
        {!flowsQuery.isLoading && !(flowsQuery.data || []).length ? (
          <p className="text-sm text-[var(--mo-muted)]">Потоков пока нет. Создайте первый.</p>
        ) : null}
      </div>

      {flow ? (
        <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-4 shadow-[var(--mo-shadow-luxury)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="cj-flow-meta-card min-w-[16rem] flex-1">
              <div>
                <span className="cj-meta-label">Курс</span>
                <span className="cj-meta-value">{flow.course_name}</span>
              </div>
              <div>
                <span className="cj-meta-label">Номер</span>
                <span className="cj-meta-value is-flow-no">
                  {flow.title?.trim() || `№${flow.flow_number}`}
                </span>
              </div>
              <div>
                <span className="cj-meta-label">Куратор</span>
                <span className="cj-meta-value">{flow.curator_name || "—"}</span>
              </div>
              <div>
                <span className="cj-meta-label">Период</span>
                <span className="cj-meta-value">
                  {formatRuDate(flow.starts_on)} – {formatRuDate(flow.ends_on)}
                </span>
              </div>
              <div>
                <span className="cj-meta-label">Участников</span>
                <span className="cj-meta-value">{flow.participants_count}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canManageFlows ? (
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"
                  onClick={() => setShowEdit(true)}
                  title="Изменить номер, период, куратора"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Настройки
                </button>
              ) : null}
              <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => shiftMonth(-1)}>
                ←
              </button>
              <span className="min-w-[9rem] text-center text-sm font-semibold">
                {MONTHS_RU[month - 1]} {year}
              </span>
              <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => shiftMonth(1)}>
                →
              </button>
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-sm"
                onClick={() => {
                  const t = new Date();
                  setYear(t.getFullYear());
                  setMonth(t.getMonth() + 1);
                  setSelectedDay(todayIso());
                  setMobileDay(todayIso());
                  didScrollToday.current = false;
                }}
              >
                Сегодня
              </button>
            </div>
          </div>

          <div className="cj-toolbar mt-3">
            <div className="cj-search-wrap">
              <Search className="cj-search-icon" />
              <input
                className="mo-input w-full text-sm"
                placeholder="Поиск по ФИО…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="mo-input cj-filter-select text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value as RowFilter)}
            >
              <option value="all">Все</option>
              <option value="has_complaints">Есть жалобы</option>
              <option value="no_diary">Не отправили дневник</option>
              <option value="no_photo">Не отправили фото</option>
              <option value="not_filled">Не заполнено</option>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  Жалоба: {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {summaryQuery.data ? (
        <div className="grid gap-2 rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            title={formatRuDate(summaryQuery.data.date)}
            body={`Участников: ${summaryQuery.data.participants_total}`}
          />
          <SummaryCard
            title="Дневник"
            body={`${summaryQuery.data.diary_done} / ${summaryQuery.data.participants_total} (${summaryQuery.data.diary_percent}%)`}
          />
          <SummaryCard
            title="Фото"
            body={`${summaryQuery.data.photo_done} / ${summaryQuery.data.participants_total} (${summaryQuery.data.photo_percent}%)`}
          />
          <SummaryCard
            title="Жалобы"
            body={`${summaryQuery.data.with_complaints} · пусто ${summaryQuery.data.not_filled}`}
          />
        </div>
      ) : null}

      {/* Desktop sticky matrix */}
      {monthQuery.data ? (
        <>
          <div
            ref={scrollRef}
            className="curator-journal-scroll hidden overflow-auto rounded-2xl border border-[var(--mo-border)] md:block"
            style={{ maxHeight: "70vh" }}
          >
            <table className="curator-journal-table border-collapse text-center text-xs">
              <thead>
                <tr>
                  <th className="cj-sticky-corner" rowSpan={2}>
                    ФИО
                  </th>
                  {monthQuery.data.days.map((d) => {
                    const isToday = d === todayIso();
                    return (
                      <th
                        key={d}
                        colSpan={3}
                        data-day={d}
                        className={[
                          "cj-sticky-top border-b border-l border-[var(--mo-border)] px-1 py-2",
                          isToday ? "bg-[var(--mo-accent)]/15 font-bold" : "bg-[var(--mo-surface-elevated)]",
                          selectedDay === d ? "ring-1 ring-inset ring-[var(--mo-accent)]" : "",
                        ].join(" ")}
                        onClick={() => setSelectedDay(d)}
                      >
                        {formatDdMm(d)}
                        {isToday ? " · СЕГОДНЯ" : ""}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  {monthQuery.data.days.map((d) =>
                    (["Дневник", "Фото", "Жалоба"] as const).map((label) => (
                      <th
                        key={`${d}-${label}`}
                        className="cj-sticky-top2 border-l border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] px-1 py-1 font-normal text-[10px] text-[var(--mo-muted)]"
                      >
                        {label}
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredParticipants.map((p) => (
                  <tr key={p.id} className="border-t border-[var(--mo-border)]">
                    <th className="cj-sticky-name">
                      <button
                        type="button"
                        className="text-left font-medium text-[var(--mo-text)] hover:underline"
                        onClick={() => setHistoryMemberId(p.id)}
                      >
                        {p.display_name}
                      </button>
                    </th>
                    {monthQuery.data!.days.map((d) => {
                      const e = entryMap.get(`${p.id}|${d}`);
                      const diary = (e?.diary_status || "pending") as DiaryStatus;
                      const photo = (e?.photo_status || "pending") as PhotoStatus;
                      const complaint = (e?.complaint_status || "pending") as ComplaintStatus;
                      return (
                        <FragmentCells key={`${p.id}-${d}`}>
                          <StatusCell
                            glyph={statusGlyph("diary", diary)}
                            title="Дневник"
                            onClick={() =>
                              upsertMut.mutate({
                                membership_id: p.id,
                                entry_date: d,
                                diary_status: cycleDiaryPhoto(diary),
                              })
                            }
                          />
                          <StatusCell
                            glyph={statusGlyph("photo", photo)}
                            title="Фото"
                            onClick={() =>
                              upsertMut.mutate({
                                membership_id: p.id,
                                entry_date: d,
                                photo_status: cycleDiaryPhoto(photo),
                              })
                            }
                          />
                          <ComplaintCell
                            glyph={statusGlyph("complaint", complaint)}
                            entry={e}
                            name={p.display_name}
                            date={d}
                            onOpen={() =>
                              setComplaintEdit({
                                membershipId: p.id,
                                date: d,
                                name: p.display_name,
                              })
                            }
                            onQuickNoComplaint={() =>
                              upsertMut.mutate({
                                membership_id: p.id,
                                entry_date: d,
                                complaint_status: "no_complaint",
                                complaints: [],
                              })
                            }
                          />
                        </FragmentCells>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredParticipants.length ? (
              <p className="p-6 text-sm text-[var(--mo-muted)]">Нет участников по фильтру.</p>
            ) : null}
          </div>

          {/* Mobile day cards */}
          <div className="flex flex-col gap-3 md:hidden">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary px-3 py-1"
                onClick={() => {
                  const days = monthQuery.data?.days || [];
                  const idx = days.indexOf(mobileDay);
                  if (idx > 0) setMobileDay(days[idx - 1]);
                }}
              >
                ←
              </button>
              <select
                className="mo-input flex-1 text-sm"
                value={mobileDay}
                onChange={(e) => {
                  setMobileDay(e.target.value);
                  setSelectedDay(e.target.value);
                }}
              >
                {(monthQuery.data?.days || []).map((d) => (
                  <option key={d} value={d}>
                    {formatRuDate(d)}
                    {d === todayIso() ? " · сегодня" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary px-3 py-1"
                onClick={() => {
                  const days = monthQuery.data?.days || [];
                  const idx = days.indexOf(mobileDay);
                  if (idx >= 0 && idx < days.length - 1) setMobileDay(days[idx + 1]);
                }}
              >
                →
              </button>
            </div>
            {filteredParticipants.map((p) => {
              const e = entryMap.get(`${p.id}|${mobileDay}`);
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-3"
                >
                  <button
                    type="button"
                    className="mb-2 font-medium hover:underline"
                    onClick={() => setHistoryMemberId(p.id)}
                  >
                    {p.display_name}
                  </button>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <MobileStatus
                      label="Дневник"
                      glyph={statusGlyph("diary", e?.diary_status || "pending")}
                      onClick={() =>
                        upsertMut.mutate({
                          membership_id: p.id,
                          entry_date: mobileDay,
                          diary_status: cycleDiaryPhoto((e?.diary_status || "pending") as DiaryStatus),
                        })
                      }
                    />
                    <MobileStatus
                      label="Фото"
                      glyph={statusGlyph("photo", e?.photo_status || "pending")}
                      onClick={() =>
                        upsertMut.mutate({
                          membership_id: p.id,
                          entry_date: mobileDay,
                          photo_status: cycleDiaryPhoto((e?.photo_status || "pending") as PhotoStatus),
                        })
                      }
                    />
                    <MobileStatus
                      label="Жалоба"
                      glyph={statusGlyph("complaint", e?.complaint_status || "pending")}
                      onClick={() =>
                        setComplaintEdit({
                          membershipId: p.id,
                          date: mobileDay,
                          name: p.display_name,
                        })
                      }
                    />
                  </div>
                  {e?.complaint_status === "complaint" && e.complaints?.length ? (
                    <ul className="mt-2 space-y-0.5 text-xs text-[var(--mo-muted)]">
                      {e.complaints.map((c) => (
                        <li key={c.category}>{complaintLine(c)}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : selectedFlowId && monthQuery.isLoading ? (
        <p className="text-sm text-[var(--mo-muted)]">Загрузка журнала…</p>
      ) : null}

      {showCreate ? (
        <FlowFormModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={(id) => {
            setShowCreate(false);
            setSelectedFlowId(id);
            void qc.invalidateQueries({ queryKey: ["curator-journal", "flows"] });
          }}
        />
      ) : null}

      {showEdit && flow ? (
        <FlowFormModal
          mode="edit"
          initial={flow}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            void qc.invalidateQueries({ queryKey: ["curator-journal"] });
          }}
          onArchived={() => {
            setShowEdit(false);
            setSelectedFlowId(null);
            void qc.invalidateQueries({ queryKey: ["curator-journal", "flows"] });
          }}
        />
      ) : null}

      {showImport && selectedFlowId ? (
        <ImportModal
          flowId={selectedFlowId}
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false);
            void qc.invalidateQueries({ queryKey: ["curator-journal"] });
          }}
        />
      ) : null}

      {complaintEdit && selectedFlowId ? (
        <ComplaintModal
          flowId={selectedFlowId}
          membershipId={complaintEdit.membershipId}
          date={complaintEdit.date}
          name={complaintEdit.name}
          initial={entryMap.get(`${complaintEdit.membershipId}|${complaintEdit.date}`)}
          onClose={() => setComplaintEdit(null)}
          onSaved={() => {
            setComplaintEdit(null);
            void qc.invalidateQueries({ queryKey: ["curator-journal", "month", selectedFlowId] });
            void qc.invalidateQueries({ queryKey: ["curator-journal", "day-summary", selectedFlowId] });
          }}
        />
      ) : null}

      {historyMemberId ? (
        <HistoryModal
          membershipId={historyMemberId}
          year={year}
          month={month}
          onClose={() => setHistoryMemberId(null)}
        />
      ) : null}

      {showReport && selectedFlowId && flow ? (
        <ReportModal
          flowId={selectedFlowId}
          startsOn={flow.starts_on}
          endsOn={flow.ends_on}
          onClose={() => setShowReport(false)}
        />
      ) : null}
    </div>
  );
}

function FragmentCells({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function SummaryCard({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mo-muted)]">
        {title}
      </div>
      <div className="text-sm font-medium">{body}</div>
    </div>
  );
}

function StatusCell({
  glyph,
  title,
  onClick,
}: {
  glyph: string;
  title: string;
  onClick: () => void;
}) {
  const color =
    glyph === "✓"
      ? "text-emerald-600"
      : glyph === "✕"
        ? "text-rose-600"
        : glyph === "!"
          ? "text-amber-600"
          : "text-[var(--mo-muted)]";
  return (
    <td className="border-l border-[var(--mo-border)] p-0">
      <button
        type="button"
        title={title}
        className={`flex h-9 w-9 items-center justify-center text-base font-semibold ${color} hover:bg-[var(--mo-accent)]/10`}
        onClick={onClick}
      >
        {glyph}
      </button>
    </td>
  );
}

function ComplaintCell({
  glyph,
  entry,
  name,
  date,
  onOpen,
  onQuickNoComplaint,
}: {
  glyph: string;
  entry?: JournalEntry;
  name: string;
  date: string;
  onOpen: () => void;
  onQuickNoComplaint: () => void;
}) {
  const [tip, setTip] = useState(false);
  const color =
    glyph === "✓"
      ? "text-emerald-600"
      : glyph === "!"
        ? "text-amber-600 font-bold"
        : "text-[var(--mo-muted)]";

  return (
    <td className="relative border-l border-[var(--mo-border)] p-0">
      <button
        type="button"
        className={`flex h-9 w-9 items-center justify-center text-base ${color} hover:bg-[var(--mo-accent)]/10`}
        onClick={() => {
          if (glyph === "○") {
            // compact: open modal for choice
            onOpen();
            return;
          }
          if (glyph === "✓") {
            onOpen();
            return;
          }
          onOpen();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onQuickNoComplaint();
        }}
        onMouseEnter={() => glyph === "!" && setTip(true)}
        onMouseLeave={() => setTip(false)}
      >
        {glyph}
      </button>
      {tip && entry?.complaints?.length ? (
        <div className="absolute left-1/2 top-full z-50 mt-1 w-56 -translate-x-1/2 rounded-lg border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-2 text-left text-[11px] shadow-lg">
          <div className="mb-1 font-semibold">
            {name}
            <br />
            {formatDdMm(date)}
          </div>
          <div className="mb-1 text-amber-700">⚠ Есть жалобы</div>
          <ul className="space-y-0.5">
            {entry.complaints.map((c) => (
              <li key={c.category}>{complaintLine(c)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </td>
  );
}

function MobileStatus({
  label,
  glyph,
  onClick,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={onClick}>
      {label} {glyph}
    </button>
  );
}

function FlowFormModal({
  mode,
  initial,
  onClose,
  onSaved,
  onArchived,
}: {
  mode: "create" | "edit";
  initial?: Flow;
  onClose: () => void;
  onSaved: (id: number) => void;
  onArchived?: () => void;
}) {
  const today = todayIso();
  const [courseName, setCourseName] = useState(initial?.course_name || "Основной курс");
  const [flowNumber, setFlowNumber] = useState(initial?.flow_number || 1);
  const [title, setTitle] = useState(initial?.title || "");
  const [startsOn, setStartsOn] = useState(initial?.starts_on || today);
  const [endsOn, setEndsOn] = useState(() => {
    if (initial?.ends_on) return initial.ends_on;
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [curatorId, setCuratorId] = useState<number | "">(initial?.curator_user_id ?? "");
  const [kpiGroup, setKpiGroup] = useState<number | "">(initial?.kpi_group_no ?? "");

  const curatorsQuery = useQuery({
    queryKey: ["curator-journal", "curators"],
    queryFn: () => apiFetch<CuratorUser[]>("/api/curator-journal/curators"),
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        course_name: courseName,
        flow_number: flowNumber,
        title: title || null,
        starts_on: startsOn,
        ends_on: endsOn,
        curator_user_id: curatorId === "" ? null : curatorId,
        kpi_group_no: kpiGroup === "" ? null : kpiGroup,
      };
      if (mode === "create") {
        return apiFetch<Flow>("/api/curator-journal/flows", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      return apiFetch<Flow>(`/api/curator-journal/flows/${initial!.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (f) => {
      toast.success(mode === "create" ? "Поток создан" : "Поток сохранён");
      onSaved(f.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archiveMut = useMutation({
    mutationFn: () =>
      apiFetch<Flow>(`/api/curator-journal/flows/${initial!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
      }),
    onSuccess: () => {
      toast.success("Поток в архиве");
      onArchived?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal title={mode === "create" ? "Новый поток" : "Настройки потока"} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <label className="block">
          <span className="mo-field-label">Курс</span>
          <input className="mo-input w-full" value={courseName} onChange={(e) => setCourseName(e.target.value)} />
        </label>

        <label className="block">
          <span className="mo-field-label">Номер потока</span>
          <input
            className="mo-input cj-flow-number-field w-full"
            type="number"
            min={1}
            value={flowNumber}
            onChange={(e) => setFlowNumber(Number(e.target.value) || 1)}
          />
          <span className="mt-1 block text-[11px] text-[var(--mo-muted)]">
            В журнале: «Поток №{flowNumber}»
          </span>
        </label>

        <label className="block">
          <span className="mo-field-label">Название (опционально)</span>
          <input
            className="mo-input w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Здоровый ребёнок"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mo-field-label">С</span>
            <DateField className="w-full" value={startsOn} onChange={setStartsOn} allowClear={false} />
          </label>
          <label className="block">
            <span className="mo-field-label">По</span>
            <DateField className="w-full" value={endsOn} onChange={setEndsOn} allowClear={false} />
          </label>
        </div>

        <label className="block">
          <span className="mo-field-label">Куратор</span>
          <select
            className="mo-input w-full"
            value={curatorId}
            onChange={(e) => setCuratorId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">— не назначен —</option>
            {(curatorsQuery.data || []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mo-field-label">KPI «Поток» для импорта (опц.)</span>
          <input
            className="mo-input w-full"
            type="number"
            min={1}
            max={20}
            value={kpiGroup}
            onChange={(e) => setKpiGroup(e.target.value ? Number(e.target.value) : "")}
            placeholder="group_no 1…20"
          />
        </label>

        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          {mode === "edit" ? (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1.5 text-rose-600"
              disabled={archiveMut.isPending}
              onClick={() => {
                if (window.confirm("Скрыть поток в архив? История журнала сохранится.")) {
                  archiveMut.mutate();
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              В архив
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saveMut.isPending || !courseName.trim()}
              onClick={() => saveMut.mutate()}
            >
              {mode === "create" ? "Создать" : "Сохранить"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ImportModal({
  flowId,
  onClose,
  onDone,
}: {
  flowId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<"kpi" | "manual" | "leads">("kpi");
  const [groupNo, setGroupNo] = useState(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [leadIds, setLeadIds] = useState("");

  const kpiMut = useMutation({
    mutationFn: () =>
      apiFetch<{ added: number; skipped: number }>(`/api/curator-journal/flows/${flowId}/import-kpi`, {
        method: "POST",
        body: JSON.stringify({ group_no: groupNo, only_active: true }),
      }),
    onSuccess: (r) => {
      toast.success(`Добавлено: ${r.added}, пропущено: ${r.skipped}`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const manualMut = useMutation({
    mutationFn: () =>
      apiFetch(`/api/curator-journal/flows/${flowId}/memberships`, {
        method: "POST",
        body: JSON.stringify({ display_name: name, phone: phone || null }),
      }),
    onSuccess: () => {
      toast.success("Участник добавлен");
      setName("");
      setPhone("");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leadsMut = useMutation({
    mutationFn: () => {
      const ids = leadIds
        .split(/[,\s]+/)
        .map((x) => Number(x.trim()))
        .filter((n) => n > 0);
      return apiFetch<{ added: number; skipped: number }>(
        `/api/curator-journal/flows/${flowId}/import-leads`,
        {
          method: "POST",
          body: JSON.stringify({ lead_ids: ids }),
        },
      );
    },
    onSuccess: (r) => {
      toast.success(`Добавлено: ${r.added}, пропущено: ${r.skipped}`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal title="Импорт участников" onClose={onClose}>
      <div className="mb-3 flex gap-2 text-sm">
        {(["kpi", "manual", "leads"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? "btn-primary px-2 py-1" : "btn-secondary px-2 py-1"}
            onClick={() => setTab(t)}
          >
            {t === "kpi" ? "Из KPI" : t === "manual" ? "Вручную" : "Лиды"}
          </button>
        ))}
      </div>
      {tab === "kpi" ? (
        <div className="space-y-2 text-sm">
          <label className="block">
            <span className="mo-field-label">Поток KPI (group_no)</span>
            <input
              className="mo-input cj-flow-number-field w-full"
              type="number"
              min={1}
              max={20}
              value={groupNo}
              onChange={(e) => setGroupNo(Number(e.target.value) || 1)}
            />
          </label>
          <p className="text-xs text-[var(--mo-muted)]">
            Подтянет активные продажи курсов/протоколов с этим номером потока.
          </p>
          <button type="button" className="btn-primary" onClick={() => kpiMut.mutate()} disabled={kpiMut.isPending}>
            Импортировать
          </button>
        </div>
      ) : null}
      {tab === "manual" ? (
        <div className="space-y-2 text-sm">
          <label className="block">
            <span className="mo-field-label">ФИО</span>
            <input className="mo-input w-full" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mo-field-label">Телефон</span>
            <input className="mo-input w-full" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={!name.trim() || manualMut.isPending}
            onClick={() => manualMut.mutate()}
          >
            Добавить
          </button>
        </div>
      ) : null}
      {tab === "leads" ? (
        <div className="space-y-2 text-sm">
          <label className="block">
            <span className="mo-field-label">ID лидов через запятую</span>
            <input
              className="mo-input w-full"
              value={leadIds}
              onChange={(e) => setLeadIds(e.target.value)}
              placeholder="12, 45, 78"
            />
          </label>
          <button type="button" className="btn-primary" onClick={() => leadsMut.mutate()} disabled={leadsMut.isPending}>
            Импортировать
          </button>
        </div>
      ) : null}
    </Modal>
  );
}

function ComplaintModal({
  flowId,
  membershipId,
  date,
  name,
  initial,
  onClose,
  onSaved,
}: {
  flowId: number;
  membershipId: number;
  date: string;
  name: string;
  initial?: JournalEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "form">(
    initial?.complaint_status === "complaint" ? "form" : "choose",
  );
  const [selected, setSelected] = useState<Set<ComplaintCategory>>(() => {
    return new Set((initial?.complaints || []).map((c) => c.category));
  });
  const [fields, setFields] = useState<Record<string, { comment: string; numeric: string; count: string }>>(
    () => {
      const init: Record<string, { comment: string; numeric: string; count: string }> = {};
      for (const c of initial?.complaints || []) {
        init[c.category] = {
          comment: c.comment || "",
          numeric: c.numeric_value != null ? String(c.numeric_value) : "",
          count: c.count_value != null ? String(c.count_value) : "",
        };
      }
      return init;
    },
  );
  const [general, setGeneral] = useState(initial?.complaint_general_comment || "");

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/api/curator-journal/flows/${flowId}/entries`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Сохранено");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggleCat(cat: ComplaintCategory) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function saveComplaint() {
    const complaints = [...selected].map((category) => {
      const f = fields[category] || { comment: "", numeric: "", count: "" };
      return {
        category,
        comment: f.comment || null,
        numeric_value: f.numeric ? Number(f.numeric) : null,
        unit: category === "temperature" ? "C" : category === "weight" ? "kg" : null,
        count_value: f.count ? Number(f.count) : null,
      };
    });
    saveMut.mutate({
      membership_id: membershipId,
      entry_date: date,
      complaint_status: "complaint",
      complaint_general_comment: general || null,
      complaints,
    });
  }

  return (
    <Modal title="Жалобы" onClose={onClose}>
      <div className="mb-2 text-sm">
        <div>
          <span className="text-[var(--mo-muted)]">Пациент:</span> {name}
        </div>
        <div>
          <span className="text-[var(--mo-muted)]">Дата:</span> {formatRuDate(date)}
        </div>
      </div>

      {mode === "choose" ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() =>
              saveMut.mutate({
                membership_id: membershipId,
                entry_date: date,
                complaint_status: "no_complaint",
                complaints: [],
              })
            }
          >
            ✓ Жалоб нет
          </button>
          <button type="button" className="btn-secondary" onClick={() => setMode("form")}>
            ! Есть жалоба
          </button>
        </div>
      ) : (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto text-sm">
          {ALL_CATEGORIES.map((cat) => {
            const on = selected.has(cat);
            const f = fields[cat] || { comment: "", numeric: "", count: "" };
            return (
              <div key={cat} className="rounded-lg border border-[var(--mo-border)] p-2">
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={on} onChange={() => toggleCat(cat)} />
                  {CATEGORY_LABELS[cat]}
                </label>
                {on ? (
                  <div className="mt-2 space-y-1 pl-6">
                    {cat === "temperature" ? (
                      <label className="block">
                        Температура °C
                        <input
                          className="mo-input mt-1 w-full"
                          value={f.numeric}
                          onChange={(e) =>
                            setFields((s) => ({ ...s, [cat]: { ...f, numeric: e.target.value } }))
                          }
                        />
                      </label>
                    ) : null}
                    {cat === "vomiting" ? (
                      <label className="block">
                        Количество эпизодов
                        <input
                          className="mo-input mt-1 w-full"
                          value={f.count}
                          onChange={(e) =>
                            setFields((s) => ({ ...s, [cat]: { ...f, count: e.target.value } }))
                          }
                        />
                      </label>
                    ) : null}
                    {cat === "weight" ? (
                      <label className="block">
                        Вес кг
                        <input
                          className="mo-input mt-1 w-full"
                          value={f.numeric}
                          onChange={(e) =>
                            setFields((s) => ({ ...s, [cat]: { ...f, numeric: e.target.value } }))
                          }
                        />
                      </label>
                    ) : null}
                    <label className="block">
                      Комментарий{cat === "other" ? " *" : ""}
                      <input
                        className="mo-input mt-1 w-full"
                        value={f.comment}
                        onChange={(e) =>
                          setFields((s) => ({ ...s, [cat]: { ...f, comment: e.target.value } }))
                        }
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            );
          })}
          <label className="block">
            Общий комментарий
            <textarea
              className="mo-input mt-1 w-full"
              rows={2}
              value={general}
              onChange={(e) => setGeneral(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap justify-between gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                saveMut.mutate({
                  membership_id: membershipId,
                  entry_date: date,
                  complaint_status: "no_complaint",
                  complaints: [],
                })
              }
            >
              Жалоб нет
            </button>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Отмена
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!selected.size || saveMut.isPending}
                onClick={saveComplaint}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function HistoryModal({
  membershipId,
  year,
  month,
  onClose,
}: {
  membershipId: number;
  year: number;
  month: number;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["curator-journal", "history", membershipId, year, month],
    queryFn: () =>
      apiFetch<MemberHistory>(
        `/api/curator-journal/memberships/${membershipId}/history?year=${year}&month=${month}`,
      ),
  });
  const h = q.data;
  return (
    <Modal title="История участника" onClose={onClose} wide>
      {q.isLoading ? <p className="text-sm">Загрузка…</p> : null}
      {h ? (
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-lg font-semibold">{h.membership.display_name}</div>
            <div className="text-[var(--mo-muted)]">
              {h.course_name} · Поток №{h.flow_number} · {MONTHS_RU[month - 1]} {year}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <SummaryCard title="Дневник" body={`${h.diary_done}/${h.diary_total_days}`} />
            <SummaryCard title="Фото" body={`${h.photo_done}/${h.photo_total_days}`} />
            <SummaryCard title="Дней с жалобами" body={String(h.complaint_days)} />
          </div>
          {h.recurring.length ? (
            <div>
              <div className="mb-1 font-medium">Повторяющиеся жалобы</div>
              <ul className="text-xs text-[var(--mo-muted)]">
                {h.recurring.map((r) => (
                  <li key={r.category}>
                    {CATEGORY_LABELS[r.category as ComplaintCategory] || r.category} —{" "}
                    {r.days_count} дн. (повторяется)
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <div className="mb-1 font-medium">Жалобы</div>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {h.entries
                .filter((e) => e.complaint_status === "complaint")
                .map((e) => (
                  <li key={e.id} className="rounded border border-[var(--mo-border)] p-2">
                    <div className="font-medium">{formatRuDate(e.entry_date)}</div>
                    {e.complaints.map((c) => (
                      <div key={c.category} className="text-xs">
                        {complaintLine(c)}
                      </div>
                    ))}
                  </li>
                ))}
              {!h.entries.some((e) => e.complaint_status === "complaint") ? (
                <li className="text-[var(--mo-muted)]">Жалоб нет</li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function ReportModal({
  flowId,
  startsOn,
  endsOn,
  onClose,
}: {
  flowId: number;
  startsOn: string;
  endsOn: string;
  onClose: () => void;
}) {
  const today = todayIso();
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);

  const reportQuery = useQuery({
    queryKey: ["curator-journal", "report", flowId, dateFrom, dateTo],
    queryFn: () =>
      apiFetch<ComplaintsReport>(
        `/api/curator-journal/flows/${flowId}/complaints-report?date_from=${dateFrom}&date_to=${dateTo}`,
      ),
  });

  function preset(kind: "today" | "week" | "month" | "flow") {
    const t = new Date();
    if (kind === "today") {
      setDateFrom(today);
      setDateTo(today);
    } else if (kind === "week") {
      const from = new Date(t);
      from.setDate(from.getDate() - 6);
      setDateFrom(
        `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`,
      );
      setDateTo(today);
    } else if (kind === "month") {
      setDateFrom(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-01`);
      setDateTo(today);
    } else {
      setDateFrom(startsOn);
      setDateTo(endsOn);
    }
  }

  const r = reportQuery.data;

  return (
    <Modal title="Отчёт по жалобам" onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => preset("today")}>
          Сегодня
        </button>
        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => preset("week")}>
          Неделя
        </button>
        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => preset("month")}>
          Месяц
        </button>
        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => preset("flow")}>
          Весь поток
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:max-w-md">
          <DateField className="min-w-[8.5rem] flex-1" value={dateFrom} onChange={setDateFrom} allowClear={false} />
          <DateField className="min-w-[8.5rem] flex-1" value={dateTo} onChange={setDateTo} allowClear={false} />
        </div>
      </div>
      {r ? (
        <div className="space-y-3 text-sm">
          <div>
            Пациентов с жалобами: <strong>{r.patients_with_complaints}</strong>
          </div>
          <div className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-3">
            {ALL_CATEGORIES.map((c) => (
              <div key={c}>
                {CATEGORY_LABELS[c]}: {r.category_totals[c] || 0}
              </div>
            ))}
          </div>
          <ul className="max-h-80 space-y-3 overflow-y-auto">
            {r.items.map((item, idx) => (
              <li key={`${item.membership_id}-${item.entry_date}-${idx}`} className="border-b border-[var(--mo-border)] pb-2">
                <div className="font-semibold">
                  {item.display_name}{" "}
                  <span className="font-normal text-[var(--mo-muted)]">{formatRuDate(item.entry_date)}</span>
                </div>
                {item.complaints.map((c) => (
                  <div key={c.category} className="text-xs">
                    {complaintLine(c)}
                  </div>
                ))}
              </li>
            ))}
            {!r.items.length ? <li className="text-[var(--mo-muted)]">Нет жалоб за период</li> : null}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-[var(--mo-muted)]">Загрузка…</p>
      )}
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-3 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div
        className={[
          "mo-modal-panel max-h-[90vh] w-full overflow-y-auto rounded-2xl p-4 shadow-xl",
          wide ? "max-w-2xl" : "max-w-md",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={onClose}>
            Закрыть
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
