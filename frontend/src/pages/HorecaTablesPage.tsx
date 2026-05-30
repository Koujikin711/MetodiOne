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
  const busyCount = activeTables.filter((t) => t.is_busy).length;
  const freeCount = Math.max(activeTables.length - busyCount, 0);
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
        <h1 className="lux-heading-page">Зал: столики в реальном времени</h1>
        <p className="text-sm lux-caption">Нумерация столиков и онлайн-статусы: занято или свободно.</p>
        <p className="text-xs mo-muted">{roleLabel}</p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs mo-muted">
        <Link to="/horeca/orders" className="rounded-lg border border-[var(--mo-border-strong)]/50 px-3 py-1.5 hover:bg-[var(--mo-accent-soft)]">
          К заказам
        </Link>
        <Link to="/horeca" className="rounded-lg border border-[var(--mo-border-strong)]/50 px-3 py-1.5 hover:bg-[var(--mo-accent-soft)]">
          В центр HoReCa
        </Link>
      </div>

      {tablesQuery.isLoading ? <p className="text-sm lux-caption">Загрузка зала…</p> : null}
      {tablesQuery.isError ? <p className="text-sm text-[#6b1d2f]">{(tablesQuery.error as Error).message}</p> : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl mo-section p-4">
          <p className="text-xs lux-caption">Всего столиков</p>
          <p className="mt-2 lux-heading-page">{activeTables.length}</p>
        </article>
        <article className="rounded-2xl border border-rose-500/35 bg-rose-950/20 p-4">
          <p className="text-xs text-rose-200/80">Занято сейчас</p>
          <p className="mt-2 text-3xl font-semibold text-rose-200">{busyCount}</p>
        </article>
        <article className="rounded-2xl border border-emerald-500/35 bg-emerald-950/20 p-4">
          <p className="text-xs text-emerald-200/80">Свободно</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-200">{freeCount}</p>
        </article>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {activeTables.map((t) => {
          const busy = Boolean(t.is_busy);
          return (
            <div
              key={t.table_id}
              className={[
                "rounded-2xl border p-4 shadow-inner",
                busy
                  ? "border-rose-500/45 bg-rose-950/25"
                  : "border-emerald-500/40 bg-emerald-950/20",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <h2 className="lux-subheading">Стол #{t.table_number}</h2>
                <span
                  className={[
                    "rounded-full px-2 py-0.5 text-xs",
                    busy ? "bg-rose-500/20 text-rose-100" : "bg-emerald-500/20 text-emerald-100",
                  ].join(" ")}
                >
                  {busy ? "Занят" : "Свободен"}
                </span>
              </div>
              <p className="mt-2 text-sm mo-muted">{t.table_name}</p>
              <p className="mt-1 text-xs lux-caption">
                {busy ? `Гость: ${(t.current_guest_name || "").trim() || "—"}` : "Ожидает посадку"}
              </p>
              {busy ? <p className="mt-1 text-xs mo-muted">Блюдо: {(t.current_item_name || "").trim() || "—"}</p> : null}
            </div>
          );
        })}
        {!tablesQuery.isLoading && activeTables.length === 0 ? (
          <p className="text-sm mo-muted">Нет столиков. Добавьте персонал зала/столики в модуле записи.</p>
        ) : null}
      </section>
    </div>
  );
}

