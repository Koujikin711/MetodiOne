import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import { EXPENSE_CATALOG } from "@/lib/expenseCatalog";
import { APP_CURRENCY } from "@/lib/money";
import { DateField } from "@/components/DateField";
import { MonthYearPicker } from "@/components/MonthYearPicker";

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

/** 07.09.26 */
function formatDateShort(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || "");
  if (!m) return isoDate || "—";
  return `${m[3]}.${m[2]}.${m[1]!.slice(-2)}`;
}

export function ExpensesPage() {
  const qc = useQueryClient();
  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));

  const listQuery = useQuery({
    queryKey: ["finance-expenses", year, month],
    queryFn: () =>
      apiFetch<ExpenseRow[]>(`/api/finance/expenses?year=${year}&month=${month}&limit=300`, {
        timeoutMs: 25_000,
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

  const catalog = EXPENSE_CATALOG;
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
    const isCustom = !known;
    return (
      <label className={["expenses-field", isCustom ? "expenses-field--span" : ""].join(" ")}>
        <span className="expenses-field__label">{label}</span>
        <select
          className="mo-input expenses-field__control"
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
        {isCustom ? (
          <input
            className="mo-input expenses-field__control expenses-field__custom"
            value={value}
            onChange={(ev) => onChange(ev.target.value)}
            placeholder="Своё значение"
            autoFocus
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
          <p className="mt-1 hidden text-xs mo-muted sm:block sm:text-sm">
            Быстрый ввод по статьям ОСВ: дата, сумма, банк и категория.
          </p>
        </div>
        <MonthYearPicker className="expenses-month-picker" value={yearMonth} onChange={setYearMonth} />
      </div>

      <div className="mo-fill-page-scroll expenses-page__scroll">
        <form onSubmit={onSubmit} className="expenses-form">
          <section className="expenses-form__section">
            <h2 className="expenses-form__section-title">Основное</h2>
            <div className="expenses-form__grid expenses-form__grid--2">
              <label className="expenses-field">
                <span className="expenses-field__label">Дата</span>
                <DateField
                  className="expenses-field__control"
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
                  className="mo-input expenses-field__control tabular-nums"
                  value={expense}
                  onChange={(e) => setExpense(e.target.value)}
                  placeholder="0"
                  required
                />
              </label>
            </div>
          </section>

          <section className="expenses-form__section">
            <h2 className="expenses-form__section-title">Классификация</h2>
            <div className="expenses-form__grid">
              {selectOrCustom(bank, [...catalog.banks], setBank, "Банк")}
              {selectOrCustom(article, [...catalog.articles], setArticle, "Статья")}
              {selectOrCustom(brief, [...catalog.brief_categories], setBrief, "Кратко")}
              {selectOrCustom(detail, [...catalog.detail_categories], setDetail, "Подробно")}
              {selectOrCustom(product, [...catalog.products], setProduct, "Товар / услуга")}
            </div>
          </section>

          <section className="expenses-form__section">
            <h2 className="expenses-form__section-title">Детали</h2>
            <div className="expenses-form__grid">
              <label className="expenses-field expenses-field--span">
                <span className="expenses-field__label">Основание</span>
                <input
                  className="mo-input expenses-field__control"
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                  placeholder="Кратко, за что оплата"
                />
              </label>
              <label className="expenses-field">
                <span className="expenses-field__label">Контрагент</span>
                <input
                  className="mo-input expenses-field__control"
                  value={counterparty}
                  onChange={(e) => setCounterparty(e.target.value)}
                />
              </label>
              <label className="expenses-field">
                <span className="expenses-field__label">Телефон</span>
                <input
                  type="tel"
                  inputMode="tel"
                  className="mo-input expenses-field__control"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+992…"
                />
              </label>
              <label className="expenses-field expenses-field--span-sm">
                <span className="expenses-field__label">Через кого</span>
                <input
                  className="mo-input expenses-field__control"
                  value={viaPerson}
                  onChange={(e) => setViaPerson(e.target.value)}
                />
              </label>
            </div>
          </section>

          <div className="expenses-form__actions">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="btn-primary expenses-form__submit"
            >
              {createMutation.isPending ? "Сохранение…" : "Добавить расход"}
            </button>
          </div>
        </form>

        <section className="expenses-month">
          <div className="expenses-month__head">
            <h2 className="expenses-month__title">За месяц</h2>
            <span className="expenses-month__total tabular-nums">
              {listQuery.isLoading ? "Итого: …" : `Итого: ${money(total)} ${APP_CURRENCY}`}
            </span>
          </div>
          {listQuery.isLoading ? (
            <p className="expenses-month__empty">Загрузка списка…</p>
          ) : listQuery.isError ? (
            <div className="expenses-month__empty space-y-2">
              <p className="text-sm text-[var(--mo-danger,#ef4444)]">
                {(listQuery.error as Error)?.message || "Не удалось загрузить расходы"}
              </p>
              <button
                type="button"
                className="btn-primary btn-table"
                onClick={() => void listQuery.refetch()}
              >
                Повторить
              </button>
            </div>
          ) : rows.length === 0 ? (
            <p className="expenses-month__empty">Пока нет расходов за этот месяц.</p>
          ) : (
            <>
              <ul className="expenses-month__cards md:hidden">
                {rows.map((r) => (
                  <li key={r.id} className="expenses-month__card">
                    <div className="expenses-month__card-top">
                      <div className="min-w-0">
                        <div className="expenses-month__card-title">
                          {r.article || r.detail_category || "Расход"}
                        </div>
                        <div className="expenses-month__card-meta">
                          <span>{formatDateShort(r.txn_date)}</span>
                          {r.bank ? <span>{r.bank}</span> : null}
                        </div>
                      </div>
                      <div className="expenses-month__card-sum tabular-nums">{money(r.expense)}</div>
                    </div>
                    {(r.product_service || r.counterparty || r.detail_category) && (
                      <div className="expenses-month__card-extra">
                        {r.detail_category ? <span>{r.detail_category}</span> : null}
                        {r.product_service ? <span>{r.product_service}</span> : null}
                        {r.counterparty ? <span>{r.counterparty}</span> : null}
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <div className="expenses-month__table-wrap hidden md:block">
                <table className="expenses-month__table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Сумма</th>
                      <th>Банк</th>
                      <th>Статья</th>
                      <th>Подробно</th>
                      <th>Товар</th>
                      <th>Контрагент</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="tabular-nums whitespace-nowrap">{formatDateShort(r.txn_date)}</td>
                        <td className="tabular-nums whitespace-nowrap font-semibold">{money(r.expense)}</td>
                        <td>{r.bank || "—"}</td>
                        <td>{r.article || "—"}</td>
                        <td>{r.detail_category || "—"}</td>
                        <td>{r.product_service || "—"}</td>
                        <td>{r.counterparty || "—"}</td>
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
