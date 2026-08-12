import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import type { ManagerDeskSale, Pipeline } from "@/lib/types";

type CatalogItem = { id: string; label: string };
type CatalogModule = {
  id: string;
  title: string;
  pricing_hint: string;
  items?: CatalogItem[];
  base_items?: CatalogItem[];
  extra_items?: CatalogItem[];
  min_selected?: number;
  price_any3?: number;
  price_all?: number;
  fixed_price?: number;
  price_each?: number;
};
type Catalog = { currency: string; modules: CatalogModule[] };

type QuoteComputeOut = {
  ok: boolean;
  errors: string[];
  currency: string;
  total: number;
  lines: { module: string; title: string; items: string[]; amount: number }[];
  summary_text: string;
};

function formatMoney(n: number) {
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} TJS`;
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function SalesQuoteCalculatorPage() {
  const me = useCurrentUserMe();
  const navigate = useNavigate();
  const enabled = Boolean(me.data?.desk_sales_enabled);

  const catalogQuery = useQuery({
    queryKey: ["quote-calculator-catalog"],
    queryFn: () => apiFetch<Catalog>("/api/quote-calculator/catalog"),
    enabled,
  });

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiFetch<Pipeline[]>("/api/pipelines"),
    enabled,
  });

  const [salesIds, setSalesIds] = useState<string[]>([]);
  const [accountingEnabled, setAccountingEnabled] = useState(false);
  const [accountingExtras, setAccountingExtras] = useState<string[]>([]);
  const [productionEnabled, setProductionEnabled] = useState(false);
  const [reportsEnabled, setReportsEnabled] = useState(false);
  const [serviceIds, setServiceIds] = useState<string[]>([]);

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [activitySphere, setActivitySphere] = useState("CRM модули");
  const [paidAmount, setPaidAmount] = useState("0");
  const [pipelineId, setPipelineId] = useState<number | "">("");

  const selectionBody = useMemo(
    () => ({
      sales_item_ids: salesIds,
      accounting_enabled: accountingEnabled,
      accounting_extra_ids: accountingExtras,
      production_enabled: productionEnabled,
      reports_enabled: reportsEnabled,
      service_ids: serviceIds,
    }),
    [salesIds, accountingEnabled, accountingExtras, productionEnabled, reportsEnabled, serviceIds],
  );

  const computeQuery = useQuery({
    queryKey: ["quote-compute", selectionBody],
    queryFn: () =>
      apiFetch<QuoteComputeOut>("/api/quote-calculator/compute", {
        method: "POST",
        body: JSON.stringify(selectionBody),
      }),
    enabled,
  });

  useEffect(() => {
    if (!accountingEnabled) setAccountingExtras([]);
  }, [accountingEnabled]);

  const commitMutation = useMutation({
    mutationFn: () =>
      apiFetch<ManagerDeskSale>("/api/quote-calculator/commit", {
        method: "POST",
        body: JSON.stringify({
          ...selectionBody,
          client_name: clientName.trim(),
          client_phone: clientPhone.trim(),
          activity_sphere: activitySphere.trim() || "CRM модули",
          paid_amount: Number(paidAmount.replace(",", ".")) || 0,
          pipeline_id: pipelineId === "" ? null : pipelineId,
        }),
      }),
    onSuccess: () => {
      toast.success("Калькуляция сохранена в продажи");
      navigate("/sales", { replace: true });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось сохранить"),
  });

  if (me.isLoading) return <p className="text-sm mo-muted">Загрузка…</p>;

  if (!enabled) {
    return (
      <div className="mo-section p-6">
        <h1 className="text-xl font-semibold text-[var(--mo-text)]">Калькуляция</h1>
        <p className="mt-2 text-sm mo-muted">Доступно только во втором пространстве (продажи).</p>
      </div>
    );
  }

  const modules = catalogQuery.data?.modules ?? [];
  const quote = computeQuery.data;
  const salesMod = modules.find((m) => m.id === "sales");
  const accMod = modules.find((m) => m.id === "accounting");
  const prodMod = modules.find((m) => m.id === "production");
  const repMod = modules.find((m) => m.id === "reports");
  const svcMod = modules.find((m) => m.id === "services");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--mo-text)]">Калькуляция</h1>
          <p className="mt-1 text-sm mo-muted">
            Выберите модули и услуги — сумма заказа сложится автоматически, затем уйдёт в{" "}
            <Link to="/sales" className="underline underline-offset-2">
              Продажи
            </Link>
            .
          </p>
        </div>
        <div className="rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)]/60 px-4 py-3 text-right">
          <div className="text-xs mo-muted">Итого к заказу</div>
          <div className="text-2xl font-semibold tabular-nums text-[var(--mo-text)]">
            {quote?.ok ? formatMoney(quote.total) : "—"}
          </div>
        </div>
      </header>

      {catalogQuery.isLoading ? <p className="text-sm mo-muted">Загрузка каталога…</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {salesMod ? (
          <section className="mo-section p-4">
            <h2 className="text-sm font-semibold text-[var(--mo-text)]">{salesMod.title}</h2>
            <p className="mt-1 text-xs mo-muted">{salesMod.pricing_hint}</p>
            <div className="mt-3 grid gap-2">
              {(salesMod.items ?? []).map((it) => (
                <label key={it.id} className="flex items-center gap-2 text-sm text-[var(--mo-text)]">
                  <input
                    type="checkbox"
                    checked={salesIds.includes(it.id)}
                    onChange={() => setSalesIds((prev) => toggleId(prev, it.id))}
                  />
                  {it.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs mo-muted">Выбрано: {salesIds.length} / 7</p>
          </section>
        ) : null}

        {accMod ? (
          <section className="mo-section p-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--mo-text)]">
              <input
                type="checkbox"
                checked={accountingEnabled}
                onChange={(e) => setAccountingEnabled(e.target.checked)}
              />
              {accMod.title} — {formatMoney(accMod.fixed_price ?? 7000)}
            </label>
            <p className="mt-1 text-xs mo-muted">{accMod.pricing_hint}</p>
            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-wide mo-muted">Входит в пакет</div>
              <ul className="mt-1 list-inside list-disc text-sm text-[var(--mo-text)]">
                {(accMod.base_items ?? []).map((it) => (
                  <li key={it.id}>{it.label}</li>
                ))}
              </ul>
            </div>
            <div className="mt-3 grid gap-2">
              <div className="text-[11px] uppercase tracking-wide mo-muted">Можно добавить</div>
              {(accMod.extra_items ?? []).map((it) => (
                <label
                  key={it.id}
                  className={`flex items-center gap-2 text-sm ${accountingEnabled ? "text-[var(--mo-text)]" : "mo-muted"}`}
                >
                  <input
                    type="checkbox"
                    disabled={!accountingEnabled}
                    checked={accountingExtras.includes(it.id)}
                    onChange={() => setAccountingExtras((prev) => toggleId(prev, it.id))}
                  />
                  {it.label}
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {prodMod ? (
          <section className="mo-section p-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--mo-text)]">
              <input
                type="checkbox"
                checked={productionEnabled}
                onChange={(e) => setProductionEnabled(e.target.checked)}
              />
              {prodMod.title} — {formatMoney(prodMod.fixed_price ?? 10000)}
            </label>
            <p className="mt-1 text-xs mo-muted">{prodMod.pricing_hint}</p>
            <ul className="mt-3 list-inside list-disc text-sm text-[var(--mo-text)]">
              {(prodMod.items ?? []).map((it) => (
                <li key={it.id}>{it.label}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {repMod ? (
          <section className="mo-section p-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--mo-text)]">
              <input
                type="checkbox"
                checked={reportsEnabled}
                onChange={(e) => setReportsEnabled(e.target.checked)}
              />
              {repMod.title} — {formatMoney(repMod.fixed_price ?? 7000)}
            </label>
            <p className="mt-1 text-xs mo-muted">{repMod.pricing_hint}</p>
            <ul className="mt-3 list-inside list-disc text-sm text-[var(--mo-text)]">
              {(repMod.items ?? []).map((it) => (
                <li key={it.id}>{it.label}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {svcMod ? (
          <section className="mo-section p-4 lg:col-span-2">
            <h2 className="text-sm font-semibold text-[var(--mo-text)]">{svcMod.title}</h2>
            <p className="mt-1 text-xs mo-muted">{svcMod.pricing_hint}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(svcMod.items ?? []).map((it) => (
                <label key={it.id} className="flex items-center gap-2 text-sm text-[var(--mo-text)]">
                  <input
                    type="checkbox"
                    checked={serviceIds.includes(it.id)}
                    onChange={() => setServiceIds((prev) => toggleId(prev, it.id))}
                  />
                  {it.label}
                  <span className="mo-muted">(+{svcMod.price_each ?? 1500})</span>
                </label>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <section className="mo-section p-4">
        <h2 className="text-sm font-semibold text-[var(--mo-text)]">Состав заказа</h2>
        {quote?.errors?.length ? (
          <ul className="mt-2 list-inside list-disc text-sm text-rose-300">
            {quote.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        {(quote?.lines?.length ?? 0) > 0 ? (
          <ul className="mt-3 space-y-2 text-sm">
            {quote!.lines.map((line, idx) => (
              <li key={`${line.module}-${idx}`} className="flex justify-between gap-3 border-b border-[var(--mo-border)] pb-2">
                <div>
                  <div className="font-medium text-[var(--mo-text)]">{line.title}</div>
                  <div className="text-xs mo-muted">{line.items.join(", ")}</div>
                </div>
                <div className="shrink-0 tabular-nums text-[var(--mo-text)]">{formatMoney(line.amount)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm lux-caption">Пока ничего не выбрано.</p>
        )}
      </section>

      <section className="mo-section p-4">
        <h2 className="text-sm font-semibold text-[var(--mo-text)]">Клиент → в продажи</h2>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!quote?.ok) {
              toast.error(quote?.errors?.[0] || "Исправьте выбор модулей");
              return;
            }
            commitMutation.mutate();
          }}
        >
          <label className="text-sm">
            <span className="mo-muted">ФИО</span>
            <input
              required
              className="mo-input mt-1 w-full"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mo-muted">Телефон</span>
            <input
              required
              className="mo-input mt-1 w-full"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mo-muted">Сфера деятельности</span>
            <input
              className="mo-input mt-1 w-full"
              value={activitySphere}
              onChange={(e) => setActivitySphere(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mo-muted">Сколько взял денег (TJS)</span>
            <input
              className="mo-input mt-1 w-full"
              inputMode="decimal"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
            />
          </label>
          {(pipelinesQuery.data?.length ?? 0) > 0 ? (
            <label className="text-sm sm:col-span-2">
              <span className="mo-muted">Воронка</span>
              <select
                className="mo-input mt-1 w-full"
                value={pipelineId === "" ? "" : String(pipelineId)}
                onChange={(e) => setPipelineId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Авто</option>
                {(pipelinesQuery.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={commitMutation.isPending || !quote?.ok}
              className="rounded-xl bg-[var(--mo-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {commitMutation.isPending ? "Сохранение…" : "Сохранить в продажи"}
            </button>
            <span className="text-sm mo-muted">
              Стоимость заказа: <span className="font-medium text-[var(--mo-text)]">{quote?.ok ? formatMoney(quote.total) : "—"}</span>
            </span>
          </div>
        </form>
      </section>
    </div>
  );
}
