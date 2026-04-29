import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeHorecaRoleFromToken, decodeRoleFromToken } from "@/lib/auth";
import type { HorecaTableStatus } from "@/lib/types";

export function HorecaTablesPage() {
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const horecaRole = decodeHorecaRoleFromToken(token);
  const tablesQuery = useQuery({
    queryKey: ["horeca-tables-status"],
    queryFn: () => apiFetch<HorecaTableStatus[]>("/api/horeca/tables/status"),
    refetchInterval: 10_000,
  });

  const activeTables = [...(tablesQuery.data ?? [])].sort((a, b) => a.table_number - b.table_number);
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

      {tablesQuery.isLoading ? <p className="text-sm text-slate-400">Загрузка зала…</p> : null}
      {tablesQuery.isError ? <p className="text-sm text-rose-300">{(tablesQuery.error as Error).message}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {activeTables.map((t) => {
          const busy = Boolean(t.is_busy);
          return (
            <div
              key={t.table_id}
              className={[
                "rounded-2xl border p-4",
                busy
                  ? "border-rose-500/45 bg-rose-950/25"
                  : "border-emerald-500/40 bg-emerald-950/20",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Стол #{t.table_number}</h2>
                <span
                  className={[
                    "rounded-full px-2 py-0.5 text-xs",
                    busy ? "bg-rose-500/20 text-rose-100" : "bg-emerald-500/20 text-emerald-100",
                  ].join(" ")}
                >
                  {busy ? "Занят" : "Свободен"}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-300">{t.table_name}</p>
              <p className="mt-1 text-xs text-slate-400">
                {busy ? `Гость: ${(t.current_guest_name || "").trim() || "—"}` : "Ожидает посадку"}
              </p>
            </div>
          );
        })}
        {!tablesQuery.isLoading && activeTables.length === 0 ? (
          <p className="text-sm text-slate-500">Нет столиков. Добавьте персонал зала/столики в модуле записи.</p>
        ) : null}
      </section>
    </div>
  );
}

