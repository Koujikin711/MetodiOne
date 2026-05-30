import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { apiFetch } from "@/lib/api";
import type { HorecaPrepLine, HorecaSellableItem } from "@/lib/types";

type DraftMap = Record<number, string>;

export function HorecaPrepPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<DraftMap>({});
  const prepQuery = useQuery({
    queryKey: ["horeca-prep-today"],
    queryFn: () => apiFetch<HorecaPrepLine[]>("/api/horeca/prep/today"),
    refetchInterval: 30_000,
  });
  const sellableQuery = useQuery({
    queryKey: ["horeca-sellable-today"],
    queryFn: () => apiFetch<HorecaSellableItem[]>("/api/horeca/menu/sellable-today"),
    refetchInterval: 30_000,
  });

  const savePrep = useMutation({
    mutationFn: () => {
      const lines = Object.entries(draft)
        .map(([menu_item_id, portions_ready]) => ({
          menu_item_id: Number(menu_item_id),
          portions_ready: Number(portions_ready || 0),
        }))
        .filter((x) => Number.isFinite(x.portions_ready) && x.portions_ready >= 0);
      return apiFetch<HorecaPrepLine[]>("/api/horeca/prep/today", {
        method: "PUT",
        body: JSON.stringify({ lines }),
      });
    },
    onSuccess: () => {
      toast.success("Заготовки сохранены");
      setDraft({});
      void qc.invalidateQueries({ queryKey: ["horeca-prep-today"] });
      void qc.invalidateQueries({ queryKey: ["horeca-sellable-today"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const prepById = useMemo(() => {
    const m = new Map<number, HorecaPrepLine>();
    for (const row of prepQuery.data ?? []) m.set(row.menu_item_id, row);
    return m;
  }, [prepQuery.data]);

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / Заготовки</p>
        <h1 className="lux-heading-page">Заготовки повара и продаваемые порции</h1>
        <p className="text-sm lux-caption">Повар вносит готовые заготовки, система считает сколько порций реально можно продать сегодня.</p>
      </header>

      <section className="rounded-2xl mo-section p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="lux-subheading">План заготовок на сегодня</h2>
          <button
            type="button"
            onClick={() => savePrep.mutate()}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-[var(--mo-text)]"
          >
            Сохранить
          </button>
        </div>
        <div className="grid gap-2">
          {(prepQuery.data ?? []).map((row) => (
            <label key={row.menu_item_id} className="grid grid-cols-[1fr_160px] items-center gap-2 rounded-xl border border-[var(--mo-border)] px-3 py-2">
              <span className="text-sm text-[var(--mo-text)]">{row.menu_item_name}</span>
              <input
                value={draft[row.menu_item_id] ?? row.portions_ready}
                onChange={(e) => setDraft((prev) => ({ ...prev, [row.menu_item_id]: e.target.value }))}
                className="rounded-lg border border-[var(--mo-border-strong)]/50 bg-white px-2 py-1.5 text-sm text-[var(--mo-text)]"
                inputMode="decimal"
              />
            </label>
          ))}
          {!prepQuery.isLoading && (prepQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm mo-muted">Нет активного меню для заготовок.</p>
          ) : null}
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl mo-section p-4">
        <h2 className="mb-2 lux-subheading">Сколько порций можно продать сегодня</h2>
        <table className="w-full min-w-[780px] text-left text-sm text-[var(--mo-text)]">
          <thead className="lux-caption">
            <tr>
              <th className="py-2 pr-3">Блюдо</th>
              <th className="py-2 pr-3">По остаткам</th>
              <th className="py-2 pr-3">Заготовлено</th>
              <th className="py-2 pr-3">Итог к продаже</th>
            </tr>
          </thead>
          <tbody>
            {(sellableQuery.data ?? []).map((row) => (
              <tr key={row.menu_item_id} className="border-t border-[var(--mo-border)]">
                <td className="py-2 pr-3">{row.menu_item_name}</td>
                <td className="py-2 pr-3">{row.max_from_stock ?? "—"}</td>
                <td className="py-2 pr-3">{prepById.get(row.menu_item_id)?.portions_ready ?? row.portions_prepared_today ?? "—"}</td>
                <td className="py-2 pr-3 font-semibold text-[#0f4c3a]">{row.sellable_portions ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
