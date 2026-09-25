import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

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
  const [q, setQ] = useState("");
  const [includeConverted, setIncludeConverted] = useState(false);

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

  const data = query.data;
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)] p-4 shadow-[var(--mo-shadow-luxury)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--mo-text)]">Курс 15 — очередь перехода</h2>
            <p className="mt-1 max-w-2xl text-xs mo-muted">
              Lifecycle / next product. Не ежедневный Telegram-дневник. Massage / TMS / EEG не закрывают
              очередь — только Курс или Протокол.
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
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs mo-muted">
            Поиск
            <input
              className="mo-input mt-1 min-w-[14rem]"
              value={q}
              placeholder="ФИО / телефон / Lead #"
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
        </div>
      </div>

      {query.isLoading ? <p className="lux-caption px-1">Загрузка очереди Курс 15…</p> : null}
      {query.isError ? (
        <p className="text-sm text-red-400">{(query.error as Error).message}</p>
      ) : null}

      {!query.isLoading && rows.length === 0 ? (
        <p className="text-sm mo-muted px-1">В рабочей очереди Курс 15 никого нет.</p>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)]">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--mo-border)] text-[11px] uppercase tracking-wide mo-muted">
                <th className="px-3 py-2 font-medium">Пациент</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 font-medium">Начало</th>
                <th className="px-3 py-2 font-medium">Окончание</th>
                <th className="px-3 py-2 font-medium">Менеджер</th>
                <th className="px-3 py-2 font-medium">Посл. контакт</th>
                <th className="px-3 py-2 font-medium">След. контакт</th>
                <th className="px-3 py-2 font-medium">След. шаг</th>
                <th className="px-3 py-2 font-medium">Внимание</th>
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
                      {r.patient_phone || "—"} · Lead #{r.lead_id}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
