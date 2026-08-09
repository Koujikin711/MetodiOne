import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import { useCurrentUserMe } from "@/hooks/useCurrentUserMe";
import { formatMoney } from "@/lib/money";
import type {
  FinanceDdsReport,
  FinanceIntegrateResult,
  FinanceIntegrationStatus,
  FinanceOpiuReport,
  FinanceOsvSummary,
  FinanceSettings,
} from "@/lib/types";

type FinanceTab = "osv" | "dds" | "opiu";

const TABS: { id: FinanceTab; label: string; hint: string }[] = [
  { id: "osv", label: "ОСВ", hint: "Операционная таблица" },
  { id: "dds", label: "ДДС", hint: "Движение денежных средств" },
  { id: "opiu", label: "ОПиУ", hint: "Отчёт о прибылях и убытках" },
];

function money(n: string | number | null | undefined): string {
  return formatMoney(n, { digits: 0 });
}

function pct(n: string | number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

export function FinancePage() {
  const qc = useQueryClient();
  const role = decodeRoleFromToken(getStoredToken());
  const meQuery = useCurrentUserMe();
  const isChiefExpert = role === "expert" && Boolean(meQuery.data?.is_chief_expert);
  const canIntegrate =
    role === "owner" ||
    role === "admin" ||
    role === "super_owner" ||
    role === "accountant" ||
    isChiefExpert;
  const year = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(year);
  const [tab, setTab] = useState<FinanceTab>("osv");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetName, setSheetName] = useState("");

  const settingsQuery = useQuery({
    queryKey: ["finance-settings"],
    queryFn: () => apiFetch<FinanceSettings>("/api/finance/settings"),
    enabled: canIntegrate,
  });

  const statusQuery = useQuery({
    queryKey: ["finance-integration-status"],
    queryFn: () => apiFetch<FinanceIntegrationStatus>("/api/finance/integration-status"),
  });

  const osvQuery = useQuery({
    queryKey: ["finance-osv", selectedYear],
    queryFn: () => apiFetch<FinanceOsvSummary>(`/api/finance/osv?year=${selectedYear}&limit=1000`),
  });

  const ddsQuery = useQuery({
    queryKey: ["finance-dds", selectedYear],
    queryFn: () => apiFetch<FinanceDdsReport>(`/api/finance/reports/dds?year=${selectedYear}`),
    enabled: tab === "dds",
  });

  const opiuQuery = useQuery({
    queryKey: ["finance-opiu", selectedYear],
    queryFn: () => apiFetch<FinanceOpiuReport>(`/api/finance/reports/opiu?year=${selectedYear}`),
    enabled: tab === "opiu",
  });

  const integrateMutation = useMutation({
    mutationFn: () => apiFetch<FinanceIntegrateResult>("/api/finance/integrate", { method: "POST" }),
    onSuccess: (res) => {
      toast.success(res.message);
      void qc.invalidateQueries({ queryKey: ["finance-integration-status"] });
      void qc.invalidateQueries({ queryKey: ["finance-settings"] });
      void qc.invalidateQueries({ queryKey: ["finance-osv"] });
      void qc.invalidateQueries({ queryKey: ["finance-dds"] });
      void qc.invalidateQueries({ queryKey: ["finance-opiu"] });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось выполнить интеграцию"),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: (body: { osv_sheet_url: string; osv_sheet_name: string }) =>
      apiFetch<FinanceSettings>("/api/finance/settings", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => {
      setSheetUrl(res.osv_sheet_url ?? "");
      setSheetName(res.osv_sheet_name ?? "");
      toast.success("Таблица ОСВ сохранена. Запускаем синхронизацию…");
      void qc.invalidateQueries({ queryKey: ["finance-settings"] });
      void qc.invalidateQueries({ queryKey: ["finance-integration-status"] });
      integrateMutation.mutate();
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось сохранить настройки"),
  });

  const years = useMemo(() => [year, year - 1, year - 2], [year]);

  const settingsLoaded = settingsQuery.data;
  const settingsUrl = settingsLoaded?.osv_sheet_url ?? "";
  const settingsTab = settingsLoaded?.osv_sheet_name ?? "";
  const formUrl = sheetUrl || settingsUrl;
  const formName = sheetName || settingsTab;

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="lux-heading text-2xl sm:text-3xl">Финансы</h1>
          <p className="mt-1 max-w-2xl text-sm mo-muted">
            Укажите ссылку на Google-таблицу с листом ОСВ — система сама читает её и обновляет отчёты. ДДС и ОПиУ
            строятся автоматически.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="mo-input text-sm"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {canIntegrate ? (
            <button
              type="button"
              onClick={() => integrateMutation.mutate()}
              disabled={integrateMutation.isPending}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-60"
            >
              {integrateMutation.isPending ? "Интеграция…" : "Интегрировать"}
            </button>
          ) : null}
        </div>
      </div>

      {canIntegrate ? (
        <div className="finance-panel">
          <h2 className="lux-subheading">Google Таблица ОСВ</h2>
          <p className="mt-1 text-xs mo-muted">
            Вставьте ссылку на вашу таблицу с колонками Дата, Выручка, Расход, Банк, Статья и т.д. Расшарьте таблицу
            на сервисный аккаунт CRM
            {settingsQuery.data?.service_account_email ? (
              <>
                : <span className="font-mono text-[11px]">{settingsQuery.data.service_account_email}</span>
              </>
            ) : (
              " (email настраивается администратором сервера)"
            )}
            . Синхронизация идёт автоматически каждые несколько минут.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <label className="block text-xs mo-muted">
              URL таблицы
              <input
                value={formUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="mo-input mt-1 w-full text-sm"
              />
            </label>
            <label className="block text-xs mo-muted">
              Лист (необязательно)
              <input
                value={formName}
                onChange={(e) => setSheetName(e.target.value)}
                placeholder="ОСВ"
                className="mo-input mt-1 w-full text-sm sm:w-36"
              />
            </label>
            <button
              type="button"
              disabled={saveSettingsMutation.isPending || !formUrl.trim()}
              onClick={() =>
                saveSettingsMutation.mutate({
                  osv_sheet_url: formUrl.trim(),
                  osv_sheet_name: formName.trim(),
                })
              }
              className="btn-primary px-4 py-2 text-sm disabled:opacity-60"
            >
              {saveSettingsMutation.isPending ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
          {!settingsQuery.data?.google_sheets_ready ? (
            <p className="finance-warning mt-2">
              Google Sheets на сервере ещё не настроен — обратитесь к администратору.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="finance-stat-card finance-stat-card--emerald">
          <div className="finance-stat-label">Строк в ОСВ</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--mo-text)]">
            {statusQuery.data?.osv_rows_count ?? "—"}
          </div>
        </div>
        <div className="finance-stat-card finance-stat-card--violet">
          <div className="finance-stat-label">Google Sheets</div>
          <div className="mt-1 text-sm font-medium text-[var(--mo-text)]">
            {statusQuery.data?.sheets_connected
              ? statusQuery.data.osv_sheet_name || "Подключена"
              : "Не указана"}
          </div>
          {statusQuery.data?.last_sync_at ? (
            <div className="mt-1 text-[11px] mo-muted">
              Обновлено: {new Date(statusQuery.data.last_sync_at).toLocaleString("ru-RU")}
            </div>
          ) : null}
        </div>
        <div className="finance-stat-card finance-stat-card--sky">
          <div className="finance-stat-label">Gmail</div>
          <div className="mt-1 text-sm font-medium text-[var(--mo-text)]">
            {statusQuery.data?.gmail_connected
              ? statusQuery.data.gmail_email || "Подключён"
              : "Не подключён"}
          </div>
          {!statusQuery.data?.gmail_connected ? (
            <Link to="/integrations" className="mt-1 inline-block text-xs text-[var(--mo-accent-hover)] hover:underline">
              Подключить в интеграциях →
            </Link>
          ) : null}
        </div>
        <div className="finance-stat-card finance-stat-card--amber">
          <div className="finance-stat-label">Выручка / расход (год)</div>
          <div className="mt-1 text-sm tabular-nums">
            <span className="font-semibold finance-revenue-total">{money(osvQuery.data?.revenue_total)}</span>
            <span className="mo-muted"> / </span>
            <span className="font-semibold finance-expense-total">{money(osvQuery.data?.expense_total)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[var(--mo-border)] pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={["finance-tab-btn", tab === t.id ? "is-active" : ""].join(" ")}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "osv" && (
        <OsvTable loading={osvQuery.isLoading} data={osvQuery.data} />
      )}
      {tab === "dds" && (
        <DdsTable loading={ddsQuery.isLoading} data={ddsQuery.data} />
      )}
      {tab === "opiu" && (
        <OpiuTable loading={opiuQuery.isLoading} data={opiuQuery.data} />
      )}
    </div>
  );
}

function OsvTable({ loading, data }: { loading: boolean; data?: FinanceOsvSummary }) {
  if (loading) return <p className="text-sm mo-muted">Загрузка ОСВ…</p>;
  const rows = data?.rows ?? [];
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--mo-border)] p-10 text-center">
        <p className="text-sm mo-muted">
          ОСВ пуста. Укажите ссылку на Google-таблицу выше — данные подтянутся автоматически.
        </p>
      </div>
    );
  }
  return (
    <div className="finance-table-wrap">
      <table className="min-w-[1200px] w-full text-left text-xs sm:text-sm">
        <thead>
          <tr className="finance-table-head--osv">
            {[
              "Дата",
              "Выручка",
              "Расход",
              "Банк",
              "Основание",
              "Контрагент",
              "Телефон",
              "Чрз",
              "Товар/услуга",
              "Статья",
              "Подробно",
              "Кратко",
            ].map((h) => (
              <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold sm:px-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="finance-table-row">
              <td className="whitespace-nowrap px-2 py-1.5 sm:px-3">{r.txn_date}</td>
              <td className="finance-table-cell-revenue whitespace-nowrap px-2 py-1.5 tabular-nums sm:px-3">
                {Number(r.revenue) > 0 ? money(r.revenue) : ""}
              </td>
              <td className="finance-table-cell-expense whitespace-nowrap px-2 py-1.5 tabular-nums sm:px-3">
                {Number(r.expense) > 0 ? money(r.expense) : ""}
              </td>
              <td className="px-2 py-1.5 sm:px-3">{r.bank || "—"}</td>
              <td className="max-w-[180px] truncate px-2 py-1.5 sm:px-3" title={r.basis || ""}>
                {r.basis || "—"}
              </td>
              <td className="px-2 py-1.5 sm:px-3">{r.counterparty || "—"}</td>
              <td className="px-2 py-1.5 sm:px-3">{r.phone || "—"}</td>
              <td className="px-2 py-1.5 sm:px-3">{r.via_person || "—"}</td>
              <td className="px-2 py-1.5 sm:px-3">{r.product_service || "—"}</td>
              <td className="px-2 py-1.5 sm:px-3">{r.article || "—"}</td>
              <td className="px-2 py-1.5 sm:px-3">{r.detail_category || "—"}</td>
              <td className="px-2 py-1.5 sm:px-3">{r.brief_category || "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="finance-table-foot">
            <td className="px-3 py-2">Итого</td>
            <td className="finance-revenue-total px-3 py-2 tabular-nums">{money(data?.revenue_total)}</td>
            <td className="finance-expense-total px-3 py-2 tabular-nums">{money(data?.expense_total)}</td>
            <td colSpan={9} className="px-3 py-2 tabular-nums">
              Остаток: {money(data?.balance)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DdsTable({ loading, data }: { loading: boolean; data?: FinanceDdsReport }) {
  if (loading) return <p className="text-sm mo-muted">Построение ДДС…</p>;
  if (!data) return null;
  const months = data.month_labels;
  return (
    <div className="finance-table-wrap">
      <table className="min-w-[1100px] w-full text-left text-xs sm:text-sm">
        <thead>
          <tr className="finance-table-head--navy">
            <th className="finance-table-head--navy sticky left-0 z-10 min-w-[220px] px-3 py-2">Категория</th>
            {months.map((m) => (
              <th key={m} className="whitespace-nowrap px-2 py-2 text-right">
                {m.replace(` ${data.year}`, "")}
              </th>
            ))}
            <th className="px-3 py-2 text-right">ИТОГ</th>
          </tr>
        </thead>
        <tbody>
          <ReportAmountRow label="Остаток на начало месяца" values={data.opening_balance} kind="total" />
          {data.sections.flatMap((sec) => [
            <tr key={`${sec.key}-head`} className="finance-table-head--navy">
              <td colSpan={months.length + 2} className="px-3 py-2 text-sm font-bold uppercase tracking-wide">
                {sec.label}
              </td>
            </tr>,
            ...sec.groups.flatMap((grp) => [
              <tr key={`${sec.key}-${grp.key}-head`} className="finance-section-head">
                <td colSpan={months.length + 2} className="px-3 py-1.5 font-semibold">
                  {grp.label}
                </td>
              </tr>,
              ...grp.rows.map((row) => (
                <ReportAmountRow key={row.key} label={row.label} values={row.values} total={row.total} />
              )),
            ]),
          ])}
          <ReportAmountRow label="ОСТАТОК НА КОНЕЦ МЕСЯЦА" values={data.closing_balance} kind="total" />
        </tbody>
      </table>
    </div>
  );
}

function OpiuTable({ loading, data }: { loading: boolean; data?: FinanceOpiuReport }) {
  if (loading) return <p className="text-sm mo-muted">Построение ОПиУ…</p>;
  if (!data) return null;
  return (
    <div className="finance-table-wrap">
      <table className="min-w-[1100px] w-full text-left text-xs sm:text-sm">
        <thead>
          <tr className="finance-table-head--navy">
            <th className="finance-table-head--navy sticky left-0 z-10 min-w-[240px] px-3 py-2">Статья / Месяц</th>
            {data.month_labels.map((m) => (
              <th key={m} className="whitespace-nowrap px-2 py-2 text-right">
                {m.split(" ")[0]}
              </th>
            ))}
            <th className="px-3 py-2 text-right">ИТОГО</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr
              key={row.key}
              className={[
                "finance-table-row",
                row.bold ? "finance-table-foot font-bold" : "",
              ].join(" ")}
            >
              <td className="sticky left-0 bg-inherit px-3 py-1.5">{row.label}</td>
              {row.values.map((v, i) => (
                <td key={i} className="px-2 py-1.5 text-right tabular-nums">
                  {row.key === "margin_pct" ? pct(v) : money(v)}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                {row.key === "margin_pct" ? pct(row.total) : money(row.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportAmountRow({
  label,
  values,
  total,
  kind,
}: {
  label: string;
  values: (string | number)[];
  total?: string | number;
  kind?: "total";
}) {
  const sum = total ?? values.reduce((a, b) => Number(a) + Number(b), 0);
  return (
    <tr
      className={[
        "finance-table-row",
        kind === "total" ? "finance-table-head--navy font-bold text-white" : "",
      ].join(" ")}
    >
      <td
        className={[
          "sticky left-0 px-3 py-1.5",
          kind === "total" ? "finance-table-head--navy" : "bg-inherit",
        ].join(" ")}
      >
        {label}
      </td>
      {values.map((v, i) => (
        <td key={i} className="px-2 py-1.5 text-right tabular-nums">
          {money(v)}
        </td>
      ))}
      <td className="px-3 py-1.5 text-right tabular-nums">{money(sum)}</td>
    </tr>
  );
}
