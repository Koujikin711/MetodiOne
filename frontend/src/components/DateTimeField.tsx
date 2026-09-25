import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { MiniMonthCalendar } from "@/components/MiniMonthCalendar";

type Props = {
  value: string;
  onChange: (datetimeLocal: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  /** Шаг минут в списке времени (по умолчанию 15). */
  minuteStep?: 5 | 10 | 15 | 30;
  allowClear?: boolean;
};

const PANEL_W = 340;

function parseLocal(value: string): { date: string; hour: number; minute: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value || "");
  if (!m) return null;
  return { date: m[1], hour: Number(m[2]), minute: Number(m[3]) };
}

function formatDisplay(value: string): string {
  const p = parseLocal(value);
  if (!p) return "";
  const [y, mo, d] = p.date.split("-");
  return `${d}.${mo}.${y}, ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function joinLocal(date: string, hour: number, minute: number): string {
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Разбор «ДД.ММ.ГГГГ, ЧЧ:ММ» / «ДД.ММ.ГГГГ ЧЧ:ММ» / «ДД.ММ.ГГГГ». */
function parseTypedDateTime(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?$/.exec(s);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const mo = Number(m[2]);
  const d = Number(m[1]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(y, mo - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== mo - 1 || check.getDate() !== d) return null;
  const hour = m[4] != null ? Number(m[4]) : 9;
  const minute = m[5] != null ? Number(m[5]) : 0;
  if (hour > 23 || minute > 59) return null;
  return joinLocal(date, hour, minute);
}

function buildTimeOptions(step: number): { hour: number; minute: number; label: string }[] {
  const out: { hour: number; minute: number; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += step) {
      out.push({
        hour: h,
        minute: m,
        label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      });
    }
  }
  return out;
}

function todayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/** Дата+время: ручной ввод + календарь. Значение: YYYY-MM-DDTHH:mm */
export function DateTimeField({
  value,
  onChange,
  disabled = false,
  required = false,
  className = "",
  id,
  "aria-label": ariaLabel,
  minuteStep = 15,
  allowClear = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => formatDisplay(value));
  const [focused, setFocused] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timeListRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!focused) setDraft(formatDisplay(value));
  }, [value, focused]);

  const parsed = parseLocal(value);
  const datePart = parsed?.date ?? todayYmd();
  const hour = parsed?.hour ?? 9;
  const minute = parsed?.minute ?? 0;
  const times = buildTimeOptions(minuteStep);
  const selectedLabel = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if ((e.target as Element | null)?.closest?.(".date-time-field__panel")) return;
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
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 6;
      const panelH = 320;
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

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      const root = timeListRef.current;
      if (!root) return;
      const sel = root.querySelector<HTMLElement>("[data-selected='1']");
      sel?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, selectedLabel]);

  function commitDraft(raw: string) {
    const next = parseTypedDateTime(raw);
    if (next) {
      onChange(next);
      setDraft(formatDisplay(next));
      return;
    }
    setDraft(formatDisplay(value));
  }

  function setDate(isoDate: string) {
    onChange(joinLocal(isoDate, hour, minute));
  }

  function setTime(h: number, m: number) {
    onChange(joinLocal(datePart, h, m));
  }

  function goNow() {
    const n = new Date();
    const step = minuteStep;
    const rounded = Math.round(n.getMinutes() / step) * step;
    const h = rounded >= 60 ? n.getHours() + 1 : n.getHours();
    const m = rounded >= 60 ? 0 : rounded;
    onChange(joinLocal(todayYmd(), Math.min(23, h), m));
    setOpen(false);
  }

  const panel =
    open && panelPos && !disabled && typeof document !== "undefined"
      ? createPortal(
          <div
            role="dialog"
            aria-label="Выбор даты и времени"
            className="date-time-field__panel"
            style={{ top: panelPos.top, left: panelPos.left, width: PANEL_W }}
          >
            <div className="date-time-field__body">
              <div className="date-time-field__cal">
                <MiniMonthCalendar compact value={datePart} onChange={setDate} />
              </div>
              <div className="date-time-field__times" ref={timeListRef} role="listbox" aria-label="Время">
                {times.map((t) => {
                  const selected = t.label === selectedLabel;
                  return (
                    <button
                      key={t.label}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-selected={selected ? "1" : undefined}
                      className={[
                        "date-time-field__time",
                        selected ? "is-selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setTime(t.hour, t.minute)}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="date-time-field__footer">
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
              <button type="button" className="date-field__link" onClick={goNow}>
                Сейчас
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={["date-time-field relative", className].filter(Boolean).join(" ")}>
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
          placeholder="ДД.ММ.ГГГГ, --:--"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
