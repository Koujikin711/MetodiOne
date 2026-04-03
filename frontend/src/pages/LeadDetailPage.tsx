import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";

import { apiFetch, getStoredToken } from "@/lib/api";
import { decodeRoleFromToken } from "@/lib/auth";
import type { Lead, LeadAuditEvent } from "@/lib/types";

export function LeadDetailPage() {
  const { id } = useParams();
  const leadId = Number(id);
  const qc = useQueryClient();
  const [auditOpen, setAuditOpen] = useState(false);
  const [closeDealOpen, setCloseDealOpen] = useState(false);
  const [closeAmount, setCloseAmount] = useState("");
  const [closePaid, setClosePaid] = useState("");

  const query = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => apiFetch<Lead>(`/api/leads/${leadId}`),
    enabled: Number.isFinite(leadId) && leadId > 0,
  });

  const closeDealMutation = useMutation({
    mutationFn: async (body: { amount: number; paid_amount: number }) =>
      apiFetch<Lead>(`/api/leads/${leadId}/close-deal`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Сделка закрыта");
      setCloseDealOpen(false);
      void qc.invalidateQueries({ queryKey: ["lead", leadId] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось закрыть сделку"),
  });

  const role = decodeRoleFromToken(getStoredToken());
  const homeLink = role === "manager" ? "/my-leads" : "/";
  const homeLabel = role === "manager" ? "Мои лиды" : "Канбан";

  const auditQuery = useQuery({
    queryKey: ["lead-audit", leadId],
    queryFn: () => apiFetch<LeadAuditEvent[]>(`/api/leads/${leadId}/audit`),
    enabled: auditOpen && Number.isFinite(leadId) && leadId > 0,
  });

  if (!Number.isFinite(leadId) || leadId <= 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-slate-400">
        Некорректный идентификатор лида.
        <Link to="/booking" className="mt-4 block text-purple-300 hover:underline">
          ← К онлайн-записи
        </Link>
      </div>
    );
  }

  return (
    <div className="relative mx-auto max-w-2xl space-y-8 pb-10">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Link
          to="/booking"
          className="font-medium text-purple-300 underline-offset-4 hover:text-purple-200 hover:underline"
        >
          ← Онлайн запись
        </Link>
        <Link to={homeLink} className="text-slate-400 hover:text-slate-200">
          {homeLabel}
        </Link>
      </div>

      {query.isLoading && <p className="text-slate-400">Загрузка карточки…</p>}
      {query.isError && (
        <p className="text-red-300">{(query.error as Error).message ?? "Ошибка загрузки"}</p>
      )}

      {query.data && (
        <article className="relative rounded-3xl border border-slate-700/40 bg-slate-800/40 p-8 shadow-2xl backdrop-blur-xl">
          <div className="absolute right-3 top-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setAuditOpen(true)}
              className="rounded-xl border border-slate-600/70 bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-purple-400/60 hover:bg-purple-500/15"
            >
              Аудит
            </button>
            <Link
              to={`/chat?lead_id=${query.data.id}`}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-600/70 bg-slate-900/70 px-3 text-sm font-semibold text-slate-100 transition hover:border-indigo-400/60 hover:bg-indigo-500/20"
              title="Открыть чат с клиентом"
            >
              Чат
            </Link>
            {query.data.show_close_deal_button && (
              <button
                type="button"
                onClick={() => {
                  setCloseAmount("");
                  setClosePaid("");
                  setCloseDealOpen(true);
                }}
                className="rounded-xl border border-emerald-600/50 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:border-emerald-400/60 hover:bg-emerald-900/30"
              >
                Закрыть сделку
              </button>
            )}
          </div>
          <header className="mb-6 border-b border-slate-700/50 pb-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Клиент / лид</p>
            <h1 className="mt-1 text-3xl font-semibold text-white">{query.data.name}</h1>
            {query.data.stage_name && (
              <p className="mt-2 inline-flex rounded-full bg-purple-500/15 px-3 py-1 text-sm text-purple-200 ring-1 ring-purple-500/30">
                {query.data.stage_name}
              </p>
            )}
          </header>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Телефон</dt>
              <dd className="mt-1 text-lg text-slate-100">{query.data.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Email</dt>
              <dd className="mt-1 text-lg text-slate-100">{query.data.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Источник</dt>
              <dd className="mt-1 text-slate-200">{query.data.source ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Менеджер (id)</dt>
              <dd className="mt-1 text-slate-200">{query.data.manager_id ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">ID в MetodiOne</dt>
              <dd className="mt-1 font-mono text-slate-300">#{query.data.id}</dd>
            </div>
          </dl>
        </article>
      )}

      {closeDealOpen && query.data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          onClick={() => setCloseDealOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">Закрыть сделку</h3>
            <p className="mt-2 text-sm text-slate-400">
              Укажите стоимость услуги и фактическую оплату. Лид будет переведён на стадию успешного закрытия. Повторно
              закрыть того же лида нельзя.
            </p>
            <div className="mt-4 grid gap-3">
              <label className="text-sm text-slate-300">
                Стоимость услуги
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={closeAmount}
                  onChange={(e) => setCloseAmount(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
              <label className="text-sm text-slate-300">
                Оплачено фактически
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={closePaid}
                  onChange={(e) => setClosePaid(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
                />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setCloseDealOpen(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={closeDealMutation.isPending}
                onClick={() => {
                  const amount = Number(closeAmount);
                  const paid = Number(closePaid);
                  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(paid) || paid < 0) {
                    toast.error("Введите неотрицательные числа");
                    return;
                  }
                  closeDealMutation.mutate({ amount, paid_amount: paid });
                }}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}

      {auditOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          onClick={() => setAuditOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">Аудит карточки лида #{leadId}</h3>
              <button
                type="button"
                onClick={() => setAuditOpen(false)}
                className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                Закрыть
              </button>
            </div>
            <div className="max-h-[66vh] overflow-y-auto p-4">
              {auditQuery.isLoading && <p className="text-sm text-slate-400">Загрузка аудита…</p>}
              {auditQuery.isError && (
                <p className="text-sm text-red-300">{(auditQuery.error as Error).message ?? "Ошибка загрузки аудита"}</p>
              )}
              {(auditQuery.data ?? []).length === 0 && !auditQuery.isLoading && (
                <p className="text-sm text-slate-500">Пока нет событий.</p>
              )}
              <ul className="space-y-2">
                {(auditQuery.data ?? []).map((e) => (
                  <li key={e.id} className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-purple-500/20 px-2 py-0.5 text-purple-200">{e.action}</span>
                      <span className="text-slate-300">{e.user_name ?? `user#${e.user_id ?? "-"}`}</span>
                      <span className="text-slate-500">
                        {new Date(e.created_at).toLocaleString("ru-RU")}
                      </span>
                    </div>
                    {e.details && <p className="mt-1 text-sm text-slate-200">{e.details}</p>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
