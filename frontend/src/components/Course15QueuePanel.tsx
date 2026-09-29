import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";

type Course15Row = {
  lead_id: number;
  patient_name: string;
  patient_phone?: string | null;
  product_label: string;
  state: string;
  state_label: string;
  started_at?: string | null;
  ended_at?: string | null;
  manager_name?: string | null;
  responsible_name?: string | null;
  last_contact_at?: string | null;
  next_contact_at?: string | null;
  next_step: string;
  requires_attention: boolean;
  attention_reason?: string | null;
  pending_program?: string | null;
};

type Course15Queue = {
  predicate: string;
  note?: string;
  counts: Record<string, number>;
  rows: Course15Row[];
};

function fmtDt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function Course15QueuePanel({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [includeConverted, setIncludeConverted] = useState(false);
  const [scope, setScope] = useState<"work" | "admin" | "all">("work");

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (includeConverted) p.set("include_converted", "true");
    if (q.trim()) p.set("q", q.trim());
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [q, includeConverted]);

  const query = useQuery({
    queryKey: ["curator-journal", "course15-queue", qs],
    enabled,
    queryFn: () => apiFetch<Course15Queue>(`/api/curator-journal/course15-queue${qs}`),
  });

  const sendMutation = useMutation({
    mutationFn: (body: { lead_id: number; program_kind: "main_course" | "protocol" }) =>
      apiFetch("/api/curator-journal/program-requests", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Отправлено админу. Оплату вносит админ в KPI → Курсы / протоколы");
      void qc.invalidateQueries({ queryKey: ["curator-journal", "course15-queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const withdrawMutation = useMutation({
    mutationFn: (leadId: number) =>
      apiFetch(`/api/curator-journal/program-requests/${leadId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Заявка отозвана");
      void qc.invalidateQueries({ queryKey: ["curator-journal", "course15-queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data = query.data;
  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    if (scope === "admin") return all.filter((r) => Boolean(r.pending_program));
    if (scope === "work") return all.filter((r) => !r.pending_program);
    return all;
  }, [data?.rows, scope]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-4 shadow-[var(--mo-shadow-luxury)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--mo-text)]">Курс 15 — очередь перехода</h2>
            <p className="mt-1 max-w-2xl text-xs mo-muted">
              Имя из онлайн-записи, телефон отдельно. Начало — последняя оплата, окончание —
              через 15 дней. В одной кнопке «Админу» выбирается Курс или Протокол.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
            <span>
              Активен <strong>{data?.counts?.active ?? 0}</strong>
            </span>
            <span>
              Ждёт шаг <strong>{data?.counts?.waiting_next_step ?? 0}</strong>
            </span>
            <span className="text-amber-700 dark:text-amber-300">
              Внимание <strong>{data?.counts?.requires_attention ?? 0}</strong>
            </span>
            <span>
              У админа <strong>{data?.counts?.pending_admin ?? 0}</strong>
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
          <label className="flex items-center gap-2 text-xs mo-muted pb-2">
            <input
              type="checkbox"
              checked={includeConverted}
              onChange={(e) => setIncludeConverted(e.target.checked)}
            />
            Показать перешедших на Курс/Протокол
          </label>
          {(
            [
              ["work", "Без заявки"],
              ["admin", "У админа"],
              ["all", "Все"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={[
                "rounded-lg border px-2.5 py-1.5 text-xs",
                scope === id
                  ? "border-[var(--mo-accent)] bg-[var(--mo-accent)]/15 font-semibold"
                  : "border-[var(--mo-border)]",
              ].join(" ")}
              onClick={() => setScope(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {query.isLoading ? <p className="lux-caption px-1">Загрузка очереди Курс 15…</p> : null}
      {query.isError ? (
        <p className="text-sm text-red-400">{(query.error as Error).message}</p>
      ) : null}

      {!query.isLoading && rows.length === 0 ? (
        <p className="text-sm mo-muted px-1">
          {(data?.rows?.length ?? 0) > 0
            ? "В этом фильтре никого нет."
            : "В рабочей очереди Курс 15 никого нет."}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)]">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--mo-border)] text-[11px] uppercase tracking-wide mo-muted">
                <th className="px-3 py-2 font-medium">Пациент</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 font-medium" title="Дата последней оплаты">
                  Начало
                </th>
                <th className="px-3 py-2 font-medium" title="15 дней после последней оплаты">
                  Окончание
                </th>
                <th className="px-3 py-2 font-medium">Менеджер</th>
                <th className="px-3 py-2 font-medium">Посл. контакт</th>
                <th className="px-3 py-2 font-medium">След. контакт</th>
                <th className="px-3 py-2 font-medium">След. шаг</th>
                <th className="px-3 py-2 font-medium">Внимание</th>
                <th className="px-3 py-2 font-medium">Админу</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.lead_id}
                  className={[
                    "border-b border-[var(--mo-border)]/50",
                    r.requires_attention ? "bg-amber-500/5" : "",
                  ].join(" ")}
                >
                  <td className="px-3 py-2.5">
                    <Link
                      to={`/leads/${r.lead_id}`}
                      className="font-semibold text-[var(--mo-accent-hover)] hover:underline"
                    >
                      {r.patient_name}
                    </Link>
                    <div className="text-[11px] tabular-nums mo-muted">
                      {r.patient_phone || "—"} · #{r.lead_id}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs font-medium">{r.state_label}</span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{fmtDt(r.started_at)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{fmtDt(r.ended_at)}</td>
                  <td className="px-3 py-2.5 text-xs">{r.manager_name || "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{fmtDt(r.last_contact_at)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-xs">{fmtDt(r.next_contact_at)}</td>
                  <td className="px-3 py-2.5 text-xs">{r.next_step}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {r.requires_attention ? (
                      <span className="text-amber-700 dark:text-amber-300" title={r.attention_reason || ""}>
                        да
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.state === "waiting_next_step" || r.state === "active" ? (
                      <select
                        className="mo-input min-w-[7.5rem] py-1 text-xs"
                        value={r.pending_program ?? ""}
                        disabled={sendMutation.isPending || withdrawMutation.isPending}
                        aria-label="Отправить админу"
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "main_course" || v === "protocol") {
                            sendMutation.mutate({ lead_id: r.lead_id, program_kind: v });
                          } else if (r.pending_program) {
                            withdrawMutation.mutate(r.lead_id);
                          }
                        }}
                      >
                        <option value="">Админу</option>
                        <option value="main_course">Курс</option>
                        <option value="protocol">Протокол</option>
                      </select>
                    ) : (
                      "—"
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
