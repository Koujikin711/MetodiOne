import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import type { ManagerDeskSale, Pipeline } from "@/lib/types";
import { ActivitySphereField } from "@/components/ActivitySphereField";

type CatalogItem = { id: string; label: string; description?: string };
type CatalogModule = {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
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

function ModuleCard({
  active,
  children,
  className = "",
}: {
  active?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={[
        "rounded-2xl border p-4 transition sm:p-5",
        active
          ? "border-[var(--mo-accent)]/45 bg-[var(--mo-accent-soft)]/35 shadow-sm"
          : "border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]",
        className,
      ].join(" ")}
    >
      {children}
    </section>
  );
}

function ModuleHeader({
  title,
  subtitle,
  description,
  priceBadge,
  control,
}: {
  title: string;
  subtitle?: string;
  description?: string;
  priceBadge?: string;
  control?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {control}
          <h2 className="text-base font-semibold tracking-tight text-[var(--mo-text)]">{title}</h2>
          {priceBadge ? (
            <span className="rounded-full border border-[var(--mo-border-strong)] bg-[var(--mo-surface)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--mo-text)]">
              {priceBadge}
            </span>
          ) : null}
        </div>
        {subtitle ? <p className="mt-0.5 text-xs font-medium text-[var(--mo-accent-hover)]">{subtitle}</p> : null}
        {description ? <p className="mt-2 text-[13px] leading-snug mo-muted">{description}</p> : null}
      </div>
    </div>
  );
}

function FeatureChip({
  item,
  checked,
  disabled,
  onToggle,
  trailing,
}: {
  item: CatalogItem;
  checked?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
  trailing?: ReactNode;
}) {
  const interactive = Boolean(onToggle);
  const body = (
    <>
      <span className="block text-[13px] font-medium leading-tight text-[var(--mo-text)]">{item.label}</span>
      {item.description ? (
        <span className="mt-0.5 block text-[11px] leading-snug mo-muted">{item.description}</span>
      ) : null}
      {trailing}
    </>
  );

  if (!interactive) {
    return (
      <div className="rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)]/70 px-3 py-2.5">{body}</div>
    );
  }

  return (
    <label
      className={[
        "flex cursor-pointer gap-2.5 rounded-xl border px-3 py-2.5 transition",
        disabled ? "cursor-not-allowed opacity-50" : "hover:border-[var(--mo-accent)]/40",
        checked
          ? "border-[var(--mo-accent)]/50 bg-[var(--mo-accent-soft)]/50"
          : "border-[var(--mo-border)] bg-[var(--mo-surface)]/70",
      ].join(" ")}
    >
      <input
        type="checkbox"
        className="mt-1 shrink-0"
        disabled={disabled}
        checked={Boolean(checked)}
        onChange={onToggle}
      />
      <span className="min-w-0">{body}</span>
    </label>
  );
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
  const [activitySphere, setActivitySphere] = useState("");
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

  const salesPriceHint =
    salesIds.length >= 7
      ? formatMoney(salesMod?.price_all ?? 7000)
      : salesIds.length >= 3
        ? formatMoney(salesMod?.price_any3 ?? 5000)
        : "от 5 000 TJS";

  return (
    <div className="sales-space-page space-y-4 pb-[4.5rem] sm:space-y-5 sm:pb-8">
      <header className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] mo-muted sm:text-[11px]">
          Продажи · конфиг
        </p>
        <h1 className="text-lg font-semibold tracking-tight text-[var(--mo-text)] sm:text-3xl">
          Калькуляция заказа
        </h1>
        <p className="mt-1 hidden text-sm leading-relaxed mo-muted sm:mt-2 sm:block">
          Соберите модули под задачу клиента. Сумма считается сразу, состав и оплату можно сохранить в{" "}
          <Link to="/sales" className="font-medium text-[var(--mo-accent-hover)] underline-offset-2 hover:underline">
            Продажи
          </Link>
          .
        </p>
      </header>

      {catalogQuery.isLoading ? <p className="text-sm mo-muted">Загрузка каталога…</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-4 lg:grid-cols-2">
          {salesMod ? (
            <ModuleCard active={salesIds.length > 0}>
              <ModuleHeader
                title={salesMod.title}
                subtitle={salesMod.subtitle}
                description={salesMod.description}
                priceBadge={salesPriceHint}
              />
              <p className="mt-2 text-[11px] mo-muted">{salesMod.pricing_hint}</p>
              <div className="mt-3 grid gap-2">
                {(salesMod.items ?? []).map((it) => (
                  <FeatureChip
                    key={it.id}
                    item={it}
                    checked={salesIds.includes(it.id)}
                    onToggle={() => setSalesIds((prev) => toggleId(prev, it.id))}
                  />
                ))}
              </div>
              <p className="mt-3 text-[11px] mo-muted">
                Выбрано {salesIds.length} из 7
                {salesIds.length > 0 && salesIds.length < 3 ? " · нужно ещё минимум до 3" : ""}
              </p>
            </ModuleCard>
          ) : null}

          {accMod ? (
            <ModuleCard active={accountingEnabled}>
              <ModuleHeader
                title={accMod.title}
                subtitle={accMod.subtitle}
                description={accMod.description}
                priceBadge={formatMoney(accMod.fixed_price ?? 7000)}
                control={
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={accountingEnabled}
                    onChange={(e) => setAccountingEnabled(e.target.checked)}
                    aria-label="Включить бухгалтерию"
                  />
                }
              />
              <p className="mt-2 text-[11px] mo-muted">{accMod.pricing_hint}</p>
              <div className="mt-3">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide mo-muted">Входит в пакет</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(accMod.base_items ?? []).map((it) => (
                    <FeatureChip key={it.id} item={it} />
                  ))}
                </div>
              </div>
              <div className="mt-3">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide mo-muted">Можно добавить</p>
                <div className="grid gap-2">
                  {(accMod.extra_items ?? []).map((it) => (
                    <FeatureChip
                      key={it.id}
                      item={it}
                      disabled={!accountingEnabled}
                      checked={accountingExtras.includes(it.id)}
                      onToggle={() => setAccountingExtras((prev) => toggleId(prev, it.id))}
                    />
                  ))}
                </div>
              </div>
            </ModuleCard>
          ) : null}

          {prodMod ? (
            <ModuleCard active={productionEnabled}>
              <ModuleHeader
                title={prodMod.title}
                subtitle={prodMod.subtitle}
                description={prodMod.description}
                priceBadge={formatMoney(prodMod.fixed_price ?? 10000)}
                control={
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={productionEnabled}
                    onChange={(e) => setProductionEnabled(e.target.checked)}
                    aria-label="Включить производство"
                  />
                }
              />
              <p className="mt-2 text-[11px] mo-muted">{prodMod.pricing_hint}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(prodMod.items ?? []).map((it) => (
                  <FeatureChip key={it.id} item={it} />
                ))}
              </div>
            </ModuleCard>
          ) : null}

          {repMod ? (
            <ModuleCard active={reportsEnabled}>
              <ModuleHeader
                title={repMod.title}
                subtitle={repMod.subtitle}
                description={repMod.description}
                priceBadge={formatMoney(repMod.fixed_price ?? 7000)}
                control={
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={reportsEnabled}
                    onChange={(e) => setReportsEnabled(e.target.checked)}
                    aria-label="Включить отчёты"
                  />
                }
              />
              <p className="mt-2 text-[11px] mo-muted">{repMod.pricing_hint}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(repMod.items ?? []).map((it) => (
                  <FeatureChip key={it.id} item={it} />
                ))}
              </div>
            </ModuleCard>
          ) : null}

          {svcMod ? (
            <ModuleCard active={serviceIds.length > 0} className="lg:col-span-2">
              <ModuleHeader
                title={svcMod.title}
                subtitle={svcMod.subtitle}
                description={svcMod.description}
                priceBadge={`+${svcMod.price_each ?? 1500} / шт.`}
              />
              <p className="mt-2 text-[11px] mo-muted">{svcMod.pricing_hint}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(svcMod.items ?? []).map((it) => (
                  <FeatureChip
                    key={it.id}
                    item={it}
                    checked={serviceIds.includes(it.id)}
                    onToggle={() => setServiceIds((prev) => toggleId(prev, it.id))}
                    trailing={
                      <span className="mt-1 block text-[10px] font-semibold tabular-nums text-[var(--mo-accent-hover)]">
                        +{formatMoney(svcMod.price_each ?? 1500)}
                      </span>
                    }
                  />
                ))}
              </div>
            </ModuleCard>
          ) : null}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <div className="space-y-3">
            <div className="rounded-2xl border border-[var(--mo-border-strong)] bg-[var(--mo-surface-elevated)] px-4 py-3 text-right shadow-sm">
              <div className="text-[10px] font-medium uppercase tracking-wide mo-muted sm:text-[11px]">Итого</div>
              <div className="mt-0.5 text-2xl font-semibold tabular-nums text-[var(--mo-text)]">
                {quote?.ok ? formatMoney(quote.total) : "—"}
              </div>
            </div>

            <section className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-[var(--mo-text)]">Состав заказа</h2>
              {quote?.errors?.length ? (
                <ul className="mt-2 space-y-1 text-xs text-rose-600 dark:text-rose-300">
                  {quote.errors.map((e) => (
                    <li key={e}>• {e}</li>
                  ))}
                </ul>
              ) : null}
              {(quote?.lines?.length ?? 0) > 0 ? (
                <ul className="mt-3 space-y-3">
                  {quote!.lines.map((line, idx) => (
                    <li key={`${line.module}-${idx}`} className="border-b border-[var(--mo-border)] pb-2 last:border-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[var(--mo-text)]">{line.title}</div>
                          <div className="mt-0.5 text-[11px] leading-snug mo-muted">{line.items.join(" · ")}</div>
                        </div>
                        <div className="shrink-0 text-sm font-semibold tabular-nums text-[var(--mo-text)]">
                          {formatMoney(line.amount)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm mo-muted">Пока ничего не выбрано.</p>
              )}
              <div className="mt-3 flex items-baseline justify-between border-t border-[var(--mo-border)] pt-3">
                <span className="text-xs mo-muted">К оплате</span>
                <span className="text-lg font-semibold tabular-nums text-[var(--mo-text)]">
                  {quote?.ok ? formatMoney(quote.total) : "—"}
                </span>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-[var(--mo-text)]">Клиент → в продажи</h2>
            <form
              className="mt-3 grid gap-3"
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
                <span className="text-xs mo-muted">ФИО</span>
                <input
                  required
                  className="mo-input mt-1 w-full"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="text-xs mo-muted">Телефон</span>
                <input
                  required
                  className="mo-input mt-1 w-full"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="text-xs mo-muted">Сфера деятельности</span>
                <ActivitySphereField
                  className="mo-input mt-1 w-full"
                  value={activitySphere}
                  onChange={setActivitySphere}
                />
              </label>
              <label className="text-sm">
                <span className="text-xs mo-muted">Оплатил (TJS)</span>
                <input
                  className="mo-input mt-1 w-full"
                  inputMode="decimal"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                />
              </label>
              {(pipelinesQuery.data?.length ?? 0) > 0 ? (
                <label className="text-sm">
                  <span className="text-xs mo-muted">Воронка</span>
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
              <button
                type="submit"
                disabled={commitMutation.isPending || !quote?.ok}
                className="mt-1 w-full rounded-xl bg-[var(--mo-accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {commitMutation.isPending ? "Сохранение…" : "Сохранить в продажи"}
              </button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}
