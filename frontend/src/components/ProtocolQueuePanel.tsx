import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import { DateTimeField } from "@/components/DateTimeField";
import { FileText } from "@/components/icons";
import { apiFetch } from "@/lib/api";

type ProtocolRow = {
  lead_id: number | null;
  patient_name: string;
  patient_phone?: string | null;
  product_label: string;
  sequence_no: number;
  protocols_count: number;
  state: string;
  state_label: string;
  started_at?: string | null;
  expected_end_at?: string | null;
  days_remaining: number;
  previous_protocols_label: string;
  manager_user_id?: number | null;
  manager_name?: string | null;
  last_contact_at?: string | null;
  next_contact_at?: string | null;
  next_sale_status: string;
  requires_attention: boolean;
  attention_reason?: string | null;
  purchase_id?: number | null;
  next_request_id?: number | null;
  next_request_kind?: "main_course" | "protocol" | null;
  course_request_id?: number | null;
  protocol_request_id?: number | null;
  followup_comment?: string | null;
  followup_call_at?: string | null;
  followup_overdue?: boolean;
};

type ProtocolQueue = {
  predicate: string;
  duration_days: number;
  ending_soon_days: number;
  note?: string;
  counts: Record<string, number>;
  rows: ProtocolRow[];
};

function protocolStateColor(state: string): string {
  if (state === "active") return "text-emerald-400";
  if (state === "ending_soon") return "text-amber-300";
  if (state === "ended_waiting_next") return "text-red-400";
  return "";
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtCall(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function FollowupCall({
  row,
  pending,
  onSave,
}: {
  row: ProtocolRow;
  pending: boolean;
  onSave: (comment: string, nextCallAt: string) => void;
}) {
  const savedCall = toDatetimeLocal(row.followup_call_at);
  const [callAt, setCallAt] = useState(savedCall);
  useEffect(() => {
    setCallAt(savedCall);
  }, [savedCall]);
  return (
    <>
      <div className="print-hide">
        <DateTimeField
          aria-label="Следующий созвон"
          value={callAt}
          disabled={pending}
          onChange={(iso) => {
            setCallAt(iso);
            onSave(row.followup_comment ?? "", iso);
          }}
        />
      </div>
      <span className="mo-print-only tabular-nums text-xs">{fmtCall(row.followup_call_at)}</span>
    </>
  );
}

function ProtocolNote({
  row,
  pending,
  onSave,
}: {
  row: ProtocolRow;
  pending: boolean;
  onSave: (comment: string, nextCallAt: string) => void;
}) {
  const saved = row.followup_comment ?? "";
  const [text, setText] = useState(saved);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    setText(saved);
  }, [saved]);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 280;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      let top = r.bottom + 6;
      if (top + 140 > window.innerHeight - 8) top = Math.max(8, r.top - 140);
      setPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  const note = saved.trim();
  const panel =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            className="print-hide fixed z-[90] w-[17.5rem] rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-2 shadow-xl"
            style={{ top: pos.top, left: pos.left }}
          >
            <textarea
              className="mo-input min-h-20 w-full text-sm"
              aria-label="Заметка"
              placeholder="Заметка"
              value={text}
              disabled={pending}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onBlur={() => {
                if (text !== saved) onSave(text, toDatetimeLocal(row.followup_call_at));
              }}
            />
          </div>,
          document.body,
        )
      : null;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={[
          "booking-appt-note-btn print-hide shrink-0 rounded p-0.5 transition hover:bg-black/10",
          note ? "is-filled" : "is-empty",
        ].join(" ")}
        aria-label={note || "Заметка"}
        title={note || "Заметка"}
        onClick={() => setOpen((value) => !value)}
      >
        <FileText className="h-3.5 w-3.5" />
      </button>
      <span className="mo-print-only text-xs">{note || "—"}</span>
      {panel}
    </>
  );
}

function fmtDt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

type ManagerOption = { id: number; name: string };

