import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { DateField } from "@/components/DateField";
import { MarketingCharts } from "@/components/marketing/MarketingCharts";
import { PageHeader } from "@/components/ui/PageHeader";
import { apiFetch } from "@/lib/api";

type MetaSettings = {
  configured: boolean;
  ad_account_id: string;
  has_token: boolean;
  account_name?: string | null;
  currency?: string | null;
  timezone_name?: string | null;
};

type CampaignRow = {
  campaign_id: string;
  campaign_name: string;
  brand?: string | null;
  spend: string | number;
  impressions: number;
  clicks: number;
  leads: number;
  followers?: number;
  cost_per_lead?: string | number | null;
};

type BrandRow = {
  account: string;
  followers: number;
  leads: number;
  spend: string | number;
  impressions: number;
  clicks: number;
};

type DailyPoint = {
  date: string;
  spend: string | number;
  leads: number;
  followers: number;
  clicks: number;
  impressions: number;
};

type ManagerRow = {
  manager_id?: number | null;
  manager_name: string;
  received: number;
  answered: number;
  rejected: number;
  sold: number;
  answered_pct: number;
  rejected_pct: number;
  sold_pct: number;
};

type Overview = {
  period: string;
  period_start: string;
  period_end: string;
  currency: string;
  account_name?: string | null;
  ad_account_id: string;
  spend: string | number;
  impressions: number;
  clicks: number;
  leads: number;
  followers: number;
  cost_per_lead?: string | number | null;
  campaigns: CampaignRow[];
  brands: BrandRow[];
  daily: DailyPoint[];
  managers: ManagerRow[];
  managers_total?: ManagerRow | null;
};

type PeriodKind = "day" | "week" | "month" | "custom";

