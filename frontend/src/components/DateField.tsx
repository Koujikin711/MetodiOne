import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { MiniMonthCalendar } from "@/components/MiniMonthCalendar";

type Props = {
  value: string;
  onChange: (isoDate: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  allowClear?: boolean;
};

const PANEL_W = 280;

function formatDisplay(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function todayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
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
  allowClear = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if ((e.target as Element | null)?.closest?.(".date-field__panel")) return;
      setOpen(false);
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
      const panelH = 300;
      let left = r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - PANEL_W - 8));
      let top = r.bottom + gap;
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

  const display = formatDisplay(value) || "ДД.ММ.ГГГГ";

  const panel =
    open && panelPos && !disabled && typeof document !== "undefined"
      ? createPortal(
          <div
            role="dialog"
            aria-label="Выбор даты"
            className="date-field__panel"
            style={{ top: panelPos.top, left: panelPos.left, width: PANEL_W }}
          >
            <MiniMonthCalendar
              compact
              value={value || todayYmd()}
              onChange={(d) => {
                onChange(d);
                setOpen(false);
              }}
            />
            <div className="date-field__footer">
              {allowClear ? (
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
              ) : (
                <span />
              )}
              <button
                type="button"
                className="date-field__link"
                onClick={() => {
                  onChange(todayYmd());
                  setOpen(false);
                }}
              >
                Сегодня
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={["date-field relative", className].filter(Boolean).join(" ")}>
      <button
        ref={triggerRef}
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
      {panel}
    </div>
  );
}
