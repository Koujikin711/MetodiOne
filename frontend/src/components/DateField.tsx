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
  /** Только иконка календаря (дата в title / aria). */
  iconOnly?: boolean;
  /** Подпись, если дата не выбрана. */
  placeholder?: string;
};

const PANEL_W = 280;

function formatDisplay(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Только цифры и разделители даты — буквы отсекаем сразу. */
function sanitizeDateDraft(raw: string): string {
  return raw.replace(/[^\d./]/g, "").slice(0, 10);
}

/** Разбор «ДД.ММ.ГГГГ» / «ДД/ММ/ГГ». */
function parseTypedDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const mo = Number(m[2]);
  const d = Number(m[1]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const check = new Date(y, mo - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== mo - 1 || check.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function todayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/** Дата: ручной ввод + календарь (без нативного Chrome-календаря). */
export function DateField({
  value,
  onChange,
  disabled = false,
  required = false,
  className = "",
  id,
  "aria-label": ariaLabel,
  allowClear = true,
  iconOnly = false,
  placeholder = "ДД.ММ.ГГГГ",
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => formatDisplay(value));
  const [focused, setFocused] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!focused) setDraft(formatDisplay(value));
  }, [value, focused]);

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
      const el = rootRef.current ?? triggerRef.current;
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

  const selectedLabel = formatDisplay(value);
  const buttonLabel = selectedLabel
    ? `${ariaLabel ?? "Дата"}: ${selectedLabel}`
    : (ariaLabel ?? "Выбрать дату");

  function commitDraft(raw: string) {
    if (!raw.trim()) {
      if (allowClear) {
        onChange("");
        setDraft("");
      } else {
        setDraft(formatDisplay(value));
      }
      return;
    }
    const next = parseTypedDate(raw);
    if (next) {
      onChange(next);
      setDraft(formatDisplay(next));
      return;
    }
    setDraft(formatDisplay(value));
  }

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
                    setDraft("");
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

  if (iconOnly) {
    return (
      <div
        ref={rootRef}
        className={["date-field relative date-field--icon-only", className].filter(Boolean).join(" ")}
      >
        <button
          ref={triggerRef}
          type="button"
          id={id}
          disabled={disabled}
          title={selectedLabel || buttonLabel}
          aria-label={buttonLabel}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-required={required || undefined}
          onClick={() => {
            if (!disabled) setOpen((o) => !o);
          }}
          className={[
            "mo-input flex min-w-0 items-center justify-center gap-0 px-1.5 text-left",
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            !selectedLabel ? "text-[var(--mo-text-muted)]" : "text-[var(--mo-text)]",
          ].join(" ")}
        >
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

  return (
    <div ref={rootRef} className={["date-field relative", className].filter(Boolean).join(" ")}>
      <div
        className={[
          "mo-input flex w-full min-w-0 items-center gap-1",
          disabled ? "cursor-not-allowed opacity-50" : "",
        ].join(" ")}
      >
        <input
          id={id}
          type="text"
          inputMode="numeric"
          disabled={disabled}
          required={required}
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(sanitizeDateDraft(e.target.value))}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commitDraft(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft(draft);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[inherit] outline-none tabular-nums placeholder:text-[var(--mo-text-muted)]"
          autoComplete="off"
        />
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-label="Открыть календарь"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => {
            if (!disabled) setOpen((o) => !o);
          }}
          className="shrink-0 rounded-md p-0.5 text-[var(--mo-text-muted)] hover:bg-[var(--mo-accent-soft)] hover:text-[var(--mo-text)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {panel}
    </div>
  );
}
