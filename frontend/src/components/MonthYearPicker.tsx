import { useEffect, useId, useRef, useState } from "react";

const MONTH_SHORT = [
  "янв.",
  "февр.",
  "марта",
  "апр.",
  "мая",
  "июня",
  "июля",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
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

function displayLabel(value: string): string {
  const parsed = parseYearMonth(value);
  if (!parsed) return "Выберите месяц";
  const d = new Date(parsed.year, parsed.month - 1, 1);
  const label = d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  // «август 2026 г.»
  return label.includes("г.") ? label : `${label} г.`;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  allowClear?: boolean;
  id?: string;
};

export function MonthYearPicker({ value, onChange, className = "", allowClear = false, id }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const parsed = parseYearMonth(value);
  const now = new Date();
  const [viewYear, setViewYear] = useState(parsed?.year ?? now.getFullYear());

  useEffect(() => {
    if (!open) return;
    setViewYear(parsed?.year ?? now.getFullYear());
  }, [open, parsed?.year, now.getFullYear()]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
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

  return (
    <div ref={rootRef} className={`mo-month-picker relative ${className}`}>
      <button
        id={inputId}
        type="button"
        className="mo-input mo-month-picker-trigger flex w-full items-center justify-between gap-2 text-left"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={parsed ? "text-[var(--mo-text)]" : "mo-muted"}>{displayLabel(value)}</span>
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

      {open ? (
        <div
          role="dialog"
          aria-label="Выбор месяца"
          className="mo-month-picker-panel absolute left-0 top-[calc(100%+6px)] z-50 w-[min(100%,280px)] overflow-hidden rounded-2xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)] p-3 shadow-[var(--mo-shadow-luxury)]"
        >
          <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-[var(--mo-surface)] px-2 py-1.5">
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-sm mo-muted transition hover:bg-[var(--mo-accent-soft)] hover:text-[var(--mo-accent-hover)]"
              aria-label="Предыдущий год"
              onClick={() => setViewYear((y) => y - 1)}
            >
              ‹
            </button>
            <span className="text-sm font-semibold tabular-nums text-[var(--mo-text)]">{viewYear}</span>
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-sm mo-muted transition hover:bg-[var(--mo-accent-soft)] hover:text-[var(--mo-accent-hover)]"
              aria-label="Следующий год"
              onClick={() => setViewYear((y) => y + 1)}
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
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
                    "rounded-xl px-1 py-2 text-center text-xs font-medium transition",
                    selected
                      ? "bg-[var(--mo-accent-hover)] text-white shadow-sm"
                      : isCurrent
                        ? "border border-[var(--mo-border-strong)] bg-[var(--mo-accent-soft)] text-[var(--mo-accent-hover)]"
                        : "text-[var(--mo-text)] hover:border hover:border-[var(--mo-border-strong)] hover:bg-[var(--mo-accent-soft)]",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--mo-border)] pt-2">
            {allowClear ? (
              <button
                type="button"
                className="text-xs font-medium text-[var(--mo-accent-hover)] transition hover:underline"
                onClick={clearValue}
              >
                Удалить
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="text-xs font-semibold text-[var(--mo-accent-hover)] transition hover:underline"
              onClick={goThisMonth}
            >
              В этом месяце
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
