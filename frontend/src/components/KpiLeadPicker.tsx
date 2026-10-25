import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type KpiLeadPick = {
  lead_id: number;
  name: string;
  phone: string | null;
  manager_name?: string | null;
  stage_name?: string | null;
};

type SearchOut = {
  q: string;
  count: number;
  note?: string;
  items: KpiLeadPick[];
};

type Props = {
  selected: KpiLeadPick | null;
  onSelect: (lead: KpiLeadPick | null) => void;
  /** When set from Lead card / URL — picker locked to this patient until cleared. */
  lockedFromContext?: boolean;
  disabled?: boolean;
  /** Имя или телефон из соседних полей формы — список появляется без отдельного поиска. */
  linkedQuery?: string;
};

export function KpiLeadPicker({
  selected,
  onSelect,
  lockedFromContext = false,
  disabled,
  linkedQuery = "",
}: Props) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const active = q.trim() || linkedQuery.trim();

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(active), 280);
    return () => window.clearTimeout(t);
  }, [active]);

  const searchQuery = useQuery({
    queryKey: ["sales-kpi-leads-search", debounced],
    queryFn: () =>
      apiFetch<SearchOut>(
        `/api/sales-kpi/leads/search?q=${encodeURIComponent(debounced)}&limit=20`,
      ),
    enabled: !disabled && !selected && debounced.length >= 1,
  });

  const items = searchQuery.data?.items ?? [];
  const multiPhoneHint =
    items.length > 1 &&
    new Set(items.map((i) => (i.phone || "").replace(/\D/g, "").slice(-9)).filter((x) => x.length >= 9))
      .size < items.length;

  if (selected) {
    return (
      <div className="col-span-2 rounded-lg border border-[var(--mo-border)] bg-[var(--mo-surface)] px-2.5 py-1.5 md:col-span-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] mo-muted">
              {lockedFromContext ? "Пациент из карточки Lead" : "Пациент выбран"}
            </p>
            <p className="truncate text-sm font-semibold text-[var(--mo-text)]">{selected.name}</p>
            <p className="mt-0.5 text-xs tabular-nums mo-muted">
              {selected.phone || "без телефона"} · Lead #{selected.lead_id}
              {selected.manager_name ? ` · ${selected.manager_name}` : ""}
            </p>
          </div>
          {!disabled ? (
            <button
              type="button"
              className="btn-secondary shrink-0 px-2 py-1 text-xs"
              onClick={() => {
                onSelect(null);
                setQ("");
              }}
            >
              Сменить
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="kpi-patient-search col-span-2 flex flex-col gap-0.5 md:col-span-4">
      <label className="text-[11px] mo-muted">
        Поиск пациента
        <input
          type="search"
          className="mo-input mt-0.5 !min-h-11 w-full text-base sm:!min-h-0 sm:text-sm"
          value={q}
          disabled={disabled}
          placeholder="ФИО, телефон или номер карточки"
          title="Можно не выбирать: продажа сохранится без карточки. Если номер общий, выберите нужного ребёнка."
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
      </label>
      {debounced.length >= 1 && searchQuery.isFetching ? (
        <p className="text-xs lux-caption">Поиск…</p>
      ) : null}
      {debounced.length >= 1 && !searchQuery.isFetching && items.length === 0 ? (
        <p className="text-xs mo-muted">Ничего не найдено</p>
      ) : null}
      {multiPhoneHint ? (
        <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90">
          Несколько пациентов с похожим телефоном — выберите нужного ребёнка.
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul className="max-h-48 overflow-y-auto rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface)]">
          {items.map((item) => (
            <li key={item.lead_id}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 border-b border-[var(--mo-border)]/50 px-3 py-2 text-left last:border-b-0 hover:bg-[var(--mo-accent-soft)]"
                onClick={() => {
                  onSelect(item);
                  setQ("");
                }}
              >
                <span className="text-sm font-semibold text-[var(--mo-text)]">{item.name}</span>
                <span className="text-[11px] tabular-nums mo-muted">
                  {item.phone || "без телефона"} · Lead #{item.lead_id}
                  {item.stage_name ? ` · ${item.stage_name}` : ""}
                  {item.manager_name ? ` · ${item.manager_name}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
