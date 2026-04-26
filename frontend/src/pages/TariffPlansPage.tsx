import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import type { FeatureCatalogItem, TariffPlanRead } from "@/lib/types";

export type TariffPlanSaveBody = {
  name: string;
  max_active_users: number;
  max_integrations: number;
  enabled_features: string[];
  warehouse_enabled: boolean;
  is_active: boolean;
  sort_order: number;
};

function PlanEditorModal({
  title,
  initial,
  catalog,
  onClose,
  onSave,
  isPending,
}: {
  title: string;
  initial: Partial<TariffPlanRead> | null;
  catalog: FeatureCatalogItem[];
  onClose: () => void;
  onSave: (body: TariffPlanSaveBody) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [maxUsers, setMaxUsers] = useState(String(initial?.max_active_users ?? 0));
  const [maxInt, setMaxInt] = useState(String(initial?.max_integrations ?? 0));
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 0));
  const [isActive, setIsActive] = useState(initial?.is_active !== false);
  const [warehouseEnabled, setWarehouseEnabled] = useState(initial?.warehouse_enabled !== false);
  const [feats, setFeats] = useState<Set<string>>(() => new Set(initial?.enabled_features ?? []));

  function toggleFeat(k: string) {
    setFeats((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  function submit() {
    const nu = Number(maxUsers);
    const ni = Number(maxInt);
    const so = Number(sortOrder);
    if (!name.trim()) {
      toast.error("Укажите название тарифа");
      return;
    }
    if (!Number.isFinite(nu) || nu < 0 || !Number.isFinite(ni) || ni < 0) {
      toast.error("Лимиты должны быть неотрицательными числами (0 = без лимита)");
      return;
    }
    if (feats.size === 0) {
      toast.error("Выберите хотя бы одну функцию");
      return;
    }
    onSave({
      name: name.trim(),
      max_active_users: nu,
      max_integrations: ni,
      enabled_features: [...feats],
      warehouse_enabled: warehouseEnabled,
      is_active: isActive,
      sort_order: Number.isFinite(so) ? so : 0,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-600 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-slate-300">
            Название
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-white"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-300">
              Макс. активных сотрудников (0 = без лимита)
              <input
                type="number"
                min={0}
                value={maxUsers}
                onChange={(e) => setMaxUsers(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-white"
              />
            </label>
            <label className="block text-sm text-slate-300">
              Макс. интеграций (0 = без лимита)
              <input
                type="number"
                min={0}
                value={maxInt}
                onChange={(e) => setMaxInt(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-white"
              />
            </label>
          </div>
          <label className="block text-sm text-slate-300">
            Порядок сортировки
            <input
              type="number"
              min={0}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-white"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Тариф активен (можно назначать компаниям)
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={warehouseEnabled} onChange={(e) => setWarehouseEnabled(e.target.checked)} />
            Склад в финансах (остатки, приход/расход)
          </label>
        </div>
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">Функции в тарифе</p>
        <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-700/60 p-2">
          {catalog.map((c) => (
            <li key={c.key}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-200 hover:bg-slate-800/50">
                <input type="checkbox" checked={feats.has(c.key)} onChange={() => toggleFeat(c.key)} />
                {c.label}
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800/60"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => submit()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {isPending ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TariffPlansPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<TariffPlanRead | null>(null);

  const catalogQuery = useQuery({
    queryKey: ["tariff-plans", "catalog"],
    queryFn: () => apiFetch<FeatureCatalogItem[]>("/api/tariff-plans/catalog/features"),
  });

  const plansQuery = useQuery({
    queryKey: ["tariff-plans"],
    queryFn: () => apiFetch<TariffPlanRead[]>("/api/tariff-plans"),
  });

  const createMut = useMutation({
    mutationFn: (body: TariffPlanSaveBody) =>
      apiFetch<TariffPlanRead>("/api/tariff-plans", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tariff-plans"] });
      void qc.invalidateQueries({ queryKey: ["tariff-access"] });
      setModal(null);
      toast.success("Тариф создан");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiFetch<TariffPlanRead>(`/api/tariff-plans/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tariff-plans"] });
      void qc.invalidateQueries({ queryKey: ["tariff-access"] });
      setModal(null);
      setEditing(null);
      toast.success("Тариф обновлён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch<undefined>(`/api/tariff-plans/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tariff-plans"] });
      void qc.invalidateQueries({ queryKey: ["tariff-access"] });
      toast.success("Тариф удалён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const catalog = catalogQuery.data ?? [];

  return (
    <div className="relative mx-auto max-w-[960px] space-y-6 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Архитектор тарифов</h1>
          <p className="mt-1 text-sm text-slate-400">
            Создайте тарифы с набором функций и лимитами. При создании компании выберите тариф — владелец увидит
            недоступные разделы с подсказкой об апгрейде.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal("create")}
          className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Новый тариф
        </button>
      </header>

      {plansQuery.isLoading && <p className="text-sm text-slate-400">Загрузка…</p>}
      {plansQuery.isError && <p className="text-sm text-red-300">{(plansQuery.error as Error).message}</p>}

      <div className="space-y-3">
        {(plansQuery.data ?? []).map((p) => (
          <article
            key={p.id}
            className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-4 backdrop-blur-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold text-white">{p.name}</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Сотрудники до {p.max_active_users === 0 ? "∞" : p.max_active_users} · интеграции до{" "}
                  {p.max_integrations === 0 ? "∞" : p.max_integrations} · порядок {p.sort_order}
                  {p.warehouse_enabled === false ? " · без склада" : " · склад"}
                  {p.is_active ? "" : " · отключён"}
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  Функции:{" "}
                  {p.enabled_features.length
                    ? p.enabled_features.map((k) => catalog.find((c) => c.key === k)?.label ?? k).join(", ")
                    : "—"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(p);
                    setModal("edit");
                  }}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800/60"
                >
                  Изменить
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Удалить тариф «${p.name}»? У компаний поле тарифа будет сброшено.`)) {
                      deleteMut.mutate(p.id);
                    }
                  }}
                  disabled={deleteMut.isPending}
                  className="rounded-lg border border-red-600/50 px-3 py-1.5 text-xs text-red-200 hover:bg-red-950/40 disabled:opacity-50"
                >
                  Удалить
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {modal === "create" && catalog.length > 0 ? (
        <PlanEditorModal
          title="Новый тариф"
          initial={null}
          catalog={catalog}
          onClose={() => setModal(null)}
          isPending={createMut.isPending}
          onSave={(body) => createMut.mutate(body)}
        />
      ) : null}

      {modal === "edit" && editing && catalog.length > 0 ? (
        <PlanEditorModal
          title={`Редактирование: ${editing.name}`}
          initial={editing}
          catalog={catalog}
          onClose={() => {
            setModal(null);
            setEditing(null);
          }}
          isPending={updateMut.isPending}
          onSave={(body) =>
            updateMut.mutate({
              id: editing.id,
              body: {
                name: body.name,
                max_active_users: body.max_active_users,
                max_integrations: body.max_integrations,
                enabled_features: body.enabled_features,
                warehouse_enabled: body.warehouse_enabled,
                is_active: body.is_active,
                sort_order: body.sort_order,
              },
            })
          }
        />
      ) : null}
    </div>
  );
}
