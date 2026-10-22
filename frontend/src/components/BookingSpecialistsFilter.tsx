import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Filter, IdCard, Search } from "@/components/icons";
import {
  allSpecialistsSelected,
  allTypesSelected,
  collectTypeLabels,
  specialistTypeLabel,
  specialistsMatchingTypes,
} from "@/lib/bookingSpecialistFilter";
import type { BookingSpecialist } from "@/lib/types";

type Props = {
  specialists: BookingSpecialist[];
  selectedTypeNames: Set<string>;
  selectedSpecialistIds: Set<number>;
  onChangeTypes: (next: Set<string>) => void;
  onChangeSpecialists: (next: Set<number>) => void;
  onResetAll: () => void;
  filterActive: boolean;
  iconOnly?: boolean;
};

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function BookingSpecialistsFilter({
  specialists,
  selectedTypeNames,
  selectedSpecialistIds,
  onChangeTypes,
  onChangeSpecialists,
  onResetAll,
  filterActive,
  iconOnly = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const typeNames = useMemo(() => collectTypeLabels(specialists), [specialists]);

  const resourcesPool = useMemo(
    () => specialistsMatchingTypes(specialists, selectedTypeNames),
    [specialists, selectedTypeNames],
  );

  const filteredResources = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return resourcesPool;
    return resourcesPool.filter((s) => {
      const hay = `${s.full_name} ${specialistTypeLabel(s)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [resourcesPool, search]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
    if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
    setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !iconOnly) return;
    const place = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 352;
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      setPanelPos({ top: rect.bottom + 6, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, iconOnly]);

  function selectAllTypes() {
    onChangeTypes(new Set(typeNames));
    const ids = specialistsMatchingTypes(specialists, new Set(typeNames)).map((s) => s.id);
    onChangeSpecialists(new Set(ids));
  }

  function resetAllTypes() {
    onChangeTypes(new Set());
    onChangeSpecialists(new Set());
  }

  function selectAllResources() {
    onChangeSpecialists(new Set(resourcesPool.map((s) => s.id)));
  }

  function resetAllResources() {
    onChangeSpecialists(new Set());
  }

  function onToggleType(name: string) {
    const nextTypes = toggleInSet(selectedTypeNames, name);
    onChangeTypes(nextTypes);
    const allowed = new Set(specialistsMatchingTypes(specialists, nextTypes).map((s) => s.id));
    const nextSpecs = new Set([...selectedSpecialistIds].filter((id) => allowed.has(id)));
    onChangeSpecialists(nextSpecs);
  }

  function onToggleResource(id: number) {
    onChangeSpecialists(toggleInSet(selectedSpecialistIds, id));
  }

  const typesAll = allTypesSelected(typeNames, selectedTypeNames);
  const resourcesAll = allSpecialistsSelected(resourcesPool, selectedSpecialistIds);

  return (
    <div ref={rootRef} className="booking-filter-root">
      <button
        ref={btnRef}
        type="button"
        className={`booking-filter-trigger${iconOnly ? " booking-filter-trigger--icon" : ""}${filterActive ? " booking-filter-trigger--active" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Фильтр"
        title="Фильтр"
        onClick={() => setOpen((v) => !v)}
      >
        <Filter className="h-4 w-4 shrink-0" />
        {iconOnly ? null : <span>Фильтр</span>}
        {filterActive ? <span className="booking-filter-trigger-dot" aria-hidden /> : null}
      </button>

      {open
        ? (iconOnly
            ? (node: ReactNode) => createPortal(node, document.body)
            : (node: ReactNode) => node)(
        <div
          ref={panelRef}
          className="booking-filter-panel"
          role="dialog"
          aria-label="Фильтр специалистов"
          style={
            iconOnly && panelPos
              ? { position: "fixed", top: panelPos.top, left: panelPos.left, zIndex: 400 }
              : undefined
          }
        >
          <section className="booking-filter-section">
            <div className="booking-filter-section-head">
              <h3 className="booking-filter-section-title">Типы</h3>
              <div className="booking-filter-section-actions">
                <button type="button" onClick={selectAllTypes} disabled={typesAll}>
                  выбрать все
                </button>
                <button type="button" onClick={resetAllTypes} disabled={selectedTypeNames.size === 0}>
                  сбросить все
                </button>
              </div>
            </div>
            <ul className="booking-filter-list">
              {typeNames.map((name) => {
                const checked = selectedTypeNames.has(name);
                return (
                  <li key={name}>
                    <label className={`booking-filter-row${checked ? " booking-filter-row--checked" : ""}`}>
                      <span className="booking-filter-row-label">{name}</span>
                      <input
                        type="checkbox"
                        className="booking-filter-checkbox"
                        checked={checked}
                        onChange={() => onToggleType(name)}
                      />
                    </label>
                  </li>
                );
              })}
              {typeNames.length === 0 ? (
                <li className="booking-filter-empty">Нет направлений</li>
              ) : null}
            </ul>
          </section>

          <div className="booking-filter-divider" aria-hidden />

          <section className="booking-filter-section">
            <div className="booking-filter-section-head">
              <h3 className="booking-filter-section-title">Специалисты</h3>
              <div className="booking-filter-section-actions">
                <button type="button" onClick={selectAllResources} disabled={resourcesAll || resourcesPool.length === 0}>
                  выбрать все
                </button>
                <button type="button" onClick={resetAllResources} disabled={selectedSpecialistIds.size === 0}>
                  сбросить все
                </button>
              </div>
            </div>
            <label className="booking-filter-search">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск"
                className="booking-filter-search-input"
              />
              <Search className="h-4 w-4 shrink-0 mo-muted" />
            </label>
            <ul className="booking-filter-list booking-filter-list--resources">
              {filteredResources.map((s) => {
                const checked = selectedSpecialistIds.has(s.id);
                const type = specialistTypeLabel(s);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`booking-filter-resource${checked ? " booking-filter-resource--checked" : ""}`}
                      onClick={() => onToggleResource(s.id)}
                    >
                      <span className="booking-filter-resource-icon" aria-hidden>
                        <IdCard className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="booking-filter-resource-name">{s.full_name}</span>
                        <span className="booking-filter-resource-type">{type}</span>
                      </span>
                      {checked ? <span className="booking-filter-check" aria-hidden>✓</span> : null}
                    </button>
                  </li>
                );
              })}
              {filteredResources.length === 0 ? (
                <li className="booking-filter-empty">Ничего не найдено</li>
              ) : null}
            </ul>
          </section>

          <button
            type="button"
            className="booking-filter-reset-all"
            onClick={() => {
              onResetAll();
              setSearch("");
              setOpen(false);
            }}
          >
            Сбросить все мои настройки
          </button>
        </div>
      ) : null}
    </div>
  );
}
