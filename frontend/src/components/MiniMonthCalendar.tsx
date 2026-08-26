import { useEffect, useMemo, useState } from "react";

type Props = {
  value: string;
  onChange: (isoDate: string) => void;
  compact?: boolean;
};

const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m || 1, d: d || 1 };
}

export function MiniMonthCalendar({ value, onChange, compact = false }: Props) {
  const selected = parseYmd(value);
  const [view, setView] = useState(() => ({ y: selected.y, m: selected.m }));

  useEffect(() => {
    const { y, m } = parseYmd(value);
    setView((prev) => (prev.y === y && prev.m === m ? prev : { y, m }));
  }, [value]);

  const { label, cells } = useMemo(() => {
    const first = new Date(view.y, view.m - 1, 1);
    const last = new Date(view.y, view.m, 0);
    const startPad = (first.getDay() + 6) % 7;
    const daysInMonth = last.getDate();
    const cells: { day: number | null; iso: string | null; isToday: boolean }[] = [];
    const today = new Date();
    const tY = today.getFullYear();
    const tM = today.getMonth() + 1;
    const tD = today.getDate();

    for (let i = 0; i < startPad; i++) cells.push({ day: null, iso: null, isToday: false });
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${view.y}-${String(view.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({
        day: d,
        iso,
        isToday: view.y === tY && view.m === tM && d === tD,
      });
    }
    const months = [
      "Январь",
      "Февраль",
      "Март",
      "Апрель",
      "Май",
      "Июнь",
      "Июль",
      "Август",
      "Сентябрь",
      "Октябрь",
      "Ноябрь",
      "Декабрь",
    ];
    return { label: `${months[view.m - 1]} ${view.y}`, cells };
  }, [view]);

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.y, v.m - 1 + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    });
  }

  return (
    <div
      className={[
        "w-full rounded-xl border border-[var(--mo-border)] bg-[var(--mo-surface-elevated)]",
        compact ? "p-1.5 mini-month-calendar--compact" : "p-2.5",
      ].join(" ")}
    >
      <div className={["mb-2 flex items-center justify-between gap-1.5", compact ? "mb-1" : ""].join(" ")}>
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className={[
            "rounded-md lux-caption hover:bg-white/5 hover:text-[var(--mo-text)]",
            compact ? "px-1 py-0.5 text-xs" : "px-1.5 py-0.5",
          ].join(" ")}
          aria-label="Предыдущий месяц"
        >
          ‹
        </button>
        <span className={compact ? "text-[10px] font-semibold text-[var(--mo-text)]" : "text-xs font-semibold text-[var(--mo-text)]"}>
          {label}
        </span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className={[
            "rounded-md lux-caption hover:bg-white/5 hover:text-[var(--mo-text)]",
            compact ? "px-1 py-0.5 text-xs" : "px-1.5 py-0.5",
          ].join(" ")}
          aria-label="Следующий месяц"
        >
          ›
        </button>
      </div>
      <div
        className={[
          "grid grid-cols-7 gap-0.5 text-center font-medium uppercase mo-muted",
          compact ? "text-[8px]" : "text-[9px]",
        ].join(" ")}
      >
        {weekDays.map((w) => (
          <div key={w} className="py-0.5">
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          const iso = c.iso ?? null;
          if (c.day == null || iso == null) return <div key={`e-${i}`} />;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onChange(iso)}
              className={[
                "rounded-md font-medium transition-colors",
                compact ? "py-0.5 text-[10px]" : "py-1 text-[11px]",
                iso === value
                  ? "border border-[#8c6d31] bg-[#A38A53] font-semibold text-white shadow-[var(--mo-shadow-luxury)]"
                  : c.isToday
                    ? "border border-[#d4af37] bg-[#f7f2e8] text-[var(--mo-text)]"
                    : "mo-muted hover:bg-[var(--mo-accent-soft)] hover:text-[var(--mo-text)]",
              ].join(" ")}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
