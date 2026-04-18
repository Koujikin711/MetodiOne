import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeCompanyIdFromToken, decodeRoleFromToken } from "@/lib/auth";
import type {
  FinanceDashboard,
  FinanceDeferredContract,
  FinanceDeferredPeriod,
  FinanceProduct,
  FinanceSettings,
  FinanceStockBalanceRow,
  FinanceWarehouse,
} from "@/lib/types";

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2,
});

function parseMoney(s: string) {
  const n = Number(s);
  return Number.isFinite(n) ? moneyFmt.format(n) : s;
}

export function FinancePage() {
  const queryClient = useQueryClient();
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const superNeedsCompany = role === "super_owner" && decodeCompanyIdFromToken(token) == null;

  const settingsQuery = useQuery({
    queryKey: ["finance-settings"],
    queryFn: () => apiFetch<FinanceSettings>("/api/finance/settings"),
    enabled: !superNeedsCompany,
  });

  const dashboardQuery = useQuery({
    queryKey: ["finance-dashboard"],
    queryFn: () => apiFetch<FinanceDashboard>("/api/finance/dashboard"),
    enabled: !superNeedsCompany,
  });

  const warehousesQuery = useQuery({
    queryKey: ["finance-warehouses"],
    queryFn: () => apiFetch<FinanceWarehouse[]>("/api/finance/warehouses"),
    enabled: !superNeedsCompany,
  });

  const productsQuery = useQuery({
    queryKey: ["finance-products"],
    queryFn: () => apiFetch<FinanceProduct[]>("/api/finance/products"),
    enabled: !superNeedsCompany,
  });

  const balancesQuery = useQuery({
    queryKey: ["finance-stock-balances"],
    queryFn: () => apiFetch<FinanceStockBalanceRow[]>("/api/finance/stock/balances"),
    enabled: !superNeedsCompany && Boolean(settingsQuery.data?.inventory_enabled),
  });

  const deferredQuery = useQuery({
    queryKey: ["finance-deferred"],
    queryFn: () => apiFetch<FinanceDeferredContract[]>("/api/finance/deferred-contracts"),
    enabled: !superNeedsCompany,
  });

  const invalidateFinance = () => {
    void queryClient.invalidateQueries({ queryKey: ["finance-settings"] });
    void queryClient.invalidateQueries({ queryKey: ["finance-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["finance-warehouses"] });
    void queryClient.invalidateQueries({ queryKey: ["finance-products"] });
    void queryClient.invalidateQueries({ queryKey: ["finance-stock-balances"] });
    void queryClient.invalidateQueries({ queryKey: ["finance-deferred"] });
  };

  const patchSettings = useMutation({
    mutationFn: (body: Partial<FinanceSettings>) =>
      apiFetch<FinanceSettings>("/api/finance/settings", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidateFinance();
      toast.success("Настройки сохранены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [draftInventory, setDraftInventory] = useState<boolean | null>(null);
  const [draftCosting, setDraftCosting] = useState<string | null>(null);
  const [draftGoodsPol, setDraftGoodsPol] = useState<string | null>(null);
  const [draftServPol, setDraftServPol] = useState<string | null>(null);

  const effective = settingsQuery.data;
  const inv = draftInventory ?? effective?.inventory_enabled ?? false;
  const cost = draftCosting ?? effective?.costing_method ?? "average";
  const gPol = draftGoodsPol ?? effective?.revenue_goods_policy ?? "shipment";
  const sPol = draftServPol ?? effective?.revenue_services_policy ?? "deferred_period";

  const [whName, setWhName] = useState("");
  const [whDefault, setWhDefault] = useState(false);
  const createWh = useMutation({
    mutationFn: () =>
      apiFetch<FinanceWarehouse>("/api/finance/warehouses", {
        method: "POST",
        body: JSON.stringify({ name: whName.trim(), is_default: whDefault, sort_order: 0 }),
      }),
    onSuccess: () => {
      setWhName("");
      setWhDefault(false);
      invalidateFinance();
      toast.success("Склад создан");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [prodName, setProdName] = useState("");
  const [prodType, setProdType] = useState<"good" | "service">("good");
  const createProd = useMutation({
    mutationFn: () =>
      apiFetch<FinanceProduct>("/api/finance/products", {
        method: "POST",
        body: JSON.stringify({ name: prodName.trim(), product_type: prodType, unit: "pcs" }),
      }),
    onSuccess: () => {
      setProdName("");
      invalidateFinance();
      toast.success("Номенклатура добавлена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const defaultWhId = useMemo(() => {
    const list = warehousesQuery.data ?? [];
    const d = list.find((w) => w.is_default);
    return d?.id ?? list[0]?.id ?? 0;
  }, [warehousesQuery.data]);

  const [rcpWh, setRcpWh] = useState(0);
  const [rcpProd, setRcpProd] = useState(0);
  const [rcpQty, setRcpQty] = useState("1");
  const [rcpCost, setRcpCost] = useState("0");
  const receiptMut = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: number }>("/api/finance/stock/receipt", {
        method: "POST",
        body: JSON.stringify({
          warehouse_id: rcpWh || defaultWhId,
          product_id: rcpProd,
          quantity: rcpQty,
          unit_cost: rcpCost,
        }),
      }),
    onSuccess: () => {
      invalidateFinance();
      toast.success("Приход проведён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [issWh, setIssWh] = useState(0);
  const [issProd, setIssProd] = useState(0);
  const [issQty, setIssQty] = useState("1");
  const issueMut = useMutation({
    mutationFn: () =>
      apiFetch<{ cost: string }>("/api/finance/stock/issue", {
        method: "POST",
        body: JSON.stringify({
          warehouse_id: issWh || defaultWhId,
          product_id: issProd,
          quantity: issQty,
        }),
      }),
    onSuccess: (res) => {
      invalidateFinance();
      toast.success(`Списание, себестоимость ${parseMoney(res.cost)}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [defTitle, setDefTitle] = useState("");
  const [defAmount, setDefAmount] = useState("10000");
  const [defPeriods, setDefPeriods] = useState("3");
  const [defStart, setDefStart] = useState("");
  const [defEnd, setDefEnd] = useState("");
  const createDef = useMutation({
    mutationFn: () => {
      const start = defStart ? `${defStart}T00:00:00` : new Date().toISOString().slice(0, 19);
      const end = defEnd ? `${defEnd}T00:00:00` : new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 19);
      return apiFetch<FinanceDeferredContract>("/api/finance/deferred-contracts", {
        method: "POST",
        body: JSON.stringify({
          title: defTitle.trim(),
          total_amount: defAmount,
          period_count: Number(defPeriods) || 1,
          start_date: start,
          end_date: end,
        }),
      });
    },
    onSuccess: () => {
      setDefTitle("");
      invalidateFinance();
      toast.success("Договор с периодами создан");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [periodsFor, setPeriodsFor] = useState<number | null>(null);
  const periodsQuery = useQuery({
    queryKey: ["finance-deferred-periods", periodsFor],
    queryFn: () => apiFetch<FinanceDeferredPeriod[]>(`/api/finance/deferred-contracts/${periodsFor}/periods`),
    enabled: periodsFor != null && !superNeedsCompany,
  });

  const recognizeMut = useMutation({
    mutationFn: ({ contractId, periodNo }: { contractId: number; periodNo: number }) =>
      apiFetch<{ id: number }>(
        `/api/finance/deferred-contracts/${contractId}/periods/${periodNo}/recognize`,
        { method: "POST" },
      ),
    onSuccess: () => {
      void periodsQuery.refetch();
      void deferredQuery.refetch();
      toast.success("Период признан в выручку");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (superNeedsCompany) {
    return (
      <div className="relative mx-auto max-w-2xl space-y-4 pb-10">
        <h1 className="text-3xl font-semibold text-white">Финансы</h1>
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Для супер-владельца нужен контекст компании. Перейдите в{" "}
          <Link to="/companies" className="font-medium text-white underline">
            Компании
          </Link>
          , нажмите «Войти в компанию», затем откройте раздел Финансы снова.
        </p>
      </div>
    );
  }

  return (
    <div className="relative mx-auto max-w-5xl space-y-8 pb-12">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Финансы</h1>
        <p className="text-sm text-slate-400">
          Политики учёта, склады, остатки (FIFO / средняя), отложенная выручка по услугам. Доступ: владелец, админ,
          супер-владелец.
        </p>
      </header>

      {settingsQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
      {settingsQuery.isError && (
        <p className="text-sm text-rose-300">{(settingsQuery.error as Error).message}</p>
      )}

      {effective && (
        <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
          <h2 className="text-lg font-medium text-white">Настройки учёта</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Склад / запасы
              <select
                value={inv ? "1" : "0"}
                onChange={(e) => setDraftInventory(e.target.value === "1")}
                className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
              >
                <option value="0">Выключено</option>
                <option value="1">Включено</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Метод себестоимости
              <select
                value={cost}
                onChange={(e) => setDraftCosting(e.target.value)}
                disabled={!inv}
                className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white disabled:opacity-40"
              >
                <option value="average">Средневзвешенная</option>
                <option value="fifo">FIFO по партиям</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Выручка: товары (политика)
              <select
                value={gPol}
                onChange={(e) => setDraftGoodsPol(e.target.value)}
                className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
              >
                <option value="shipment">Отгрузка</option>
                <option value="payment">Оплата</option>
                <option value="invoice">Акт / счёт</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Выручка: услуги (политика)
              <select
                value={sPol}
                onChange={(e) => setDraftServPol(e.target.value)}
                className="rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
              >
                <option value="deferred_period">По периодам (отложенная)</option>
                <option value="payment">По оплате</option>
                <option value="shipment">По отгрузке / оказанию</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={patchSettings.isPending}
            onClick={() =>
              patchSettings.mutate({
                inventory_enabled: draftInventory ?? undefined,
                costing_method: draftCosting ?? undefined,
                revenue_goods_policy: draftGoodsPol ?? undefined,
                revenue_services_policy: draftServPol ?? undefined,
              })
            }
            className="mt-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-medium text-white shadow-lg disabled:opacity-50"
          >
            Сохранить настройки
          </button>
        </section>
      )}

      {dashboardQuery.data && (
        <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
          <h2 className="text-lg font-medium text-white">Сводка</h2>
          <p className="mt-1 text-xs text-slate-500">
            Складов: {dashboardQuery.data.warehouse_count}. Себестоимость:{" "}
            {dashboardQuery.data.costing_method === "fifo" ? "FIFO" : "средняя"}.
          </p>
          {dashboardQuery.data.inventory_enabled && dashboardQuery.data.warehouses.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {dashboardQuery.data.warehouses.map((w) => (
                <div
                  key={w.warehouse_id}
                  className="rounded-xl border border-slate-600/40 bg-slate-900/40 px-4 py-3"
                >
                  <div className="text-sm font-medium text-white">{w.warehouse_name}</div>
                  <div className="mt-1 text-xs text-slate-400">Позиций: {w.sku_positions}</div>
                  <div className="mt-1 text-sm text-emerald-300">{parseMoney(w.inventory_value)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
        <h2 className="text-lg font-medium text-white">Склады</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-300">
          {(warehousesQuery.data ?? []).map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-white">{w.name}</span>
              {w.is_default && <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-200">по умолчанию</span>}
              {!w.is_active && <span className="text-xs text-rose-300">неактивен</span>}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1 text-sm text-slate-300">
            Новый склад
            <input
              value={whName}
              onChange={(e) => setWhName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
              placeholder="Название"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={whDefault} onChange={(e) => setWhDefault(e.target.checked)} />
            по умолчанию
          </label>
          <button
            type="button"
            disabled={!whName.trim() || createWh.isPending}
            onClick={() => createWh.mutate()}
            className="rounded-xl border border-slate-500/50 px-4 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-40"
          >
            Добавить
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
        <h2 className="text-lg font-medium text-white">Номенклатура</h2>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1 text-sm text-slate-300">
            Название
            <input
              value={prodName}
              onChange={(e) => setProdName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Тип
            <select
              value={prodType}
              onChange={(e) => setProdType(e.target.value as "good" | "service")}
              className="mt-1 block rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
            >
              <option value="good">Товар</option>
              <option value="service">Услуга</option>
            </select>
          </label>
          <button
            type="button"
            disabled={!prodName.trim() || createProd.isPending}
            onClick={() => createProd.mutate()}
            className="rounded-xl border border-slate-500/50 px-4 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-40"
          >
            Создать
          </button>
        </div>
        <ul className="mt-4 max-h-48 space-y-1 overflow-auto text-sm text-slate-400">
          {(productsQuery.data ?? []).map((p) => (
            <li key={p.id}>
              {p.name} — {p.product_type === "good" ? "товар" : "услуга"}
            </li>
          ))}
        </ul>
      </section>

      {effective?.inventory_enabled && (
        <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
          <h2 className="text-lg font-medium text-white">Остатки и движения</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm text-slate-300">
              <thead>
                <tr className="border-b border-slate-600/50 text-xs uppercase text-slate-500">
                  <th className="py-2 pr-2">Товар</th>
                  <th className="py-2 pr-2">Склад</th>
                  <th className="py-2 pr-2">Кол-во</th>
                  <th className="py-2 pr-2">Себ-ть</th>
                  <th className="py-2">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {(balancesQuery.data ?? []).map((row, i) => (
                  <tr key={i} className="border-b border-slate-700/30">
                    <td className="py-2 pr-2 text-white">{row.product_name}</td>
                    <td className="py-2 pr-2">{row.warehouse_name}</td>
                    <td className="py-2 pr-2">{row.quantity}</td>
                    <td className="py-2 pr-2">{parseMoney(row.avg_unit_cost)}</td>
                    <td className="py-2">{parseMoney(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium text-slate-200">Приход</h3>
              <div className="mt-2 space-y-2">
                <select
                  value={rcpWh || defaultWhId}
                  onChange={(e) => setRcpWh(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                >
                  {(warehousesQuery.data ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <select
                  value={rcpProd}
                  onChange={(e) => setRcpProd(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                >
                  <option value={0}>— товар —</option>
                  {(productsQuery.data ?? [])
                    .filter((p) => p.product_type === "good")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <input
                  value={rcpQty}
                  onChange={(e) => setRcpQty(e.target.value)}
                  placeholder="Кол-во"
                  className="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                />
                <input
                  value={rcpCost}
                  onChange={(e) => setRcpCost(e.target.value)}
                  placeholder="Цена за ед."
                  className="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                />
                <button
                  type="button"
                  disabled={receiptMut.isPending || !rcpProd}
                  onClick={() => receiptMut.mutate()}
                  className="w-full rounded-xl bg-emerald-600/80 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Провести приход
                </button>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-200">Списание (расход)</h3>
              <div className="mt-2 space-y-2">
                <select
                  value={issWh || defaultWhId}
                  onChange={(e) => setIssWh(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                >
                  {(warehousesQuery.data ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <select
                  value={issProd}
                  onChange={(e) => setIssProd(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                >
                  <option value={0}>— товар —</option>
                  {(productsQuery.data ?? [])
                    .filter((p) => p.product_type === "good")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <input
                  value={issQty}
                  onChange={(e) => setIssQty(e.target.value)}
                  placeholder="Кол-во"
                  className="w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
                />
                <button
                  type="button"
                  disabled={issueMut.isPending || !issProd}
                  onClick={() => issueMut.mutate()}
                  className="w-full rounded-xl bg-rose-600/70 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Провести списание
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
        <h2 className="text-lg font-medium text-white">Отложенная выручка (услуги по периодам)</h2>
        <p className="mt-1 text-xs text-slate-500">
          Создайте договор — периоды распределятся автоматически. Кнопка «Признать» формирует проводку Дт 2090 / Кт 4010.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-[180px] flex-1 text-sm text-slate-300">
            Название
            <input
              value={defTitle}
              onChange={(e) => setDefTitle(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
            />
          </label>
          <label className="w-28 text-sm text-slate-300">
            Сумма
            <input
              value={defAmount}
              onChange={(e) => setDefAmount(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
            />
          </label>
          <label className="w-20 text-sm text-slate-300">
            Периодов
            <input
              value={defPeriods}
              onChange={(e) => setDefPeriods(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
            />
          </label>
          <label className="w-36 text-sm text-slate-300">
            Начало
            <input
              type="date"
              value={defStart}
              onChange={(e) => setDefStart(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
            />
          </label>
          <label className="w-36 text-sm text-slate-300">
            Конец
            <input
              type="date"
              value={defEnd}
              onChange={(e) => setDefEnd(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-white"
            />
          </label>
          <button
            type="button"
            disabled={!defTitle.trim() || createDef.isPending}
            onClick={() => createDef.mutate()}
            className="rounded-xl border border-slate-500/50 px-4 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-40"
          >
            Создать договор
          </button>
        </div>

        <ul className="mt-6 space-y-2">
          {(deferredQuery.data ?? []).map((c) => (
            <li key={c.id} className="rounded-xl border border-slate-600/40 bg-slate-900/30 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-white">{c.title}</span>
                <span className="text-emerald-300">{parseMoney(c.total_amount)}</span>
              </div>
              <button
                type="button"
                className="mt-2 text-xs text-indigo-300 hover:underline"
                onClick={() => setPeriodsFor(periodsFor === c.id ? null : c.id)}
              >
                {periodsFor === c.id ? "Скрыть периоды" : "Периоды"}
              </button>
              {periodsFor === c.id && periodsQuery.data && (
                <ul className="mt-2 space-y-1 border-t border-slate-700/50 pt-2 text-xs text-slate-400">
                  {periodsQuery.data.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        №{p.period_no} — {parseMoney(p.amount)} — до {p.due_date?.slice(0, 10) ?? "—"}
                        {p.posted_at && <span className="ml-2 text-emerald-400">признан</span>}
                      </span>
                      {!p.posted_at && (
                        <button
                          type="button"
                          disabled={recognizeMut.isPending}
                          onClick={() => recognizeMut.mutate({ contractId: c.id, periodNo: p.period_no })}
                          className="rounded-lg bg-indigo-600/60 px-2 py-1 text-white"
                        >
                          Признать
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
