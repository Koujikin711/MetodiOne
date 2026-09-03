import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import { MonthYearPicker } from "@/components/MonthYearPicker";

type ExpenseCatalog = {
  banks: string[];
  articles: string[];
  brief_categories: string[];
  detail_categories: string[];
  products: string[];
};

type ExpenseRow = {
  id: number;
  txn_date: string;
  expense: number | string;
  bank: string | null;
  basis: string | null;
  counterparty: string | null;
  phone: string | null;
  via_person: string | null;
  product_service: string | null;
  article: string | null;
  detail_category: string | null;
  brief_category: string | null;
  source: string;
};

function defaultYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function money(v: number | string | null | undefined) {
  const n = Number(v || 0);
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

export function ExpensesPage() {
  const qc = useQueryClient();
  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));

  const catalogQuery = useQuery({
    queryKey: ["finance-expense-catalog"],
    queryFn: () => apiFetch<ExpenseCatalog>("/api/finance/expense-catalog"),
  });

  const listQuery = useQuery({
    queryKey: ["finance-expenses", year, month],
    queryFn: () =>
      apiFetch<ExpenseRow[]>(`/api/finance/expenses?year=${year}&month=${month}&limit=300`),
  });

  const [txnDate, setTxnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expense, setExpense] = useState("");
  const [bank, setBank] = useState("ДС");
  const [article, setArticle] = useState("ФОТ");
  const [brief, setBrief] = useState("Расход");
  const [detail, setDetail] = useState("");
  const [product, setProduct] = useState("");
  const [basis, setBasis] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [phone, setPhone] = useState("");
  const [viaPerson, setViaPerson] = useState("");

  const catalog = catalogQuery.data;
  const rows = listQuery.data ?? [];
  const total = useMemo(() => rows.reduce((s, r) => s + Number(r.expense || 0), 0), [rows]);

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<ExpenseRow>("/api/finance/expenses", {
        method: "POST",
        body: JSON.stringify({
          txn_date: txnDate,
          expense: Number(expense),
          bank: bank || null,
          article: article || null,
          brief_category: brief || "Расход",
          detail_category: detail || null,
          product_service: product || null,
          basis: basis || null,
          counterparty: counterparty || null,
          phone: phone || null,
          via_person: viaPerson || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Расход сохранён");
      setExpense("");
      setBasis("");
      setCounterparty("");
      setPhone("");
      void qc.invalidateQueries({ queryKey: ["finance-expenses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const amount = Number(expense);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Укажите сумму расхода");
      return;
    }
    createMutation.mutate();
  }

  function selectOrCustom(
    value: string,
    options: string[],
    onChange: (v: string) => void,
    label: string,
  ) {
    const known = options.includes(value);
    return (
      <label className="text-sm mo-muted">
        {label}
        <select
          className="mo-input mt-1 w-full"
          value={known ? value : "__custom__"}
          onChange={(ev) => {
            if (ev.target.value === "__custom__") onChange("");
            else onChange(ev.target.value);
          }}
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value="__custom__">Другое…</option>
        </select>
        {!known ? (
          <input
            className="mo-input mt-1 w-full"
            value={value}
            onChange={(ev) => onChange(ev.target.value)}
            placeholder="Своё значение"
          />
        ) : null}
      </label>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--mo-text)]">Расходы</h1>
          <p className="mt-1 text-sm mo-muted">
            Ввод расходов по статьям ОСВ клиники (банк, статья, подробно, товар/услуга).
          </p>
        </div>
        <MonthYearPicker value={yearMonth} onChange={setYearMonth} />
      </header>

      <form
        onSubmit={onSubmit}
        className="grid gap-3 rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)]/60 p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <label className="text-sm mo-muted">
          Дата
          <input
            type="date"
            className="mo-input mt-1 w-full"
            value={txnDate}
            onChange={(e) => setTxnDate(e.target.value)}
            required
          />
        </label>
        <label className="text-sm mo-muted">
          Сумма (SOM)
          <input
            type="number"
            min={0}
            step="0.01"
            className="mo-input mt-1 w-full tabular-nums"
            value={expense}
            onChange={(e) => setExpense(e.target.value)}
            required
          />
        </label>
        {selectOrCustom(bank, catalog?.banks ?? [], setBank, "Банк")}
        {selectOrCustom(article, catalog?.articles ?? [], setArticle, "Статья")}
        {selectOrCustom(brief, catalog?.brief_categories ?? [], setBrief, "Кратко")}
        {selectOrCustom(detail, catalog?.detail_categories ?? [], setDetail, "Подробно")}
        {selectOrCustom(product, catalog?.products ?? [], setProduct, "Товар / услуга")}
        <label className="text-sm mo-muted sm:col-span-2 lg:col-span-3">
          Основание
          <input className="mo-input mt-1 w-full" value={basis} onChange={(e) => setBasis(e.target.value)} />
        </label>
        <label className="text-sm mo-muted">
          Контрагент
          <input
            className="mo-input mt-1 w-full"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
          />
        </label>
        <label className="text-sm mo-muted">
          Телефон
          <input className="mo-input mt-1 w-full" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="text-sm mo-muted">
          Через кого
          <input
            className="mo-input mt-1 w-full"
            value={viaPerson}
            onChange={(e) => setViaPerson(e.target.value)}
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-3">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="mo-btn-primary rounded-xl px-4 py-2 text-sm font-medium"
          >
            {createMutation.isPending ? "Сохранение…" : "Добавить расход"}
          </button>
        </div>
      </form>

      <section className="overflow-hidden rounded-2xl border border-[var(--mo-border)]">
        <div className="flex items-center justify-between border-b border-[var(--mo-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--mo-text)]">За месяц</h2>
          <span className="tabular-nums text-sm mo-muted">Итого: {money(total)}</span>
        </div>
        {listQuery.isLoading ? (
          <p className="px-4 py-6 text-sm mo-muted">Загрузка…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-sm mo-muted">Пока нет расходов за этот месяц.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--mo-surface)]/80 text-xs mo-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Дата</th>
                  <th className="px-3 py-2 font-medium">Сумма</th>
                  <th className="px-3 py-2 font-medium">Банк</th>
                  <th className="px-3 py-2 font-medium">Статья</th>
                  <th className="px-3 py-2 font-medium">Подробно</th>
                  <th className="px-3 py-2 font-medium">Товар</th>
                  <th className="px-3 py-2 font-medium">Контрагент</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--mo-border)]/70">
                    <td className="px-3 py-2 tabular-nums">{r.txn_date}</td>
                    <td className="px-3 py-2 tabular-nums">{money(r.expense)}</td>
                    <td className="px-3 py-2">{r.bank || "—"}</td>
                    <td className="px-3 py-2">{r.article || "—"}</td>
                    <td className="px-3 py-2">{r.detail_category || "—"}</td>
                    <td className="px-3 py-2">{r.product_service || "—"}</td>
                    <td className="px-3 py-2">{r.counterparty || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
