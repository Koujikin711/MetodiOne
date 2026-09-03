import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import { APP_CURRENCY } from "@/lib/money";
import { DateField } from "@/components/DateField";
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
    queryFn: () =>
      apiFetch<ExpenseCatalog>("/api/finance/expense-catalog", { timeoutMs: 45_000 }),
    staleTime: 60_000,
  });

  const listQuery = useQuery({
    queryKey: ["finance-expenses", year, month],
    queryFn: () =>
      apiFetch<ExpenseRow[]>(`/api/finance/expenses?year=${year}&month=${month}&limit=300`, {
        timeoutMs: 45_000,
      }),
    retry: 1,
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
        timeoutMs: 60_000,
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
      <label className="expenses-field">
        <span className="expenses-field__label">{label}</span>
        <select
          className="mo-input mt-1 w-full min-w-0"
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
            className="mo-input mt-1.5 w-full min-w-0"
            value={value}
            onChange={(ev) => onChange(ev.target.value)}
            placeholder="Своё значение"
          />
        ) : null}
      </label>
    );
  }

  return (
    <div className="expenses-page mo-fill-page relative w-full min-w-0">
      <div className="mo-admin-page-head expenses-page__head">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--mo-text)] sm:text-2xl">Расходы</h1>
          <p className="mt-1 text-xs mo-muted sm:text-sm">
            Ввод расходов по статьям ОСВ клиники (банк, статья, подробно, товар/услуга).
          </p>
        </div>
        <MonthYearPicker value={yearMonth} onChange={setYearMonth} />
      </div>

      <div className="mo-fill-page-scroll space-y-4 pt-3 sm:space-y-5 sm:pt-4">
        <form onSubmit={onSubmit} className="expenses-form">
          <div className="expenses-form__grid">
            <label className="expenses-field">
              <span className="expenses-field__label">Дата</span>
              <DateField
                className="mt-1"
                value={txnDate}
                onChange={setTxnDate}
                required
                aria-label="Дата расхода"
              />
            </label>
            <label className="expenses-field">
              <span className="expenses-field__label">Сумма ({APP_CURRENCY})</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="mo-input mt-1 w-full min-w-0 tabular-nums"
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
            <label className="expenses-field expenses-field--span">
              <span className="expenses-field__label">Основание</span>
              <input
                className="mo-input mt-1 w-full min-w-0"
                value={basis}
                onChange={(e) => setBasis(e.target.value)}
              />
            </label>
            <label className="expenses-field">
              <span className="expenses-field__label">Контрагент</span>
              <input
                className="mo-input mt-1 w-full min-w-0"
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
              />
            </label>
            <label className="expenses-field">
              <span className="expenses-field__label">Телефон</span>
              <input
                type="tel"
                inputMode="tel"
                className="mo-input mt-1 w-full min-w-0"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className="expenses-field">
              <span className="expenses-field__label">Через кого</span>
              <input
                className="mo-input mt-1 w-full min-w-0"
                value={viaPerson}
                onChange={(e) => setViaPerson(e.target.value)}
              />
            </label>
          </div>
          <div className="expenses-form__actions">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="mo-btn-primary w-full rounded-xl px-4 py-2.5 text-sm font-medium sm:w-auto sm:py-2"
            >
              {createMutation.isPending ? "Сохранение…" : "Добавить расход"}
            </button>
          </div>
        </form>

        <section className="expenses-month overflow-hidden rounded-2xl border border-[var(--mo-border)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--mo-border)] px-3 py-3 sm:px-4">
            <h2 className="text-sm font-semibold text-[var(--mo-text)]">За месяц</h2>
            <span className="tabular-nums text-sm font-medium text-[var(--mo-text)]">
              Итого: {money(total)}
            </span>
          </div>
          {listQuery.isLoading ? (
            <p className="px-3 py-6 text-sm mo-muted sm:px-4">Загрузка…</p>
          ) : listQuery.isError ? (
            <div className="space-y-2 px-3 py-6 sm:px-4">
              <p className="text-sm text-[var(--mo-danger,#ef4444)]">
                {(listQuery.error as Error)?.message || "Не удалось загрузить расходы"}
              </p>
              <button
                type="button"
                className="mo-btn-primary rounded-xl px-3 py-1.5 text-sm"
                onClick={() => void listQuery.refetch()}
              >
                Повторить
              </button>
            </div>
          ) : rows.length === 0 ? (
            <p className="px-3 py-6 text-sm mo-muted sm:px-4">Пока нет расходов за этот месяц.</p>
          ) : (
            <>
              <ul className="expenses-month__cards space-y-2 p-3 md:hidden">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)]/50 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--mo-text)]">
                          {r.article || r.detail_category || "Расход"}
                        </div>
                        <div className="mt-0.5 text-xs mo-muted">
                          {r.txn_date}
                          {r.bank ? ` · ${r.bank}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 tabular-nums text-sm font-semibold text-[var(--mo-text)]">
                        {money(r.expense)}
                      </div>
                    </div>
                    {(r.product_service || r.counterparty || r.detail_category) && (
                      <div className="mt-1.5 space-y-0.5 text-xs mo-muted">
                        {r.detail_category ? <div>Подробно: {r.detail_category}</div> : null}
                        {r.product_service ? <div>Товар: {r.product_service}</div> : null}
                        {r.counterparty ? <div>Контрагент: {r.counterparty}</div> : null}
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto md:block">
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
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.txn_date}</td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap">{money(r.expense)}</td>
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
            </>
          )}
        </section>
      </div>
    </div>
  );
}
