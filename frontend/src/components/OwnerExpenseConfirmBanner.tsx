import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Bell } from "@/components/icons";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { APP_CURRENCY } from "@/lib/money";

type PendingExpense = {
  id: number;
  txn_date: string;
  expense: number | string;
  counterparty: string | null;
  basis: string | null;
  bank: string | null;
  expense_confirm?: string | null;
};

function money(v: number | string | null | undefined) {
  const n = Number(v || 0);
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function shortDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return iso || "—";
  return `${m[3]}.${m[2]}`;
}

function yearMonthOf(iso: string) {
  return (iso || "").slice(0, 7);
}

/** Колокольчик владельцу: расходы >500 ждут подтверждения. */
export function OwnerExpenseConfirmBanner() {
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const isOwner = role === "owner" || role === "super_owner";
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const pendingQuery = useQuery({
    queryKey: ["finance-expenses-pending"],
    queryFn: () => apiFetch<PendingExpense[]>("/api/finance/expenses/pending-confirm"),
    enabled: Boolean(token) && isOwner,
    refetchInterval: 30_000,
  });

  const rows = pendingQuery.data ?? [];
  const count = rows.length;
  const total = useMemo(
    () => rows.reduce((sum, row) => sum + Math.abs(Number(row.expense || 0)), 0),
    [rows],
  );

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  if (!token || !isOwner || count === 0) return null;

  return (
    <div ref={rootRef} className="relative z-40 shrink-0 print:hidden">
      <button
        type="button"
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] text-[var(--mo-text)] shadow-sm"
        aria-label={`Ждут подтверждения расходы: ${count}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell className="h-5 w-5" />
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
          {count > 9 ? "9+" : count}
        </span>
      </button>
      {open ? (
        <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] shadow-xl">
          <div className="border-b border-[var(--mo-border)] px-3 py-2">
            <p className="text-sm font-semibold text-[var(--mo-text)]">Расходы ждут подтверждения</p>
            <p className="text-[11px] mo-muted">
              {count} · {money(total)} {APP_CURRENCY}
            </p>
          </div>
          <ul className="max-h-80 overflow-y-auto py-1">
            {rows.map((row) => {
              const ym = yearMonthOf(row.txn_date);
              const to = ym ? `/expenses?ym=${ym}&focus=${row.id}` : "/expenses";
              return (
                <li key={row.id}>
                  <Link
                    to={to}
                    className="block px-3 py-2 text-sm text-[var(--mo-text)] hover:bg-[var(--mo-surface)]"
                    onClick={() => setOpen(false)}
                  >
                    <span className="font-medium tabular-nums">
                      {money(row.expense)} {APP_CURRENCY}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] mo-muted">
                      {shortDate(row.txn_date)}
                      {row.counterparty ? ` · ${row.counterparty}` : ""}
                      {row.basis ? ` · ${row.basis}` : ""}
                      {row.bank ? ` · ${row.bank}` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
