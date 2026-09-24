import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { MonthYearPicker } from "@/components/MonthYearPicker";
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
  spend: string | number;
  impressions: number;
  clicks: number;
  leads: number;
  cpc?: string | number | null;
  ctr?: string | number | null;
  cost_per_lead?: string | number | null;
};

type Overview = {
  period_start: string;
  period_end: string;
  currency: string;
  account_name?: string | null;
  ad_account_id: string;
  spend: string | number;
  impressions: number;
  clicks: number;
  leads: number;
  messaging_connections: number;
  cost_per_lead?: string | number | null;
  campaigns: CampaignRow[];
};

function defaultYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function money(v: number | string | null | undefined, currency = "USD") {
  const n = Number(v || 0);
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${currency}`;
}

export function MarketingPage() {
  const qc = useQueryClient();
  const [yearMonth, setYearMonth] = useState(defaultYearMonth);
  const [adAccountId, setAdAccountId] = useState("act_1442491974027857");
  const [accessToken, setAccessToken] = useState("");

  const settingsQuery = useQuery({
    queryKey: ["marketing-meta-settings"],
    queryFn: () => apiFetch<MetaSettings>("/api/marketing/meta/settings"),
  });

  const overviewQuery = useQuery({
    queryKey: ["marketing-meta-overview", yearMonth],
    queryFn: () =>
      apiFetch<Overview>(`/api/marketing/meta/overview?year_month=${encodeURIComponent(yearMonth)}`, {
        timeoutMs: 60_000,
      }),
    enabled: Boolean(settingsQuery.data?.configured),
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
      void qc.invalidateQueries({ queryKey: ["marketing-meta-settings"] });
      void qc.invalidateQueries({ queryKey: ["marketing-meta-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data = overviewQuery.data;
  const currency = data?.currency || settingsQuery.data?.currency || "USD";

  const settingsHint = useMemo(() => {
    if (!settingsQuery.data) return null;
    if (settingsQuery.data.configured) {
      return `${settingsQuery.data.account_name || "Meta"} · ${settingsQuery.data.ad_account_id}`;
    }
    return "Нужны ad account и токен System User";
  }, [settingsQuery.data]);

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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <PageHeader
        title="Маркетинг"
        description="Meta Ads: расход, лиды и кампании за месяц. WhatsApp по-прежнему через Green API."
      />

      <form onSubmit={onSave} className="mo-section space-y-3 p-4">
        <h2 className="text-sm font-semibold text-[var(--mo-text)]">Подключение Meta Ads</h2>
        <p className="text-xs mo-muted">{settingsHint}</p>
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

      <div className="flex flex-wrap items-end gap-3">
        <MonthYearPicker value={yearMonth} onChange={setYearMonth} />
      </div>

      {!settingsQuery.data?.configured ? (
        <p className="text-sm mo-muted">Сохраните токен выше — появится сводка по кабинету Metodi.</p>
      ) : overviewQuery.isLoading ? (
        <p className="text-sm mo-muted">Загрузка из Meta…</p>
      ) : overviewQuery.isError ? (
        <p className="text-sm text-red-400">{(overviewQuery.error as Error).message}</p>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-[var(--mo-border)] p-4">
              <div className="text-xs mo-muted">Расход</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{money(data.spend, currency)}</div>
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] p-4">
              <div className="text-xs mo-muted">Лиды</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{data.leads}</div>
              <div className="mt-1 text-[11px] mo-muted">
                CPL {data.cost_per_lead != null ? money(data.cost_per_lead, currency) : "—"}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] p-4">
              <div className="text-xs mo-muted">Показы / клики</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {Number(data.impressions).toLocaleString("ru-RU")}
              </div>
              <div className="mt-1 text-[11px] mo-muted">
                клики {Number(data.clicks).toLocaleString("ru-RU")}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--mo-border)] p-4">
              <div className="text-xs mo-muted">Переписки (messaging)</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{data.messaging_connections}</div>
              <div className="mt-1 text-[11px] mo-muted">
                {data.period_start} — {data.period_end}
              </div>
            </div>
          </div>

          <section className="overflow-hidden rounded-2xl border border-[var(--mo-border)]">
            <div className="border-b border-[var(--mo-border)] px-4 py-3 text-sm font-semibold">
              Кампании · {data.account_name || data.ad_account_id}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--mo-surface)]/70 text-xs mo-muted">
                  <tr>
                    <th className="px-3 py-2">Кампания</th>
                    <th className="px-3 py-2">Расход</th>
                    <th className="px-3 py-2">Лиды</th>
                    <th className="px-3 py-2">CPL</th>
                    <th className="px-3 py-2">Клики</th>
                    <th className="px-3 py-2">Показы</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 mo-muted" colSpan={6}>
                        Нет данных за месяц
                      </td>
                    </tr>
                  ) : (
                    data.campaigns.map((c) => (
                      <tr key={c.campaign_id || c.campaign_name} className="border-t border-[var(--mo-border)]/60">
                        <td className="px-3 py-2">{c.campaign_name}</td>
                        <td className="px-3 py-2 tabular-nums">{money(c.spend, currency)}</td>
                        <td className="px-3 py-2 tabular-nums">{c.leads}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {c.cost_per_lead != null ? money(c.cost_per_lead, currency) : "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{c.clicks}</td>
                        <td className="px-3 py-2 tabular-nums">{c.impressions}</td>
                      </tr>
                    ))
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
