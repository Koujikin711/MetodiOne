import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

import { DateTimeField } from "@/components/DateTimeField";
import { apiDownloadBlob, apiFetch, setActiveCompanyId, setStoredToken } from "@/lib/api";
import type {
  PendingPaymentCompanyRead,
  PlatformBillingSettingsRead,
  PlatformDashboardRead,
  SuperOwnerAuditRead,
  SuperOwnerCompanyRead,
  TariffPlanRead,
  TokenResponse,
} from "@/lib/types";

function applyTariffPatchBody(
  draftUsers: string,
  draftIntegrations: string,
): Record<string, number | null> | null {
  const body: Record<string, number | null> = {};
  const tu = draftUsers.trim();
  if (tu !== "") {
    const n = Number(tu);
    if (!Number.isFinite(n) || n < 0) return null;
    body.tariff_max_active_users = n;
  }
  const ti = draftIntegrations.trim();
  if (ti !== "") {
    const n = Number(ti);
    if (!Number.isFinite(n) || n < 0) return null;
    body.tariff_max_integrations = n;
  }
  return Object.keys(body).length ? body : null;
}

export function CompaniesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [externalDbDsn, setExternalDbDsn] = useState("");
  const [tariffCompany, setTariffCompany] = useState<SuperOwnerCompanyRead | null>(null);
  const [tariffUsersDraft, setTariffUsersDraft] = useState("");
  const [tariffIntsDraft, setTariffIntsDraft] = useState("");
  const [createTariffPlanId, setCreateTariffPlanId] = useState<number | "">("");
  const [createBillingDiscount, setCreateBillingDiscount] = useState("");
  const [billingDiscountDraft, setBillingDiscountDraft] = useState("");
  const [demoDaysDraft, setDemoDaysDraft] = useState("14");
  const [scheduleCompany, setScheduleCompany] = useState<SuperOwnerCompanyRead | null>(null);
  const [schedulePlanDraft, setSchedulePlanDraft] = useState<number | "">("");
  const [scheduleAtDraft, setScheduleAtDraft] = useState("");

  useEffect(() => {
    if (!tariffCompany) return;
    setTariffUsersDraft(
      tariffCompany.tariff_max_active_users == null ? "" : String(tariffCompany.tariff_max_active_users),
    );
    setTariffIntsDraft(
      tariffCompany.tariff_max_integrations == null ? "" : String(tariffCompany.tariff_max_integrations),
    );
    setBillingDiscountDraft(
      tariffCompany.billing_discount_percent == null ? "" : String(tariffCompany.billing_discount_percent),
    );
  }, [tariffCompany]);

  function isoToDatetimeLocal(iso: string | null | undefined): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  useEffect(() => {
    if (!scheduleCompany) return;
    setSchedulePlanDraft(scheduleCompany.scheduled_tariff_plan_id ?? "");
    setScheduleAtDraft(isoToDatetimeLocal(scheduleCompany.scheduled_tariff_effective_at));
  }, [scheduleCompany]);

  const dashboardQuery = useQuery({
    queryKey: ["companies", "dashboard"],
    queryFn: () => apiFetch<PlatformDashboardRead>("/api/companies/dashboard"),
  });

  const auditQuery = useQuery({
    queryKey: ["companies", "audit"],
    queryFn: () => apiFetch<SuperOwnerAuditRead[]>("/api/companies/audit-log?limit=60"),
  });

  const companiesQuery = useQuery({
    queryKey: ["companies"],
    queryFn: () => apiFetch<SuperOwnerCompanyRead[]>("/api/companies"),
  });

  const plansQuery = useQuery({
    queryKey: ["tariff-plans"],
    queryFn: () => apiFetch<TariffPlanRead[]>("/api/tariff-plans"),
  });

  const platformBillingQuery = useQuery({
    queryKey: ["billing", "platform-settings"],
    queryFn: () => apiFetch<PlatformBillingSettingsRead>("/api/billing/platform-settings"),
  });

  useEffect(() => {
    const d = platformBillingQuery.data?.demo_trial_days;
    if (d != null) setDemoDaysDraft(String(d));
  }, [platformBillingQuery.data?.demo_trial_days]);

  const platformBillingMutation = useMutation({
    mutationFn: (demo_trial_days: number) =>
      apiFetch<PlatformBillingSettingsRead>("/api/billing/platform-settings", {
        method: "PATCH",
        body: JSON.stringify({ demo_trial_days }),
      }),
    onSuccess: () => {
      void platformBillingQuery.refetch();
      toast.success("Срок демо для новых заявок обновлён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingPaymentsQuery = useQuery({
    queryKey: ["billing", "pending-payments"],
    queryFn: () => apiFetch<PendingPaymentCompanyRead[]>("/api/billing/pending-payments"),
  });

  const confirmPaymentMutation = useMutation({
    mutationFn: (companyId: number) =>
      apiFetch<PendingPaymentCompanyRead>("/api/billing/confirm-payment", {
        method: "POST",
        body: JSON.stringify({ company_id: companyId }),
      }),
    onSuccess: () => {
      void pendingPaymentsQuery.refetch();
      void companiesQuery.refetch();
      void qc.invalidateQueries({ queryKey: ["billing-status"] });
      toast.success("Тариф включён, компания получила доступ");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignPlanMutation = useMutation({
    mutationFn: ({ companyId, planId }: { companyId: number; planId: number | null }) =>
      apiFetch<SuperOwnerCompanyRead>(`/api/companies/${companyId}/tariff-plan`, {
        method: "PATCH",
        body: JSON.stringify({ tariff_plan_id: planId }),
      }),
    onSuccess: () => {
      void companiesQuery.refetch();
      void qc.invalidateQueries({ queryKey: ["tariff-access"] });
      void qc.invalidateQueries({ queryKey: ["billing-status"] });
      void pendingPaymentsQuery.refetch();
      toast.success("Тариф компании обновлён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        name,
        owner_email: ownerEmail,
        owner_full_name: ownerName || null,
        external_db_dsn: externalDbDsn || null,
      };
      if (createTariffPlanId !== "") {
        payload.tariff_plan_id = createTariffPlanId;
      }
      return apiFetch<SuperOwnerCompanyRead>("/api/companies", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      setName("");
      setOwnerEmail("");
      setOwnerName("");
      setExternalDbDsn("");
      setCreateTariffPlanId("");
      setCreateBillingDiscount("");
      void companiesQuery.refetch();
      void dashboardQuery.refetch();
      void auditQuery.refetch();
      toast.success("Компания создана, доступ отправлен владельцу на email");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function finishTokenSwitch(res: TokenResponse, companyId: number) {
    setStoredToken(res.access_token);
    setActiveCompanyId(companyId);
    if (res.must_change_password === true) {
      navigate("/force-password", { replace: true });
      toast.success("Контекст переключён — задайте новый пароль");
      return;
    }
    navigate("/app", { replace: true });
    toast.success("Контекст компании переключён");
  }

  const switchMutation = useMutation({
    mutationFn: (companyId: number) =>
      apiFetch<TokenResponse>("/api/companies/switch", {
        method: "POST",
        body: JSON.stringify({ company_id: companyId }),
      }),
    onSuccess: (res, companyId) => finishTokenSwitch(res, companyId),
    onError: (e: Error) => toast.error(e.message),
  });

  const impersonateMutation = useMutation({
    mutationFn: (companyId: number) =>
      apiFetch<TokenResponse>(`/api/companies/${companyId}/impersonate-owner`, { method: "POST" }),
    onSuccess: (res, companyId) => finishTokenSwitch(res, companyId),
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ companyId, isActive }: { companyId: number; isActive: boolean }) =>
      apiFetch<SuperOwnerCompanyRead>(`/api/companies/${companyId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: isActive }),
      }),
    onSuccess: () => {
      void companiesQuery.refetch();
      void dashboardQuery.refetch();
      void auditQuery.refetch();
      toast.success("Статус компании обновлён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const billingDiscountMutation = useMutation({
    mutationFn: ({ companyId, percent }: { companyId: number; percent: number | null }) =>
      apiFetch<SuperOwnerCompanyRead>(`/api/companies/${companyId}/billing-discount`, {
        method: "PATCH",
        body: JSON.stringify({ billing_discount_percent: percent }),
      }),
    onSuccess: () => {
      void companiesQuery.refetch();
      toast.success("Скидка на подписку обновлена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tariffMutation = useMutation({
    mutationFn: ({ companyId, body }: { companyId: number; body: Record<string, number | null> }) =>
      apiFetch<SuperOwnerCompanyRead>(`/api/companies/${companyId}/tariff`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void companiesQuery.refetch();
      void auditQuery.refetch();
      setTariffCompany(null);
      toast.success("Лимиты тарифа обновлены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scheduledTariffMutation = useMutation({
    mutationFn: ({
      companyId,
      body,
    }: {
      companyId: number;
      body: { scheduled_tariff_plan_id: number | null; scheduled_tariff_effective_at: string | null };
    }) =>
      apiFetch<SuperOwnerCompanyRead>(`/api/companies/${companyId}/scheduled-tariff`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void companiesQuery.refetch();
      void auditQuery.refetch();
      void qc.invalidateQueries({ queryKey: ["tariff-access"] });
      void qc.invalidateQueries({ queryKey: ["billing-status"] });
      setScheduleCompany(null);
      toast.success("Отложенная смена тарифа сохранена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = dashboardQuery.data;

  return (
    <div className="relative mx-auto max-w-[1200px] space-y-6 pb-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--mo-text)]">Компании</h1>
        <p className="mt-1 text-sm lux-caption">
          Платформа: метрики, аудит, лимиты и вход в компанию или от имени владельца (поддержка)
        </p>
      </header>

      {dashboardQuery.isLoading && <p className="text-sm lux-caption">Загрузка сводки…</p>}
      {dashboardQuery.isError && (
        <p className="text-sm text-red-300">{(dashboardQuery.error as Error).message}</p>
      )}
      {d ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Компаний всего", String(d.companies_total)],
            ["Активных", String(d.companies_active)],
            ["Остановлено", String(d.companies_suspended)],
            ["Пользователей (в компаниях)", String(d.users_total)],
            ["Лидов всего", String(d.leads_total)],
            ["Воронок", String(d.pipelines_total)],
            ["Глоб. лимит пользов.", String(d.global_tariff_max_active_users)],
            ["Глоб. лимит интегр.", String(d.global_tariff_max_integrations)],
            ["Аудит за 7 дн.", String(d.recent_audit_count)],
            ["Сбоев фона (посл. события)", String(d.recent_background_failures)],
          ].map(([label, val]) => (
            <div
              key={label}
              className="mo-section px-4 py-3 shadow-inner backdrop-blur-sm"
            >
              <p className="text-xs uppercase tracking-wide mo-muted">{label}</p>
              <p className="mt-1 text-xl font-semibold text-[var(--mo-text)]">{val}</p>
            </div>
          ))}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            void apiDownloadBlob("/api/companies/incidents-export?hours=168", "metodione_incidents.csv").catch(
              (e: Error) => toast.error(e.message),
            )
          }
          className="rounded-xl crm-modal-panel border/50 px-4 py-2 text-sm text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]/70"
        >
          Экспорт инцидентов (CSV)
        </button>
        <button
          type="button"
          onClick={() => {
            void auditQuery.refetch();
            void dashboardQuery.refetch();
            void pendingPaymentsQuery.refetch();
            void platformBillingQuery.refetch();
          }}
          className="rounded-xl crm-modal-panel border/50 px-4 py-2 text-sm text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]/70"
        >
          Обновить сводку и аудит
        </button>
      </div>

      <section className="mo-section p-4 shadow-inner backdrop-blur-sm">
        <h2 className="lux-subheading">Демо и оплаты</h2>
        <p className="mt-1 text-xs lux-caption">
          Длительность автодемо с лендинга для новых компаний. Заявки на тариф после демо — подтвердите оплату и
          включите доступ.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm mo-muted">
            Дней демо (новые заявки с сайта)
            <input
              type="number"
              min={1}
              max={365}
              value={demoDaysDraft}
              onChange={(e) => setDemoDaysDraft(e.target.value)}
              className="mt-1 w-32 mo-input"
            />
          </label>
          <button
            type="button"
            disabled={platformBillingMutation.isPending}
            onClick={() => {
              const n = Number(demoDaysDraft);
              if (!Number.isFinite(n) || n < 1 || n > 365) {
                toast.error("Укажите число от 1 до 365");
                return;
              }
              platformBillingMutation.mutate(n);
            }}
            className="rounded-xl bg-indigo-600 px-4 py-2 lux-subheading text-sm hover:bg-indigo-500 disabled:opacity-50"
          >
            Сохранить срок демо
          </button>
        </div>
        {pendingPaymentsQuery.isLoading && <p className="mt-3 text-sm lux-caption">Загрузка заявок…</p>}
        {pendingPaymentsQuery.isError && (
          <p className="mt-3 text-sm text-red-300">{(pendingPaymentsQuery.error as Error).message}</p>
        )}
        {(pendingPaymentsQuery.data ?? []).length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--mo-border)]">
            <table className="w-full min-w-[520px] text-left text-xs mo-muted">
              <thead className="bg-white/90 lux-caption">
                <tr>
                  <th className="px-3 py-2 font-medium">Компания</th>
                  <th className="px-3 py-2 font-medium">Контакт</th>
                  <th className="px-3 py-2 font-medium">Выбранный тариф</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {(pendingPaymentsQuery.data ?? []).map((row) => (
                  <tr key={row.id} className="border-t border-[var(--mo-border)]">
                    <td className="px-3 py-2 font-medium text-[var(--mo-text)]">
                      {row.name} <span className="mo-muted">#{row.id}</span>
                    </td>
                    <td className="px-3 py-2">{row.contact_email ?? "—"}</td>
                    <td className="px-3 py-2 text-violet-200">{row.pending_tariff_plan_name ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={confirmPaymentMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Подтвердить оплату и включить тариф для «${row.name}»?`)) {
                            confirmPaymentMutation.mutate(row.id);
                          }
                        }}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-[var(--mo-text)] hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Оплата получена — включить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !pendingPaymentsQuery.isLoading && (
            <p className="mt-3 text-sm mo-muted">Нет компаний в ожидании оплаты.</p>
          )
        )}
      </section>

      <section className="rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-accent-soft)]/20 p-4">
        <h2 className="lux-subheading">Журнал действий super_owner</h2>
        {auditQuery.isLoading && <p className="mt-2 text-sm lux-caption">Загрузка…</p>}
        {auditQuery.isError && (
          <p className="mt-2 text-sm text-red-300">{(auditQuery.error as Error).message}</p>
        )}
        <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-[var(--mo-border)]">
          <table className="w-full min-w-[640px] text-left text-xs mo-muted">
            <thead className="sticky top-0 bg-white/95 lux-caption">
              <tr>
                <th className="px-3 py-2 font-medium">Время</th>
                <th className="px-3 py-2 font-medium">Действие</th>
                <th className="px-3 py-2 font-medium">Компания</th>
                <th className="px-3 py-2 font-medium">Актор</th>
                <th className="px-3 py-2 font-medium">Детали</th>
              </tr>
            </thead>
            <tbody>
              {(auditQuery.data ?? []).map((row) => (
                <tr key={row.id} className="border-t border-[var(--mo-border)] hover:bg-white">
                  <td className="whitespace-nowrap px-3 py-2 lux-caption">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-[var(--mo-text)]">{row.action}</td>
                  <td className="px-3 py-2">{row.company_id ?? "—"}</td>
                  <td className="px-3 py-2">{row.actor_user_id}</td>
                  <td className="max-w-[280px] truncate px-3 py-2 mo-muted" title={row.detail ?? ""}>
                    {row.detail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mo-section p-4 shadow-inner backdrop-blur-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] flex-1 text-sm mo-muted">
            Новая компания
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mo-input mt-1 w-full"
              placeholder="Название компании..."
            />
          </label>
          <label className="min-w-[220px] flex-1 text-sm mo-muted">
            Email владельца
            <input
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              className="mo-input mt-1 w-full"
              placeholder="owner@company.com"
              type="email"
            />
          </label>
          <label className="min-w-[220px] flex-1 text-sm mo-muted">
            ФИО владельца (опц.)
            <input
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="mo-input mt-1 w-full"
              placeholder="Иван Иванов"
            />
          </label>
          <label className="min-w-[220px] flex-1 text-sm mo-muted">
            Внешняя БД компании (опц.)
            <input
              value={externalDbDsn}
              onChange={(e) => setExternalDbDsn(e.target.value)}
              className="mo-input mt-1 w-full"
              placeholder="postgresql://..."
            />
          </label>
          <label className="min-w-[220px] flex-1 text-sm mo-muted">
            Тарифный план
            <select
              value={createTariffPlanId === "" ? "" : String(createTariffPlanId)}
              onChange={(e) => {
                const v = e.target.value;
                setCreateTariffPlanId(v === "" ? "" : Number(v));
              }}
              className="mo-input mt-1 w-full"
            >
              <option value="">Не назначать (все функции)</option>
              {(plansQuery.data ?? [])
                .filter((p) => p.is_active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="min-w-[140px] text-sm mo-muted">
            Скидка к подписке, % (опц.)
            <input
              value={createBillingDiscount}
              onChange={(e) => setCreateBillingDiscount(e.target.value)}
              placeholder="0"
              className="mo-input mt-1 w-full"
            />
          </label>
          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name.trim() || !ownerEmail.trim()}
            className="btn-primary"
          >
            Создать
          </button>
        </div>
      </section>

      {companiesQuery.isLoading && <p className="text-sm lux-caption">Загрузка списка…</p>}
      {companiesQuery.isError && <p className="text-sm text-red-300">{(companiesQuery.error as Error).message}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(companiesQuery.data ?? []).map((c) => (
          <article
            key={c.id}
            className="mo-section p-4 shadow-inner backdrop-blur-sm"
          >
            <h3 className="lux-subheading">{c.name}</h3>
            <p className="mt-1 text-xs mo-muted">
              {c.is_active ? "Статус: активна" : "Статус: остановлена"}
            </p>
            <p className="mt-1 text-xs lux-caption">Владелец: {c.contact_email || "—"}</p>
            <p className="mt-1 text-xs lux-caption">
              Пользователи: {c.users_count} · Лиды: {c.leads_count} · Воронки: {c.pipelines_count}
            </p>
            <p className="mt-2 text-xs text-violet-200/90">
              Тарифный план: {c.tariff_plan_name ?? "не назначен (все функции)"}
            </p>
            <p className="mt-1 text-xs mo-muted">
              Биллинг: {c.billing_status ?? "active"}
              {c.trial_ends_at ? ` · демо до ${new Date(c.trial_ends_at).toLocaleDateString()}` : ""}
              {c.pending_tariff_plan_name
                ? ` · ожидает тариф: ${c.pending_tariff_plan_name}`
                : ""}
              {c.billing_discount_percent != null && c.billing_discount_percent > 0
                ? ` · скидка ${c.billing_discount_percent}%`
                : ""}
            </p>
            {c.scheduled_tariff_plan_name && c.scheduled_tariff_effective_at ? (
              <p className="mt-1 text-xs text-amber-200/90">
                Смена тарифа с {new Date(c.scheduled_tariff_effective_at).toLocaleString()}: {c.scheduled_tariff_plan_name}
              </p>
            ) : null}
            <label className="mt-2 block text-xs lux-caption">
              Сменить тариф
              <select
                value={c.tariff_plan_id ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  assignPlanMutation.mutate({
                    companyId: c.id,
                    planId: v === "" ? null : Number(v),
                  });
                }}
                disabled={assignPlanMutation.isPending}
                className="mt-1 w-full rounded-lg border border-[var(--mo-border)] bg-[var(--mo-surface)] px-2 py-1.5 text-sm text-[var(--mo-text)] disabled:opacity-50"
              >
                <option value="">Не назначать (все функции)</option>
                {(plansQuery.data ?? [])
                  .filter((p) => p.is_active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <p className="mt-2 text-xs text-amber-100/90">
              Лимиты: активные пользователи —{" "}
              {c.tariff_max_active_users == null ? "как на платформе" : c.tariff_max_active_users}; интеграции —{" "}
              {c.tariff_max_integrations == null ? "как на платформе" : c.tariff_max_integrations}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => switchMutation.mutate(c.id)}
                disabled={switchMutation.isPending || !c.is_active}
                className="rounded-xl crm-modal-panel border/40 px-3 py-1.5 text-sm text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)] disabled:opacity-40"
              >
                Открыть компанию
              </button>
              <button
                type="button"
                onClick={() => impersonateMutation.mutate(c.id)}
                disabled={impersonateMutation.isPending || !c.is_active}
                className="rounded-xl border border-amber-700/50 bg-amber-950/30 px-3 py-1.5 text-sm text-amber-100 hover:bg-amber-950/50 disabled:opacity-40"
              >
                Войти как владелец
              </button>
              <button
                type="button"
                onClick={() => setTariffCompany(c)}
                disabled={tariffMutation.isPending}
                className="rounded-xl crm-modal-panel border/40 px-3 py-1.5 text-sm text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)] disabled:opacity-40"
              >
                Лимиты тарифа
              </button>
              <button
                type="button"
                onClick={() => setScheduleCompany(c)}
                disabled={scheduledTariffMutation.isPending}
                className="rounded-xl border border-amber-700/40 bg-amber-950/25 px-3 py-1.5 text-sm text-amber-100 hover:bg-amber-950/45 disabled:opacity-40"
              >
                Отложенный тариф
              </button>
              <button
                type="button"
                onClick={() => statusMutation.mutate({ companyId: c.id, isActive: !c.is_active })}
                disabled={statusMutation.isPending}
                className="rounded-xl crm-modal-panel border/40 px-3 py-1.5 text-sm text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)] disabled:opacity-40"
              >
                {c.is_active ? "Остановить" : "Запустить"}
              </button>
            </div>
          </article>
        ))}
      </div>

      {tariffCompany ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal
          aria-labelledby="tariff-title"
        >
          <div className="w-full max-w-md rounded-2xl crm-modal-panel border p-6 shadow-2xl">
            <h2 id="tariff-title" className="lux-subheading">
              Лимиты: {tariffCompany.name}
            </h2>
            <p className="mt-1 text-xs lux-caption">
              Пустое поле — не менять этот лимит. Число — своё ограничение для компании.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm mo-muted">
                Макс. активных пользователей
                <input
                  type="number"
                  min={0}
                  value={tariffUsersDraft}
                  onChange={(e) => setTariffUsersDraft(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="block text-sm mo-muted">
                Макс. интеграций
                <input
                  type="number"
                  min={0}
                  value={tariffIntsDraft}
                  onChange={(e) => setTariffIntsDraft(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
              <label className="block text-sm mo-muted">
                Скидка к подписке, % (перекрывает скидку тарифа; пусто — сброс)
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={billingDiscountDraft}
                  onChange={(e) => setBillingDiscountDraft(e.target.value)}
                  className="mo-input mt-1 w-full"
                />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTariffCompany(null)}
                className="rounded-xl border border-[var(--mo-border-strong)] px-4 py-2 text-sm text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={tariffMutation.isPending}
                onClick={() => {
                  const body = applyTariffPatchBody(tariffUsersDraft, tariffIntsDraft);
                  if (!body) {
                    toast.error("Укажите хотя бы одно непустое неотрицательное число");
                    return;
                  }
                  tariffMutation.mutate({ companyId: tariffCompany.id, body });
                }}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-[var(--mo-text)] hover:bg-indigo-500 disabled:opacity-50"
              >
                Сохранить
              </button>
              <button
                type="button"
                disabled={tariffMutation.isPending}
                onClick={() =>
                  tariffMutation.mutate({
                    companyId: tariffCompany.id,
                    body: { tariff_max_active_users: null, tariff_max_integrations: null },
                  })
                }
                className="rounded-xl border border-slate-500 px-4 py-2 text-sm text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)] disabled:opacity-50"
              >
                Сбросить на платформу
              </button>
              <button
                type="button"
                disabled={billingDiscountMutation.isPending}
                onClick={() => {
                  const t = billingDiscountDraft.trim();
                  if (t === "") {
                    billingDiscountMutation.mutate({ companyId: tariffCompany.id, percent: null });
                    return;
                  }
                  const n = Number(t);
                  if (!Number.isFinite(n) || n < 0 || n > 100) {
                    toast.error("Скидка: 0–100 или пусто");
                    return;
                  }
                  billingDiscountMutation.mutate({ companyId: tariffCompany.id, percent: n });
                }}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-[var(--mo-text)] hover:bg-violet-500 disabled:opacity-50"
              >
                Сохранить скидку
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {scheduleCompany ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal
          aria-labelledby="schedule-tariff-title"
        >
          <div className="w-full max-w-md rounded-2xl crm-modal-panel border p-6 shadow-2xl">
            <h2 id="schedule-tariff-title" className="lux-subheading">
              Отложенная смена тарифа: {scheduleCompany.name}
            </h2>
            <p className="mt-1 text-xs lux-caption">
              Текущий план остаётся до указанного времени, затем подставится выбранный тариф (например с 1-го числа).
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm mo-muted">
                Новый тариф
                <select
                  value={schedulePlanDraft === "" ? "" : String(schedulePlanDraft)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSchedulePlanDraft(v === "" ? "" : Number(v));
                  }}
                  className="mo-input mt-1 w-full"
                >
                  <option value="">— сбросить отложенную смену —</option>
                  {(plansQuery.data ?? [])
                    .filter((p) => p.is_active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block text-sm mo-muted">
                Дата и время вступления (локальное)
                <DateTimeField
                  value={scheduleAtDraft}
                  onChange={setScheduleAtDraft}
                  className="mt-1"
                  aria-label="Дата и время вступления тарифа"
                />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setScheduleCompany(null)}
                className="rounded-xl border border-[var(--mo-border-strong)] px-4 py-2 text-sm text-[var(--mo-text)] hover:bg-[var(--mo-accent-soft)]"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={scheduledTariffMutation.isPending}
                onClick={() => {
                  if (schedulePlanDraft === "") {
                    scheduledTariffMutation.mutate({
                      companyId: scheduleCompany.id,
                      body: { scheduled_tariff_plan_id: null, scheduled_tariff_effective_at: null },
                    });
                    return;
                  }
                  if (!scheduleAtDraft.trim()) {
                    toast.error("Укажите дату и время вступления отложенного тарифа");
                    return;
                  }
                  const at = new Date(scheduleAtDraft);
                  if (Number.isNaN(at.getTime())) {
                    toast.error("Некорректная дата");
                    return;
                  }
                  scheduledTariffMutation.mutate({
                    companyId: scheduleCompany.id,
                    body: {
                      scheduled_tariff_plan_id: Number(schedulePlanDraft),
                      scheduled_tariff_effective_at: at.toISOString(),
                    },
                  });
                }}
                className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-[var(--mo-text)] hover:bg-amber-500 disabled:opacity-50"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
