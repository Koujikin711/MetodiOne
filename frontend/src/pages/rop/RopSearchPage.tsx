import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

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
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(q.trim());
        }}
      >
        <input
          className="mo-input min-w-[16rem] flex-1"
          placeholder="Телефон или ФИО пациента"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="mo-btn-primary text-sm">
          Найти
        </button>
      </form>

      {query.isFetching && <p className="text-sm mo-muted">Поиск…</p>}

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
