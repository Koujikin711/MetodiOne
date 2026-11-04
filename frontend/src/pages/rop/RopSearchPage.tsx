import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";

import { RopPageIntro } from "@/components/RopPageIntro";
import { Search } from "@/components/icons";
import { apiFetch } from "@/lib/api";

type Visit = {
  appointment_id: number;
  start_at: string;
  specialist_name: string | null;
  status: string;
  service_title: string | null;
  service_amount: number;
  paid_amount: number;
  responsible_manager_name: string | null;
};

type Patient = {
  patient_name: string;
  patient_phone: string;
  total_visits: number;
  visits: Visit[];
};

function money(v: number) {
  return Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

function fmtDt(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_RU: Record<string, string> = {
  booked: "Запись",
  completed: "Пришёл",
  no_show: "Неявка",
  cancelled: "Отмена",
};

export function RopSearchPage() {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");

  const query = useQuery({
    queryKey: ["rop-search", submitted],
    enabled: submitted.trim().length >= 2,
    queryFn: () =>
      apiFetch<Patient[]>(
        `/api/rop/search?q=${encodeURIComponent(submitted.trim())}&limit=20`,
      ),
  });

  return (
    <div className="flex flex-col gap-4">
      <RopPageIntro
        title="Поиск пациента"
        hint="ФИО или телефон любой страны (+992, +7, +1, 8…). Можно без кода страны — покажем историю визитов."
      />
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const next = q.trim();
          if (next.length < 2) {
            toast.error("Введите хотя бы 2 символа");
            return;
          }
          setSubmitted(next);
        }}
      >
        <input
          className="mo-input min-h-10 min-w-[16rem] flex-1"
          placeholder="Телефон или ФИО пациента"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <button
          type="submit"
          className="journal-icon-btn inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--mo-border-strong)] bg-[var(--mo-surface-elevated)] text-[var(--mo-text)] disabled:opacity-50"
          aria-label={query.isFetching ? "Поиск…" : "Найти"}
          title="Найти"
          disabled={query.isFetching}
        >
          <Search className="h-5 w-5" />
          <span className="journal-icon-btn__tip" role="tooltip">
            Найти
          </span>
        </button>
      </form>

      {query.isError ? (
        <p className="text-sm text-[var(--mo-danger,#ef4444)]">
          {(query.error as Error)?.message || "Не удалось выполнить поиск"}
        </p>
      ) : null}

      {(query.data ?? []).map((p) => (
        <div key={`${p.patient_name}-${p.patient_phone}`} className="rounded-xl border border-[var(--mo-border)] p-4">
          <div className="font-medium">{p.patient_name}</div>
          <div className="text-sm mo-muted">
            {p.patient_phone} · визитов: {p.total_visits}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-xs mo-muted">
                <tr>
                  <th className="py-1 text-left">Когда</th>
                  <th className="py-1 text-left">Специалист</th>
                  <th className="py-1 text-left">Услуга</th>
                  <th className="py-1 text-left">Статус</th>
                  <th className="py-1 text-right">Оплата</th>
                  <th className="py-1 text-left">Менеджер</th>
                </tr>
              </thead>
              <tbody>
                {p.visits.map((v) => (
                  <tr key={v.appointment_id} className="border-t border-[var(--mo-border)]">
                    <td className="py-1 whitespace-nowrap">{fmtDt(v.start_at)}</td>
                    <td className="py-1">{v.specialist_name || "—"}</td>
                    <td className="py-1">{v.service_title || "—"}</td>
                    <td className="py-1">{STATUS_RU[v.status] || v.status}</td>
                    <td className="py-1 text-right tabular-nums">
                      {money(v.paid_amount)} / {money(v.service_amount)}
                    </td>
                    <td className="py-1">{v.responsible_manager_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {submitted && !query.isFetching && !(query.data ?? []).length && (
        <p className="text-sm mo-muted">Ничего не найдено</p>
      )}
    </div>
  );
}
