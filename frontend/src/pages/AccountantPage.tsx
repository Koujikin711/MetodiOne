import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import type { FinanceAccount, GmailInboxItemRead } from "@/lib/types";

export function AccountantPage() {
  const [amount, setAmount] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [ddsArticle, setDdsArticle] = useState("");
  const [memo, setMemo] = useState("");

  const accountsQ = useQuery({
    queryKey: ["finance-accounts"],
    queryFn: () => apiFetch<FinanceAccount[]>("/api/finance/accounts"),
  });
  const inboxQ = useQuery({
    queryKey: ["gmail-inbox"],
    queryFn: () => apiFetch<GmailInboxItemRead[]>("/api/services/gmail-inbox"),
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
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const expenseAccounts = (accountsQ.data ?? []).filter((a) => a.account_type === "expense" || a.code.startsWith("7"));

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <header>
        <h1 className="text-2xl font-semibold">Бухгалтерия</h1>
        <p className="text-sm lux-caption">Ввод расходов по статьям номенклатуры</p>
      </header>

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
        <h2 className="mb-2 lux-subheading">Входящие (Gmail)</h2>
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
