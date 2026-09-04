import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Link, Navigate } from "react-router-dom";

import { DateField } from "@/components/DateField";
import { MonthYearPicker } from "@/components/MonthYearPicker";
import { Settings } from "@/components/icons";
import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { formatMoney } from "@/lib/money";

type TabId = "new" | "settings" | "report" | "journal";

type ExtraServiceType = {
  id: number;
  name: string;
  keep_percent: number | string;
  payout_percent: number | string;
  is_active: boolean;
  sort_order: number;
};

type ExtraServiceSale = {
  id: number;
  service_type_id: number;
  service_name: string;
  client_name: string;
  client_phone: string;
  amount: number | string;
  keep_percent: number | string;
  payout_percent: number | string;
  keep_amount: number | string;
  payout_amount: number | string;
  sold_at: string;
  note: string | null;
  created_by_name: string | null;
};

type ExtraServiceReport = {
  count: number;
  amount_total: number | string;
  keep_total: number | string;
  payout_total: number | string;
  by_type: Array<{
    service_type_id: number;
    service_name: string;
    count: number;
    amount_total: number | string;
    keep_total: number | string;
    payout_total: number | string;
  }>;
  by_client: Array<{
    client_name: string;
    client_phone: string;
    count: number;
    amount_total: number | string;
    keep_total: number | string;
    payout_total: number | string;
  }>;
};

const TABS: { id: Exclude<TabId, "settings">; label: string }[] = [
  { id: "new", label: "Новая запись" },
  { id: "report", label: "Отчёты" },
  { id: "journal", label: "Журнал" },
];

function defaultYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(yearMonth: string): { date_from: string; date_to: string } {
  const [ys, ms] = yearMonth.split("-");
  const last = new Date(Number(ys), Number(ms), 0).getDate();
  return {
    date_from: `${ys}-${ms}-01`,
    date_to: `${ys}-${ms}-${String(last).padStart(2, "0")}`,
  };
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function n(v: number | string | null | undefined): number {
  return Number(v || 0);
}

function canAccessExtraServices(role: string | null): boolean {
  return role === "owner" || role === "admin" || role === "administrator";
}

const fieldClass = "mo-input mt-1.5 w-full min-w-0";

export function ExtraServicesPage() {
  const qc = useQueryClient();
  const role = decodeRoleFromToken(getStoredToken());
  const accessOk = canAccessExtraServices(role);
  const [tab, setTab] = useState<TabId>("new");
  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  const range = useMemo(() => monthRange(yearMonth), [yearMonth]);

  const typesQuery = useQuery({
    queryKey: ["extra-service-types"],
    queryFn: () => apiFetch<ExtraServiceType[]>("/api/extra-services/types"),
    enabled: accessOk,
  });
  const activeTypes = useMemo(
    () => (typesQuery.data ?? []).filter((t) => t.is_active),
    [typesQuery.data],
  );

  const [serviceTypeId, setServiceTypeId] = useState<number | "">("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [soldDate, setSoldDate] = useState(todayYmd);
  const [note, setNote] = useState("");

  const selectedType = activeTypes.find((t) => t.id === serviceTypeId) ?? null;
  const amountNum = Number(String(amount).replace(",", ".")) || 0;
  const previewKeep =
    selectedType && amountNum > 0
      ? Math.round(((amountNum * n(selectedType.keep_percent)) / 100) * 100) / 100
      : 0;
  const previewPayout =
    selectedType && amountNum > 0 ? Math.round((amountNum - previewKeep) * 100) / 100 : 0;

  const createSale = useMutation({
    mutationFn: () =>
      apiFetch<ExtraServiceSale>("/api/extra-services/sales", {
        method: "POST",
        body: JSON.stringify({
          service_type_id: serviceTypeId,
          client_name: clientName.trim(),
          client_phone: clientPhone.trim(),
          amount: amountNum,
          sold_at: soldDate ? `${soldDate}T12:00:00+00:00` : null,
          note: note.trim() || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Доп. услуга сохранена");
      setClientName("");
      setClientPhone("");
      setAmount("");
      setNote("");
      void qc.invalidateQueries({ queryKey: ["extra-service-sales"] });
      void qc.invalidateQueries({ queryKey: ["extra-service-report"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmitSale(e: FormEvent) {
    e.preventDefault();
    if (!serviceTypeId) {
      toast.error("Выберите услугу");
      return;
    }
    if (!clientName.trim()) {
      toast.error("Укажите ФИО");
      return;
    }
    if (!(amountNum > 0)) {
      toast.error("Укажите сумму");
      return;
    }
    createSale.mutate();
  }

  const [newName, setNewName] = useState("");
  const [newKeep, setNewKeep] = useState("50");
  const [newPayout, setNewPayout] = useState("50");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editKeep, setEditKeep] = useState("");
  const [editPayout, setEditPayout] = useState("");

  const createType = useMutation({
    mutationFn: () =>
      apiFetch<ExtraServiceType>("/api/extra-services/types", {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          keep_percent: Number(String(newKeep).replace(",", ".")),
          payout_percent: Number(String(newPayout).replace(",", ".")),
        }),
      }),
    onSuccess: () => {
      toast.success("Услуга добавлена");
      setNewName("");
      setNewKeep("50");
      setNewPayout("50");
      void qc.invalidateQueries({ queryKey: ["extra-service-types"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateType = useMutation({
    mutationFn: () =>
      apiFetch<ExtraServiceType>(`/api/extra-services/types/${editId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim(),
          keep_percent: Number(String(editKeep).replace(",", ".")),
          payout_percent: Number(String(editPayout).replace(",", ".")),
        }),
      }),
    onSuccess: () => {
      toast.success("Сохранено");
      setEditId(null);
      void qc.invalidateQueries({ queryKey: ["extra-service-types"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deactivateType = useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/api/extra-services/types/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Услуга отключена");
      void qc.invalidateQueries({ queryKey: ["extra-service-types"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [journalQ, setJournalQ] = useState("");
  const [journalDebounced, setJournalDebounced] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setJournalDebounced(journalQ.trim()), 300);
    return () => window.clearTimeout(t);
  }, [journalQ]);

  const salesQuery = useQuery({
    queryKey: ["extra-service-sales", range.date_from, range.date_to, journalDebounced],
    queryFn: () => {
      const qs = new URLSearchParams({
        date_from: range.date_from,
        date_to: range.date_to,
        limit: "500",
      });
      if (journalDebounced) qs.set("q", journalDebounced);
      return apiFetch<ExtraServiceSale[]>(`/api/extra-services/sales?${qs.toString()}`);
    },
    enabled: accessOk && (tab === "journal" || tab === "new"),
  });

  const cancelSale = useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/api/extra-services/sales/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Запись отменена");
      void qc.invalidateQueries({ queryKey: ["extra-service-sales"] });
      void qc.invalidateQueries({ queryKey: ["extra-service-report"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reportQuery = useQuery({
    queryKey: ["extra-service-report", range.date_from, range.date_to],
    queryFn: () => {
      const qs = new URLSearchParams({
        date_from: range.date_from,
        date_to: range.date_to,
      });
      return apiFetch<ExtraServiceReport>(`/api/extra-services/report?${qs.toString()}`);
    },
    enabled: accessOk && tab === "report",
  });

  if (!accessOk) {
    return <Navigate to="/booking" replace />;
  }

  return (
    <div className="extra-services-page mo-fill-page relative w-full min-w-0">
      <div className="mo-admin-page-head expenses-page__head">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--mo-text)] sm:text-2xl">
            Доп услуги
          </h1>
          <p className="mt-1 text-xs mo-muted sm:text-sm">
            Под онлайн-записью: ФИО, телефон, сумма — система считает, сколько нам и сколько отдаём.{" "}
            <Link to="/booking" className="text-[var(--mo-accent-hover)] hover:underline">
              ← К онлайн-записи
            </Link>
          </p>
        </div>
        <div className="extra-services-head-actions">
          <MonthYearPicker value={yearMonth} onChange={setYearMonth} />
          <button
            type="button"
            className={["extra-services-settings-btn", tab === "settings" ? "is-active" : ""].join(" ")}
            aria-label="Настройки %"
            title="Настройки %"
            aria-pressed={tab === "settings"}
            onClick={() => setTab((prev) => (prev === "settings" ? "new" : "settings"))}
          >
            <Settings className="h-[1.05rem] w-[1.05rem]" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mo-fill-page-scroll space-y-4 pt-3 sm:space-y-5 sm:pt-4">
      {tab !== "settings" ? (
        <div className="crm-view-switch flex flex-wrap gap-2" role="tablist" aria-label="Доп услуги">
          {TABS.map((t) => (
            <button key={t.id} type="button" data-active={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--mo-text)]">Настройки %</h2>
          <button
            type="button"
            className="text-xs text-[var(--mo-accent-hover)] underline"
            onClick={() => setTab("new")}
          >
            ← К записям
          </button>
        </div>
      )}

      {tab === "new" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <form
            onSubmit={onSubmitSale}
            className="space-y-3 rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-4"
          >
            <h2 className="text-sm font-semibold text-[var(--mo-text)]">Новая доп. услуга</h2>
            <label className="block text-sm text-[var(--mo-text)]">
              Услуга
              <select
                className={fieldClass}
                value={serviceTypeId}
                onChange={(e) => setServiceTypeId(e.target.value ? Number(e.target.value) : "")}
                required
              >
                <option value="">Выберите…</option>
                {activeTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {!activeTypes.length ? (
              <p className="text-xs mo-muted">
                Сначала добавьте услуги в настройках %{" "}
                <button
                  type="button"
                  className="text-[var(--mo-accent-hover)] underline"
                  onClick={() => setTab("settings")}
                >
                  открыть
                </button>
                .
              </p>
            ) : null}
            <label className="block text-sm text-[var(--mo-text)]">
              ФИО клиента
              <input
                className={fieldClass}
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Иванов Иван"
                required
              />
            </label>
            <label className="block text-sm text-[var(--mo-text)]">
              Телефон
              <input
                className={fieldClass}
                inputMode="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="+992…"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-[var(--mo-text)]">
                Сумма
                <input
                  className={fieldClass}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  required
                />
              </label>
              <label className="block text-sm text-[var(--mo-text)]">
                Дата
                <div className="mt-1.5">
                  <DateField value={soldDate} onChange={setSoldDate} />
                </div>
              </label>
            </div>
            <label className="block text-sm text-[var(--mo-text)]">
              Комментарий
              <input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {selectedType && amountNum > 0 ? (
              <div className="extra-services-split">
                <div>
                  <span className="extra-services-split__label">Нам</span>
                  <span className="extra-services-split__value kpi-actual-value">
                    {formatMoney(previewKeep)}
                  </span>
                  <span className="extra-services-split__pct">{n(selectedType.keep_percent)}%</span>
                </div>
                <div>
                  <span className="extra-services-split__label">Отдаём</span>
                  <span className="extra-services-split__value">{formatMoney(previewPayout)}</span>
                  <span className="extra-services-split__pct">{n(selectedType.payout_percent)}%</span>
                </div>
              </div>
            ) : null}
            <button type="submit" className="btn-primary" disabled={createSale.isPending}>
              {createSale.isPending ? "Сохранение…" : "Сохранить"}
            </button>
          </form>

          <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--mo-text)]">
              Недавние записи ({yearMonth})
            </h2>
            {salesQuery.isLoading ? <p className="text-sm mo-muted">Загрузка…</p> : null}
            {(salesQuery.data ?? []).slice(0, 12).map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--mo-border)] py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium text-[var(--mo-text)]">{s.client_name}</div>
                  <div className="text-xs mo-muted">
                    {s.service_name} · {formatDt(s.sold_at)}
                    {s.client_phone ? ` · ${s.client_phone}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div className="text-[var(--mo-text)]">{formatMoney(s.amount)}</div>
                  <div className="text-xs mo-muted">
                    <span className="kpi-actual-value">нам {formatMoney(s.keep_amount)}</span>
                    {" / "}
                    отдали {formatMoney(s.payout_amount)}
                  </div>
                </div>
              </div>
            ))}
            {!salesQuery.data?.length && !salesQuery.isLoading ? (
              <p className="text-sm mo-muted">Пока нет записей за этот месяц.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className="space-y-4">
          <form
            className="space-y-3 rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const k = Number(String(newKeep).replace(",", "."));
              const p = Number(String(newPayout).replace(",", "."));
              if (!newName.trim()) {
                toast.error("Укажите название");
                return;
              }
              if (Math.abs(k + p - 100) > 0.01) {
                toast.error("Сумма % должна быть 100");
                return;
              }
              createType.mutate();
            }}
          >
            <h2 className="text-sm font-semibold text-[var(--mo-text)]">Добавить услугу</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-sm text-[var(--mo-text)] sm:col-span-2">
                Название
                <input
                  className={fieldClass}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Лаборатория"
                />
              </label>
              <label className="block text-sm text-[var(--mo-text)]">
                % нам
                <input
                  className={fieldClass}
                  inputMode="decimal"
                  value={newKeep}
                  onChange={(e) => {
                    setNewKeep(e.target.value);
                    const k = Number(String(e.target.value).replace(",", "."));
                    if (Number.isFinite(k)) setNewPayout(String(Math.round((100 - k) * 100) / 100));
                  }}
                />
              </label>
              <label className="block text-sm text-[var(--mo-text)]">
                % отдаём
                <input
                  className={fieldClass}
                  inputMode="decimal"
                  value={newPayout}
                  onChange={(e) => {
                    setNewPayout(e.target.value);
                    const p = Number(String(e.target.value).replace(",", "."));
                    if (Number.isFinite(p)) setNewKeep(String(Math.round((100 - p) * 100) / 100));
                  }}
                />
              </label>
            </div>
            <button type="submit" className="btn-primary" disabled={createType.isPending}>
              Добавить услугу
            </button>
          </form>

          <div className="overflow-x-auto rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-2 sm:p-3">
            <table className="mo-table min-w-[640px]">
              <thead>
                <tr>
                  <th>Услуга</th>
                  <th>% нам</th>
                  <th>% отдаём</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(typesQuery.data ?? []).map((t) =>
                  editId === t.id ? (
                    <tr key={t.id}>
                      <td>
                        <input className="mo-input w-full" value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </td>
                      <td>
                        <input
                          className="mo-input w-20 tabular-nums"
                          value={editKeep}
                          onChange={(e) => {
                            setEditKeep(e.target.value);
                            const k = Number(String(e.target.value).replace(",", "."));
                            if (Number.isFinite(k)) setEditPayout(String(Math.round((100 - k) * 100) / 100));
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="mo-input w-20 tabular-nums"
                          value={editPayout}
                          onChange={(e) => {
                            setEditPayout(e.target.value);
                            const p = Number(String(e.target.value).replace(",", "."));
                            if (Number.isFinite(p)) setEditKeep(String(Math.round((100 - p) * 100) / 100));
                          }}
                        />
                      </td>
                      <td>{t.is_active ? "Активна" : "Выкл."}</td>
                      <td className="space-x-2 whitespace-nowrap">
                        <button type="button" className="btn-primary px-2 py-1 text-xs" onClick={() => updateType.mutate()}>
                          OK
                        </button>
                        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setEditId(null)}>
                          Отмена
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={t.id}>
                      <td className="font-medium">{t.name}</td>
                      <td className="tabular-nums kpi-actual-value">{n(t.keep_percent)}%</td>
                      <td className="tabular-nums">{n(t.payout_percent)}%</td>
                      <td>{t.is_active ? "Активна" : "Выкл."}</td>
                      <td className="whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            className="btn-secondary px-2.5 py-1 text-xs"
                            onClick={() => {
                              setEditId(t.id);
                              setEditName(t.name);
                              setEditKeep(String(n(t.keep_percent)));
                              setEditPayout(String(n(t.payout_percent)));
                            }}
                          >
                            Изменить
                          </button>
                          {t.is_active ? (
                            <button
                              type="button"
                              className="rounded-xl border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/20"
                              onClick={() => deactivateType.mutate(t.id)}
                            >
                              Отключить
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            {!typesQuery.data?.length && !typesQuery.isLoading ? (
              <p className="mt-3 px-1 text-sm mo-muted">Пока нет услуг. Добавьте, например, «Лаборатория».</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "report" ? (
        <div className="space-y-5">
          {reportQuery.isLoading ? <p className="text-sm mo-muted">Загрузка отчёта…</p> : null}
          {reportQuery.data ? (
            <>
              <div className="extra-services-kpis">
                <div className="extra-services-kpi">
                  <div className="extra-services-kpi__label">Кол-во</div>
                  <div className="extra-services-kpi__value">{reportQuery.data.count}</div>
                </div>
                <div className="extra-services-kpi">
                  <div className="extra-services-kpi__label">Сумма оплат</div>
                  <div className="extra-services-kpi__value">{formatMoney(reportQuery.data.amount_total)}</div>
                </div>
                <div className="extra-services-kpi">
                  <div className="extra-services-kpi__label">Заработали (нам)</div>
                  <div className="extra-services-kpi__value kpi-actual-value">
                    {formatMoney(reportQuery.data.keep_total)}
                  </div>
                </div>
                <div className="extra-services-kpi">
                  <div className="extra-services-kpi__label">Отдали</div>
                  <div className="extra-services-kpi__value">{formatMoney(reportQuery.data.payout_total)}</div>
                </div>
              </div>

              <div>
                <h2 className="mb-2 text-sm font-semibold text-[var(--mo-text)]">По услугам</h2>
                <div className="overflow-x-auto rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-2 sm:p-3">
                  <table className="mo-table min-w-[560px]">
                    <thead>
                      <tr>
                        <th>Услуга</th>
                        <th>Кол-во</th>
                        <th>Сумма</th>
                        <th>Нам</th>
                        <th>Отдали</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportQuery.data.by_type.map((r) => (
                        <tr key={r.service_type_id}>
                          <td>{r.service_name}</td>
                          <td className="tabular-nums">{r.count}</td>
                          <td className="tabular-nums">{formatMoney(r.amount_total)}</td>
                          <td className="tabular-nums kpi-actual-value">{formatMoney(r.keep_total)}</td>
                          <td className="tabular-nums">{formatMoney(r.payout_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h2 className="mb-2 text-sm font-semibold text-[var(--mo-text)]">По клиентам</h2>
                <div className="overflow-x-auto rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-2 sm:p-3">
                  <table className="mo-table min-w-[640px]">
                    <thead>
                      <tr>
                        <th>Клиент</th>
                        <th>Телефон</th>
                        <th>Кол-во</th>
                        <th>Оплатил</th>
                        <th>Нам</th>
                        <th>Отдали</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportQuery.data.by_client.map((r, i) => (
                        <tr key={`${r.client_name}-${r.client_phone}-${i}`}>
                          <td className="font-medium">{r.client_name}</td>
                          <td>{r.client_phone || "—"}</td>
                          <td className="tabular-nums">{r.count}</td>
                          <td className="tabular-nums">{formatMoney(r.amount_total)}</td>
                          <td className="tabular-nums kpi-actual-value">{formatMoney(r.keep_total)}</td>
                          <td className="tabular-nums">{formatMoney(r.payout_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!reportQuery.data.by_client.length ? (
                    <p className="mt-2 px-1 text-sm mo-muted">Нет данных за выбранный месяц.</p>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "journal" ? (
        <div className="space-y-3">
          <input
            className="mo-input w-full max-w-md"
            placeholder="Поиск: ФИО, телефон, услуга…"
            value={journalQ}
            onChange={(e) => setJournalQ(e.target.value)}
          />
          <div className="overflow-x-auto rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-2 sm:p-3">
            <table className="mo-table min-w-[900px]">
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Клиент</th>
                  <th>Телефон</th>
                  <th>Услуга</th>
                  <th>Оплатил</th>
                  <th>Нам</th>
                  <th>Отдали</th>
                  <th>Кто внёс</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(salesQuery.data ?? []).map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap text-xs">{formatDt(s.sold_at)}</td>
                    <td className="font-medium">{s.client_name}</td>
                    <td>{s.client_phone || "—"}</td>
                    <td>
                      {s.service_name}
                      <div className="text-[11px] mo-muted">
                        {n(s.keep_percent)}% / {n(s.payout_percent)}%
                      </div>
                    </td>
                    <td className="tabular-nums">{formatMoney(s.amount)}</td>
                    <td className="tabular-nums kpi-actual-value">{formatMoney(s.keep_amount)}</td>
                    <td className="tabular-nums">{formatMoney(s.payout_amount)}</td>
                    <td className="text-xs mo-muted">{s.created_by_name || "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="text-xs text-red-400 underline"
                        onClick={() => {
                          if (window.confirm("Отменить эту запись?")) cancelSale.mutate(s.id);
                        }}
                      >
                        Отмена
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {salesQuery.isLoading ? <p className="mt-2 px-1 text-sm mo-muted">Загрузка…</p> : null}
            {!salesQuery.isLoading && !(salesQuery.data ?? []).length ? (
              <p className="mt-2 px-1 text-sm mo-muted">Ничего не найдено за выбранный месяц.</p>
            ) : null}
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