export function ProtocolQueuePanel({
  enabled,
  canReassign = false,
}: {
  enabled: boolean;
  canReassign?: boolean;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [includeConverted, setIncludeConverted] = useState(true);
  const [endingSoonDays, setEndingSoonDays] = useState("7");

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (includeConverted) p.set("include_converted", "true");
    const n = Number(endingSoonDays);
    if (Number.isFinite(n) && n >= 0 && n <= 30) p.set("ending_soon_days", String(n));
    if (q.trim()) p.set("q", q.trim());
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [q, includeConverted, endingSoonDays]);

  const query = useQuery({
    queryKey: ["curator-journal", "protocol-queue", qs],
    enabled,
    queryFn: () => apiFetch<ProtocolQueue>(`/api/curator-journal/protocol-queue${qs}`),
  });

  const managersQ = useQuery({
    queryKey: ["protocol-queue-managers"],
    enabled: enabled && canReassign,
    queryFn: () => apiFetch<ManagerOption[]>("/api/curator-journal/protocol-queue/managers"),
  });

  const data = query.data;
  const rows = data?.rows ?? [];

  const sendNext = useMutation({
    mutationFn: (row: ProtocolRow & { program_kind: "main_course" | "protocol" }) =>
      apiFetch("/api/curator-journal/protocol-queue/next-request", {
        method: "POST",
        body: JSON.stringify({
          lead_id: row.lead_id,
          sale_id: row.lead_id ? null : row.purchase_id,
          sequence_no: row.sequence_no,
          program_kind: row.program_kind,
        }),
      }),
    onSuccess: () => {
      toast.success("Заявка у администратора в KPI");
      void qc.invalidateQueries({ queryKey: ["curator-journal", "protocol-queue"] });
      void qc.invalidateQueries({ queryKey: ["sales-kpi-program-requests"] });
    },
    onError: (err: Error) => toast.error(err.message || "Не удалось отправить"),
  });

  const saveFollowup = useMutation({
    mutationFn: (body: { row: ProtocolRow; comment: string; nextCallAt: string }) =>
      apiFetch("/api/curator-journal/protocol-queue/followup", {
        method: "PUT",
        body: JSON.stringify({
          lead_id: body.row.lead_id,
          sale_id: body.row.lead_id ? null : body.row.purchase_id,
          comment: body.comment.trim() || null,
          next_call_at: body.nextCallAt || null,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["curator-journal", "protocol-queue"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["task-warnings"] });
    },
    onError: (err: Error) => toast.error(err.message || "Не удалось сохранить"),
  });

  const changeManager = useMutation({
    mutationFn: (body: { row: ProtocolRow; managerUserId: number }) =>
      apiFetch<ManagerOption>("/api/curator-journal/protocol-queue/manager", {
        method: "PUT",
        body: JSON.stringify({
          lead_id: body.row.lead_id,
          sale_id: body.row.lead_id ? null : body.row.purchase_id,
          manager_user_id: body.managerUserId,
        }),
      }),
    onSuccess: () => {
      toast.success("Менеджер изменён");
      void qc.invalidateQueries({ queryKey: ["curator-journal", "protocol-queue"] });
    },
    onError: (err: Error) => toast.error(err.message || "Не удалось сменить менеджера"),
  });

  const withdrawNext = useMutation({
    mutationFn: (requestId: number) =>
      apiFetch(`/api/curator-journal/protocol-queue/next-request/${requestId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Заявка отозвана");
      void qc.invalidateQueries({ queryKey: ["curator-journal", "protocol-queue"] });
      void qc.invalidateQueries({ queryKey: ["sales-kpi-program-requests"] });
    },
    onError: (err: Error) => toast.error(err.message || "Не удалось отозвать"),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-4 shadow-[var(--mo-shadow-luxury)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--mo-text)]">
              Протоколы — срок {data?.duration_days ?? 30} дней
            </h2>
            <p className="mt-1 max-w-2xl text-xs mo-muted">
              Кто уже купил Протокол: продажа в KPI или запись на протокол попадает сюда сама.
              Номер 2 и 3 — это следующий протокол после 30 дней, не каждый визит внутри срока.
              В списке сразу все номера. Снимите галочку, если нужны только те, у кого следующий ещё не куплен.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
            <span>
              В сроке <strong>{data?.counts?.active ?? 0}</strong>
            </span>
            <span>
              Скоро <strong>{data?.counts?.ending_soon ?? 0}</strong>
            </span>
            <span>
              Вышел <strong>{data?.counts?.ended_waiting_next ?? 0}</strong>
            </span>
            <span className="text-amber-700 dark:text-amber-300">
              Внимание <strong>{data?.counts?.requires_attention ?? 0}</strong>
            </span>
          </div>
        </div>

        <div className="print-screen-only mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs mo-muted">
            Поиск
            <input
              className="mo-input mt-1 min-w-[14rem]"
              value={q}
              placeholder="ФИО / телефон / #"
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <label className="text-xs mo-muted">
            «Скоро» (дней)
            <input
              className="mo-input mt-1 w-20"
              type="number"
              min={0}
              max={30}
              value={endingSoonDays}
              onChange={(e) => setEndingSoonDays(e.target.value)}
              title="Configurable порог ending soon"
            />
          </label>
          <label className="flex items-center gap-2 text-xs mo-muted pb-2">
            <input
              type="checkbox"
              checked={includeConverted}
              onChange={(e) => setIncludeConverted(e.target.checked)}
            />
            Показать все: 1-й, 2-й и 3-й протокол
          </label>
        </div>
      </div>

      {query.isLoading ? <p className="lux-caption px-1">Загрузка очереди Протоколов…</p> : null}
      {query.isError ? (
        <p className="text-sm text-red-400">{(query.error as Error).message}</p>
      ) : null}

      {!query.isLoading && rows.length === 0 ? (
        <p className="text-sm mo-muted px-1">В рабочей очереди Протоколов никого нет.</p>
      ) : null}

      {rows.length > 0 ? (
        <div className="mo-table-scroll rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)]">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--mo-border)] text-[11px] uppercase tracking-wide mo-muted">
                <th className="px-3 py-2 font-medium">Пациент</th>
                <th className="px-3 py-2 font-medium">Протокол</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 font-medium">Начало</th>
                <th className="px-3 py-2 font-medium">Осталось</th>
                <th className="px-3 py-2 font-medium">Менеджер</th>
                <th className="px-3 py-2 font-medium">Посл. контакт</th>
                <th className="px-3 py-2 font-medium">Созвон</th>
                <th className="px-3 py-2 font-medium">Заметки</th>
                <th className="px-3 py-2 font-medium">Админу</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.lead_id}-${r.sequence_no}-${r.purchase_id ?? ""}`}
                  data-lead-row={r.lead_id ?? undefined}
                  className="border-b border-[var(--mo-border)]/50"
                >
                  <td className="px-3 py-2.5">
                    {r.lead_id ? (
                      <Link
                        to={`/leads/${r.lead_id}`}
                        className="font-semibold text-[var(--mo-accent-hover)] hover:underline"
                      >
                        {r.patient_name}
                      </Link>
                    ) : (
                      <span className="font-semibold">{r.patient_name}</span>
                    )}
                    <div className="text-[11px] tabular-nums mo-muted">
                      {r.patient_phone || "—"}
                      {r.lead_id ? ` · #${r.lead_id}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs font-medium tabular-nums">
                    #{r.sequence_no}
                    <span className="mo-muted"> / {r.protocols_count}</span>
                  </td>
                  <td className={["px-3 py-2.5 text-xs font-medium", protocolStateColor(r.state)].filter(Boolean).join(" ")}>
                    {r.state_label}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{fmtDt(r.started_at)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">
                    {r.days_remaining < 0 ? `${r.days_remaining} дн.` : `${r.days_remaining} дн.`}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {canReassign ? (
                      <select
                        className="mo-input print-hide min-w-[9.5rem] py-1 text-xs"
                        aria-label="Менеджер"
                        value={r.manager_user_id ?? ""}
                        disabled={changeManager.isPending || (!r.lead_id && !r.purchase_id)}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          if (!next || next === r.manager_user_id) return;
                          changeManager.mutate({ row: r, managerUserId: next });
                        }}
                      >
                        {r.manager_user_id ? null : <option value="">—</option>}
                        {(managersQ.data ?? []).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                        {r.manager_user_id &&
                        !(managersQ.data ?? []).some((m) => m.id === r.manager_user_id) ? (
                          <option value={r.manager_user_id}>{r.manager_name || "Менеджер"}</option>
                        ) : null}
                      </select>
                    ) : (
                      r.manager_name || "—"
                    )}
                    {canReassign ? (
                      <span className="mo-print-only">{r.manager_name || "—"}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{fmtDt(r.last_contact_at)}</td>
                  <td className={["px-3 py-2.5", r.followup_overdue ? "text-amber-300" : ""].filter(Boolean).join(" ")}>
                    <FollowupCall
                      row={r}
                      pending={saveFollowup.isPending}
                      onSave={(comment, nextCallAt) => saveFollowup.mutate({ row: r, comment, nextCallAt })}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <ProtocolNote
                      row={r}
                      pending={saveFollowup.isPending}
                      onSave={(comment, nextCallAt) => saveFollowup.mutate({ row: r, comment, nextCallAt })}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <div className="flex flex-col gap-1">
                      <label className="flex items-center gap-1.5 whitespace-nowrap">
                        <input
                          type="checkbox"
                          aria-label="Направить на курс"
                          checked={Boolean(r.course_request_id)}
                          disabled={
                            sendNext.isPending ||
                            withdrawNext.isPending ||
                            (!r.lead_id && !r.purchase_id)
                          }
                          onChange={(e) => {
                            if (e.target.checked) sendNext.mutate({ ...r, program_kind: "main_course" });
                            else if (r.course_request_id) withdrawNext.mutate(r.course_request_id);
                          }}
                        />
                        Курс
                      </label>
                      <label className="flex items-center gap-1.5 whitespace-nowrap">
                        <input
                          type="checkbox"
                          aria-label="Направить на протокол"
                          checked={Boolean(r.protocol_request_id)}
                          disabled={
                            sendNext.isPending ||
                            withdrawNext.isPending ||
                            (!r.lead_id && !r.purchase_id)
                          }
                          onChange={(e) => {
                            if (e.target.checked) sendNext.mutate({ ...r, program_kind: "protocol" });
                            else if (r.protocol_request_id) withdrawNext.mutate(r.protocol_request_id);
                          }}
                        />
                        На {r.sequence_no + 1}-й протокол
                      </label>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
