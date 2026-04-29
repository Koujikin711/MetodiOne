import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeHorecaRoleFromToken, decodeRoleFromToken } from "@/lib/auth";
import { ymdInBookingTz } from "@/lib/bookingTz";
import { bookingStatusToHorecaStage } from "@/lib/horecaOrderFlow";
import type { BookingAppointment, BookingSpecialist } from "@/lib/types";

function isBusyNow(a: BookingAppointment, nowMs: number): boolean {
  const stage = bookingStatusToHorecaStage(a.status);
  if (stage === "closed") return false;
  const s = new Date(a.start_at).getTime();
  const e = new Date(a.end_at).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return false;
  return nowMs >= s && nowMs < e;
}

export function HorecaTablesPage() {
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const horecaRole = decodeHorecaRoleFromToken(token);
  const date = ymdInBookingTz(Date.now());
  const specialistsQuery = useQuery({
    queryKey: ["booking-specialists", "horeca-tables"],
    queryFn: () => apiFetch<BookingSpecialist[]>("/api/booking/specialists"),
    refetchInterval: 15_000,
  });
  const appointmentsQuery = useQuery({
    queryKey: ["booking-appointments-grid", date, "horeca-tables"],
    queryFn: () => apiFetch<BookingAppointment[]>(`/api/booking/appointments?date=${encodeURIComponent(date)}`),
    refetchInterval: 10_000,
  });

  const activeTables = (specialistsQuery.data ?? [])
    .filter((s) => s.is_active)
    .sort((a, b) => {
      const ao = a.sort_order ?? 0;
      const bo = b.sort_order ?? 0;
      if (ao !== bo) return ao - bo;
      return a.id - b.id;
    });
  const nowMs = Date.now();
  const roleLabel =
    horecaRole === "cook" || role === "expert"
      ? "Режим кухни: контроль загрузки стола и готовности"
      : horecaRole === "waiter" || role === "manager"
        ? "Режим официанта: контроль посадки и занятости"
        : horecaRole === "hall_admin" || role === "admin"
          ? "Режим администратора зала"
          : "Режим владельца";

  return (
    <div className="mx-auto max-w-[1300px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / Столики</p>
        <h1 className="text-3xl font-semibold text-white">Зал: столики в реальном времени</h1>
        <p className="text-sm text-slate-400">Нумерация столиков и онлайн-статусы: занято или свободно.</p>
        <p className="text-xs text-slate-500">{roleLabel}</p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs text-slate-300">
        <Link to="/horeca/orders" className="rounded-lg border border-slate-600/50 px-3 py-1.5 hover:bg-slate-800/60">
          К заказам
        </Link>
        <Link to="/horeca" className="rounded-lg border border-slate-600/50 px-3 py-1.5 hover:bg-slate-800/60">
          В центр HoReCa
        </Link>
      </div>

      {specialistsQuery.isLoading || appointmentsQuery.isLoading ? <p className="text-sm text-slate-400">Загрузка зала…</p> : null}
      {specialistsQuery.isError ? <p className="text-sm text-rose-300">{(specialistsQuery.error as Error).message}</p> : null}
      {appointmentsQuery.isError ? <p className="text-sm text-rose-300">{(appointmentsQuery.error as Error).message}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {activeTables.map((t, idx) => {
          const slot = (appointmentsQuery.data ?? []).find((a) => a.specialist_id === t.id && isBusyNow(a, nowMs));
          const busy = Boolean(slot);
          return (
            <div
              key={t.id}
              className={[
                "rounded-2xl border p-4",
                busy
                  ? "border-rose-500/45 bg-rose-950/25"
                  : "border-emerald-500/40 bg-emerald-950/20",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Стол #{idx + 1}</h2>
                <span
                  className={[
                    "rounded-full px-2 py-0.5 text-xs",
                    busy ? "bg-rose-500/20 text-rose-100" : "bg-emerald-500/20 text-emerald-100",
                  ].join(" ")}
                >
                  {busy ? "Занят" : "Свободен"}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-300">{t.full_name}</p>
              <p className="mt-1 text-xs text-slate-400">
                {slot ? `Гость: ${(slot.patient_name || "").trim() || "—"}` : "Ожидает посадку"}
              </p>
            </div>
          );
        })}
      </section>
    </div>
  );
}

