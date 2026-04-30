import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";

import { apiFetch } from "@/lib/api";
import type { HorecaMenuItem, HorecaProductOption, HorecaTechCardRead } from "@/lib/types";

type DraftLine = { product_id: number; qty_per_portion: string };

export function HorecaKitchenPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);

  const itemsQuery = useQuery({
    queryKey: ["horeca-menu-items"],
    queryFn: () => apiFetch<HorecaMenuItem[]>("/api/horeca/menu-items"),
  });
  const productsQuery = useQuery({
    queryKey: ["horeca-products-options"],
    queryFn: () => apiFetch<HorecaProductOption[]>("/api/horeca/products/options"),
  });

  const techCardQuery = useQuery({
    queryKey: ["horeca-tech-card", selectedItemId],
    queryFn: () => apiFetch<HorecaTechCardRead>(`/api/horeca/menu-items/${selectedItemId}/tech-card`),
    enabled: selectedItemId != null,
  });

  useEffect(() => {
    if (!techCardQuery.data) return;
    setLines(techCardQuery.data.lines.map((l) => ({ product_id: l.product_id, qty_per_portion: l.qty_per_portion })));
  }, [techCardQuery.data]);

  const createItem = useMutation({
    mutationFn: () =>
      apiFetch<HorecaMenuItem>("/api/horeca/menu-items", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          sale_price: Number(price || 0),
          is_active: true,
        }),
      }),
    onSuccess: () => {
      setName("");
      setPrice("");
      toast.success("Позиция меню добавлена");
      void qc.invalidateQueries({ queryKey: ["horeca-menu-items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveTechCard = useMutation({
    mutationFn: () =>
      apiFetch<HorecaTechCardRead>(`/api/horeca/menu-items/${selectedItemId}/tech-card`, {
        method: "PUT",
        body: JSON.stringify(
          lines
            .filter((l) => l.product_id > 0 && Number(l.qty_per_portion) > 0)
            .map((l) => ({ product_id: l.product_id, qty_per_portion: Number(l.qty_per_portion) })),
        ),
      }),
    onSuccess: () => {
      toast.success("Техкарта сохранена");
      void qc.invalidateQueries({ queryKey: ["horeca-tech-card", selectedItemId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const productsById = useMemo(() => {
    const m = new Map<number, HorecaProductOption>();
    for (const p of productsQuery.data ?? []) m.set(p.id, p);
    return m;
  }, [productsQuery.data]);

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 pb-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-teal-300/90">HoReCa / Кухня и техкарты</p>
        <h1 className="text-3xl font-semibold text-white">Кухня и техкарты</h1>
        <div className="flex gap-2 text-xs">
          <Link to="/horeca/prep" className="rounded-lg border border-slate-600/60 px-3 py-1.5 text-slate-200 hover:bg-slate-800/50">
            Заготовки и продаваемые порции
          </Link>
          <Link to="/horeca/stock" className="rounded-lg border border-slate-600/60 px-3 py-1.5 text-slate-200 hover:bg-slate-800/50">
            Алерты по складу
          </Link>
        </div>
      </header>

      <section className="grid gap-3 rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4 md:grid-cols-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название позиции" className="rounded-xl border border-slate-600/50 bg-slate-900/70 px-3 py-2 text-sm text-white" />
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Цена продажи" className="rounded-xl border border-slate-600/50 bg-slate-900/70 px-3 py-2 text-sm text-white" />
        <button
          type="button"
          onClick={() => {
            if (!name.trim()) return toast.error("Введите название");
            createItem.mutate();
          }}
          className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"
        >
          Добавить позицию
        </button>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <h2 className="text-base font-semibold text-white">Позиции меню</h2>
          <div className="mt-3 space-y-2">
            {(itemsQuery.data ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedItemId(item.id);
                  setLines([]);
                }}
                className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${selectedItemId === item.id ? "border-teal-500/50 bg-teal-500/10 text-white" : "border-slate-700/60 bg-slate-950/40 text-slate-300"}`}
              >
                {item.name} · {item.sale_price}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/40 p-4">
          <h2 className="text-base font-semibold text-white">Редактор техкарты</h2>
          {selectedItemId == null ? <p className="mt-2 text-sm text-slate-500">Выберите позицию меню.</p> : null}
          {techCardQuery.data ? (
            <p className="mt-2 text-xs text-slate-400">
              Текущая себестоимость: {techCardQuery.data.recipe_cost} · Food cost: {techCardQuery.data.food_cost_pct}%
            </p>
          ) : null}
          <div className="mt-3 space-y-2">
            {lines.map((l, idx) => (
              <div key={`${l.product_id}-${idx}`} className="grid grid-cols-[1fr_120px] gap-2">
                <select
                  value={l.product_id}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...l, product_id: Number(e.target.value) };
                    setLines(next);
                  }}
                  className="rounded-xl border border-slate-600/50 bg-slate-900/70 px-2 py-2 text-sm text-white"
                >
                  <option value={0}>Продукт</option>
                  {(productsQuery.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.unit})
                    </option>
                  ))}
                </select>
                <input
                  value={l.qty_per_portion}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...l, qty_per_portion: e.target.value };
                    setLines(next);
                  }}
                  placeholder="Кол-во"
                  className="rounded-xl border border-slate-600/50 bg-slate-900/70 px-2 py-2 text-sm text-white"
                />
              </div>
            ))}
            <button type="button" onClick={() => setLines((prev) => [...prev, { product_id: 0, qty_per_portion: "1" }])} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200">
              + Строка
            </button>
            <button
              type="button"
              onClick={() => {
                if (!selectedItemId) return;
                saveTechCard.mutate();
              }}
              className="ml-2 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Сохранить техкарту
            </button>
          </div>
          {techCardQuery.data?.lines.length ? (
            <div className="mt-3 text-xs text-slate-400">
              {techCardQuery.data.lines.slice(0, 4).map((l) => (
                <div key={l.product_id}>
                  {l.product_name}: {l.qty_per_portion} · {productsById.get(l.product_id)?.unit || "ед."}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
