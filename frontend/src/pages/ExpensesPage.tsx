import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import { EXPENSE_CATALOG } from "@/lib/expenseCatalog";
import { APP_CURRENCY } from "@/lib/money";
import { DateField } from "@/components/DateField";
import { MonthYearPicker } from "@/components/MonthYearPicker";

type StaffCard = {
  id: number;
  full_name: string | null;
  phone: string | null;
  role: string;
  base_salary: string | number | null;
  payout_bank: string | null;
};

type PayrollRow = {
  user_id: number;
  full_name: string;
  expert_title?: string;
  phone: string | null;
  payout_bank: string | null;
  base_salary: string | number | null;
  bonus: string | number;
  debt: string | number;
  debt_label: string;
  formula: string;
  adjustment: string | number;
  adjustment_reason: string;
  advances: string | number;
  remainder: string | number;
};

type PayrollReport = {
  year_month: string;
  pipeline_name: string | null;
  rows: PayrollRow[];
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
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2, signDisplay: "auto" });
}

function parseMoneyInput(raw: string): number {
  const t = raw.trim().replace(/\s/g, "").replace(",", ".").replace("−", "-");
  if (!t || t === "-" || t === ".") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function moneyInput(v: number | string | null | undefined): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : "";
}

function PayrollLine({
  row,
  year,
  month,
  onSaved,
  onRemove,
}: {
  row: PayrollRow;
  year: number;
  month: number;
  onSaved: () => void;
  onRemove: () => void;
}) {
  const [amount, setAmount] = useState(row.adjustment == null ? "" : String(row.adjustment));
  const [reason, setReason] = useState(row.adjustment_reason || "");
  const [debt, setDebt] = useState(() => (Number(row.debt || 0) ? String(row.debt) : ""));
  const [salary, setSalary] = useState(moneyInput(row.base_salary));
  const [bonus, setBonus] = useState(moneyInput(row.bonus));
  const [advances, setAdvances] = useState(moneyInput(row.advances));
  const [phone, setPhone] = useState(row.phone || "");
  const [bank, setBank] = useState(row.payout_bank || "");
  const [fullName, setFullName] = useState(row.full_name);
  const parsedDebt = parseMoneyInput(debt);
  const parsedSalary = parseMoneyInput(salary);
  const parsedBonus = parseMoneyInput(bonus);
  const parsedAdvances = parseMoneyInput(advances);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        user_id: row.user_id,
        amount: Number(amount || 0),
        reason,
        company_debt: parsedDebt,
      };
      if (parsedSalary !== Number(row.base_salary || 0)) body.base_salary = parsedSalary;
      if (parsedBonus !== Number(row.bonus || 0)) body.bonus = parsedBonus;
      if (parsedAdvances !== Number(row.advances || 0)) body.advances = parsedAdvances;
      return apiFetch(`/api/finance/payroll/adjustment?year=${year}&month=${month}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => onSaved(),
    onError: (e: Error) => toast.error(e.message),
  });
  const saveContact = useMutation({
    mutationFn: (body: { phone?: string; payout_bank?: string }) =>
      apiFetch(`/api/employees/${row.user_id}/profile`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => onSaved(),
    onError: (e: Error) => toast.error(e.message),
  });
  const saveName = useMutation({
    mutationFn: () =>
      apiFetch(`/api/employees/${row.user_id}/profile`, {
        method: "POST",
        body: JSON.stringify({ full_name: fullName.trim() }),
      }),
    onSuccess: () => onSaved(),
    onError: (e: Error) => toast.error(e.message),
  });
  const unchanged =
    Number(amount || 0) === Number(row.adjustment || 0) &&
    reason.trim() === (row.adjustment_reason || "").trim();
  return (
    <tr>
      <td className="payroll-person">
        <input
          className="mo-input payroll-name"
          value={fullName}
          aria-label={`ФИО ${row.full_name}`}
          onChange={(e) => setFullName(e.target.value)}
          onBlur={() => {
            const next = fullName.trim();
            if (next.length >= 2 && next !== row.full_name.trim()) saveName.mutate();
          }}
        />
        {row.expert_title ? <div className="payroll-role">{row.expert_title}</div> : null}
        {row.formula ? <div className="payroll-formula">{row.formula}</div> : null}
        <button type="button" className="payroll-remove" onClick={onRemove}>
          Убрать
        </button>
      </td>
      <td className="payroll-phone">
        <input
          className="mo-input payroll-adjust tabular-nums"
          value={phone}
          inputMode="tel"
          aria-label={`Телефон ${row.full_name}`}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => {
            const next = phone.replace(/\D/g, "");
            const prev = (row.phone || "").replace(/\D/g, "");
            if (next === prev) return;
            if (next.length < 7) {
              toast.error("Телефон короче 7 цифр");
              return;
            }
            saveContact.mutate({ phone: next });
          }}
        />
      </td>
      <td>
        <input
          className="mo-input payroll-adjust"
          value={bank}
          aria-label={`Выплата ${row.full_name}`}
          onChange={(e) => setBank(e.target.value)}
          onBlur={() => {
            const next = bank.trim();
            if (next !== (row.payout_bank || "").trim()) saveContact.mutate({ payout_bank: next });
          }}
        />
      </td>
      <td className="payroll-num">
        <input
          className="mo-input payroll-adjust tabular-nums"
          inputMode="decimal"
          value={salary}
          aria-label={`Оклад ${row.full_name}`}
          onChange={(e) => setSalary(e.target.value)}
          onBlur={() => {
            if (parsedSalary !== Number(row.base_salary || 0)) save.mutate();
          }}
        />
      </td>
      <td className="payroll-num">
        <input
          className="mo-input payroll-adjust tabular-nums"
          inputMode="decimal"
          value={bonus}
          aria-label={`Начисление ${row.full_name}`}
          onChange={(e) => setBonus(e.target.value)}
          onBlur={() => {
            if (parsedBonus !== Number(row.bonus || 0)) save.mutate();
          }}
        />
      </td>
      <td className={parsedDebt < 0 ? "payroll-num payroll-debt-minus" : "payroll-num"} title={row.debt_label || undefined}>
        <input
          className="mo-input payroll-adjust tabular-nums"
          inputMode="decimal"
          value={debt}
          placeholder="0"
          aria-label={`долг- и долг+ ${row.full_name}`}
          onChange={(e) => setDebt(e.target.value)}
          onBlur={() => {
            if (parsedDebt !== Number(row.debt || 0)) save.mutate();
          }}
        />
      </td>
      <td>
        <input
          className="mo-input payroll-adjust tabular-nums"
          inputMode="decimal"
          value={amount}
          aria-label={`Корректировка ${row.full_name}`}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => {
            if (!unchanged) save.mutate();
          }}
        />
      </td>
      <td>
        <input
          className="mo-input payroll-reason"
          value={reason}
          aria-label={`Причина корректировки ${row.full_name}`}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => {
            if (!unchanged) save.mutate();
          }}
        />
      </td>
      <td className="payroll-num">
        <input
          className="mo-input payroll-adjust tabular-nums"
          inputMode="decimal"
          value={advances}
          aria-label={`Авансы ${row.full_name}`}
          onChange={(e) => setAdvances(e.target.value)}
          onBlur={() => {
            if (parsedAdvances !== Number(row.advances || 0)) save.mutate();
          }}
        />
      </td>
      <td className="payroll-num payroll-pay">
        {money(parsedSalary + parsedBonus + Number(amount || 0) + parsedDebt - parsedAdvances)}
      </td>
    </tr>
  );
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
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"journal" | "payroll">("journal");
  const [employeeId, setEmployeeId] = useState("");
  const [payrollAddOpen, setPayrollAddOpen] = useState(false);
  const [payrollName, setPayrollName] = useState("");
  const [payrollRole, setPayrollRole] = useState("manager");
  const [payrollSpec, setPayrollSpec] = useState("Невролог");
  const [payrollPhone, setPayrollPhone] = useState("");
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));

  const listQuery = useQuery({
    queryKey: ["finance-expenses", year, month],
    queryFn: () =>
      apiFetch<ExpenseRow[]>(`/api/finance/expenses?year=${year}&month=${month}&limit=1000`, {
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
  const fot = article.trim().toUpperCase() === "ФОТ";
  const staffQuery = useQuery({
    queryKey: ["finance-staff"],
    queryFn: () => apiFetch<StaffCard[]>("/api/finance/staff"),
  });
  const payrollQuery = useQuery({
    queryKey: ["finance-payroll", year, month],
    queryFn: () => apiFetch<PayrollReport>(`/api/finance/payroll?year=${year}&month=${month}`),
    enabled: view === "payroll",
  });
  const addPayrollMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/employees/for-payroll", {
        method: "POST",
        body: JSON.stringify({
          full_name: payrollName.trim(),
          role: payrollRole,
          specialization: payrollRole === "expert" ? payrollSpec.trim() : null,
          phone: payrollPhone.trim() || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Сотрудник добавлен в ведомость");
      setPayrollAddOpen(false);
      setPayrollName("");
      setPayrollPhone("");
      void qc.invalidateQueries({ queryKey: ["finance-payroll"] });
      void qc.invalidateQueries({ queryKey: ["finance-staff"] });
      void qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const removePayrollMutation = useMutation({
    mutationFn: (userId: number) =>
      apiFetch(`/api/finance/payroll/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Убран с ведомости");
      void qc.invalidateQueries({ queryKey: ["finance-payroll"] });
      void qc.invalidateQueries({ queryKey: ["finance-payroll-hidden"] });
      void qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const hiddenPayrollQuery = useQuery({
    queryKey: ["finance-payroll-hidden"],
    queryFn: () => apiFetch<{ user_id: number; full_name: string }[]>("/api/finance/payroll/hidden"),
    enabled: view === "payroll" && payrollAddOpen,
  });
  const restorePayrollMutation = useMutation({
    mutationFn: (userId: number) =>
      apiFetch(`/api/finance/payroll/members/${userId}/restore`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Сотрудник снова в ведомости");
      setPayrollAddOpen(false);
      void qc.invalidateQueries({ queryKey: ["finance-payroll"] });
      void qc.invalidateQueries({ queryKey: ["finance-payroll-hidden"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [phone, setPhone] = useState("");
  const [viaPerson, setViaPerson] = useState("");

  const catalog = EXPENSE_CATALOG;
  const rows = listQuery.data ?? [];
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase().replace(/ё/g, "е");
    if (!term) return rows;
    const digits = term.replace(/\D/g, "");
    return rows.filter((r) => {
      const blob = [
        formatDateShort(r.txn_date),
        r.txn_date,
        String(r.expense ?? ""),
        money(r.expense),
        r.bank,
        r.basis,
        r.counterparty,
        r.phone,
        r.via_person,
        r.product_service,
        r.article,
        r.detail_category,
        r.brief_category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .replace(/ё/g, "е");
      if (blob.includes(term)) return true;
      if (digits.length >= 3) {
        const phone = (r.phone || "").replace(/\D/g, "");
        if (phone.includes(digits)) return true;
      }
      return false;
    });
  }, [rows, search]);
  const total = useMemo(() => filtered.reduce((s, r) => s + Number(r.expense || 0), 0), [filtered]);

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
          employee_user_id: fot && employeeId ? Number(employeeId) : null,
          phone: phone || null,
          via_person: viaPerson || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Расход сохранён");
      setExpense("");
      setBasis("");
      setCounterparty("");
      setEmployeeId("");
      setPhone("");
      void qc.invalidateQueries({ queryKey: ["finance-expenses"] });
      void qc.invalidateQueries({ queryKey: ["finance-payroll"] });
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
    if (fot && !employeeId) {
      toast.error("Для статьи ФОТ выберите сотрудника");
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
        {!known ? (
          <input
            className="mo-input expenses-field__control expenses-field__custom"
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
          <h1 className="mo-page-title">Расходы</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              className={["debtor-chip", view === "journal" ? "is-on" : ""].filter(Boolean).join(" ")}
              onClick={() => setView("journal")}
            >
              Журнал
            </button>
            <button
              type="button"
              className={["debtor-chip", view === "payroll" ? "is-on" : ""].filter(Boolean).join(" ")}
              onClick={() => setView("payroll")}
            >
              Ведомость
            </button>
          </div>
          <p className="mo-page-sub hidden sm:block">
            Банк, статья, товар. «Кому» — получатель (ЗП), «Через кого» — кто передал; это разные роли.
          </p>
        </div>
        <MonthYearPicker className="expenses-month-picker" value={yearMonth} onChange={setYearMonth} />
      </div>

      <div className="mo-fill-page-scroll expenses-page__body">
        <form onSubmit={onSubmit} className="expenses-form">
          <div className="expenses-form__grid">
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
                required
              />
            </label>
            {selectOrCustom(bank, [...catalog.banks], setBank, "Банк")}
            {selectOrCustom(article, [...catalog.articles], setArticle, "Статья")}
            {selectOrCustom(brief, [...catalog.brief_categories], setBrief, "Кратко")}
            {selectOrCustom(detail, [...catalog.detail_categories], setDetail, "Подробно")}
            {selectOrCustom(product, [...catalog.products], setProduct, "Товар / услуга")}
            <div className="expenses-payees">
            <label className="expenses-field">
              <span className="expenses-field__label">Основание</span>
              <input
                className="mo-input expenses-field__control"
                value={basis}
                onChange={(e) => setBasis(e.target.value)}
              />
            </label>
            <label className="expenses-field">
              <span className="expenses-field__label">Кому (получатель)</span>
              {fot ? (
                <select
                  className="mo-input expenses-field__control"
                  value={employeeId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setEmployeeId(id);
                    const person = (staffQuery.data ?? []).find((s) => String(s.id) === id);
                    if (!person) {
                      setCounterparty("");
                      return;
                    }
                    setCounterparty(person.full_name || "");
                    if (person.phone) setPhone(person.phone);
                    if (person.payout_bank) setBank(person.payout_bank);
                  }}
                >
                  <option value="">Выберите сотрудника</option>
                  {(staffQuery.data ?? []).map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.full_name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="mo-input expenses-field__control"
                  value={counterparty}
                  onChange={(e) => setCounterparty(e.target.value)}
                  placeholder="Например: Шакармамадова Мадина"
                />
              )}
              <span className="expenses-field__hint">
                {fot
                  ? "Телефон и банк подставляются из карточки, если они там есть"
                  : "Кому ушли деньги (ЗП, оплата услуги)"}
              </span>
            </label>
            <label className="expenses-field">
              <span className="expenses-field__label">Телефон</span>
              <input
                type="tel"
                inputMode="tel"
                className="mo-input expenses-field__control"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className="expenses-field">
              <span className="expenses-field__label">Через кого (передал)</span>
              <input
                className="mo-input expenses-field__control"
                value={viaPerson}
                onChange={(e) => setViaPerson(e.target.value)}
                placeholder="Например: Искандаров"
              />
              <span className="expenses-field__hint">Кто передал. Даже если это тот же человек — пишите отдельно</span>
            </label>
            </div>
          </div>
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

        {view === "payroll" ? (
          <section className="expenses-month">
            <div className="expenses-month__head">
              <h2 className="expenses-month__title">Ведомость</h2>
              <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setPayrollAddOpen(true)}>
                Добавить
              </button>
              <span className="expenses-month__total tabular-nums">
                {payrollQuery.data?.pipeline_name
                  ? `Бонус из KPI · ${payrollQuery.data.pipeline_name}`
                  : "Бонус из KPI"}
              </span>
            </div>
            <p className="payroll-note">
              Графы строки правятся вручную. «К выплате» — сумма оклада, начисления, долга и корректировки минус авансы. Долг: минус — сотрудник должен компании, без минуса — компания должна сотруднику. Пока аванс не вписан, он берётся из расходов за этот месяц (ФОТ или зарплата).
            </p>
            {payrollQuery.isLoading ? <p className="text-sm mo-muted">Загрузка…</p> : null}
            {payrollQuery.isError ? (
              <p className="text-sm text-red-300">{(payrollQuery.error as Error).message}</p>
            ) : null}
            {!payrollQuery.isLoading && (payrollQuery.data?.rows.length ?? 0) === 0 ? (
              <p className="text-sm mo-muted">За этот месяц нечего показать: нет оклада, бонуса и авансов.</p>
            ) : null}
            {(payrollQuery.data?.rows.length ?? 0) > 0 ? (
              <div className="payroll-sheet-wrap">
                <table className="kpi-data-table payroll-sheet text-sm">
                  <colgroup>
                    <col className="payroll-col-person" />
                    <col className="payroll-col-phone" />
                    <col className="payroll-col-bank" />
                    <col className="payroll-col-num" />
                    <col className="payroll-col-num" />
                    <col className="payroll-col-debt" />
                    <col className="payroll-col-adjust" />
                    <col className="payroll-col-reason" />
                    <col className="payroll-col-num" />
                    <col className="payroll-col-num" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Сотрудник</th>
                      <th>Телефон</th>
                      <th>Выплата</th>
                      <th className="payroll-num">Оклад</th>
                      <th className="payroll-num">Начисление</th>
                      <th className="payroll-num payroll-debt" title="долг− — сотрудник должен компании. долг+ — компания должна сотруднику.">
                        долг−
                        <br />
                        долг+
                      </th>
                      <th>Корректировка</th>
                      <th>Причина</th>
                      <th className="payroll-num">Авансы</th>
                      <th className="payroll-num">К выплате</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(payrollQuery.data?.rows ?? []).map((row) => (
                      <PayrollLine
                        key={`${row.user_id}-${year}-${month}`}
                        row={row}
                        year={year}
                        month={month}
                        onSaved={() => void payrollQuery.refetch()}
                        onRemove={() => {
                          if (!window.confirm(`Убрать ${row.full_name} с ведомости?`)) return;
                          removePayrollMutation.mutate(row.user_id);
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {payrollAddOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                <div className="w-full max-w-md rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-5 shadow-2xl">
                  <h3 className="text-base font-semibold">Добавить в ведомость</h3>
                  <p className="mt-1 text-sm mo-muted">
                    Человек появится в расчёте зарплаты. Логин для входа не создаётся.
                  </p>
                  {(hiddenPayrollQuery.data?.length ?? 0) > 0 ? (
                    <div className="mt-3">
                      <div className="text-sm mo-muted">Вернуть на ведомость</div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {(hiddenPayrollQuery.data ?? []).map((person) => (
                          <button
                            key={person.user_id}
                            type="button"
                            className="btn-secondary px-3 py-1.5 text-sm"
                            onClick={() => restorePayrollMutation.mutate(person.user_id)}
                          >
                            {person.full_name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-3">
                    <label className="text-sm mo-muted">
                      ФИО
                      <input className="mo-input mt-1" value={payrollName} onChange={(e) => setPayrollName(e.target.value)} />
                    </label>
                    <label className="text-sm mo-muted">
                      Роль
                      <select className="mo-input mt-1" value={payrollRole} onChange={(e) => setPayrollRole(e.target.value)}>
                        <option value="manager">Менеджер</option>
                        <option value="curator">Куратор</option>
                        <option value="administrator">Администратор</option>
                        <option value="expert">Эксперт</option>
                        <option value="accountant">Бухгалтер</option>
                        <option value="rop">РОП</option>
                        <option value="admin">Админ воронки</option>
                      </select>
                    </label>
                    {payrollRole === "expert" ? (
                      <label className="text-sm mo-muted">
                        Специальность
                        <input
                          className="mo-input mt-1"
                          value={payrollSpec}
                          onChange={(e) => setPayrollSpec(e.target.value)}
                          list="payroll-sheet-specs"
                        />
                        <datalist id="payroll-sheet-specs">
                          <option value="Невролог" />
                          <option value="Эндокринолог" />
                          <option value="Невролог курса 15" />
                          <option value="Массажист" />
                          <option value="Логомассажист" />
                          <option value="Остеопат" />
                          <option value="Нутрициолог" />
                        </datalist>
                      </label>
                    ) : null}
                    <label className="text-sm mo-muted">
                      Телефон, если есть
                      <input className="mo-input mt-1" value={payrollPhone} onChange={(e) => setPayrollPhone(e.target.value)} />
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-primary flex-1 disabled:opacity-60"
                        disabled={
                          addPayrollMutation.isPending ||
                          payrollName.trim().length < 2 ||
                          (payrollRole === "expert" && payrollSpec.trim().length < 2)
                        }
                        onClick={() => addPayrollMutation.mutate()}
                      >
                        {addPayrollMutation.isPending ? "Добавление…" : "Добавить"}
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => setPayrollAddOpen(false)}>
                        Закрыть
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {view === "journal" ? (
        <section className="expenses-month">
          <div className="expenses-month__head">
            <h2 className="expenses-month__title">За месяц</h2>
            <input
              className="mo-input expenses-month__search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск: кому, телефон, сумма, статья"
              aria-label="Поиск расхода"
            />
            <span className="expenses-month__total tabular-nums">
              {listQuery.isLoading
                ? "Итого: …"
                : search.trim()
                  ? `Найдено ${filtered.length} · ${money(total)} ${APP_CURRENCY}`
                  : `Итого: ${money(total)} ${APP_CURRENCY}`}
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
          ) : filtered.length === 0 ? (
            <p className="expenses-month__empty">Ничего не найдено.</p>
          ) : (
            <>
              <ul className="expenses-month__cards md:hidden">
                {filtered.map((r) => (
                  <li key={r.id} className="expenses-month__card">
                    <div className="expenses-month__card-top">
                      <div className="min-w-0">
                        <div className="expenses-month__card-title">
                          {r.article || r.detail_category || "Расход"}
                        </div>
                        <div className="expenses-month__card-meta">
                          <span>{formatDateShort(r.txn_date)}</span>
                          {r.bank ? <span>{r.bank}</span> : null}
                          {r.brief_category ? <span>{r.brief_category}</span> : null}
                        </div>
                      </div>
                      <div className="expenses-month__card-sum tabular-nums">{money(r.expense)}</div>
                    </div>
                    <div className="expenses-month__card-grid">
                      {r.basis ? (
                        <div>
                          <span className="expenses-month__card-k">Основание</span>
                          <span>{r.basis}</span>
                        </div>
                      ) : null}
                      {r.counterparty ? (
                        <div>
                          <span className="expenses-month__card-k">Контрагент</span>
                          <span>{r.counterparty}</span>
                        </div>
                      ) : null}
                      {r.phone ? (
                        <div>
                          <span className="expenses-month__card-k">Телефон</span>
                          <span>{r.phone}</span>
                        </div>
                      ) : null}
                      {r.via_person ? (
                        <div>
                          <span className="expenses-month__card-k">Через</span>
                          <span>{r.via_person}</span>
                        </div>
                      ) : null}
                      {r.product_service ? (
                        <div>
                          <span className="expenses-month__card-k">Товар/услуга</span>
                          <span>{r.product_service}</span>
                        </div>
                      ) : null}
                      {r.detail_category ? (
                        <div>
                          <span className="expenses-month__card-k">Подробно</span>
                          <span>{r.detail_category}</span>
                        </div>
                      ) : null}
                    </div>
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
                      <th>Основание</th>
                      <th>Контрагенты</th>
                      <th>Телефон</th>
                      <th>Через</th>
                      <th>Товар/услуга</th>
                      <th>Статья</th>
                      <th>Подробно</th>
                      <th>Кратко</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id}>
                        <td className="tabular-nums whitespace-nowrap">{formatDateShort(r.txn_date)}</td>
                        <td className="tabular-nums whitespace-nowrap font-semibold">{money(r.expense)}</td>
                        <td>{r.bank || "—"}</td>
                        <td>{r.basis || "—"}</td>
                        <td>{r.counterparty || "—"}</td>
                        <td className="tabular-nums whitespace-nowrap">{r.phone || "—"}</td>
                        <td>{r.via_person || "—"}</td>
                        <td>{r.product_service || "—"}</td>
                        <td>{r.article || "—"}</td>
                        <td>{r.detail_category || "—"}</td>
                        <td>{r.brief_category || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
        ) : null}
      </div>
    </div>
  );
}
