import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MONTH_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
] as const;

function parseYearMonth(value: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value || "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

function formatYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function displayLabel(value: string, compact = false): string {
  const parsed = parseYearMonth(value);
  if (!parsed) return "Месяц";
  if (compact) {
    return `${MONTH_SHORT[parsed.month - 1]} ${parsed.year}`;
  }
  const d = new Date(parsed.year, parsed.month - 1, 1);
  const label = d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return label.includes("г.") ? label : `${label} г.`;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  allowClear?: boolean;
  id?: string;
  /** Короткая подпись на узких экранах (авг. 2026). */
  compact?: boolean;
};

const PANEL_W = 288;

export function MonthYearPicker({
  value,
  onChange,
  className = "",
  allowClear = false,
  id,
  compact = false,
}: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const parsed = parseYearMonth(value);
  const [viewYear, setViewYear] = useState(() => parsed?.year ?? new Date().getFullYear());

  useEffect(() => {
    if (!open) return;
    setViewYear(parsed?.year ?? new Date().getFullYear());
  }, [open, parsed?.year]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 6;
      let left = r.right - PANEL_W;
      left = Math.max(8, Math.min(left, window.innerWidth - PANEL_W - 8));
      let top = r.bottom + gap;
      const panelH = 280;
      if (top + panelH > window.innerHeight - 8 && r.top > panelH + gap) {
        top = r.top - panelH - gap;
      }
      setPanelPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if ((e.target as Element | null)?.closest?.(".mo-month-picker-panel")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const now = new Date();

  function pickMonth(month: number) {
    onChange(formatYearMonth(viewYear, month));
    setOpen(false);
  }

  function goThisMonth() {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    onChange(formatYearMonth(y, m));
    setViewYear(y);
    setOpen(false);
  }

  function clearValue() {
    onChange("");
    setOpen(false);
  }

  const panel =
    open && panelPos && typeof document !== "undefined"
      ? createPortal(
          <div
            role="dialog"
            aria-label="Выбор месяца"
            className="mo-month-picker-panel"
            style={{ top: panelPos.top, left: panelPos.left, width: PANEL_W }}
          >
            <div className="mo-month-picker-panel__year">
              <button
                type="button"
                className="mo-month-picker-panel__nav"
                aria-label="Предыдущий год"
                onClick={() => setViewYear((y) => y - 1)}
              >
                ‹
              </button>
              <span className="mo-month-picker-panel__year-label">{viewYear}</span>
              <button
                type="button"
                className="mo-month-picker-panel__nav"
                aria-label="Следующий год"
                onClick={() => setViewYear((y) => y + 1)}
              >
                ›
              </button>
            </div>

            <div className="mo-month-picker-panel__grid">
              {MONTH_SHORT.map((label, idx) => {
                const month = idx + 1;
                const selected = parsed?.year === viewYear && parsed.month === month;
                const isCurrent = now.getFullYear() === viewYear && now.getMonth() + 1 === month;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => pickMonth(month)}
                    className={[
                      "mo-month-picker-panel__month",
                      selected ? "is-selected" : "",
                      !selected && isCurrent ? "is-current" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="mo-month-picker-panel__footer">
              {allowClear ? (
                <button type="button" className="mo-month-picker-panel__link" onClick={clearValue}>
                  Удалить
                </button>
              ) : (
                <span />
              )}
              <button type="button" className="mo-month-picker-panel__link" onClick={goThisMonth}>
                В этом месяце
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={`mo-month-picker relative ${className}`}>
      <button
        ref={triggerRef}
        id={inputId}
        type="button"
        className="mo-input mo-month-picker-trigger flex min-h-11 w-full items-center justify-between gap-1.5 text-left text-base sm:min-h-0 sm:gap-2 sm:text-sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`truncate ${parsed ? "text-[var(--mo-text)]" : "mo-muted"}`}>
          <span className={compact ? "sm:hidden" : "hidden"}>{displayLabel(value, true)}</span>
          <span className={compact ? "hidden sm:inline" : undefined}>{displayLabel(value, false)}</span>
        </span>
        <svg
          className="h-4 w-4 shrink-0 text-[var(--mo-text-muted)]"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden
        >
          <path
            d="M6 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {panel}
    </div>
  );
}
