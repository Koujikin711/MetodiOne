import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import { apiFetch, getActiveCompanyId, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type { BillingCompositionLine, BillingStatusRead } from "@/lib/types";

function trialDaysLeft(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const end = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(end)) return null;
  const ms = end - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export function BillingTariffPage() {
  const qc = useQueryClient();
  const [showComposition, setShowComposition] = useState(false);
  const token = getStoredToken();
  const role = decodeRoleFromToken(token);
  const companyId = getActiveCompanyId();
  const isOwner = role === "owner";

  const q = useQuery({
    queryKey: ["billing-status", companyId],
    queryFn: () => apiFetch<BillingStatusRead>("/api/billing/status"),
    enabled: companyId != null && (role === "owner" || role === "admin"),
  });

  const selectMut = useMutation({
    mutationFn: (tariff_plan_id: number) =>
      apiFetch<BillingStatusRead>("/api/billing/select-tariff", {
        method: "POST",
        body: JSON.stringify({ tariff_plan_id }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["billing-status"] });
      toast.success("Заявка отправлена. После оплаты администратор платформы включит тариф.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (companyId == null) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-700/50 bg-slate-900/40 p-8 text-center text-slate-300">
        Не выбрана компания в контексте. Войдите заново или переключите компанию.
      </div>
    );
  }

  if (q.isLoading) {
    return <p className="text-sm text-slate-400">Загрузка…</p>;
  }
  if (q.isError || !q.data) {
    return <p className="text-sm text-red-300">{(q.error as Error)?.message ?? "Не удалось загрузить статус"}</p>;
  }

  const s = q.data;
  const daysLeft = trialDaysLeft(s.trial_ends_at);
  const canPick =
    isOwner &&
    (s.billing_status === "demo_expired" ||
      s.billing_status === "payment_pending" ||
      s.billing_status === "subscribed" ||
      s.billing_status === "active");

  const cur = s.billing_currency ?? "TJS";
  const total = s.monthly_total;
  const lines = (s.composition ?? []) as BillingCompositionLine[];

  return (
    <div className="relative mx-auto max-w-[720px] space-y-6 pb-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Оплата и тариф</h1>
        <p className="mt-1 text-sm text-slate-400">
          Демо-период, выбор тарифа после демо и статус подключения по оплате.
        </p>
      </header>

      {s.billing_status === "demo_trial" && daysLeft != null ? (
        <div className="rounded-2xl border border-cyan-500/35 bg-cyan-950/25 px-5 py-4 text-sm text-cyan-50">
          <p className="font-semibold text-white">Бесплатный демо-доступ</p>
          <p className="mt-2 text-cyan-100/90">
            Осталось дней: <span className="font-mono text-white">{daysLeft}</span>
            {s.trial_ends_at ? (
              <>
                {" "}
                (до {new Date(s.trial_ends_at).toLocaleDateString()})
              </>
            ) : null}
            . После окончания вы сможете выбрать тариф здесь же.
          </p>
        </div>
      ) : null}

      {s.billing_status === "demo_expired" ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-950/30 px-5 py-4 text-sm text-amber-50">
          <p className="font-semibold text-white">Демо-период завершён</p>
          <p className="mt-2 text-amber-100/90">
            Выберите тариф ниже, чтобы продолжить работу в MetodiOne. После выбора с вами свяжется администратор
            платформы для подтверждения оплаты и включения доступа.
          </p>
        </div>
      ) : null}

      {s.billing_status === "payment_pending" ? (
        <div className="rounded-2xl border border-violet-500/40 bg-violet-950/30 px-5 py-4 text-sm text-violet-50">
          <p className="font-semibold text-white">Ожидается подтверждение оплаты</p>
          <p className="mt-2 text-violet-100/90">
            Выбран тариф: <span className="font-medium text-white">{s.pending_tariff_plan_name ?? "—"}</span>. Доступ к
            CRM возобновится после проверки оплаты администратором. При необходимости вы можете выбрать другой тариф
            ниже (заявка обновится).
          </p>
        </div>
      ) : null}

      {s.billing_status === "subscribed" || s.billing_status === "active" ? (
        <div className="rounded-2xl border border-emerald-500/35 bg-emerald-950/20 px-5 py-4 text-sm text-emerald-50">
          <p className="font-semibold text-white">Тариф подключён</p>
          <p className="mt-2 text-emerald-100/90">
            Текущий план: <span className="font-medium text-white">{s.current_tariff_plan_name ?? "не зафиксирован"}</span>
            .
          </p>
          <Link to="/app" className="mt-3 inline-block text-sm font-medium text-emerald-200 underline-offset-2 hover:underline">
            На главную CRM
          </Link>
        </div>
      ) : null}

      {!isOwner ? (
        <p className="text-xs text-slate-500">Выбор тарифа доступен только владельцу компании.</p>
      ) : null}

      {canPick ? (
        <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5">
          <h2 className="text-lg font-semibold text-white">Выберите тариф</h2>
          <ul className="mt-4 space-y-3">
            {s.plans.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-950/40 px-4 py-3"
              >
                <div>
                  <p className="font-medium text-white">{p.name}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Сотрудники до {p.max_active_users === 0 ? "∞" : p.max_active_users} · интеграции до{" "}
                    {p.max_integrations === 0 ? "∞" : p.max_integrations}
                    {p.warehouse_enabled ? " · склад включён" : " · без склада"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={selectMut.isPending}
                  onClick={() => selectMut.mutate(p.id)}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Выбрать
                </button>
              </li>
            ))}
          </ul>
          {s.plans.length === 0 ? (
            <p className="mt-3 text-sm text-amber-200/90">Нет активных тарифов на платформе. Обратитесь к поддержке.</p>
          ) : null}
        </section>
      ) : null}

      {showComposition && lines.length > 0 ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal
          onClick={(e) => e.target === e.currentTarget && setShowComposition(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-600 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">Состав подписки</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              {lines.map((ln, i) => (
                <li key={i} className="flex justify-between gap-2 border-b border-slate-700/50 pb-2">
                  <span>{ln.label}</span>
                  <span className="shrink-0 font-mono text-slate-100">
                    {ln.amount} {cur}
                  </span>
                </li>
              ))}
            </ul>
            {s.monthly_subtotal != null ? (
              <p className="mt-3 text-xs text-slate-500">
                Промежуточно: {s.monthly_subtotal} {cur}
                {s.monthly_discount_percent != null && Number(s.monthly_discount_percent) > 0
                  ? ` · скидка ${s.monthly_discount_percent}% (−${s.monthly_discount_amount ?? "0"} ${cur})`
                  : ""}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setShowComposition(false)}
              className="mt-4 w-full rounded-xl border border-slate-600 py-2 text-sm text-slate-200 hover:bg-slate-800/60"
            >
              Закрыть
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const BillingPage = BillingTariffPage;
