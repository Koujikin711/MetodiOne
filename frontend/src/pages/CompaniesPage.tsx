import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

import { apiFetch, setActiveCompanyId, setStoredToken } from "@/lib/api";

interface Company {
  id: number;
  name: string;
  contact_email?: string | null;
  is_active: boolean;
  users_count: number;
  leads_count: number;
  pipelines_count: number;
}

interface SwitchResponse {
  access_token: string;
  token_type: string;
}

export function CompaniesPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [externalDbDsn, setExternalDbDsn] = useState("");
  const companiesQuery = useQuery({
    queryKey: ["companies"],
    queryFn: () => apiFetch<Company[]>("/api/companies"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<Company>("/api/companies", {
        method: "POST",
        body: JSON.stringify({
          name,
          owner_email: ownerEmail,
          owner_full_name: ownerName || null,
          external_db_dsn: externalDbDsn || null,
        }),
      }),
    onSuccess: () => {
      setName("");
      setOwnerEmail("");
      setOwnerName("");
      setExternalDbDsn("");
      void companiesQuery.refetch();
      toast.success("Компания создана, доступ отправлен владельцу на email");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const switchMutation = useMutation({
    mutationFn: (companyId: number) =>
      apiFetch<SwitchResponse>("/api/companies/switch", {
        method: "POST",
        body: JSON.stringify({ company_id: companyId }),
      }),
    onSuccess: (res, companyId) => {
      setStoredToken(res.access_token);
      setActiveCompanyId(companyId);
      navigate("/", { replace: true });
      toast.success("Контекст компании переключён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ companyId, isActive }: { companyId: number; isActive: boolean }) =>
      apiFetch<Company>(`/api/companies/${companyId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: isActive }),
      }),
    onSuccess: () => {
      void companiesQuery.refetch();
      toast.success("Статус компании обновлён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="relative mx-auto max-w-[1200px] space-y-6 pb-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Компании</h1>
        <p className="mt-1 text-sm text-slate-400">Выберите компанию для просмотра структуры и CRM-данных</p>
      </header>

      <section className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4 shadow-inner backdrop-blur-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] flex-1 text-sm text-slate-300">
            Новая компания
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
              placeholder="Название компании..."
            />
          </label>
          <label className="min-w-[220px] flex-1 text-sm text-slate-300">
            Email владельца
            <input
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
              placeholder="owner@company.com"
              type="email"
            />
          </label>
          <label className="min-w-[220px] flex-1 text-sm text-slate-300">
            ФИО владельца (опц.)
            <input
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
              placeholder="Иван Иванов"
            />
          </label>
          <label className="min-w-[220px] flex-1 text-sm text-slate-300">
            Внешняя БД компании (опц.)
            <input
              value={externalDbDsn}
              onChange={(e) => setExternalDbDsn(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-white"
              placeholder="postgresql://..."
            />
          </label>
          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name.trim() || !ownerEmail.trim()}
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Создать
          </button>
        </div>
      </section>

      {companiesQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
      {companiesQuery.isError && <p className="text-sm text-red-300">{(companiesQuery.error as Error).message}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(companiesQuery.data ?? []).map((c) => (
          <article
            key={c.id}
            className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4 shadow-inner backdrop-blur-sm"
          >
            <h3 className="text-lg font-semibold text-white">{c.name}</h3>
            <p className="mt-1 text-xs text-slate-300">
              {c.is_active ? "Статус: активна" : "Статус: остановлена"}
            </p>
            <p className="mt-1 text-xs text-slate-400">Владелец: {c.contact_email || "—"}</p>
            <p className="mt-1 text-xs text-slate-400">
              Пользователи: {c.users_count} · Лиды: {c.leads_count} · Воронки: {c.pipelines_count}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => switchMutation.mutate(c.id)}
                disabled={switchMutation.isPending || !c.is_active}
                className="rounded-xl border border-slate-600 bg-slate-900/40 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800/60 disabled:opacity-40"
              >
                Открыть компанию
              </button>
              <button
                type="button"
                onClick={() => statusMutation.mutate({ companyId: c.id, isActive: !c.is_active })}
                disabled={statusMutation.isPending}
                className="rounded-xl border border-slate-600 bg-slate-900/40 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800/60 disabled:opacity-40"
              >
                {c.is_active ? "Остановить" : "Запустить"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
