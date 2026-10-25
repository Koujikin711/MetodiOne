import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#6366f1"];

const tick = { fill: "var(--mo-text-muted, #64748b)", fontSize: 11 };

type Campaign = {
  campaign_name: string;
  brand?: string | null;
  spend: string | number;
  leads: number;
  followers?: number;
};

type Brand = {
  account: string;
  followers: number;
  leads: number;
  spend: string | number;
};

type Daily = {
  date: string;
  spend: string | number;
  leads: number;
  followers: number;
};

type Manager = {
  manager_name: string;
  received: number;
  answered: number;
  rejected: number;
  sold: number;
};

type Props = {
  campaigns: Campaign[];
  brands: Brand[];
  daily: Daily[];
  managers: Manager[];
  currency: string;
};

function ChartTip({
  active,
  payload,
  label,
  money,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string; payload?: { name?: string; full?: string } }>;
  label?: string;
  money?: boolean;
  currency?: string;
}) {
  if (!active || !payload?.length) return null;
  const title = String(payload[0]?.payload?.full || payload[0]?.payload?.name || label || "");
  return (
    <div className="mo-chart-tip">
      {title ? <div className="mo-chart-tip__title">{title}</div> : null}
      {payload.map((row, i) => {
        const raw = Number(row.value ?? 0);
        const asMoney = Boolean(money || row.dataKey === "spend");
        return (
          <div key={`${row.dataKey || row.name || i}`} className="mo-chart-tip__row">
            <span className="mo-chart-tip__dot" style={{ background: row.color || "var(--mo-accent)" }} />
            <span className="min-w-0 truncate">{row.name || row.dataKey}</span>
            <span className="tabular-nums font-semibold">
              {asMoney && Number.isFinite(raw)
                ? `${raw.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${currency || "USD"}`
                : String(row.value ?? "—")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function shortLabel(s: string, n = 14) {
  const t = (s || "").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

function NameTick({ x, y, payload }: { x?: number; y?: number; payload?: { value?: string } }) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="var(--mo-text-muted, #64748b)" fontSize={11}>
      {payload?.value ?? ""}
    </text>
  );
}

function AccountBars({ brands }: { brands: Brand[] }) {
  const rows = brands.map((b) => ({
    name: b.account,
    followers: b.followers || 0,
    leads: b.leads || 0,
  }));
  const max = Math.max(1, ...rows.flatMap((row) => [row.followers, row.leads]));
  const has = rows.some((row) => row.followers > 0 || row.leads > 0);
  return (
    <section className="mkt-chart-card mkt-modern">
      <div className="mkt-modern__head">
        <h3>Новые подписчики по аккаунтам</h3>
        <div className="mkt-modern__legend">
          <span><i className="is-followers" /> Подписчики</span>
          <span><i className="is-leads" /> Лиды</span>
        </div>
      </div>
      {!has ? (
        <p className="text-sm mo-muted">Нет данных</p>
      ) : (
        <ul className="mkt-modern__accounts">
          {rows.map((row) => (
            <li key={row.name}>
              <div className="mkt-modern__account-name">{row.name}</div>
              <Meter value={row.followers} max={max} kind="followers" />
              <Meter value={row.leads} max={max} kind="leads" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Meter({ value, max, kind }: { value: number; max: number; kind: "followers" | "leads" }) {
  const width = value <= 0 ? 0 : Math.max(4, Math.round((value / max) * 100));
  return (
    <div className="mkt-modern__meter">
      <div className="mkt-modern__meter-track">
        <div className={`mkt-modern__fill is-${kind}`} style={{ width: `${width}%` }} />
      </div>
      <span className="mkt-modern__num">{value.toLocaleString("ru-RU")}</span>
    </div>
  );
}

function ManagerBars({ managers }: { managers: Manager[] }) {
  const rows = managers
    .map((m) => ({
      name: m.manager_name,
      answered: m.answered || 0,
      sold: m.sold || 0,
      rejected: m.rejected || 0,
    }))
    .map((row) => ({ ...row, sum: row.answered + row.sold + row.rejected }))
    .filter((row) => row.sum > 0);
  const max = Math.max(1, ...rows.map((row) => row.sum));
  return (
    <section className="mkt-chart-card mkt-modern">
      <div className="mkt-modern__head">
        <h3>Конверсия менеджеров</h3>
        <div className="mkt-modern__legend">
          <span><i className="is-answered" /> Ответили</span>
          <span><i className="is-sold" /> Продали</span>
          <span><i className="is-rejected" /> Отказ</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm mo-muted">За период ответов и продаж с рекламы нет</p>
      ) : (
        <ul className="mkt-modern__people">
          {rows.map((row) => (
            <li key={row.name}>
              <span className="mkt-modern__who" title={row.name}>{row.name}</span>
              <span className="mkt-modern__track" aria-hidden>
                <span className="mkt-modern__stack" style={{ width: `${Math.max(8, (row.sum / max) * 100)}%` }}>
                  {row.answered > 0 ? <span className="is-answered" style={{ flex: row.answered }} /> : null}
                  {row.sold > 0 ? <span className="is-sold" style={{ flex: row.sold }} /> : null}
                  {row.rejected > 0 ? <span className="is-rejected" style={{ flex: row.rejected }} /> : null}
                </span>
              </span>
              <span className="mkt-modern__sum">{row.sum.toLocaleString("ru-RU")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MarketingCharts({ campaigns, brands, daily, managers, currency }: Props) {
  const spendRows = [...campaigns]
    .sort((a, b) => Number(b.spend) - Number(a.spend))
    .slice(0, 8)
    .map((c) => ({
      name: shortLabel(c.campaign_name, 18),
      full: c.campaign_name,
      spend: Number(c.spend) || 0,
    }));

  const leadShare = campaigns
    .map((c) => ({ name: c.campaign_name, value: c.leads || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const dailyRows = daily.map((d) => ({
    name: d.date.slice(5),
    date: d.date,
    spend: Number(d.spend) || 0,
    leads: d.leads || 0,
    followers: d.followers || 0,
  }));

  return (
    <div className="mkt-charts-grid">
      {dailyRows.length > 1 ? (
        <section className="mkt-chart-card lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold">Динамика · расход и лиды</h3>
          <div className="h-52 sm:h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="mktSpend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="mktLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--mo-border)" opacity={0.5} />
                <XAxis dataKey="name" tick={tick} />
                <YAxis yAxisId="left" tick={tick} width={40} />
                <YAxis yAxisId="right" orientation="right" tick={tick} width={36} />
                <Tooltip cursor={false} content={<ChartTip currency={currency} />} />
                <Legend />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="spend"
                  name="Расход"
                  stroke="#0ea5e9"
                  fill="url(#mktSpend)"
                  strokeWidth={2}
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="leads"
                  name="Лиды"
                  stroke="#10b981"
                  fill="url(#mktLeads)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      <section className="mkt-chart-card">
        <h3 className="mb-2 text-sm font-semibold">Расход по кампаниям</h3>
        <div style={{ height: Math.max(220, spendRows.length * 36 + 28) }}>
          {spendRows.length === 0 ? (
            <p className="text-sm mo-muted">Нет данных</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spendRows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--mo-border)" opacity={0.5} />
                <XAxis type="number" tick={tick} />
                <YAxis type="category" dataKey="name" width={132} tick={<NameTick />} interval={0} />
                <Tooltip cursor={false} content={<ChartTip money currency={currency} />} />
                <Bar dataKey="spend" name="Расход" radius={[0, 6, 6, 0]}>
                  {spendRows.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="mkt-chart-card">
        <h3 className="mb-2 text-sm font-semibold">Лиды по кампаниям</h3>
        {leadShare.length === 0 ? (
          <p className="text-sm mo-muted">Нет лидов</p>
        ) : (
          <>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={leadShare} dataKey="value" nameKey="name" innerRadius={46} outerRadius={72} paddingAngle={2}>
                    {leadShare.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip cursor={false} content={<ChartTip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mkt-pie-legend">
              {leadShare.map((row, i) => (
                <li key={row.name}>
                  <span className="mkt-pie-legend__dot" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="min-w-0 truncate">{row.name}</span>
                  <span className="tabular-nums">{row.value.toLocaleString("ru-RU")}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <AccountBars brands={brands} />
      <ManagerBars managers={managers} />
    </div>
  );
}
