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
const BRAND_COLORS: Record<string, string> = {
  "Ganjina Zamiri": "#0ea5e9",
  MetodiClinic: "#f59e0b",
};

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
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string; payload?: { name?: string } }>;
  label?: string;
  money?: boolean;
  currency?: string;
}) {
  if (!active || !payload?.length) return null;
  const title = String(payload[0]?.payload?.name || label || "");
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
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function MarketingCharts({ campaigns, brands, daily, managers, currency }: Props) {
  const spendRows = [...campaigns]
    .sort((a, b) => Number(b.spend) - Number(a.spend))
    .slice(0, 8)
    .map((c) => ({
      name: shortLabel(c.campaign_name, 16),
      full: c.campaign_name,
      spend: Number(c.spend) || 0,
    }));

  const leadShare = campaigns
    .map((c) => ({ name: shortLabel(c.campaign_name, 18), value: c.leads || 0 }))
    .filter((r) => r.value > 0);

  const brandFollow = brands.map((b) => ({
    name: b.account,
    followers: b.followers || 0,
    leads: b.leads || 0,
    spend: Number(b.spend) || 0,
    fill: BRAND_COLORS[b.account] || COLORS[0],
  }));

  const dailyRows = daily.map((d) => ({
    name: d.date.slice(5),
    date: d.date,
    spend: Number(d.spend) || 0,
    leads: d.leads || 0,
    followers: d.followers || 0,
  }));

  const managerRows = managers.map((m) => ({
    name: shortLabel(m.manager_name, 12),
    full: m.manager_name,
    received: m.received,
    answered: m.answered,
    rejected: m.rejected,
    sold: m.sold,
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
        <div className="h-52 sm:h-56">
          {spendRows.length === 0 ? (
            <p className="text-sm mo-muted">Нет данных</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spendRows} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--mo-border)" opacity={0.5} />
                <XAxis type="number" tick={tick} />
                <YAxis type="category" dataKey="name" width={88} tick={tick} />
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
        <div className="h-52 sm:h-56">
          {leadShare.length === 0 ? (
            <p className="text-sm mo-muted">Нет лидов</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={leadShare}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={78}
                  paddingAngle={2}
                >
                  {leadShare.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip cursor={false} content={<ChartTip />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="mkt-chart-card">
        <h3 className="mb-2 text-sm font-semibold">Подписчики по аккаунтам</h3>
        <div className="h-52 sm:h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={brandFollow} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--mo-border)" opacity={0.5} />
              <XAxis dataKey="name" tick={tick} />
              <YAxis tick={tick} width={36} allowDecimals={false} />
              <Tooltip cursor={false} content={<ChartTip />} />
              <Legend />
              <Bar dataKey="followers" name="Подписчики" radius={[6, 6, 0, 0]}>
                {brandFollow.map((r) => (
                  <Cell key={r.name} fill={r.fill} />
                ))}
              </Bar>
              <Bar dataKey="leads" name="Лиды" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mkt-chart-card">
        <h3 className="mb-2 text-sm font-semibold">Конверсия менеджеров</h3>
        <div className="h-52 sm:h-56">
          {managerRows.length === 0 ? (
            <p className="text-sm mo-muted">Нет лидов в CRM</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={managerRows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--mo-border)" opacity={0.5} />
                <XAxis dataKey="name" tick={tick} />
                <YAxis tick={tick} width={32} allowDecimals={false} />
                <Tooltip cursor={false} content={<ChartTip />} />
                <Legend />
                <Bar dataKey="answered" name="Ответили" stackId="a" fill="#0ea5e9" />
                <Bar dataKey="sold" name="Продали" stackId="a" fill="#10b981" />
                <Bar dataKey="rejected" name="Отказ" stackId="a" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>
    </div>
  );
}
