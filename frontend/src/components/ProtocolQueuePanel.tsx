import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

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
  manager_name?: string | null;
  last_contact_at?: string | null;
  next_contact_at?: string | null;
  next_sale_status: string;
  requires_attention: boolean;
  attention_reason?: string | null;
  purchase_id?: number | null;
  next_request_id?: number | null;
};

type ProtocolQueue = {
  predicate: string;
  duration_days: number;
  ending_soon_days: number;
  note?: string;
  counts: Record<string, number>;
  rows: ProtocolRow[];
};

function fmtDt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

export function ProtocolQueuePanel({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [includeConverted, setIncludeConverted] = useState(false);
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

  const data = query.data;
  const rows = data?.rows ?? [];

  const sendNext = useMutation({
    mutationFn: (row: ProtocolRow) =>
      apiFetch("/api/curator-journal/protocol-queue/next-request", {
        method: "POST",
        body: JSON.stringify({
          lead_id: row.lead_id,
          sale_id: row.lead_id ? null : row.purchase_id,
          sequence_no: row.sequence_no,
        }),
      }),
    onSuccess: () => {
      toast.success("Заявка у администратора в KPI");
      void qc.invalidateQueries({ queryKey: ["curator-journal", "protocol-queue"] });
      void qc.invalidateQueries({ queryKey: ["sales-kpi-program-requests"] });
    },
    onError: (err: Error) => toast.error(err.message || "Не удалось отправить"),
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
              Кто уже купил Протокол. Срок 30 дней с даты продажи. Без привязки к карточке
              человек тоже виден — по имени из продажи.
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

        <div className="mt-3 flex flex-wrap items-end gap-3">
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
            Показать с купленным следующим Протоколом
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
        <div className="overflow-x-auto rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)]">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--mo-border)] text-[11px] uppercase tracking-wide mo-muted">
                <th className="px-3 py-2 font-medium">Пациент</th>
                <th className="px-3 py-2 font-medium">Протокол</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 font-medium">Начало</th>
                <th className="px-3 py-2 font-medium">Ожид. конец</th>
                <th className="px-3 py-2 font-medium">Осталось</th>
                <th className="px-3 py-2 font-medium">Предыдущие</th>
                <th className="px-3 py-2 font-medium">Менеджер</th>
                <th className="px-3 py-2 font-medium">Посл. контакт</th>
                <th className="px-3 py-2 font-medium">След. контакт</th>
                <th className="px-3 py-2 font-medium">След. продажа</th>
                <th className="px-3 py-2 font-medium">Внимание</th>
                <th className="px-3 py-2 font-medium">Админу</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.lead_id}-${r.sequence_no}-${r.purchase_id ?? ""}`}
                  data-lead-row={r.lead_id ?? undefined}
                  className={[
                    "border-b border-[var(--mo-border)]/50",
                    r.requires_attention ? "bg-amber-500/5" : "",
                  ].join(" ")}
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
                  <td className="px-3 py-2.5 text-xs font-medium">{r.state_label}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{fmtDt(r.started_at)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{fmtDt(r.expected_end_at)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">
                    {r.days_remaining < 0 ? `${r.days_remaining} дн.` : `${r.days_remaining} дн.`}
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums">{r.previous_protocols_label}</td>
                  <td className="px-3 py-2.5 text-xs">{r.manager_name || "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{fmtDt(r.last_contact_at)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{fmtDt(r.next_contact_at)}</td>
                  <td className="px-3 py-2.5 text-xs">{r.next_sale_status}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {r.requires_attention ? (
                      <span className="text-amber-700 dark:text-amber-300" title={r.attention_reason || ""}>
                        да
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {r.state === "next_protocol_sold" ? (
                      "—"
                    ) : r.next_request_id ? (
                      <button
                        type="button"
                        className="text-[var(--mo-accent)] hover:underline"
                        disabled={withdrawNext.isPending}
                        onClick={() => withdrawNext.mutate(r.next_request_id as number)}
                      >
                        У админа · отозвать
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        disabled={sendNext.isPending || (!r.lead_id && !r.purchase_id)}
                        onClick={() => sendNext.mutate(r)}
                      >
                        На {r.sequence_no + 1}-й протокол
                      </button>
                    )}
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
