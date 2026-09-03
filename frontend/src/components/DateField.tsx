import { useEffect, useRef, useState } from "react";

import { MiniMonthCalendar } from "@/components/MiniMonthCalendar";

type Props = {
  value: string;
  onChange: (isoDate: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
};

function formatDisplay(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Дата в стиле MetodiOne (без нативного Chrome-календаря). */
export function DateField({
  value,
  onChange,
  disabled = false,
  required = false,
  className = "",
  id,
  "aria-label": ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const display = formatDisplay(value) || "ДД.ММ.ГГГГ";

  return (
    <div ref={rootRef} className={["date-field relative", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-required={required || undefined}
        onClick={() => {
          if (!disabled) setOpen((o) => !o);
        }}
        className={[
          "mo-input flex w-full min-w-0 items-center justify-between gap-2 text-left",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          !formatDisplay(value) ? "text-[var(--mo-text-muted)]" : "text-[var(--mo-text)]",
        ].join(" ")}
      >
        <span className="min-w-0 truncate tabular-nums">{display}</span>
        <span className="shrink-0 text-[var(--mo-text-muted)]" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      {open && !disabled ? (
        <div className="date-field__popover" role="dialog" aria-label="Выбор даты">
          <MiniMonthCalendar
            compact
            value={value || new Date().toISOString().slice(0, 10)}
            onChange={(d) => {
              onChange(d);
              setOpen(false);
            }}
          />
          <div className="date-field__footer">
            <button
              type="button"
              className="date-field__link"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Удалить
            </button>
            <button
              type="button"
              className="date-field__link"
              onClick={() => {
                onChange(new Date().toISOString().slice(0, 10));
                setOpen(false);
              }}
            >
              Сегодня
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