function money(v: number | string | null | undefined, currency = "USD") {
  const n = Number(v || 0);
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${currency}`;
}

function pctCell(count: number, pct: number) {
  return (
    <span className="tabular-nums">
      {count}{" "}
      <span className="text-[11px] mo-muted">({pct.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%)</span>
    </span>
  );
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MarketingPage() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<PeriodKind>("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [adAccountId, setAdAccountId] = useState("act_1442491974027857");
  const [accessToken, setAccessToken] = useState("");
  const [showConnect, setShowConnect] = useState(false);
  const [igHook, setIgHook] = useState<{ callback_url: string; verify_token: string; accounts: string } | null>(
    null,
  );

  const settingsQuery = useQuery({
    queryKey: ["marketing-meta-settings"],
    queryFn: () => apiFetch<MetaSettings>("/api/marketing/meta/settings"),
  });

  useEffect(() => {
    const s = settingsQuery.data;
    if (!s) return;
    if (s.ad_account_id) setAdAccountId(s.ad_account_id);
    if (!s.configured) setShowConnect(true);
  }, [settingsQuery.data]);

  const periodReady = period !== "custom" || Boolean(dateFrom && dateTo);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("period", period);
    if (period === "custom") {
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
    }
    return p.toString();
  }, [period, dateFrom, dateTo]);

  const overviewQuery = useQuery({
    queryKey: ["marketing-meta-overview", qs],
    queryFn: () =>
      apiFetch<Overview>(`/api/marketing/meta/overview?${qs}`, {
        timeoutMs: 90_000,
      }),
    enabled: Boolean(settingsQuery.data?.configured) && periodReady,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<MetaSettings>("/api/marketing/meta/settings", {
        method: "PUT",
        body: JSON.stringify({
          ad_account_id: adAccountId.trim(),
          access_token: accessToken.trim() || undefined,
        }),
      }),
    onSuccess: (data) => {
      toast.success(data.account_name ? `Подключено: ${data.account_name}` : "Сохранено");
      setAccessToken("");
      setShowConnect(false);
      void qc.invalidateQueries({ queryKey: ["marketing-meta-settings"] });
      void qc.invalidateQueries({ queryKey: ["marketing-meta-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const igConnectMutation = useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        verify_token: string;
        callback_url: string;
        accounts: Array<{ label: string; ig_username?: string | null }>;
        hint: string;
      }>("/api/marketing/meta/connect-instagram", { method: "POST", timeoutMs: 90_000 }),
    onSuccess: (data) => {
      toast.success(`Instagram: ${data.accounts.map((a) => a.label).join(", ")}`);
      setIgHook({
        callback_url: data.callback_url,
        verify_token: data.verify_token,
        accounts: data.accounts
          .map((a) => `${a.label}${a.ig_username ? ` (@${a.ig_username})` : ""}`)
          .join(" · "),
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data = overviewQuery.data;
  const currency = data?.currency || settingsQuery.data?.currency || "USD";
  const configured = Boolean(settingsQuery.data?.configured);

  function onSave(e: FormEvent) {
    e.preventDefault();
    if (!adAccountId.trim()) {
      toast.error("Укажите ad account id");
      return;
    }
    if (!settingsQuery.data?.has_token && !accessToken.trim()) {
      toast.error("Вставьте access token");
      return;
    }
    saveMutation.mutate();
  }

  function setPeriodKind(next: PeriodKind) {
    setPeriod(next);
    if (next === "custom" && !dateFrom && !dateTo) {
      const t = todayIso();
      setDateFrom(t.slice(0, 8) + "01");
      setDateTo(t);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <PageHeader
        title="Маркетинг"
        description="Два IG-аккаунта: Ganjina Zamiri и MetodiClinic (без MetodiOne)"
      />

      {configured && !showConnect ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--mo-border)] px-4 py-3">
          <p className="text-sm mo-muted">
            Meta · {settingsQuery.data?.account_name || "подключено"} · {settingsQuery.data?.ad_account_id}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={igConnectMutation.isPending}
              onClick={() => igConnectMutation.mutate()}
            >
              {igConnectMutation.isPending ? "Подключение…" : "Подключить Instagram DM"}
            </button>
            <button type="button" className="btn-secondary text-sm" onClick={() => setShowConnect(true)}>
              Изменить токен
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSave} className="mo-section space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--mo-text)]">Подключение Meta Ads</h2>
            {configured ? (
              <button type="button" className="text-xs mo-muted underline" onClick={() => setShowConnect(false)}>
                Скрыть
              </button>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm mo-muted">
              Ad Account ID
              <input
                className="mo-input mt-1 w-full"
                value={adAccountId}
                onChange={(e) => setAdAccountId(e.target.value)}
                placeholder="act_1442491974027857"
                autoComplete="off"
              />
            </label>
            <label className="block text-sm mo-muted">
              Access token {settingsQuery.data?.has_token ? "(оставьте пустым, чтобы не менять)" : ""}
              <input
                className="mo-input mt-1 w-full"
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="EAA…"
                autoComplete="off"
              />
            </label>
          </div>
          <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Проверка…" : "Сохранить и проверить"}
          </button>
        </form>
      )}

      {igHook ? (
        <div className="space-y-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm">
          <p className="font-semibold text-[var(--mo-text)]">Instagram DM подключены: {igHook.accounts}</p>
          <p className="text-xs mo-muted">
            Один раз в Meta Developers → CRM → Webhooks вставь Callback URL и Verify Token, нажми Verify:
          </p>
          <div className="break-all font-mono text-[11px]">{igHook.callback_url}</div>
          <div className="break-all font-mono text-[11px]">Verify: {igHook.verify_token}</div>
        </div>
      ) : null}

      <section className="mo-section flex flex-wrap items-end gap-3 p-4">
        <label className="block text-sm mo-muted">
          Период
          <select
            className="mo-input mt-1 min-w-[10rem]"
            value={period}
            onChange={(e) => setPeriodKind(e.target.value as PeriodKind)}
          >
            <option value="day">День</option>
            <option value="week">Неделя</option>
            <option value="month">Месяц</option>
            <option value="custom">Свой период</option>
          </select>
        </label>
        <label className="block text-sm mo-muted">
          С
          <div className="mt-1">
            <DateField
              value={dateFrom}
              onChange={setDateFrom}
              disabled={period !== "custom"}
              allowClear={false}
              aria-label="Дата с"
            />
          </div>
        </label>
        <label className="block text-sm mo-muted">
          По
          <div className="mt-1">
            <DateField
              value={dateTo}
              onChange={setDateTo}
              disabled={period !== "custom"}
              allowClear={false}
              aria-label="Дата по"
            />
          </div>
        </label>
        {data ? (
          <p className="pb-2 text-xs mo-muted">
            {data.period_start} — {data.period_end}
          </p>
        ) : null}
      </section>

      {!configured ? (
        <p className="text-sm mo-muted">Один раз вставьте токен выше — дальше форма скрыта.</p>
      ) : !periodReady ? (
        <p className="text-sm mo-muted">Укажите даты периода.</p>
      ) : overviewQuery.isLoading ? (
        <p className="text-sm mo-muted">Загрузка из Meta…</p>
      ) : overviewQuery.isError ? (
        <p className="text-sm text-red-400">{(overviewQuery.error as Error).message}</p>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)]/40 p-4">
              <div className="text-xs mo-muted">Расход</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{money(data.spend, currency)}</div>
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)]/40 p-4">
              <div className="text-xs mo-muted">Лиды Meta</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{data.leads}</div>
              <div className="mt-1 text-[11px] mo-muted">
                формы + переписки · CPL{" "}
                {data.cost_per_lead != null ? money(data.cost_per_lead, currency) : "—"}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)]/40 p-4">
              <div className="text-xs mo-muted">В CRM у менеджеров</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {data.managers_total?.received ?? 0}
              </div>
              <div className="mt-1 text-[11px] mo-muted">
                {data.leads > 0
                  ? `${(((data.managers_total?.received ?? 0) / data.leads) * 100).toLocaleString("ru-RU", {
                      maximumFractionDigits: 1,
                    })}% от Meta`
                  : "карточки в воронке"}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)]/40 p-4">
              <div className="text-xs mo-muted">Подписчики</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{data.followers}</div>
              <div className="mt-1 text-[11px] mo-muted">follow / page like</div>
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface)]/40 p-4">
              <div className="text-xs mo-muted">Показы / клики</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {Number(data.impressions).toLocaleString("ru-RU")}
              </div>
              <div className="mt-1 text-[11px] mo-muted">
                клики {Number(data.clicks).toLocaleString("ru-RU")}
              </div>
            </div>
          </div>

          <p className="text-xs mo-muted">
            Meta считает события рекламы (форма + старт переписки). В CRM — только реальные карточки,
            которые дошли менеджерам. Не каждый клик/сообщение в Instagram создаёт лид в MetodiOne.
          </p>
          <MarketingCharts
            campaigns={data.campaigns}
            brands={data.brands}
            daily={data.daily}
            managers={data.managers}
            currency={currency}
          />

          <section className="overflow-hidden rounded-2xl border border-[var(--mo-border)]">
            <div className="border-b border-[var(--mo-border)] px-4 py-3 text-sm font-semibold">
              Подписчики по аккаунтам
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--mo-surface)]/70 text-xs mo-muted">
                  <tr>
                    <th className="px-3 py-2">Аккаунт</th>
                    <th className="px-3 py-2">Подписчики</th>
                    <th className="px-3 py-2">Лиды</th>
                    <th className="px-3 py-2">Расход</th>
                    <th className="px-3 py-2">Клики</th>
                    <th className="px-3 py-2">Показы</th>
                  </tr>
                </thead>
                <tbody>
                  {data.brands.map((b) => (
                    <tr key={b.account} className="border-t border-[var(--mo-border)]/60">
                      <td className="px-3 py-2 font-medium">{b.account}</td>
                      <td className="px-3 py-2 tabular-nums">{b.followers}</td>
                      <td className="px-3 py-2 tabular-nums">{b.leads}</td>
                      <td className="px-3 py-2 tabular-nums">{money(b.spend, currency)}</td>
                      <td className="px-3 py-2 tabular-nums">{b.clicks}</td>
                      <td className="px-3 py-2 tabular-nums">{b.impressions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-[var(--mo-border)]">
            <div className="border-b border-[var(--mo-border)] px-4 py-3 text-sm font-semibold">
              Кампании · Ganjina Zamiri / MetodiClinic
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--mo-surface)]/70 text-xs mo-muted">
                  <tr>
                    <th className="px-3 py-2">Кампания</th>
                    <th className="px-3 py-2">Аккаунт</th>
                    <th className="px-3 py-2">Расход</th>
                    <th className="px-3 py-2">Лиды</th>
                    <th className="px-3 py-2">Подписчики</th>
                    <th className="px-3 py-2">CPL</th>
                    <th className="px-3 py-2">Клики</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 mo-muted" colSpan={7}>
                        Нет кампаний Ganjina Zamiri / MetodiClinic
                      </td>
                    </tr>
                  ) : (
                    data.campaigns.map((c) => (
                      <tr key={c.campaign_id || c.campaign_name} className="border-t border-[var(--mo-border)]/60">
                        <td className="px-3 py-2">{c.campaign_name}</td>
                        <td className="px-3 py-2 mo-muted">{c.brand || "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{money(c.spend, currency)}</td>
                        <td className="px-3 py-2 tabular-nums">{c.leads}</td>
                        <td className="px-3 py-2 tabular-nums">{c.followers ?? 0}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {c.cost_per_lead != null ? money(c.cost_per_lead, currency) : "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{c.clicks}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-[var(--mo-border)]">
            <div className="border-b border-[var(--mo-border)] px-4 py-3 text-sm font-semibold">
              Конверсия менеджеров · карточки CRM с рекламы (не = лиды Meta)
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--mo-surface)]/70 text-xs mo-muted">
                  <tr>
                    <th className="px-3 py-2">Менеджер</th>
                    <th className="px-3 py-2">Получили</th>
                    <th className="px-3 py-2">Ответили</th>
                    <th className="px-3 py-2">Отказ</th>
                    <th className="px-3 py-2">Продали</th>
                  </tr>
                </thead>
                <tbody>
                  {data.managers.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 mo-muted" colSpan={5}>
                        Нет лидов с рекламы за период
                      </td>
                    </tr>
                  ) : (
                    <>
                      {data.managers.map((m) => (
                        <tr
                          key={m.manager_id ?? m.manager_name}
                          className="border-t border-[var(--mo-border)]/60"
                        >
                          <td className="px-3 py-2">{m.manager_name}</td>
                          <td className="px-3 py-2 tabular-nums">{m.received}</td>
                          <td className="px-3 py-2">{pctCell(m.answered, m.answered_pct)}</td>
                          <td className="px-3 py-2">{pctCell(m.rejected, m.rejected_pct)}</td>
                          <td className="px-3 py-2">{pctCell(m.sold, m.sold_pct)}</td>
                        </tr>
                      ))}
                      {data.managers_total ? (
                        <tr className="border-t-2 border-[var(--mo-border)] bg-[var(--mo-surface)]/40 font-medium">
                          <td className="px-3 py-2">{data.managers_total.manager_name}</td>
                          <td className="px-3 py-2 tabular-nums">{data.managers_total.received}</td>
                          <td className="px-3 py-2">
                            {pctCell(data.managers_total.answered, data.managers_total.answered_pct)}
                          </td>
                          <td className="px-3 py-2">
                            {pctCell(data.managers_total.rejected, data.managers_total.rejected_pct)}
                          </td>
                          <td className="px-3 py-2">
                            {pctCell(data.managers_total.sold, data.managers_total.sold_pct)}
                          </td>
                        </tr>
                      ) : null}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
