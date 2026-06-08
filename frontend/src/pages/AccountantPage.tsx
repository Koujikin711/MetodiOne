import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import type { AccountantDashboardRead, FinanceAccount, GmailInboxItemRead } from "@/lib/types";

function monthBoundsYmd(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, "0")}` };
}

export function AccountantPage() {
  const qc = useQueryClient();
  const period = useMemo(() => monthBoundsYmd(), []);
  const [amount, setAmount] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [ddsArticle, setDdsArticle] = useState("");
  const [memo, setMemo] = useState("");

  const accountsQ = useQuery({
    queryKey: ["finance-accounts"],
    queryFn: () => apiFetch<FinanceAccount[]>("/api/finance/accounts"),
  });
  const dashboardQ = useQuery({
    queryKey: ["accountant-dashboard", period.from, period.to],
    queryFn: () =>
      apiFetch<AccountantDashboardRead>(
        `/api/finance/accountant/dashboard?date_from=${period.from}&date_to=${period.to}`,
      ),
  });
  const inboxQ = useQuery({
    queryKey: ["gmail-inbox"],
    queryFn: () => apiFetch<GmailInboxItemRead[]>("/api/services/gmail-inbox"),
  });

  const gmailSyncMut = useMutation({
    mutationFn: () => apiFetch<{ imported: number }>("/api/services/gmail-sync", { method: "POST" }),
    onSuccess: (data) => {
      toast.success(data.imported ? `Импортировано писем: ${data.imported}` : "Новых писем нет");
      void qc.invalidateQueries({ queryKey: ["gmail-inbox"] });
      void qc.invalidateQueries({ queryKey: ["accountant-dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const expenseMut = useMutation({
    mutationFn: () =>
      apiFetch<{ journal_entry_id: number }>("/api/finance/accountant/expense", {
        method: "POST",
        body: JSON.stringify({
          amount: Number(amount),
          expense_account_code: accountCode,
          dds_article: ddsArticle.trim(),
          memo: memo.trim() || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Расход записан");
      setAmount("");
      setMemo("");
      void qc.invalidateQueries({ queryKey: ["accountant-dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const expenseAccounts = (accountsQ.data ?? []).filter((a) => a.account_type === "expense" || a.code.startsWith("7"));
  const dash = dashboardQ.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <header>
        <h1 className="text-2xl font-semibold">Бухгалтерия</h1>
        <p className="text-sm lux-caption">Ввод расходов, Gmail и сводка ОПУ / ДДС / ОСВ за текущий месяц</p>
      </header>

      <section className="mo-section p-4">
        <h2 className="mb-3 lux-subheading">Сводка за месяц</h2>
        {dashboardQ.isLoading && <p className="text-sm lux-caption">Загрузка…</p>}
        {dash ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric label="Выручка (ОПУ)" value={dash.revenue_total} />
            <Metric label="Расходы (ОПУ)" value={dash.expense_total} />
            <Metric label="Чистая прибыль" value={dash.net_income} />
            <Metric label="Операционный ДДС" value={dash.dds_operating_net} />
            <Metric label="Касса на начало" value={dash.cash_opening} />
            <Metric label="Касса на конец" value={dash.cash_closing} />
            <div className="rounded-lg border border-[var(--mo-border)] p-3 text-sm">
              <span className="mo-muted">ОСВ: </span>
              <b>{dash.trial_balance_lines}</b> счетов с оборотами
            </div>
            <div className="rounded-lg border border-[var(--mo-border)] p-3 text-sm">
              <span className="mo-muted">Gmail ожидают: </span>
              <b>{dash.gmail_pending_count}</b>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mo-section space-y-3 p-4">
        <h2 className="lux-subheading">Новый расход</h2>
        <input className="mo-input" type="number" min={0} placeholder="Сумма" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <select className="mo-input" value={accountCode} onChange={(e) => setAccountCode(e.target.value)}>
          <option value="">Статья / счёт расхода</option>
          {expenseAccounts.map((a) => (
            <option key={a.id} value={a.code}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>
        <input className="mo-input" placeholder="Статья ДДС (из номенклатуры)" value={ddsArticle} onChange={(e) => setDdsArticle(e.target.value)} />
        <input className="mo-input" placeholder="Комментарий" value={memo} onChange={(e) => setMemo(e.target.value)} />
        <button type="button" className="btn-primary" disabled={expenseMut.isPending || !amount || !accountCode || !ddsArticle.trim()} onClick={() => expenseMut.mutate()}>
          Записать расход
        </button>
      </section>

      <section className="mo-section p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="lux-subheading">Входящие (Gmail)</h2>
          <button type="button" className="btn-secondary text-sm" disabled={gmailSyncMut.isPending} onClick={() => gmailSyncMut.mutate()}>
            Синхронизировать
          </button>
        </div>
        <p className="mb-3 text-xs lux-caption">
          Подключите Gmail в разделе «Интеграции» (IMAP + App Password). Новые письма подтягиваются каждые 5 минут.
        </p>
        {(inboxQ.data ?? []).map((item) => (
          <div key={item.id} className="mb-2 rounded-lg border border-[var(--mo-border)] p-2 text-sm">
            <div className="font-medium">{item.subject || "Без темы"}</div>
            <div className="lux-caption">{item.sender} · {item.status}</div>
            {item.parsed_summary ? <div className="mt-1 text-xs">{item.parsed_summary}</div> : null}
          </div>
        ))}
        {!inboxQ.isLoading && (inboxQ.data ?? []).length === 0 && <p className="text-sm lux-caption">Входящих пока нет</p>}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--mo-border)] p-3">
      <p className="text-xs mo-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{Number(value).toLocaleString("ru-RU")}</p>
    </div>
  );
}
